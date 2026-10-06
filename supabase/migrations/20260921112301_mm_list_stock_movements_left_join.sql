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
$fn$;;
