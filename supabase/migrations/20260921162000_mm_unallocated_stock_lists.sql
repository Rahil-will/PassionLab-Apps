-- Stock, movements, rack, putaway: LEFT JOIN style; fabric from unit.fabric_type_id.

CREATE OR REPLACE FUNCTION public._mm_stock_movement_kind(
  p_entry_type text,
  p_note text,
  p_ref_table text,
  p_status_after text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type IN ('ALLOCATE', 'UNALLOCATE') THEN 'allocation'
    WHEN COALESCE(p_note, '') ILIKE '%4-point%'
      OR p_ref_table = 'mm_warehouse_inspections'
      THEN 'qc'
    WHEN COALESCE(p_note, '') ILIKE '%dispatched to cutting%'
      OR p_ref_table = 'mm_store_challans'
      THEN 'dispatch'
    WHEN COALESCE(p_note, '') ILIKE '%red label%'
      OR COALESCE(p_note, '') ILIKE '%rack move%'
      OR p_ref_table = 'mm_locations'
      THEN 'putaway'
    WHEN p_entry_type IN ('INHOUSE_IN', 'RECEIPT_IN')
      OR COALESCE(p_note, '') ILIKE '%warehouse receive%'
      OR p_ref_table = 'mm_in_challans'
      THEN 'received'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION public._mm_stock_movement_action(
  p_entry_type text,
  p_note text,
  p_ref_table text,
  p_status_after text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type = 'ALLOCATE' THEN 'Allocated'
    WHEN p_entry_type = 'UNALLOCATE' THEN 'Unallocated'
    WHEN COALESCE(p_note, '') ILIKE '%4-point pass%'
      OR (p_ref_table = 'mm_warehouse_inspections' AND p_status_after = 'in_stock')
      THEN '4-point pass'
    WHEN COALESCE(p_note, '') ILIKE '%4-point fail%'
      OR (p_ref_table = 'mm_warehouse_inspections' AND p_status_after = 'rejected')
      THEN '4-point fail'
    WHEN COALESCE(p_note, '') ILIKE '%dispatched to cutting%'
      OR p_ref_table = 'mm_store_challans'
      THEN 'Dispatched to cutting'
    WHEN COALESCE(p_note, '') ILIKE '%red label%' THEN 'Moved to red label'
    WHEN COALESCE(p_note, '') ILIKE '%rack move%' OR p_ref_table = 'mm_locations' THEN 'Putaway'
    WHEN COALESCE(p_note, '') ILIKE '%warehouse receive%' THEN 'Received into warehouse'
    WHEN p_entry_type = 'INHOUSE_IN' THEN 'Mill inbound'
    WHEN p_entry_type = 'RECEIPT_IN' THEN 'Vendor inbound'
    WHEN p_ref_table = 'mm_in_challans' AND p_status_after = 'in_transit' THEN 'Mill dispatched'
    WHEN p_ref_table = 'mm_in_challans' THEN 'Received into warehouse'
    WHEN NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL THEN btrim(p_note)
    ELSE 'Move'
  END
$$;

CREATE OR REPLACE FUNCTION public.mm_list_warehouse_stock(
  p_search text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_buyer text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_q text;
  v_loc text;
  v_buyer text;
  v_page integer;
  v_size integer;
  v_off integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  v_q := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_loc := COALESCE(NULLIF(btrim(COALESCE(p_location, '')), ''), 'warehouse');
  v_buyer := NULLIF(btrim(COALESCE(p_buyer, '')), '');
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
  v_off := (v_page - 1) * v_size;

  RETURN public._mm_ok((
    WITH units AS (
      SELECT
        u.id,
        u.unit_code,
        u.length_m,
        u.uom,
        u.status,
        u.in_challan_id,
        u.store_challan_id,
        u.style_material_id,
        u.fabric_type_id,
        u.color_ref,
        u.lot_no,
        public._mm_stock_location_bucket(u.status, u.current_location_id, v_wh, v_cut) AS bucket,
        loc.code AS location_code,
        loc.name AS location_name,
        o.id AS order_id,
        o.style_name,
        o.style_ref,
        o.buyer_name,
        o.po_number,
        cw.name AS color_name,
        COALESCE(NULLIF(trim(cm.name), ''), ft.name) AS fabric_name,
        ft.name AS fabric_type,
        c.challan_no,
        c.source AS challan_source,
        COALESCE(c.received_at, u.created_at) AS received_at
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      WHERE u.factory_id = v_factory
    ),
    scoped AS (
      SELECT *
      FROM units
      WHERE bucket <> 'other'
        AND (
          CASE v_loc
            WHEN 'warehouse' THEN bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
            WHEN 'pending_test' THEN bucket = 'pending_test'
            WHEN 'receiving' THEN bucket = 'receiving'
            WHEN 'rack' THEN bucket = 'rack'
            WHEN 'red_label' THEN bucket = 'red_label'
            WHEN 'cutting' THEN bucket = 'cutting'
            WHEN 'unallocated' THEN
              bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
              AND style_material_id IS NULL
            ELSE bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
          END
        )
        AND (v_buyer IS NULL OR buyer_name = v_buyer)
        AND (
          v_q IS NULL OR concat_ws(' ',
            unit_code, style_name, style_ref, buyer_name, po_number, color_name,
            fabric_name, fabric_type, location_code, location_name, challan_no, color_ref, lot_no
          ) ILIKE '%' || v_q || '%'
        )
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*)::int FROM scoped),
      'counts', jsonb_build_object(
        'pending_test', (SELECT count(*)::int FROM units WHERE bucket = 'pending_test'),
        'receiving', (SELECT count(*)::int FROM units WHERE bucket = 'receiving'),
        'rack', (SELECT count(*)::int FROM units WHERE bucket = 'rack'),
        'red_label', (SELECT count(*)::int FROM units WHERE bucket = 'red_label'),
        'unallocated', (
          SELECT count(*)::int FROM units
          WHERE bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
            AND style_material_id IS NULL
        )
      ),
      'buyers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', b.name) ORDER BY b.name)
        FROM (
          SELECT DISTINCT buyer_name AS name
          FROM units
          WHERE bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
            AND NULLIF(trim(buyer_name), '') IS NOT NULL
        ) b
      ), '[]'::jsonb),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id,
          'unit_code', s.unit_code,
          'qty', s.length_m,
          'uom', s.uom,
          'status', s.status,
          'bucket', s.bucket,
          'status_label', public._mm_stock_location_label(s.bucket),
          'location_code', s.location_code,
          'location_name', s.location_name,
          'order_id', s.order_id,
          'style_material_id', s.style_material_id,
          'style_name', COALESCE(s.style_name, 'Unallocated'),
          'style_ref', s.style_ref,
          'buyer_name', s.buyer_name,
          'po_number', s.po_number,
          'color_name', s.color_name,
          'color_ref', s.color_ref,
          'lot_no', s.lot_no,
          'fabric_name', s.fabric_name,
          'fabric_type', s.fabric_type,
          'fabric_type_id', s.fabric_type_id,
          'in_challan_id', s.in_challan_id,
          'challan_no', s.challan_no,
          'challan_source', s.challan_source,
          'store_challan_id', s.store_challan_id,
          'received_at', s.received_at
        ) ORDER BY s.received_at DESC NULLS LAST, s.unit_code)
        FROM (
          SELECT * FROM scoped
          ORDER BY received_at DESC NULLS LAST, unit_code
          OFFSET v_off LIMIT v_size
        ) s
      ), '[]'::jsonb)
    )
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_stock_movements(
  p_search text DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_q text;
  v_kind text;
  v_page integer;
  v_size integer;
  v_off integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_q := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_kind := NULLIF(btrim(COALESCE(p_kind, '')), '');
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
  v_off := (v_page - 1) * v_size;

  RETURN public._mm_ok((
    WITH moves AS (
      SELECT
        sl.id,
        sl.txn_at,
        sl.qty_delta,
        sl.ref_table,
        sl.ref_id,
        sl.status_after,
        public._mm_stock_movement_kind(sl.entry_type, sl.note, sl.ref_table, sl.status_after) AS kind,
        public._mm_stock_movement_action(sl.entry_type, sl.note, sl.ref_table, sl.status_after) AS action,
        u.id AS stock_unit_id,
        u.unit_code,
        u.uom,
        u.status,
        u.in_challan_id,
        loc_from.code AS from_code,
        loc_from.name AS from_name,
        loc_to.code AS to_code,
        loc_to.name AS to_name,
        o.id AS order_id,
        o.style_name,
        o.style_ref,
        o.buyer_name,
        cw.name AS color_name,
        COALESCE(NULLIF(trim(cm.name), ''), ft.name) AS fabric_name,
        COALESCE(inch.challan_no, sc.challan_no) AS doc_no,
        COALESCE(inch.source, CASE WHEN sc.id IS NOT NULL THEN 'store' ELSE NULL END) AS doc_source,
        COALESCE(inch.id, CASE WHEN sl.ref_table = 'mm_warehouse_inspections' THEN sl.ref_id ELSE NULL END) AS in_challan_id_resolved,
        sc.id AS store_challan_id
      FROM public.mm_stock_ledger sl
      JOIN public.mm_stock_units u ON u.id = sl.stock_unit_id
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      LEFT JOIN public.mm_locations loc_from ON loc_from.id = sl.location_before
      LEFT JOIN public.mm_locations loc_to ON loc_to.id = sl.location_after
      LEFT JOIN public.mm_in_challans inch ON (
        (sl.ref_table = 'mm_in_challans' AND inch.id = sl.ref_id)
        OR (sl.ref_table = 'mm_warehouse_inspections' AND inch.id = sl.ref_id)
      )
      LEFT JOIN public.mm_store_challans sc ON sl.ref_table = 'mm_store_challans' AND sc.id = sl.ref_id
      WHERE sl.factory_id = v_factory
    ),
    scoped AS (
      SELECT *
      FROM moves
      WHERE (v_kind IS NULL OR kind = v_kind)
        AND (
          v_q IS NULL OR concat_ws(' ',
            action, unit_code, style_name, style_ref, buyer_name, color_name,
            fabric_name, from_code, from_name, to_code, to_name, doc_no
          ) ILIKE '%' || v_q || '%'
        )
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*)::int FROM scoped),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id,
          'txn_at', s.txn_at,
          'kind', s.kind,
          'action', s.action,
          'qty', s.qty_delta,
          'uom', s.uom,
          'unit_code', s.unit_code,
          'status', s.status,
          'from_code', s.from_code,
          'from_name', s.from_name,
          'to_code', s.to_code,
          'to_name', s.to_name,
          'order_id', s.order_id,
          'style_name', COALESCE(s.style_name, 'Unallocated'),
          'style_ref', s.style_ref,
          'buyer_name', s.buyer_name,
          'color_name', s.color_name,
          'fabric_name', s.fabric_name,
          'doc_no', s.doc_no,
          'doc_source', s.doc_source,
          'ref_table', s.ref_table,
          'ref_id', s.ref_id,
          'in_challan_id', COALESCE(s.in_challan_id_resolved, s.in_challan_id),
          'store_challan_id', s.store_challan_id
        ) ORDER BY s.txn_at DESC, s.unit_code)
        FROM (
          SELECT * FROM scoped
          ORDER BY txn_at DESC, unit_code
          OFFSET v_off LIMIT v_size
        ) s
      ), '[]'::jsonb)
    )
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_red uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_red := public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL');
  RETURN public._mm_ok(jsonb_build_object(
    'warehouse_id', v_wh,
    'red_label_id', v_red,
    'rack_targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id, 'code', loc.code, 'name', loc.name, 'location_type', loc.location_type,
        'capacity_rolls', loc.capacity_rolls,
        'roll_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'
        )
      ) ORDER BY loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('rack', 'bin') AND loc.is_pickable
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb),
    'unassigned_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'uom', u.uom,
        'shade', u.shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY COALESCE(o.style_name, 'Unallocated'), cw.name, ch.challan_no NULLS LAST, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ), '[]'::jsonb),
    'racked_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'uom', u.uom,
        'shade', u.shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY loc.code, COALESCE(o.style_name, 'Unallocated'), cw.name, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ), '[]'::jsonb),
    'red_label_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'uom', u.uom,
        'shade', u.shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND (u.status = 'rejected' OR loc.location_type = 'rejected')
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_putaway_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id, 'code', loc.code, 'name', loc.name, 'location_type', loc.location_type
      ) ORDER BY loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('rack', 'bin')
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'length_m', u.length_m,
        'shade', u.shade,
        'lot_no', u.lot_no,
        'color_ref', u.color_ref,
        'source', u.source,
        'style_name', COALESCE(o.style_name, 'Unallocated'),
        'color_name', cw.name,
        'fabric_type', ft.name,
        'location_code', loc.code,
        'location_name', loc.name
      ) ORDER BY COALESCE(o.style_name, 'Unallocated'), u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND NOT public._mm_is_pickable_loc(u.current_location_id)
    ), '[]'::jsonb)
  ));
END;
$fn$;
