-- Expected receipts board + unallocated receive + allocate / unallocate.

CREATE OR REPLACE FUNCTION public.mm_get_expected_board(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
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
  v_status text;
  v_q text;
  v_limit integer;
  v_off integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  v_status := lower(NULLIF(btrim(COALESCE(p_status, '')), ''));
  v_q := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_off := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN public._mm_ok((
    WITH cells AS (
      SELECT
        o.id AS order_id,
        o.style_name,
        o.style_ref,
        o.buyer_name,
        o.po_number,
        c.id AS colorway_id,
        c.name AS color_name,
        cm.id AS fabric_line_id,
        ft.id AS fabric_type_id,
        COALESCE(NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), ft.name, 'Fabric') AS fabric_name,
        COALESCE(ft.name, NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_type,
        CASE
          WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
            THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
          ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), ''))
        END AS fabric_category,
        COALESCE(cm.total_cons, 0) AS required_m,
        NULLIF(trim(cm.unit), '') AS uom,
        sm.id AS style_material_id,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'
        ), 0) AS qty_incoming_m,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'
        ), 0) AS rolls_incoming,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND (
              u.status = 'pending_qc'
              OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
              OR public._mm_loc_is_under(u.current_location_id, v_cut)
            )
        ), 0) AS qty_received_m,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND (
              u.status = 'pending_qc'
              OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
              OR public._mm_loc_is_under(u.current_location_id, v_cut)
            )
        ), 0) AS rolls_received
      FROM public.style_orders o
      JOIN public.colorways c
        ON c.order_id = o.id AND c.factory_id = v_factory
      JOIN public.colorway_materials cm
        ON cm.colorway_id = c.id AND cm.factory_id = v_factory AND cm.kind = 'Fabric'
      LEFT JOIN public.mm_fabric_types ft
        ON ft.factory_id = v_factory AND ft.is_active
       AND lower(ft.name) = lower(NULLIF(trim(cm.type), ''))
      LEFT JOIN public.mm_style_materials sm
        ON sm.factory_id = v_factory
       AND sm.order_id = o.id
       AND sm.colorway_id = c.id
       AND (
         sm.colorway_material_id = cm.id
         OR (sm.colorway_material_id IS NULL AND sm.fabric_type_id IS NOT DISTINCT FROM ft.id)
       )
      WHERE o.factory_id = v_factory
        AND o.status IS DISTINCT FROM 'Completed'
        AND o.status IS DISTINCT FROM 'Cancelled'
    ),
    scored AS (
      SELECT
        cells.*,
        GREATEST(0, cells.required_m - cells.qty_received_m) AS qty_still_due_m,
        GREATEST(0, cells.required_m - cells.qty_received_m - cells.qty_incoming_m) AS qty_uncovered_m,
        CASE
          WHEN cells.qty_received_m >= cells.required_m THEN 'met'
          WHEN cells.qty_incoming_m > 0 THEN 'incoming'
          ELSE 'due'
        END AS row_status
      FROM cells
    ),
    filtered AS (
      SELECT *
      FROM scored
      WHERE (
          CASE
            WHEN v_status IS NULL OR v_status IN ('', 'open') THEN row_status IN ('due', 'incoming')
            WHEN v_status = 'all' THEN true
            ELSE row_status = v_status
          END
        )
        AND (
          v_q IS NULL OR concat_ws(' ',
            style_name, style_ref, buyer_name, po_number, color_name, fabric_name, fabric_type
          ) ILIKE '%' || v_q || '%'
        )
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*)::int FROM filtered),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id', f.order_id,
          'style_name', f.style_name,
          'style_ref', f.style_ref,
          'buyer_name', f.buyer_name,
          'po_number', f.po_number,
          'colorway_id', f.colorway_id,
          'color_name', f.color_name,
          'fabric_line_id', f.fabric_line_id,
          'fabric_type_id', f.fabric_type_id,
          'fabric_name', f.fabric_name,
          'fabric_type', f.fabric_type,
          'fabric_category', f.fabric_category,
          'uom', f.uom,
          'style_material_id', f.style_material_id,
          'required_m', f.required_m,
          'qty_incoming_m', f.qty_incoming_m,
          'rolls_incoming', f.rolls_incoming,
          'qty_received_m', f.qty_received_m,
          'rolls_received', f.rolls_received,
          'qty_still_due_m', f.qty_still_due_m,
          'qty_uncovered_m', f.qty_uncovered_m,
          'status', f.row_status
        ) ORDER BY
          CASE f.row_status WHEN 'due' THEN 0 WHEN 'incoming' THEN 1 ELSE 2 END,
          f.style_name, f.color_name, f.fabric_name)
        FROM (
          SELECT * FROM filtered
          ORDER BY
            CASE row_status WHEN 'due' THEN 0 WHEN 'incoming' THEN 1 ELSE 2 END,
            style_name, color_name, fabric_name
          OFFSET v_off LIMIT v_limit
        ) f
      ), '[]'::jsonb)
    )
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_vendor_grn(
  p_fabric_type_id uuid,
  p_supplier_name text,
  p_uom text,
  p_color_ref text,
  p_lot_no text,
  p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch uuid;
  v_no text;
  v_n integer;
  v_recv uuid;
  v_sup text;
  v_ft uuid;
  v_uom text;
  v_color text;
  v_lot text;
  v_rolls jsonb;
  v_row jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_sup := NULLIF(trim(COALESCE(p_supplier_name, '')), '');
  IF v_sup IS NULL THEN RETURN public._mm_err('REQUIRED', 'Supplier name is required'); END IF;
  SELECT id INTO v_ft FROM public.mm_fabric_types
  WHERE id = p_fabric_type_id AND factory_id = v_factory AND is_active;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  v_uom := COALESCE(NULLIF(trim(COALESCE(p_uom, '')), ''), 'm');
  v_color := NULLIF(trim(COALESCE(p_color_ref, '')), '');
  v_lot := NULLIF(trim(COALESCE(p_lot_no, '')), '');
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Add at least one roll');
  END IF;
  v_rolls := '[]'::jsonb;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_rolls := v_rolls || jsonb_build_array(
      v_row || jsonb_build_object(
        'fabric_type_id', v_ft,
        'uom', v_uom,
        'color_ref', COALESCE(NULLIF(trim(COALESCE(v_row->>'color_ref', '')), ''), v_color),
        'lot_no', COALESCE(NULLIF(trim(COALESCE(v_row->>'lot_no', '')), ''), v_lot)
      )
    );
  END LOOP;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  v_no := public.next_doc_no('GRN');
  INSERT INTO public.mm_in_challans (
    factory_id, challan_no, source, style_material_id, supplier_name, status,
    received_at, received_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, 'vendor', NULL, v_sup, 'received', now(), auth.uid(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_ch;
  BEGIN
    v_n := public._mm_insert_rolls(v_factory, NULL, v_ch, 'vendor', 'pending_qc', v_recv, v_rolls, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_mill_batch(
  p_fabric_type_id uuid,
  p_batch_no text,
  p_mill_ref text,
  p_production_date date,
  p_remarks text,
  p_color_ref text,
  p_lot_no text,
  p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ft uuid;
  v_batch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
  v_date date;
  v_color text;
  v_lot text;
  v_rolls jsonb;
  v_row jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  SELECT id INTO v_ft FROM public.mm_fabric_types
  WHERE id = p_fabric_type_id AND factory_id = v_factory AND is_active;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  v_color := NULLIF(trim(COALESCE(p_color_ref, '')), '');
  v_lot := NULLIF(trim(COALESCE(p_lot_no, '')), '');
  v_rolls := '[]'::jsonb;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_rolls := v_rolls || jsonb_build_array(
      v_row || jsonb_build_object(
        'color_ref', COALESCE(NULLIF(trim(COALESCE(v_row->>'color_ref', '')), ''), v_color),
        'lot_no', COALESCE(NULLIF(trim(COALESCE(v_row->>'lot_no', '')), ''), v_lot)
      )
    );
  END LOOP;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, fabric_type_id, batch_no, mill_ref, production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, NULL, v_ft, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''), auth.uid(), auth.uid()
    ) RETURNING id INTO v_batch;
    v_n := public._mm_insert_mill_batch_rolls(v_factory, NULL, v_batch, v_mill, v_rolls);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
    WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_unallocated_mill()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object(
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'batch_no', b.batch_no,
        'mill_ref', b.mill_ref,
        'production_date', b.production_date,
        'remarks', b.remarks,
        'fabric_type_id', b.fabric_type_id,
        'fabric_type', ft.name,
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      JOIN public.mm_fabric_types ft ON ft.id = b.fabric_type_id
      WHERE b.factory_id = v_factory AND b.style_material_id IS NULL
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'unit_code', r.unit_code,
        'mill_batch_id', r.mill_batch_id,
        'batch_no', b.batch_no,
        'length_m', r.length_m,
        'weight_kg', r.weight_kg,
        'shade', r.shade,
        'lot_no', r.lot_no,
        'color_ref', r.color_ref,
        'attributes', r.attributes,
        'status', r.status,
        'fabric_type_id', r.fabric_type_id,
        'fabric_type', ft.name,
        'in_challan_id', r.in_challan_id,
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL)
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
      WHERE r.factory_id = v_factory AND r.style_material_id IS NULL
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_unit_alloc_ok(
  p_status text, p_loc uuid, p_store uuid, p_wh uuid, p_cut uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT p_store IS NULL
    AND public._mm_stock_location_bucket(p_status, p_loc, p_wh, p_cut)
      IN ('pending_test', 'receiving', 'rack', 'red_label')
$$;

CREATE OR REPLACE FUNCTION public.mm_allocate_rolls_to_style(
  p_unit_ids uuid[],
  p_order_id uuid,
  p_colorway_id uuid,
  p_colorway_material_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ft uuid;
  v_wh uuid;
  v_cut uuid;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
  v_qty numeric := 0;
  v_have numeric := 0;
  v_required numeric := 0;
  v_style text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to allocate');
  END IF;
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm_id;
  SELECT style_name INTO v_style FROM public.style_orders WHERE id = p_order_id;
  SELECT COALESCE(cm.total_cons, 0) INTO v_required
  FROM public.colorway_materials cm WHERE cm.id = p_colorway_material_id;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.style_material_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'Select only unallocated rolls');
    END IF;
    IF v_unit.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Fabric type must match the style fabric');
    END IF;
    IF NOT public._mm_unit_alloc_ok(v_unit.status, v_unit.current_location_id, v_unit.store_challan_id, v_wh, v_cut) THEN
      RETURN public._mm_err('INVALID', 'Allocate only rolls in warehouse receiving, rack, test, or red label');
    END IF;
    UPDATE public.mm_stock_units SET
      style_material_id = v_sm_id,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = v_sm_id,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_unit.mill_roll_id AND factory_id = v_factory;
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'ALLOCATE', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_style_materials', v_sm_id, 'Allocated to ' || COALESCE(v_style, 'style')
    );
    v_n := v_n + 1;
    v_qty := v_qty + COALESCE(v_unit.length_m, 0);
  END LOOP;

  SELECT COALESCE(sum(u.length_m), 0) INTO v_have
  FROM public.mm_stock_units u
  WHERE u.style_material_id = v_sm_id
    AND (
      u.status = 'pending_qc'
      OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
      OR public._mm_loc_is_under(u.current_location_id, v_cut)
    );

  RETURN public._mm_ok(jsonb_build_object(
    'count', v_n,
    'style_material_id', v_sm_id,
    'over_allocated', (v_have > v_required)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_unallocate_rolls(p_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to unallocate');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.style_material_id IS NULL THEN
      RETURN public._mm_err('INVALID', 'Select only allocated rolls');
    END IF;
    IF NOT public._mm_unit_alloc_ok(v_unit.status, v_unit.current_location_id, v_unit.store_challan_id, v_wh, v_cut) THEN
      RETURN public._mm_err('INVALID', 'Unallocate only rolls still in the warehouse');
    END IF;
    UPDATE public.mm_stock_units SET
      style_material_id = NULL,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = NULL,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_unit.mill_roll_id AND factory_id = v_factory;
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'UNALLOCATE', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_stock_units', v_unit.id, 'Unallocated'
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('count', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_get_expected_board(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_save_unallocated_vendor_grn(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_unallocated_mill() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_unit_alloc_ok(text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_allocate_rolls_to_style(uuid[], uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_unallocate_rolls(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mm_get_expected_board(text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_vendor_grn(uuid, text, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_unallocated_mill() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_allocate_rolls_to_style(uuid[], uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_unallocate_rolls(uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
