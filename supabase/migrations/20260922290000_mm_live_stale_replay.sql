-- DO NOT APPLY. Historical snapshot only.
-- Later migrations dropped mm_save_vendor_in_challan, mm_send_to_warehouse,
-- mm_list_putaway_queue, mm_list_warehouse_locations, mm_save_warehouse_location,
-- and mm_deactivate_warehouse_location, and renamed mm_resolve_style_material to
-- _mm_resolve_style_material. Re-applying this file would recreate those RPCs.
-- Live catalog replay for material functions whose latest repo CREATE body
-- does not match project xtfljldeceonqyzgkoyp, plus functions that never had a CREATE.
-- Bodies are pg_get_functiondef. A store challan does not refuse missing or mixed shade.

DROP FUNCTION IF EXISTS public.mm_create_store_challan(uuid, uuid[], text, text, date, text, boolean);
CREATE OR REPLACE FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_recv uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_status text;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source <> 'mill' THEN RETURN public._mm_err('INVALID', 'Not a mill challan'); END IF;
  IF v_ch.status IN ('received', 'short_closed') THEN RETURN public._mm_err('ALREADY', 'Already received'); END IF;
  IF v_ch.status NOT IN ('pending', 'partial') THEN RETURN public._mm_err('INVALID', 'Challan cannot be received'); END IF;
  IF v_ch.row_version IS DISTINCT FROM COALESCE(p_row_version, v_ch.row_version) THEN
    RETURN public._mm_err('STALE_VERSION', 'Reload and try again');
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_missing_unit_ids, ARRAY[]::uuid[])) AS mid(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mm_stock_units u
      WHERE u.id = mid.id AND u.in_challan_id = v_ch.id AND u.factory_id = v_factory AND u.status = 'in_transit'
    )
  ) THEN
    RETURN public._mm_err('INVALID', 'A missing roll is not in transit on this challan');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_recv := public._mm_recv_loc(v_factory);
  FOR v_unit IN
    SELECT * FROM public.mm_stock_units
    WHERE in_challan_id = v_ch.id AND factory_id = v_factory AND status = 'in_transit'
      AND NOT (id = ANY (COALESCE(p_missing_unit_ids, ARRAY[]::uuid[])))
  LOOP
    UPDATE public.mm_stock_units SET
      status = 'pending_qc', current_location_id = v_recv,
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_unit.id;
    UPDATE public.mm_in_challan_lines
    SET line_status = 'received', received_at = now(), received_by = public._mm_actor_id()
    WHERE stock_unit_id = v_unit.id AND challan_id = v_ch.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', public._mm_mill_length(v_unit), v_unit.status, 'pending_qc',
      v_unit.current_location_id, v_recv, 'mm_in_challans', v_ch.id, 'Warehouse receive'
    );
    v_n := v_n + 1;
  END LOOP;
  v_status := public._mm_refresh_in_challan_status(v_ch.id);
  PERFORM public._mm_apply_clearance(ARRAY(
    SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id
  ));
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'status', v_status, 'received_rolls', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_receive_store_challan(p_id uuid, p_missing_unit_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_sc public.mm_store_challans%ROWTYPE;
  v_id uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_missing int := 0;
  v_received int := 0;
  v_status text;
  v_missing_ids uuid[];
BEGIN
  v_missing_ids := ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(p_missing_unit_ids, ARRAY[]::uuid[])) AS x
  );
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  SELECT * INTO v_sc
  FROM public.mm_store_challans
  WHERE id = p_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Store challan not found'); END IF;
  IF v_sc.status IN ('received', 'partial') THEN
    RETURN public._mm_err('ALREADY', 'Already received');
  END IF;

  FOREACH v_id IN ARRAY v_missing_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_store_challan_lines l
      WHERE l.challan_id = v_sc.id AND l.stock_unit_id = v_id
    ) THEN
      RETURN public._mm_err('INVALID', 'A missing roll is not on this challan');
    END IF;
    SELECT * INTO v_unit
    FROM public.mm_stock_units
    WHERE id = v_id AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    IF v_unit.status IS DISTINCT FROM 'issued' THEN
      RETURN public._mm_err('INVALID', v_unit.unit_code || ' is not still at cutting');
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_missing_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id FOR UPDATE;
    PERFORM public._mm_ledger(
      v_factory, v_id, 'WRITE_OFF', v_unit.qty_available,
      v_unit.status, 'missing',
      v_unit.current_location_id, NULL,
      'mm_store_challans', v_sc.id, 'missing at cutting receive'
    );
    UPDATE public.mm_stock_units
    SET status = 'missing',
        current_location_id = NULL,
        updated_at = now(),
        updated_by = public._mm_actor_id()
    WHERE id = v_id;
    UPDATE public.mm_store_challan_lines
    SET line_status = 'missing',
        received_at = now(),
        received_by = public._mm_actor_id()
    WHERE challan_id = v_sc.id AND stock_unit_id = v_id;
    v_missing := v_missing + 1;
  END LOOP;

  UPDATE public.mm_store_challan_lines
  SET line_status = 'received',
      received_at = now(),
      received_by = public._mm_actor_id()
  WHERE challan_id = v_sc.id
    AND line_status = 'pending'
    AND NOT (stock_unit_id = ANY (v_missing_ids));
  GET DIAGNOSTICS v_received = ROW_COUNT;

  v_status := CASE WHEN v_missing > 0 THEN 'partial' ELSE 'received' END;
  UPDATE public.mm_store_challans
  SET status = v_status,
      received_at = now(),
      received_by = public._mm_actor_id(),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = v_sc.id;

  RETURN public._mm_ok(jsonb_build_object(
    'id', v_sc.id,
    'status', v_status,
    'received_rolls', v_received,
    'missing_rolls', v_missing
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.mm_receive_mill_in_challan(p_id, p_roll_edits, p_row_version, NULL::uuid[]);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_receive_store_challan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.mm_receive_store_challan(p_id, NULL::uuid[]);
END;
$function$
;

CREATE OR REPLACE FUNCTION public._mm_challan_header(p_ch mm_in_challans)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT jsonb_build_object(
    'id', p_ch.id,
    'challan_no', p_ch.challan_no,
    'reference_no', p_ch.reference_no,
    'source', p_ch.source,
    'status', p_ch.status,
    'supplier_name', p_ch.supplier_name,
    'sent_at', p_ch.sent_at,
    'received_at', p_ch.received_at,
    'to_location', p_ch.to_location,
    'remarks', p_ch.remarks,
    'factory_name', (SELECT f.name FROM public.factories f WHERE f.id = p_ch.factory_id),
    'factory_code', (SELECT f.code FROM public.factories f WHERE f.id = p_ch.factory_id),
    'row_version', p_ch.row_version,
    'style_material_id', p_ch.style_material_id,
    'order_id', sm.order_id,
    'colorway_id', sm.colorway_id,
    'fabric_line_id', COALESCE(sm.colorway_material_id, cm.id),
    'style_name', COALESCE(o.style_name, 'Unallocated'),
    'style_ref', o.style_ref,
    'buyer_name', o.buyer_name,
    'po_number', o.po_number,
    'image_url', o.image_url,
    'color_name', COALESCE(cw.name, 'Unallocated'),
    'fabric_type', COALESCE(ft.name, ft_unit.name),
    'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name, ft_unit.name, 'Fabric'),
    'fabric_category', CASE
      WHEN cm.id IS NULL THEN NULL
      WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
        THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
      ELSE COALESCE(
        NULLIF(trim(cm.category), ''),
        NULLIF(trim(cm.extras->>'fabricCategory'), '')
      )
    END,
    'required_m', cm.total_cons,
    'uom', COALESCE(
      (
        SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
        WHERE u.in_challan_id = p_ch.id ORDER BY u.created_at LIMIT 1
      ),
      NULLIF(trim(COALESCE(cm.unit, cm.extras->>'unit', '')), '')
    ),
    'roll_count', (
      SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = p_ch.id
    ),
    'received_roll_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND public._mm_counts_as_received(u.status)
    ),
    'qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id
    ),
    'passed_qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'pass'
    ),
    'passed_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'pass'
    ),
    'failed_qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'fail'
    ),
    'pending_qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.status = 'pending_qc'
    ),
    'tested_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result IS NOT NULL
    ),
    'failed_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'fail'
    ),
    'pending_qc_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.status = 'pending_qc'
    )
  )
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.mm_style_materials sm ON sm.id = p_ch.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
  LEFT JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
  LEFT JOIN public.colorway_materials cm ON cm.id = COALESCE(
    sm.colorway_material_id,
    (
      SELECT c2.id
      FROM public.colorway_materials c2
      WHERE c2.colorway_id = sm.colorway_id
        AND c2.factory_id = sm.factory_id
        AND c2.kind = 'Fabric'
        AND lower(trim(c2.type)) = lower(trim(ft.name))
      ORDER BY c2.seq
      LIMIT 1
    )
  )
  LEFT JOIN public.mm_fabric_types ft_unit ON ft_unit.id = (
    SELECT u.fabric_type_id FROM public.mm_stock_units u
    WHERE u.in_challan_id = p_ch.id ORDER BY u.created_at LIMIT 1
  )
$function$
;

CREATE OR REPLACE FUNCTION public._mm_insert_mill_batch_rolls(p_factory uuid, p_sm uuid, p_batch uuid, p_loc uuid, p_rolls jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_code text;
  v_len numeric;
  v_wt numeric;
  v_shade text;
  v_lot text;
  v_color text;
  v_ft uuid;
  v_attrs jsonb;
  v_n integer := 0;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  SELECT fabric_type_id INTO v_ft FROM public.mm_mill_batches WHERE id = p_batch;
  IF v_ft IS NULL THEN RAISE EXCEPTION 'Fabric type is required'; END IF;
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_code := NULLIF(trim(COALESCE(v_row->>'unit_code', '')), '');
    IF v_code IS NULL THEN RAISE EXCEPTION 'Each roll needs a roll number'; END IF;
    v_key := lower(v_code);
    IF v_key = ANY (v_seen) THEN RAISE EXCEPTION 'Roll % already exists in this batch', v_code; END IF;
    v_seen := array_append(v_seen, v_key);
    IF EXISTS (
      SELECT 1 FROM public.mm_mill_rolls r
      WHERE r.factory_id = p_factory AND r.mill_batch_id = p_batch AND lower(r.unit_code) = v_key
    ) THEN
      RAISE EXCEPTION 'Roll % already exists in this batch', v_code;
    END IF;
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_color := NULLIF(trim(COALESCE(v_row->>'color_ref', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    INSERT INTO public.mm_mill_rolls (
      factory_id, mill_batch_id, style_material_id, fabric_type_id, unit_code,
      length_m, weight_kg, shade, lot_no, color_ref, attributes, status,
      created_by, updated_by
    ) VALUES (
      p_factory, p_batch, p_sm, v_ft, v_code,
      v_len, v_wt, v_shade, v_lot, v_color, v_attrs, 'draft',
      public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id INTO v_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._mm_insert_rolls(p_factory uuid, p_sm uuid, p_challan uuid, p_source text, p_status text, p_loc uuid, p_rolls jsonb, p_freeze boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_code text;
  v_len numeric;
  v_wt numeric;
  v_shade text;
  v_lot text;
  v_color text;
  v_ft uuid;
  v_sm_ft uuid;
  v_attrs jsonb;
  v_snap jsonb;
  v_n integer := 0;
BEGIN
  IF p_source IS DISTINCT FROM 'vendor' THEN
    RAISE EXCEPTION 'Only vendor GRNs may insert new inbound rolls';
  END IF;
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;
  IF p_sm IS NOT NULL THEN
    SELECT fabric_type_id INTO v_sm_ft FROM public.mm_style_materials WHERE id = p_sm;
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_color := NULLIF(trim(COALESCE(v_row->>'color_ref', '')), '');
    v_ft := COALESCE(v_sm_ft, NULLIF(trim(COALESCE(v_row->>'fabric_type_id', '')), '')::uuid);
    IF v_ft IS NULL THEN RAISE EXCEPTION 'Fabric type is required'; END IF;
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    v_code := public.next_doc_no('ROLL');
    IF p_freeze THEN
      v_snap := jsonb_build_object(
        'length_m', v_len, 'weight_kg', v_wt, 'shade', v_shade, 'lot_no', v_lot,
        'color_ref', v_color, 'attributes', v_attrs
      );
    ELSE
      v_snap := NULL;
    END IF;
    INSERT INTO public.mm_stock_units (
      factory_id, unit_code, unit_kind, style_material_id, fabric_type_id, in_challan_id, source,
      uom, length_m, weight_kg, shade, lot_no, color_ref, attributes, mill_snapshot, status,
      current_location_id, qty_uom, qty_declared, qty_received, qty_available, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, v_ft, p_challan, p_source,
      COALESCE(NULLIF(trim(COALESCE(v_row->>'uom', '')), ''), 'm'),
      v_len, v_wt, v_shade, v_lot, v_color, v_attrs, v_snap, p_status, p_loc,
      COALESCE(NULLIF(trim(COALESCE(v_row->>'uom', '')), ''), 'm'), v_len, v_len, 0,
      public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id INTO v_id;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (p_factory, p_challan, v_id, public._mm_actor_id());
    PERFORM public._mm_ledger(
      p_factory, v_id, 'RECEIPT_IN',
      v_len, NULL, p_status, NULL, p_loc, 'mm_in_challans', p_challan, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._mm_refresh_in_challan_status(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_open integer;
  v_got integer;
  v_status text;
BEGIN
  SELECT
    count(*) FILTER (WHERE u.status = 'in_transit'),
    count(*) FILTER (WHERE u.status IS DISTINCT FROM 'in_transit' AND u.status IS DISTINCT FROM 'missing')
  INTO v_open, v_got
  FROM public.mm_stock_units u
  WHERE u.in_challan_id = p_id;
  v_status := CASE
    WHEN COALESCE(v_open, 0) = 0 AND COALESCE(v_got, 0) > 0 THEN 'received'
    WHEN COALESCE(v_got, 0) > 0 AND COALESCE(v_open, 0) > 0 THEN 'partial'
    ELSE 'pending'
  END;
  UPDATE public.mm_in_challans
  SET status = v_status,
      received_at = CASE WHEN v_status = 'received' THEN COALESCE(received_at, now()) ELSE received_at END,
      received_by = CASE WHEN v_status = 'received' THEN COALESCE(received_by, public._mm_actor_id()) ELSE received_by END,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_id;
  RETURN v_status;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._mm_store_line_missing(p_unit_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_missing boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_store_challan_lines' AND column_name = 'line_status'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.mm_store_challan_lines WHERE stock_unit_id = $1 AND line_status = ''missing'')'
      INTO v_missing USING p_unit_id;
  END IF;
  RETURN COALESCE(v_missing, false);
END;
$function$
;

CREATE OR REPLACE FUNCTION public._mm_unit_clearance(p_unit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unit public.mm_stock_units%ROWTYPE;
  v_block text;
  v_tested boolean;
  v_inspected boolean := false;
  v_result text;
  v_hold boolean;
  v_cleared boolean := false;
  v_reason text;
BEGIN
  SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = p_unit_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tested', false, 'inspected', false, 'inspection_result', NULL,
      'cleared', false, 'blocking_reason', 'Roll not found'
    );
  END IF;
  v_block := public._mm_cutting_param_block(v_unit);
  v_tested := v_block IS NULL;
  SELECT (i.result IS NOT NULL), i.result
    INTO v_inspected, v_result
  FROM public.mm_warehouse_inspections i
  WHERE i.stock_unit_id = v_unit.id
  ORDER BY i.inspected_at DESC NULLS LAST
  LIMIT 1;
  v_inspected := COALESCE(v_inspected, false);
  v_hold := public._mm_unit_on_hold(v_unit.id);
  IF v_hold THEN
    v_reason := 'On hold';
  ELSIF v_result = 'fail' THEN
    v_reason := 'Inspection failed';
  ELSIF v_unit.source = 'vendor' THEN
    v_cleared := v_tested AND v_inspected AND v_result = 'pass';
    IF NOT v_cleared THEN
      v_reason := 'Vendor roll needs testing and a passing inspection';
    END IF;
  ELSE
    v_cleared := v_tested;
    IF NOT v_tested THEN
      v_reason := COALESCE(v_block, 'Testing required');
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'tested', v_tested,
    'inspected', v_inspected,
    'inspection_result', v_result,
    'cleared', v_cleared,
    'blocking_reason', v_reason
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_allocate_rolls_to_style(p_unit_ids uuid[], p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
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
      updated_by = public._mm_actor_id()
    WHERE id = v_unit.id;
    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = v_sm_id,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
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

  SELECT COALESCE(sum(COALESCE(u.qty_received, u.length_m)), 0) INTO v_have
  FROM public.mm_stock_units u
  WHERE u.style_material_id = v_sm_id
    AND public._mm_counts_as_received(u.status);

  RETURN public._mm_ok(jsonb_build_object(
    'count', v_n,
    'style_material_id', v_sm_id,
    'over_allocated', (v_have > v_required),
    'warnings', CASE
      WHEN v_have > v_required THEN jsonb_build_array('over_required')
      ELSE '[]'::jsonb
    END
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_confirm_received_lengths(p_challan_id uuid, p_lengths jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_row jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
  v_measured numeric;
  v_current numeric;
  v_delta numeric;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans
  WHERE id = p_challan_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_lengths, '[]'::jsonb)) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = NULLIF(v_row->>'unit_id', '')::uuid
      AND factory_id = v_factory
      AND in_challan_id = v_ch.id
    FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('INVALID', 'Roll is not on this challan'); END IF;
    v_measured := COALESCE(NULLIF(v_row->>'length', '')::numeric, NULLIF(v_row->>'length_m', '')::numeric);
    IF v_measured IS NULL OR v_measured < 0 THEN
      RETURN public._mm_err('REQUIRED', 'Measured length is required');
    END IF;
    v_current := COALESCE(public._mm_unit_qty_received(v_unit), 0);
    v_delta := v_measured - v_current;
    IF abs(v_delta) > 0.0001 THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id,
        CASE WHEN v_delta < 0 THEN 'QC_DEDUCT' ELSE 'ADJUST_PLUS' END,
        v_delta,
        v_unit.status, v_unit.status,
        v_unit.current_location_id, v_unit.current_location_id,
        'mm_in_challans', v_ch.id, 'length confirmed at receive'
      );
      PERFORM public._mm_set_on_hand(v_unit.id, v_measured, true);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  PERFORM public._mm_apply_clearance(ARRAY(
    SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id
  ));
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'adjusted', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_create_store_challan(p_style_material_id uuid, p_unit_ids uuid[], p_challan_no text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_sent_at date DEFAULT NULL::date, p_remarks text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_id uuid;
  v_no text;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_ref text;
  v_block text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_style_material_id IS NULL OR p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to send');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit
    FROM public.mm_stock_units u
    WHERE u.id = v_uid AND u.factory_id = v_factory AND u.style_material_id = p_style_material_id
      AND u.status = 'in_stock' AND u.store_challan_id IS NULL
      AND public._mm_is_pickable_loc(u.current_location_id)
      AND public._mm_loc_is_under(u.current_location_id, v_wh);
    IF NOT FOUND THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not on a warehouse rack');
    END IF;
    IF public._mm_unit_on_hold(v_unit.id) THEN
      RETURN public._mm_err('HOLD', COALESCE(v_unit.unit_code, 'Roll') || ' is on hold');
    END IF;
    v_block := public._mm_cutting_param_block(v_unit);
    IF v_block IS NOT NULL THEN
      RETURN public._mm_err('PARAMS', v_unit.unit_code || ': ' || v_block);
    END IF;
  END LOOP;
  v_no := NULLIF(btrim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN v_no := public.next_doc_no('SC'); END IF;
  v_ref := NULLIF(btrim(COALESCE(p_reference_no, '')), '');
  BEGIN
    INSERT INTO public.mm_store_challans (
      factory_id, challan_no, style_material_id, from_location_id, to_location_id,
      status, sent_at, sent_by, remarks, reference_no, created_by, updated_by
    ) VALUES (
      v_factory, v_no, p_style_material_id, v_wh, v_cut, 'pending',
      COALESCE(p_sent_at, CURRENT_DATE)::timestamptz,
      public._mm_actor_id(),
      NULLIF(btrim(COALESCE(p_remarks, '')), ''),
      v_ref,
      public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That challan number already exists');
  END;
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    INSERT INTO public.mm_store_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_id, v_uid, public._mm_actor_id());
    UPDATE public.mm_stock_units SET
      store_challan_id = v_id, current_location_id = v_cut, status = 'issued',
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_uid;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'ISSUE_TO_CUTTING', v_unit.length_m, v_unit.status, 'issued',
      v_unit.current_location_id, v_cut, 'mm_store_challans', v_id, 'Dispatched to cutting'
    );
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'challan_no', v_no, 'status', 'pending'));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_deactivate_rack_location(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_loc public.mm_locations%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  SELECT * INTO v_loc FROM public.mm_locations WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Location not found'); END IF;
  IF v_loc.location_type NOT IN ('zone', 'rack', 'bin') THEN
    RETURN public._mm_err('INVALID', 'Cannot remove this location');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory AND u.status = 'in_stock'
      AND (
        u.current_location_id = v_loc.id
        OR public._mm_loc_is_under(u.current_location_id, v_loc.id)
      )
  ) THEN
    RETURN public._mm_err('IN_USE', 'Move rolls off this rack before removing it');
  END IF;
  UPDATE public.mm_locations SET is_active = false, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE factory_id = v_factory AND (
    id = v_loc.id OR public._mm_loc_is_under(id, v_loc.id)
  ) AND location_type IN ('zone', 'rack', 'bin');
  RETURN public._mm_ok(jsonb_build_object('id', v_loc.id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_deactivate_warehouse_location(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_loc public.mm_locations%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  SELECT * INTO v_loc FROM public.mm_locations WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Location not found'); END IF;
  IF v_loc.location_type NOT IN ('zone', 'rack', 'bin') THEN
    RETURN public._mm_err('INVALID', 'Cannot remove this location');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory AND u.status = 'in_stock'
      AND (
        u.current_location_id = v_loc.id
        OR public._mm_loc_is_under(u.current_location_id, v_loc.id)
      )
  ) THEN
    RETURN public._mm_err('IN_USE', 'Move or putaway rolls before removing this location');
  END IF;
  UPDATE public.mm_locations SET is_active = false, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE factory_id = v_factory AND (
    id = v_loc.id OR public._mm_loc_is_under(id, v_loc.id)
  ) AND location_type IN ('zone', 'rack', 'bin');
  RETURN public._mm_ok(jsonb_build_object('id', v_loc.id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_delete_fabric_type(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  UPDATE public.mm_fabric_types SET
    is_active = false,
    row_version = row_version + 1,
    updated_at = now(),
    updated_by = public._mm_actor_id()
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric type not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id, 'action', 'deactivated'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_delete_trim_requirement_param(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  UPDATE public.mm_trim_requirement_params SET
    is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Trim category not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_dispatch_mill_rolls(p_unit_ids uuid[], p_challan_no text, p_reference_no text DEFAULT NULL::text, p_to_location text DEFAULT 'Warehouse'::text, p_sent_at date DEFAULT NULL::date, p_remarks text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_sm uuid;
  v_ft uuid;
  v_ch uuid;
  v_no text;
  v_ref text;
  v_to text;
  v_uid uuid;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_n integer := 0;
  v_batch public.mm_mill_batches%ROWTYPE;
  v_mill uuid;
  v_uom text;
  v_stock uuid;
  v_snap jsonb;
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
  v_no := NULLIF(trim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Enter a challan number');
  END IF;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to dispatch');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_ref := NULLIF(trim(COALESCE(p_reference_no, '')), '');
  v_to := COALESCE(NULLIF(trim(COALESCE(p_to_location, '')), ''), 'Warehouse');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_roll.status <> 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting at the mill');
    END IF;
    IF public._mm_mill_at_process(v_roll.id) THEN
      RETURN public._mm_err('AT_PROCESS', 'A selected roll is at a process vendor');
    END IF;
    IF v_sm IS NULL AND v_ft IS NULL THEN
      v_sm := v_roll.style_material_id;
      v_ft := v_roll.fabric_type_id;
    END IF;
    IF (v_roll.style_material_id IS NULL) IS DISTINCT FROM (v_sm IS NULL) THEN
      RETURN public._mm_err('INVALID', 'Select either unallocated rolls or rolls from the same style, not both');
    END IF;
    IF v_roll.style_material_id IS DISTINCT FROM v_sm THEN
      RETURN public._mm_err('INVALID', 'Select rolls from the same style, color, and fabric');
    END IF;
    IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Select rolls of the same fabric type');
    END IF;
  END LOOP;

  IF v_sm IS NOT NULL AND public._mm_mill_short_closed(v_sm) THEN
    RETURN public._mm_err('CLOSED', 'This fabric is short closed. Cancel short close to dispatch.');
  END IF;

  SELECT COALESCE(
    (
      SELECT NULLIF(trim(u.uom), '')
      FROM public.mm_stock_units u
      WHERE (v_sm IS NOT NULL AND u.style_material_id = v_sm)
         OR (v_sm IS NULL AND u.fabric_type_id = v_ft)
      ORDER BY u.created_at
      LIMIT 1
    ),
    (
      SELECT NULLIF(trim(cm.unit), '')
      FROM public.mm_style_materials sm
      JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sm.id = v_sm
      LIMIT 1
    ),
    'm'
  ) INTO v_uom;

  BEGIN
    INSERT INTO public.mm_in_challans (
      factory_id, challan_no, source, style_material_id, status, sent_at, sent_by,
      remarks, reference_no, to_location, created_by, updated_by
    ) VALUES (
      v_factory, v_no, 'mill', v_sm, 'pending',
      COALESCE(p_sent_at, CURRENT_DATE)::timestamptz,
      public._mm_actor_id(),
      NULLIF(btrim(COALESCE(p_remarks, '')), ''),
      v_ref,
      v_to,
      public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id INTO v_ch;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That challan number already exists');
  END;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_uid;
    SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = v_roll.mill_batch_id;
    v_snap := jsonb_build_object(
      'length_m', v_roll.length_m,
      'weight_kg', v_roll.weight_kg,
      'shade', v_roll.shade,
      'lot_no', v_roll.lot_no,
      'color_ref', v_roll.color_ref,
      'attributes', v_roll.attributes,
      'mill_batch_id', v_roll.mill_batch_id,
      'batch_no', v_batch.batch_no,
      'mill_ref', v_batch.mill_ref,
      'production_date', v_batch.production_date
    );
    BEGIN
      INSERT INTO public.mm_stock_units (
        factory_id, unit_code, unit_kind, style_material_id, fabric_type_id, mill_batch_id, mill_roll_id,
        in_challan_id, source, uom, length_m, weight_kg, shade, lot_no, color_ref, attributes,
        mill_snapshot, status, current_location_id,
        qty_uom, qty_declared, qty_received, qty_available,
        created_by, updated_by
      ) VALUES (
        v_factory, v_roll.unit_code, 'roll', v_roll.style_material_id, v_roll.fabric_type_id,
        v_roll.mill_batch_id, v_roll.id,
        v_ch, 'mill', v_uom, v_roll.length_m, v_roll.weight_kg, v_roll.shade, v_roll.lot_no, v_roll.color_ref,
        v_roll.attributes,
        v_snap, 'in_transit', v_mill,
        v_uom, v_roll.length_m, v_roll.length_m, 0,
        public._mm_actor_id(), public._mm_actor_id()
      ) RETURNING id INTO v_stock;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Roll % already exists in warehouse stock for this mill batch', v_roll.unit_code;
    END;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_ch, v_stock, public._mm_actor_id());
    UPDATE public.mm_mill_rolls SET
      status = 'dispatched',
      in_challan_id = v_ch,
      dispatched_at = now(),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    WHERE id = v_roll.id AND status = 'draft' AND in_challan_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected roll is not waiting at the mill';
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_stock, 'RECEIPT_IN', v_roll.length_m, 'draft', 'in_transit',
      v_mill, v_mill, 'mm_in_challans', v_ch, 'Mill dispatch'
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_disposition_rejected(p_unit_ids uuid[], p_action text, p_reason text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_role text;
  v_apps jsonb;
  v_id uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_return uuid;
  v_no text;
  v_recv uuid;
  v_supplier text;
  v_n integer := 0;
  v_qty numeric;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_action NOT IN ('return_to_supplier', 'accept_deviation', 'write_off') THEN
    RETURN public._mm_err('INVALID', 'Unknown disposition');
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A reason is required');
  END IF;
  v_actor := public._mm_actor_id();
  IF p_action = 'accept_deviation' THEN
    SELECT p.user_role, COALESCE(p.assigned_apps, '[]'::jsonb) INTO v_role, v_apps
    FROM public.profiles p WHERE p.id = v_actor AND p.factory_id = v_factory;
    IF COALESCE(v_role, '') NOT IN ('admin', 'superadmin')
       AND NOT (COALESCE(v_apps, '[]'::jsonb) @> '["mm_qc_approve"]'::jsonb)
       AND NOT public.is_factory_admin() THEN
      RETURN public._mm_err('FORBIDDEN', 'Deviation needs an approver');
    END IF;
  END IF;
  IF p_action = 'return_to_supplier' AND EXISTS (
    SELECT 1 FROM public.mm_stock_units a
    WHERE a.id = ANY (p_unit_ids) AND a.style_material_id IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.mm_stock_units b
    WHERE b.id = ANY (p_unit_ids) AND b.style_material_id IS NOT NULL
  ) THEN
    RETURN public._mm_err('INVALID', 'Do not mix unallocated rolls with style rolls on one return');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
  v_recv := public._mm_recv_loc(v_factory);
  IF p_action = 'return_to_supplier' THEN
    SELECT c.supplier_name INTO v_supplier
    FROM public.mm_stock_units u
    LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
    WHERE u.id = p_unit_ids[1];
    v_no := public.next_doc_no('SR');
    INSERT INTO public.mm_supplier_returns (factory_id, return_no, supplier_name, reason, debit_note_ref, created_by)
    VALUES (v_factory, v_no, v_supplier, btrim(p_reason), NULLIF(btrim(COALESCE(p_reference, '')), ''), v_actor)
    RETURNING id INTO v_return;
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_unit_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    IF v_unit.status <> 'rejected' THEN
      RETURN public._mm_err('INVALID', 'Only rejected rolls can be dispositioned');
    END IF;
    v_qty := COALESCE(v_unit.qty_available, 0);
    IF p_action = 'return_to_supplier' THEN
      PERFORM public._mm_ledger(
        v_factory, v_id, 'RETURN_TO_SUPPLIER', v_qty, v_unit.status, 'returned_to_supplier',
        v_unit.current_location_id, NULL, 'mm_supplier_returns', v_return, btrim(p_reason)
      );
      INSERT INTO public.mm_supplier_return_lines (factory_id, return_id, stock_unit_id, qty)
      VALUES (v_factory, v_return, v_id, v_qty);
      UPDATE public.mm_stock_units
      SET status = 'returned_to_supplier', current_location_id = NULL, on_hold = false,
          updated_at = now(), updated_by = v_actor
      WHERE id = v_id;
    ELSIF p_action = 'write_off' THEN
      PERFORM public._mm_ledger(
        v_factory, v_id, 'WRITE_OFF', v_qty, v_unit.status, 'written_off',
        v_unit.current_location_id, NULL, 'mm_stock_units', v_id, btrim(p_reason)
      );
      UPDATE public.mm_stock_units
      SET status = 'written_off', current_location_id = NULL, on_hold = false,
          updated_at = now(), updated_by = v_actor
      WHERE id = v_id;
    ELSE
      UPDATE public.mm_warehouse_inspections
      SET deviation_approved_by = v_actor, deviation_approved_at = now(),
          deviation_reason = btrim(p_reason),
          deviation_reference = NULLIF(btrim(COALESCE(p_reference, '')), '')
      WHERE stock_unit_id = v_id AND factory_id = v_factory;
      UPDATE public.mm_stock_units
      SET status = 'in_stock', current_location_id = v_recv, on_hold = false,
          updated_at = now(), updated_by = v_actor
      WHERE id = v_id;
      PERFORM public._mm_ledger(
        v_factory, v_id, 'RELEASE', 0, 'rejected', 'in_stock',
        v_unit.current_location_id, v_recv, 'mm_warehouse_inspections', v_id, 'accepted under deviation'
      );
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('action', p_action, 'rolls', v_n, 'return_id', v_return, 'return_no', v_no));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_enable_module(p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RETURN public._mm_err('NO_PERMISSION', 'Admin required');
  END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  PERFORM public.set_factory_module('material', true, COALESCE(p_config, '{}'::jsonb));
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (v_factory, 'in_house_mill', true),
    (v_factory, 'receive_goods', false),
    (v_factory, 'test_rolls', false)
  ON CONFLICT (factory_id, feature_key) DO NOTHING;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  RETURN public._mm_ok(jsonb_build_object('factory_id', v_factory));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_exclude_roll(p_unit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  UPDATE public.mm_stock_units
  SET on_hold = true,
      hold_reason = 'excluded at inspection',
      hold_by = public._mm_actor_id(),
      hold_at = now(),
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_unit_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_unit_id, 'on_hold', true));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_floor_gaps()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_on boolean := false;
BEGIN
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR public._mm_actor_id() IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  BEGIN
    PERFORM public.assert_module_enabled('material');
    v_on := true;
  EXCEPTION WHEN OTHERS THEN
    v_on := false;
  END;
  RETURN public._mm_ok(jsonb_build_object(
    'module_on', v_on,
    'p1_on_hand', EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_mm_is_on_hand'),
    'p2_qty', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_stock_units' AND column_name='qty_available'),
    'p3_defects', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mm_inspection_defects'),
    'p4_lines', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_in_challan_lines' AND column_name='line_status'),
    'p5_hold', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_stock_units' AND column_name='on_hold'),
    'issued_status', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'mm_stock_units_status_chk'
        AND pg_get_constraintdef(oid) LIKE '%issued%'
    )
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_config_bundle()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    PERFORM public.assert_module_enabled('material');
    v_factory := public.current_factory_id();
    IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
    IF NOT public.is_factory_admin() THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = public._mm_actor_id()
          AND (
            p.assigned_apps @> '["mm_config"]'::jsonb
            OR p.assigned_apps @> '["mm_reports"]'::jsonb
          )
      ) THEN
        RETURN public._mm_err('NO_PERMISSION', 'mm_config or mm_reports required');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  RETURN public._mm_ok(jsonb_build_object(
    'types', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.seq, t.name)
      FROM public.mm_fabric_types t WHERE t.factory_id = v_factory
    ), '[]'::jsonb),
    'test_fields', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f WHERE f.factory_id = v_factory
    ), '[]'::jsonb),
    'requirement_fields', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.seq, f.label)
      FROM public.mm_type_requirement_fields f WHERE f.factory_id = v_factory
    ), '[]'::jsonb),
    'trim_params', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seq, p.category)
      FROM public.mm_trim_requirement_params p WHERE p.factory_id = v_factory AND p.is_active
    ), '[]'::jsonb),
    'attribute_defs', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(f) || jsonb_build_object(
          'applies_to', 'material',
          'data_type', 'text',
          'options', '[]'::jsonb
        )
        ORDER BY f.seq, f.label
      )
      FROM public.mm_type_requirement_fields f
      WHERE f.factory_id = v_factory AND f.is_active
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_expected_board(p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          SELECT sum(u.qty_available) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'
        ), 0) AS qty_incoming_m,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'
        ), 0) AS rolls_incoming,
        COALESCE((
          SELECT sum(COALESCE(u.qty_received, u.length_m)) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND public._mm_counts_as_received(u.status)
        ), 0) AS qty_received_m,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND public._mm_counts_as_received(u.status)
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
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_lay_report(p_lay_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR public._mm_actor_id() IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'stock_unit_id', c.stock_unit_id,
      'unit_code', u.unit_code,
      'roll_no', COALESCE(u.attributes->>'roll_no', u.unit_code),
      'plies', c.plies,
      'opening_qty', c.opening_qty,
      'used_qty', c.used_qty,
      'shortage_qty', c.shortage_qty,
      'end_bit', c.opening_qty - COALESCE(c.used_qty, 0) - COALESCE(c.shortage_qty, 0),
      'closing_qty', c.closing_qty,
      'end_bit_action', c.end_bit_action
    ) ORDER BY c.seq, u.unit_code)
    FROM public.mm_lay_unit_consumptions c
    JOIN public.mm_stock_units u ON u.id = c.stock_unit_id
    WHERE c.cutting_lay_id = p_lay_id AND c.factory_id = v_factory
  ), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_mill_line(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_type_id uuid;
  v_type_name text;
  v_fabric_name text;
  v_fabric_category text;
  v_required numeric;
  v_uom text;
  v_sm uuid;
  v_mill uuid;
  v_short_closed boolean := false;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric are required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders o WHERE o.id = p_order_id AND o.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Order not found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.colorways c
    WHERE c.id = p_colorway_id AND c.order_id = p_order_id AND c.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Colorway not found');
  END IF;

  v_fabric_name := NULL;
  v_required := NULL;
  v_uom := NULL;
  v_fabric_category := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT COALESCE(NULLIF(trim(cm.name), ''''), NULLIF(trim(cm.type), ''''), ''Fabric''),
                cm.total_cons, NULLIF(trim(cm.type), ''''), NULLIF(trim(cm.unit), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_fabric_name, v_required, v_type_name, v_uom
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_fabric_name := NULL;
    END;

    BEGIN
      SELECT CASE
        WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
          THEN NULLIF(trim(cm.extras->>$$fabricCategory$$), '')
        ELSE COALESCE(
          NULLIF(trim(cm.category), ''),
          NULLIF(trim(cm.extras->>$$fabricCategory$$), '')
        )
      END
      INTO v_fabric_category
      FROM public.colorway_materials cm
      WHERE cm.id = p_colorway_material_id
        AND cm.factory_id = v_factory
        AND cm.order_id = p_order_id
        AND cm.colorway_id = p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_fabric_category := NULL;
    END;

    BEGIN
      EXECUTE
        'SELECT COALESCE(cm.mill_short_closed, false)
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_short_closed
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_short_closed := false;
    END;
  END IF;

  IF v_fabric_name IS NULL THEN
    SELECT name INTO v_type_name FROM public.mm_fabric_types
    WHERE id = p_colorway_material_id AND factory_id = v_factory AND is_active;
    IF v_type_name IS NULL THEN RETURN public._mm_err('NOT_FOUND', 'Fabric line not found'); END IF;
    v_fabric_name := v_type_name;
    v_type_id := p_colorway_material_id;
  ELSE
    SELECT id INTO v_type_id
    FROM public.mm_fabric_types
    WHERE factory_id = v_factory AND is_active AND lower(name) = lower(v_type_name)
    LIMIT 1;
  END IF;

  v_sm := public._mm_lookup_style_material_id(
    v_factory, p_order_id, p_colorway_id, p_colorway_material_id, v_type_id
  );

  IF NULLIF(trim(COALESCE(v_uom, '')), '') IS NULL AND v_sm IS NOT NULL THEN
    SELECT NULLIF(trim(u.uom), '') INTO v_uom
    FROM public.mm_stock_units u
    WHERE u.style_material_id = v_sm
    ORDER BY u.created_at
    LIMIT 1;
  END IF;

  v_mill := public._mm_loc(v_factory, 'MILL');

  RETURN public._mm_ok(jsonb_build_object(
    'order_id', p_order_id,
    'colorway_id', p_colorway_id,
    'fabric_line_id', p_colorway_material_id,
    'fabric_type_id', v_type_id,
    'style_material_id', v_sm,
    'required_m', v_required,
    'mill_short_closed', COALESCE(v_short_closed, false),
    'uom', v_uom,
    'style_name', (SELECT style_name FROM public.style_orders WHERE id = p_order_id),
    'style_ref', (SELECT style_ref FROM public.style_orders WHERE id = p_order_id),
    'po_number', (SELECT po_number FROM public.style_orders WHERE id = p_order_id),
    'buyer_name', (SELECT buyer_name FROM public.style_orders WHERE id = p_order_id),
    'image_url', (SELECT image_url FROM public.style_orders WHERE id = p_order_id),
    'color_name', (SELECT name FROM public.colorways WHERE id = p_colorway_id),
    'fabric_name', v_fabric_name,
    'fabric_type', COALESCE((SELECT name FROM public.mm_fabric_types WHERE id = v_type_id), v_type_name, v_fabric_name),
    'fabric_category', v_fabric_category,
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type_id AND f.is_active
    ), '[]'::jsonb),
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'batch_no', b.batch_no,
        'mill_ref', b.mill_ref,
        'production_date', b.production_date,
        'remarks', b.remarks, 'row_version', b.row_version,
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
        ),
        'dispatched_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'dispatched'
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      WHERE b.factory_id = v_factory AND b.style_material_id = v_sm
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
        'attributes', r.attributes,
        'status', r.status,
        'in_challan_id', r.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'challan_reference_no', c.reference_no,
        'challan_sent_at', c.sent_at,
        'challan_received_at', c.received_at,
        'challan_to_location', c.to_location,
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL)
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      LEFT JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
      WHERE r.factory_id = v_factory AND r.style_material_id = v_sm
    ), '[]'::jsonb)
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_ops_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_mill boolean;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'Not allowed'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  SELECT COALESCE(bool_or(enabled), true) INTO v_mill
  FROM public.mm_factory_features
  WHERE factory_id = v_factory AND feature_key = 'in_house_mill';
  RETURN public._mm_ok(jsonb_build_object(
    'in_house_mill', COALESCE(v_mill, true),
    'features', COALESCE((
      SELECT jsonb_object_agg(feature_key, enabled)
      FROM public.mm_factory_features WHERE factory_id = v_factory
    ), '{}'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'name', name, 'location_type', location_type,
        'parent_id', parent_id, 'is_pickable', is_pickable
      ) ORDER BY code)
      FROM public.mm_locations WHERE factory_id = v_factory AND is_active
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_process_challan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_process_challans%ROWTYPE;
  v_vendor text;
  v_process text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'A process challan is required'); END IF;
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Process challan was not found'); END IF;
  SELECT v.name INTO v_vendor FROM public.mm_process_vendors v WHERE v.id = v_ch.vendor_id AND v.factory_id = v_factory;
  SELECT t.name INTO v_process FROM public.mm_process_types t WHERE t.id = v_ch.process_type_id AND t.factory_id = v_factory;
  RETURN public._mm_ok(jsonb_build_object(
    'id', v_ch.id, 'challan_no', v_ch.challan_no, 'origin', v_ch.origin, 'status', v_ch.status,
    'vendor_name', v_vendor, 'process_name', v_process, 'remarks', v_ch.remarks,
    'created_at', v_ch.created_at, 'returned_at', v_ch.returned_at,
    'out', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'unit_code', l.unit_code, 'qty', l.qty, 'uom', l.uom, 'shade', l.shade,
        'lot_no', l.lot_no, 'color_ref', l.color_ref, 'line_status', l.line_status,
        'style_name', NULLIF(btrim(o.style_name), '')
      ) ORDER BY l.unit_code)
      FROM public.mm_process_out_lines l
      LEFT JOIN public.mm_mill_rolls mr ON mr.id = l.mill_roll_id AND mr.factory_id = v_factory
      LEFT JOIN public.mm_stock_units su ON su.id = l.stock_unit_id AND su.factory_id = v_factory
      LEFT JOIN public.mm_style_materials sm ON sm.id = COALESCE(mr.style_material_id, su.style_material_id) AND sm.factory_id = v_factory
      LEFT JOIN public.style_orders o ON o.id = sm.order_id AND o.factory_id = v_factory
      WHERE l.challan_id = v_ch.id AND l.factory_id = v_factory
    ), '[]'::jsonb),
    'back', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'out_line_id', r.out_line_id, 'same_identity', r.same_identity, 'unit_code', r.unit_code,
        'qty', r.qty, 'uom', r.uom, 'shade', r.shade, 'color_ref', r.color_ref, 'lot_no', r.lot_no
      ) ORDER BY r.created_at, r.unit_code)
      FROM public.mm_process_return_lines r
      WHERE r.challan_id = v_ch.id AND r.factory_id = v_factory
    ), '[]'::jsonb)
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND public._mm_is_on_hand(u.status, loc.location_type)
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
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_store_challan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_sc public.mm_store_challans%ROWTYPE;
  v_type uuid;
  v_header jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_sc FROM public.mm_store_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Dispatch challan not found'); END IF;

  SELECT sm.fabric_type_id INTO v_type
  FROM public.mm_style_materials sm
  WHERE sm.id = v_sc.style_material_id;

  SELECT jsonb_build_object(
    'id', v_sc.id,
    'challan_no', v_sc.challan_no,
    'status', v_sc.status,
    'sent_at', v_sc.sent_at,
    'received_at', v_sc.received_at,
    'reference_no', v_sc.reference_no,
    'remarks', v_sc.remarks,
    'row_version', v_sc.row_version,
    'factory_name', (SELECT f.name FROM public.factories f WHERE f.id = v_factory),
    'factory_code', (SELECT f.code FROM public.factories f WHERE f.id = v_factory),
    'order_id', o.id,
    'image_url', o.image_url,
    'style_name', o.style_name,
    'style_ref', o.style_ref,
    'buyer_name', o.buyer_name,
    'po_number', o.po_number,
    'color_name', cw.name,
    'fabric_type_id', sm.fabric_type_id,
    'fabric_type', ft.name,
    'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
    'fabric_category', CASE
      WHEN cm.id IS NULL THEN NULL
      WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
        THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
      ELSE COALESCE(
        NULLIF(trim(cm.category), ''),
        NULLIF(trim(cm.extras->>'fabricCategory'), '')
      )
    END,
    'uom', COALESCE(
      (
        SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
        WHERE u.store_challan_id = v_sc.id LIMIT 1
      ),
      NULLIF(trim(cm.unit), '')
    ),
    'qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.store_challan_id = v_sc.id
    ),
    'roll_count', (SELECT count(*) FROM public.mm_store_challan_lines l WHERE l.challan_id = v_sc.id),
    'received_roll_count', (
      SELECT count(*) FROM public.mm_store_challan_lines l
      WHERE l.challan_id = v_sc.id AND l.line_status = 'received'
    )
  ) INTO v_header
  FROM public.mm_style_materials sm
  JOIN public.style_orders o ON o.id = sm.order_id
  JOIN public.colorways cw ON cw.id = sm.colorway_id
  JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
  LEFT JOIN public.colorway_materials cm ON cm.id = COALESCE(
    sm.colorway_material_id,
    (
      SELECT c2.id
      FROM public.colorway_materials c2
      WHERE c2.colorway_id = sm.colorway_id
        AND c2.factory_id = sm.factory_id
        AND c2.kind = 'Fabric'
        AND lower(trim(c2.type)) = lower(trim(ft.name))
      ORDER BY c2.seq
      LIMIT 1
    )
  )
  WHERE sm.id = v_sc.style_material_id;

  RETURN public._mm_ok(jsonb_build_object(
    'challan', v_header,
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'key', f.key,
        'label', f.label,
        'data_type', f.data_type,
        'options', f.options
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory
        AND f.type_id = v_type
        AND f.is_active
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'status', u.status,
        'length_m', u.length_m,
        'weight_kg', u.weight_kg,
        'shade', u.shade, 'shade_band', u.shade_band,
        'lot_no', u.lot_no,
        'attributes', u.attributes,
        'source', u.source,
        'batch_no', COALESCE(b.batch_no, NULLIF(trim(u.mill_snapshot->>'batch_no'), '')),
        'mill_snapshot', u.mill_snapshot,
        'location_code', loc.code,
        'location_name', loc.name,
        'line_status', l.line_status
      ) ORDER BY u.unit_code)
      FROM public.mm_store_challan_lines l
      JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE l.challan_id = v_sc.id
    ), '[]'::jsonb)
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_style_reconciliation(p_style_material_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_lines jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_style_material_id IS NULL AND p_order_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style or order is required');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'style_material_id', v.style_material_id,
    'color_name', v.color_name,
    'fabric_name', v.fabric_name,
    'uom', v.uom,
    'required', v.required,
    'received', v.received,
    'qc_deducted', v.qc_deducted,
    'returned_to_supplier', v.returned_to_supplier,
    'written_off', v.written_off,
    'on_hand_warehouse', v.on_hand_warehouse,
    'at_cutting', v.at_cutting,
    'issued_to_cutting', v.issued_to_cutting,
    'consumed', v.consumed,
    'waste', v.waste,
    'shortage', v.shortage,
    'returned_from_cutting', v.returned_from_cutting,
    'balance_check', v.balance_check
  ) ORDER BY v.color_name, v.fabric_name), '[]'::jsonb)
  INTO v_lines
  FROM public.mm_v_style_fabric_reconciliation v
  WHERE v.factory_id = v_factory
    AND (p_style_material_id IS NULL OR v.style_material_id = p_style_material_id)
    AND (p_order_id IS NULL OR v.order_id = p_order_id);
  RETURN public._mm_ok(jsonb_build_object('lines', v_lines));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_style_warehouse(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_wh uuid; v_cut uuid; v_order jsonb; v_fabrics jsonb; v_colors jsonb; v_challans jsonb; v_rolls jsonb; v_test_fields jsonb;
  v_cover numeric; v_putaway numeric; v_colors_total int; v_colors_ready int; v_wh_qty numeric; v_rack_qty numeric; v_transit_qty numeric; v_score int; v_label text; v_has_bom boolean;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF p_order_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Style is required'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.style_orders o WHERE o.id = p_order_id AND o.factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND', 'Style not found');
  END IF;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  SELECT jsonb_build_object('order_id', o.id, 'style_name', o.style_name, 'style_ref', o.style_ref, 'buyer_name', o.buyer_name, 'po_number', o.po_number, 'image_url', o.image_url) INTO v_order FROM public.style_orders o WHERE o.id = p_order_id;
  v_has_bom := false;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.colorway_materials cm WHERE cm.order_id = p_order_id AND cm.factory_id = v_factory) INTO v_has_bom;
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.color_name, x.fabric_name), '[]'::jsonb) INTO v_fabrics FROM (
      SELECT cm.id AS fabric_line_id, cm.colorway_id, cw.name AS color_name, sm.id AS style_material_id,
        COALESCE(NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), ft.name, 'Fabric') AS fabric_name,
        COALESCE(ft.name, NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_type,
        CASE WHEN lower(trim(cm.category)) IN ('fabric', 'trim') THEN NULLIF(trim(cm.extras->>'fabricCategory'), '') ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), '')) END AS fabric_category,
        cm.total_cons AS required_m,
        COALESCE(NULLIF(trim(cm.unit), ''), NULLIF(trim(cm.extras->>'unit'), ''), (SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u WHERE sm.id IS NOT NULL AND u.style_material_id = sm.id ORDER BY u.created_at LIMIT 1)) AS uom,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.source = 'mill' AND u.status = 'draft' AND u.in_challan_id IS NULL), 0) AS rolls_at_mill,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.source = 'mill' AND u.status = 'draft' AND u.in_challan_id IS NULL), 0) AS qty_at_mill,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS rolls_in_transit,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS qty_in_transit,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'), 0) AS rolls_awaiting_test,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'), 0) AS qty_awaiting_test,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), 0) AS rolls_receiving,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), 0) AS qty_receiving,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), 0) AS rolls_racked,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), 0) AS qty_racked,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'issued'), 0) AS rolls_issued,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'issued'), 0) AS qty_issued,
COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'returned_to_supplier'), 0) AS rolls_returned,
COALESCE((SELECT sum(COALESCE(u.qty_received, u.length_m)) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'returned_to_supplier'), 0) AS qty_returned
      FROM public.colorway_materials cm JOIN public.colorways cw ON cw.id = cm.colorway_id
      LEFT JOIN public.mm_style_materials sm ON sm.colorway_material_id = cm.id AND sm.factory_id = v_factory
      LEFT JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      WHERE cm.order_id = p_order_id AND cm.factory_id = v_factory AND cm.kind = 'Fabric'
    ) x;
  ELSE v_fabrics := '[]'::jsonb; END IF;
  IF (v_fabrics IS NULL OR v_fabrics = '[]'::jsonb) AND NOT v_has_bom THEN
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.color_name, x.fabric_name), '[]'::jsonb) INTO v_fabrics FROM (
      SELECT sm.colorway_material_id AS fabric_line_id, sm.colorway_id, cw.name AS color_name, sm.id AS style_material_id,
        COALESCE(NULLIF(trim(cm.name), ''), ft.name) AS fabric_name, ft.name AS fabric_type,
        CASE WHEN cm.id IS NULL THEN NULL WHEN lower(trim(cm.category)) IN ('fabric', 'trim') THEN NULLIF(trim(cm.extras->>'fabricCategory'), '') ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), '')) END AS fabric_category,
        cm.total_cons AS required_m, NULLIF(trim(COALESCE(cm.unit, cm.extras->>'unit', '')), '') AS uom,
        0 AS rolls_at_mill, 0::numeric AS qty_at_mill,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS rolls_in_transit,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS qty_in_transit,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'), 0) AS rolls_awaiting_test,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'), 0) AS qty_awaiting_test,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), 0) AS rolls_receiving,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), 0) AS qty_receiving,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), 0) AS rolls_racked,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), 0) AS qty_racked,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'issued'), 0) AS rolls_issued,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'issued'), 0) AS qty_issued,
COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'returned_to_supplier'), 0) AS rolls_returned,
COALESCE((SELECT sum(COALESCE(u.qty_received, u.length_m)) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'returned_to_supplier'), 0) AS qty_returned
      FROM public.mm_style_materials sm JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sm.factory_id = v_factory AND sm.order_id = p_order_id AND (cm.id IS NULL OR cm.kind = 'Fabric')
    ) x;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('colorway_id', g.colorway_id, 'color_name', g.color_name, 'fabric_count', g.fabric_count, 'required_m', g.required_m, 'qty_in_wh', g.qty_in_wh, 'qty_racked', g.qty_racked, 'ready', g.ready) ORDER BY g.color_name), '[]'::jsonb) INTO v_colors FROM (
    SELECT f->>'colorway_id' AS colorway_id, f->>'color_name' AS color_name, count(*)::int AS fabric_count,
      COALESCE(sum((f->>'required_m')::numeric), 0) AS required_m,
      COALESCE(sum(COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)), 0) AS qty_in_wh,
      COALESCE(sum((f->>'qty_racked')::numeric), 0) AS qty_racked,
      bool_and(CASE WHEN COALESCE((f->>'required_m')::numeric, 0) <= 0 THEN (COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)) > 0 ELSE (COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)) >= (f->>'required_m')::numeric * 0.95 END) AS ready
    FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f GROUP BY f->>'colorway_id', f->>'color_name'
  ) g;
  SELECT COALESCE(jsonb_agg(c.obj ORDER BY c.sort_ts DESC NULLS LAST), '[]'::jsonb) INTO v_challans FROM (
    SELECT jsonb_build_object('kind', 'inbound', 'origin', c.source, 'id', c.id, 'challan_no', c.challan_no, 'status', c.status, 'sent_at', c.sent_at, 'received_at', c.received_at, 'color_name', (public._mm_challan_header(c)->>'color_name'), 'fabric_name', (public._mm_challan_header(c)->>'fabric_name'), 'fabric_category', (public._mm_challan_header(c)->>'fabric_category'), 'roll_count', (public._mm_challan_header(c)->>'roll_count')::int, 'qty', (public._mm_challan_header(c)->>'qty')::numeric, 'uom', public._mm_challan_header(c)->>'uom') AS obj, COALESCE(c.sent_at, c.received_at, c.created_at) AS sort_ts
    FROM public.mm_in_challans c JOIN public.mm_style_materials sm ON sm.id = c.style_material_id WHERE c.factory_id = v_factory AND sm.order_id = p_order_id
    UNION ALL
    SELECT jsonb_build_object('kind', 'store', 'origin', 'store', 'id', sc.id, 'challan_no', sc.challan_no, 'status', sc.status, 'sent_at', sc.sent_at, 'received_at', sc.received_at, 'color_name', cw.name, 'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name), 'fabric_category', CASE WHEN cm.id IS NULL THEN NULL WHEN lower(trim(cm.category)) IN ('fabric', 'trim') THEN NULLIF(trim(cm.extras->>'fabricCategory'), '') ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), '')) END, 'roll_count', (SELECT count(*)::int FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id), 'qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id), 'uom', (SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id LIMIT 1)) AS obj, COALESCE(sc.sent_at, sc.received_at, sc.created_at) AS sort_ts
    FROM public.mm_store_challans sc JOIN public.mm_style_materials sm ON sm.id = sc.style_material_id JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id WHERE sc.factory_id = v_factory AND sm.order_id = p_order_id
  ) c;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg, 'shade', u.shade, 'shade_band', u.shade_band, 'qty_available', u.qty_available, 'lot_no', u.lot_no, 'attributes', u.attributes, 'mill_snapshot', u.mill_snapshot, 'source', u.source, 'status', u.status, 'qc_result', u.qc_result, 'points_per_100_sqyd', (SELECT i.points_per_100_sqyd FROM public.mm_warehouse_inspections i WHERE i.stock_unit_id = u.id ORDER BY i.inspected_at DESC NULLS LAST LIMIT 1), 'in_challan_id', u.in_challan_id, 'store_challan_id', u.store_challan_id, 'color_name', cw.name, 'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name), 'fabric_type', ft.name, 'fabric_type_id', ft.id, 'location_code', loc.code, 'location_name', loc.name, 'bucket', CASE WHEN u.status = 'draft' THEN 'mill' WHEN u.status = 'in_transit' THEN 'transit' WHEN u.status = 'pending_qc' THEN 'testing' WHEN u.status = 'rejected' OR COALESCE(loc.location_type, '') = 'rejected' THEN 'rejected' WHEN public._mm_loc_is_under(u.current_location_id, v_cut) THEN 'issued' WHEN public._mm_is_pickable_loc(u.current_location_id) THEN 'racked' ELSE 'receiving' END) ORDER BY cw.name, COALESCE(NULLIF(trim(cm.name), ''), ft.name), u.unit_code), '[]'::jsonb) INTO v_rolls
  FROM public.mm_stock_units u JOIN public.mm_style_materials sm ON sm.id = u.style_material_id JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id WHERE u.factory_id = v_factory AND sm.order_id = p_order_id;
  SELECT COALESCE(sum(GREATEST(COALESCE((f->>'required_m')::numeric, 0), 0)), 0), COALESCE(sum(COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)), 0), COALESCE(sum(COALESCE((f->>'qty_racked')::numeric, 0)), 0), COALESCE(sum(COALESCE((f->>'qty_in_transit')::numeric, 0)), 0) INTO v_cover, v_wh_qty, v_rack_qty, v_transit_qty FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f;
  IF v_cover > 0 THEN v_cover := LEAST(1, v_wh_qty / v_cover); ELSIF v_wh_qty > 0 THEN v_cover := 1; ELSE v_cover := 0; END IF;
  IF v_wh_qty > 0 THEN v_putaway := LEAST(1, v_rack_qty / v_wh_qty); ELSE v_putaway := 0; END IF;
  SELECT COALESCE(count(*), 0), COALESCE(count(*) FILTER (WHERE (c->>'ready')::boolean), 0) INTO v_colors_total, v_colors_ready FROM jsonb_array_elements(COALESCE(v_colors, '[]'::jsonb)) c;
  v_score := round((v_cover * 70) + (v_putaway * 20) + (CASE WHEN v_colors_total > 0 THEN (v_colors_ready::numeric / v_colors_total) * 10 ELSE 0 END))::int;
  IF v_score = 0 AND COALESCE(v_wh_qty, 0) = 0 AND COALESCE(v_transit_qty, 0) = 0 THEN v_label := 'Not started';
  ELSIF v_cover >= 0.9 AND v_putaway >= 0.8 THEN v_label := 'Ready for cutting';
  ELSIF v_cover < 0.5 THEN v_label := 'Material inbound';
  ELSIF v_putaway < 0.5 THEN v_label := 'Receiving';
  ELSE v_label := 'In warehouse'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type_id', t.type_id, 'fields', t.fields) ORDER BY t.type_id), '[]'::jsonb) INTO v_test_fields FROM (SELECT f.type_id, jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options) ORDER BY f.seq, f.label) AS fields FROM public.mm_type_test_fields f WHERE f.factory_id = v_factory AND f.is_active AND f.type_id IN (SELECT DISTINCT sm.fabric_type_id FROM public.mm_style_materials sm WHERE sm.factory_id = v_factory AND sm.order_id = p_order_id AND sm.fabric_type_id IS NOT NULL) GROUP BY f.type_id) t;
  RETURN public._mm_ok(jsonb_build_object('order', v_order, 'fabrics', COALESCE(v_fabrics, '[]'::jsonb), 'colors', COALESCE(v_colors, '[]'::jsonb), 'challans', COALESCE(v_challans, '[]'::jsonb), 'rolls', COALESCE(v_rolls, '[]'::jsonb), 'test_fields', COALESCE(v_test_fields, '[]'::jsonb), 'readiness', jsonb_build_object('score', v_score, 'label', v_label, 'coverage_pct', round(v_cover * 100), 'putaway_pct', round(v_putaway * 100), 'colors_total', v_colors_total, 'colors_ready', v_colors_ready, 'qty_in_wh', COALESCE(v_wh_qty, 0), 'qty_racked', COALESCE(v_rack_qty, 0), 'qty_in_transit', COALESCE(v_transit_qty, 0), 'qty_awaiting_test', COALESCE((SELECT sum(COALESCE((f->>'qty_awaiting_test')::numeric, 0)) FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f), 0))));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_unallocated_mill()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'remarks', b.remarks, 'row_version', b.row_version,
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
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_warehouse_board(p_order_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_orders jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_order_ids IS NULL OR COALESCE(array_length(p_order_ids, 1), 0) = 0 THEN
    RETURN public._mm_ok(jsonb_build_object('orders', '[]'::jsonb));
  END IF;

  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

  v_orders := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(ord.obj ORDER BY ord.style_name), '[]'::jsonb) INTO v_orders
      FROM (
        SELECT
          cells.order_id,
          max(o.style_name) AS style_name,
          jsonb_build_object(
            'order_id', cells.order_id,
            'fabrics', COALESCE(jsonb_agg(jsonb_build_object(
              'colorway_id', cells.colorway_id,
              'color_name', cells.color_name,
              'fabric_line_id', cells.fabric_line_id,
              'fabric_type_id', cells.fabric_type_id,
              'fabric_name', cells.fabric_name,
              'fabric_type', cells.fabric_type,
              'fabric_category', cells.fabric_category,
              'required_m', cells.required_m,
              'uom', cells.uom,
              'style_material_id', cells.style_material_id,
              'rolls_received', cells.rolls_received,
              'qty_received_m', cells.qty_received_m,
              'rolls_passed', cells.rolls_passed,
              'qty_passed_m', cells.qty_passed_m,
              'rolls_to_cutting', cells.rolls_to_cutting,
              'qty_to_cutting_m', cells.qty_to_cutting_m
            ) ORDER BY cells.color_name, cells.fabric_name), '[]'::jsonb)
          ) AS obj
        FROM (
          SELECT
            o.id AS order_id,
            c.id AS colorway_id,
            c.name AS color_name,
            cm.id AS fabric_line_id,
            ft.id AS fabric_type_id,
            COALESCE(NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_name,
            COALESCE(ft.name, NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_type,
            NULLIF(trim(cm.extras->>'fabricCategory'), '') AS fabric_category,
            cm.total_cons AS required_m,
            COALESCE(
              NULLIF(trim(cm.unit), ''),
              (
                SELECT NULLIF(trim(u.uom), '')
                FROM public.mm_stock_units u
                WHERE u.style_material_id = sm.id
                ORDER BY u.created_at
                LIMIT 1
              )
            ) AS uom,
            sm.id AS style_material_id,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND public._mm_counts_as_received(u.status)
            ), 0) AS rolls_received,
            COALESCE((
              SELECT sum(u.qty_received) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND public._mm_counts_as_received(u.status)
            ), 0) AS qty_received_m,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND u.qc_result = 'pass'
                AND (
                  (
                    u.status = 'in_stock'
                    AND public._mm_loc_is_under(u.current_location_id, v_wh)
                  )
                  OR public._mm_loc_is_under(u.current_location_id, v_cut)
                )
            ), 0) AS rolls_passed,
            COALESCE((
              SELECT sum(u.qty_available) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND u.qc_result = 'pass'
                AND (
                  (
                    u.status = 'in_stock'
                    AND public._mm_loc_is_under(u.current_location_id, v_wh)
                  )
                  OR public._mm_loc_is_under(u.current_location_id, v_cut)
                )
            ), 0) AS qty_passed_m,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND public._mm_loc_is_under(u.current_location_id, v_cut)
            ), 0) AS rolls_to_cutting,
            COALESCE((
              SELECT sum(u.qty_available) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND public._mm_loc_is_under(u.current_location_id, v_cut)
            ), 0) AS qty_to_cutting_m
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
          WHERE o.factory_id = v_factory AND o.id = ANY (p_order_ids)
        ) cells
        JOIN public.style_orders o ON o.id = cells.order_id
        GROUP BY cells.order_id
      ) ord;
    EXCEPTION WHEN OTHERS THEN
      v_orders := NULL;
    END;
  END IF;

  IF v_orders IS NULL THEN
    SELECT COALESCE(jsonb_agg(ord.obj ORDER BY ord.style_name), '[]'::jsonb) INTO v_orders
    FROM (
      SELECT
        cells.order_id,
        max(o.style_name) AS style_name,
        jsonb_build_object(
          'order_id', cells.order_id,
          'fabrics', COALESCE(jsonb_agg(jsonb_build_object(
            'colorway_id', cells.colorway_id,
            'color_name', cells.color_name,
            'fabric_line_id', cells.fabric_line_id,
            'fabric_type_id', cells.fabric_type_id,
            'fabric_name', cells.fabric_name,
            'fabric_type', cells.fabric_type,
            'fabric_category', cells.fabric_category,
            'required_m', cells.required_m,
            'uom', cells.uom,
            'style_material_id', cells.style_material_id,
            'rolls_received', cells.rolls_received,
            'qty_received_m', cells.qty_received_m,
            'rolls_passed', cells.rolls_passed,
            'qty_passed_m', cells.qty_passed_m,
            'rolls_to_cutting', cells.rolls_to_cutting,
            'qty_to_cutting_m', cells.qty_to_cutting_m
          ) ORDER BY cells.color_name, cells.fabric_name), '[]'::jsonb)
        ) AS obj
      FROM (
        SELECT
          o.id AS order_id,
          c.id AS colorway_id,
          c.name AS color_name,
          t.id AS fabric_line_id,
          t.id AS fabric_type_id,
          t.name AS fabric_name,
          t.name AS fabric_type,
          NULL::text AS fabric_category,
          NULL::numeric AS required_m,
          NULL::text AS uom,
          sm.id AS style_material_id,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND public._mm_counts_as_received(u.status)
          ), 0) AS rolls_received,
          COALESCE((
            SELECT sum(u.qty_received) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND public._mm_counts_as_received(u.status)
          ), 0) AS qty_received_m,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND u.qc_result = 'pass'
              AND (
                (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
                OR public._mm_loc_is_under(u.current_location_id, v_cut)
              )
          ), 0) AS rolls_passed,
          COALESCE((
            SELECT sum(u.qty_available) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND u.qc_result = 'pass'
              AND (
                (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
                OR public._mm_loc_is_under(u.current_location_id, v_cut)
              )
          ), 0) AS qty_passed_m,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND public._mm_loc_is_under(u.current_location_id, v_cut)
          ), 0) AS rolls_to_cutting,
          COALESCE((
            SELECT sum(u.qty_available) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND public._mm_loc_is_under(u.current_location_id, v_cut)
          ), 0) AS qty_to_cutting_m
        FROM public.style_orders o
        JOIN public.colorways c ON c.order_id = o.id AND c.factory_id = v_factory
        JOIN public.mm_fabric_types t ON t.factory_id = v_factory AND t.is_active
        LEFT JOIN public.mm_style_materials sm
          ON sm.factory_id = v_factory AND sm.order_id = o.id
         AND sm.colorway_id = c.id AND sm.fabric_type_id = t.id
        WHERE o.factory_id = v_factory AND o.id = ANY (p_order_ids)
      ) cells
      JOIN public.style_orders o ON o.id = cells.order_id
      GROUP BY cells.order_id
    ) ord;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('orders', COALESCE(v_orders, '[]'::jsonb)));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_warehouse_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'rolls_in_stock', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'qty_m', (
      SELECT COALESCE(sum(u.qty_available), 0) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'qty_kg', (
      SELECT COALESCE(sum(u.weight_kg), 0) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'rolls_pickable', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
    ),
    'pending_putaway', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ),
    'red_label_count', (
      SELECT count(*) FROM public.mm_stock_units u
      JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory
        AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND (u.status = 'rejected' OR loc.location_type = 'rejected')
    ),
    'by_fabric_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', t.name, 'rolls', t.n) ORDER BY t.n DESC)
      FROM (
        SELECT ft.name, count(*)::int AS n
        FROM public.mm_stock_units u
        JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
        WHERE u.factory_id = v_factory AND u.status = 'in_stock'
          AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        GROUP BY ft.name
        ORDER BY count(*) DESC
        LIMIT 6
      ) t
    ), '[]'::jsonb),
    'pending', COALESCE((
      SELECT jsonb_agg(s.x ORDER BY s.ts DESC NULLS LAST)
      FROM (
        SELECT q.x, q.ts
        FROM (
          SELECT jsonb_build_object(
            'kind', 'mill', 'id', c.id, 'label',
            'Batch ' || c.challan_no || ' — ' || COALESCE(o.style_name, 'Unallocated') ||
            CASE WHEN cw.name IS NULL THEN '' ELSE ' / ' || cw.name END || ' — ' ||
            (SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = c.id) || ' rolls — sent ' ||
            CASE WHEN c.sent_at IS NULL THEN 'today'
                 WHEN c.sent_at > now() - interval '1 day' THEN 'today'
                 ELSE (EXTRACT(DAY FROM now() - c.sent_at)::int)::text || ' days ago' END,
            'ts', c.sent_at
          ) AS x, c.sent_at AS ts
          FROM public.mm_in_challans c
          LEFT JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          LEFT JOIN public.style_orders o ON o.id = sm.order_id
          LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory AND c.source = 'mill' AND c.status = 'pending'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', c.source, 'id', c.id, 'label',
            c.challan_no || ' — ' || COALESCE(o.style_name, 'Unallocated') ||
            CASE WHEN cw.name IS NULL THEN '' ELSE ' / ' || cw.name END || ' — ' ||
            (SELECT count(*) FILTER (WHERE u.qc_result IS NOT NULL) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' of ' ||
            (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' rolls tested',
            'ts', COALESCE(c.received_at, c.sent_at)
          ) AS x, COALESCE(c.received_at, c.sent_at) AS ts
          FROM public.mm_in_challans c
          LEFT JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          LEFT JOIN public.style_orders o ON o.id = sm.order_id
          LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory
            AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc')
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'putaway', 'id', 'queue', 'label',
            (SELECT count(*) FROM public.mm_stock_units u
             WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
               AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
               AND public._mm_is_unassigned_loc(u.current_location_id)
            )::text || ' rolls waiting for rack putaway',
            'ts', now()
          ) AS x, now() AS ts
          WHERE EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
              AND public._mm_is_unassigned_loc(u.current_location_id)
          )
        ) q
        ORDER BY q.ts DESC NULLS LAST
        LIMIT 8
      ) s
    ), '[]'::jsonb),
    'internal_pending', (
      SELECT count(*) FROM public.mm_in_challans
      WHERE factory_id = v_factory AND source = 'mill' AND status = 'pending'
    ),
    'internal_stock', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.source = 'mill' AND u.status = 'in_stock'
        AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'external_pending', (
      SELECT count(*) FROM public.mm_in_challans
      WHERE factory_id = v_factory AND source = 'vendor' AND status = 'received'
    ),
    'testing_pending', (
      SELECT count(*) FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory
        AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc')
    ),
    'external_stock', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.source = 'vendor' AND u.status = 'in_stock'
        AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'store_pending', (
      SELECT count(*) FROM public.mm_store_challans
      WHERE factory_id = v_factory AND status = 'pending'
    ),
    'store_sent', (
      SELECT count(*) FROM public.mm_store_challans WHERE factory_id = v_factory
    ),
    'rack_count', (
      SELECT count(*) FROM public.mm_locations
      WHERE factory_id = v_factory AND is_active AND location_type IN ('rack', 'bin')
        AND public._mm_loc_is_under(id, v_wh)
    )
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_get_warehouse_dispatch_board(p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'pending', COALESCE((
      SELECT jsonb_agg(g.obj ORDER BY g.sort_name)
      FROM (
        SELECT jsonb_build_object(
          'style_material_id', sm.id,
          'order_id', o.id,
          'style_name', o.style_name,
          'color_name', cw.name,
          'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
          'fabric_type', ft.name,
          'fabric_type_id', ft.id,
          'uom', COALESCE((
            SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id ORDER BY u.created_at LIMIT 1
          ), NULLIF(trim(cm.unit), '')),
          'roll_count', (
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_pickable_loc(u.current_location_id)
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
          ),
          'qty', (
            SELECT COALESCE(sum(u.qty_available), 0) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_pickable_loc(u.current_location_id)
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
          ),
          'rolls', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
              'shade', u.shade, 'shade_band', u.shade_band, 'lot_no', u.lot_no, 'is_remnant', u.is_remnant, 'attributes', u.attributes,
              'mill_snapshot', u.mill_snapshot, 'source', u.source,
              'location_code', loc.code, 'location_name', loc.name,
              'fabric_type_id', ft.id
            ) ORDER BY u.unit_code)
            FROM public.mm_stock_units u
            JOIN public.mm_locations loc ON loc.id = u.current_location_id
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_pickable_loc(u.current_location_id)
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
          ), '[]'::jsonb)
        ) AS obj,
        o.style_name || ' ' || cw.name AS sort_name
        FROM public.mm_style_materials sm
        JOIN public.style_orders o ON o.id = sm.order_id
        JOIN public.colorways cw ON cw.id = sm.colorway_id
        JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
        LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
        WHERE sm.factory_id = v_factory
          AND (p_order_id IS NULL OR sm.order_id = p_order_id)
          AND EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_pickable_loc(u.current_location_id)
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
          )
      ) g
    ), '[]'::jsonb),
    'completed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sc.id,
        'challan_no', sc.challan_no,
        'status', sc.status,
        'sent_at', sc.sent_at,
        'reference_no', sc.reference_no,
        'style_material_id', sm.id,
        'order_id', o.id,
        'style_name', o.style_name,
        'color_name', cw.name,
        'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
        'fabric_type', ft.name,
        'fabric_type_id', ft.id,
        'uom', (
          SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
          WHERE u.store_challan_id = sc.id LIMIT 1
        ),
        'roll_count', (SELECT count(*)::int FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id),
        'qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id),
        'rolls', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
            'shade', u.shade, 'shade_band', u.shade_band, 'lot_no', u.lot_no, 'is_remnant', u.is_remnant, 'attributes', u.attributes,
            'mill_snapshot', u.mill_snapshot, 'source', u.source,
            'location_code', loc.code, 'location_name', loc.name,
            'fabric_type_id', ft.id
          ) ORDER BY u.unit_code)
          FROM public.mm_stock_units u
          LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
          WHERE u.store_challan_id = sc.id
        ), '[]'::jsonb)
      ) ORDER BY sc.sent_at DESC NULLS LAST)
      FROM public.mm_store_challans sc
      JOIN public.mm_style_materials sm ON sm.id = sc.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sc.factory_id = v_factory
        AND (p_order_id IS NULL OR sm.order_id = p_order_id)
    ), '[]'::jsonb),
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('type_id', t.type_id, 'fields', t.fields) ORDER BY t.type_id)
      FROM (
        SELECT f.type_id, jsonb_agg(jsonb_build_object(
          'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options
        ) ORDER BY f.seq, f.label) AS fields
        FROM public.mm_type_test_fields f
        WHERE f.factory_id = v_factory AND f.is_active
        GROUP BY f.type_id
      ) t
    ), '[]'::jsonb)
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_hold_rolls(p_unit_ids uuid[], p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_n integer := 0;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A reason is required');
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_unit_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    IF v_unit.status NOT IN ('pending_qc', 'in_stock') THEN
      RETURN public._mm_err('INVALID', 'Only rolls in the warehouse can be held');
    END IF;
    UPDATE public.mm_stock_units
    SET on_hold = true, hold_reason = btrim(p_reason), hold_by = public._mm_actor_id(), hold_at = now(),
        updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;
    PERFORM public._mm_ledger(
      v_factory, v_id, 'HOLD', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_stock_units', v_id, btrim(p_reason)
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('held', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_list_cutting_rolls(p_order_id uuid, p_colorway_id uuid, p_style_material_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_cut uuid;
  v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_actor IS NULL OR v_factory IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', u.id,
      'unit_code', u.unit_code,
      'roll_no', COALESCE(u.attributes->>'roll_no', u.unit_code),
      'lot_no', u.lot_no,
      'width_in', u.declared_width_in,
      'opening_qty', public._mm_unit_on_hand(u),
      'uom', u.uom,
      'status', u.status,
      'style_material_id', u.style_material_id,
      'color_ref', u.color_ref,
      'is_remnant', u.is_remnant
    ) ORDER BY u.unit_code)
    FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory
      AND public._mm_unit_on_hand(u) > 0
      AND NOT public._mm_unit_on_hold(u.id)
      AND NOT public._mm_store_line_missing(u.id)
      AND (u.status = 'issued' OR (u.status = 'in_stock' AND u.current_location_id = v_cut))
      AND (
        (p_style_material_id IS NOT NULL AND u.style_material_id = p_style_material_id)
        OR (
          p_style_material_id IS NULL
          AND u.style_material_id IN (
            SELECT sm.id FROM public.mm_style_materials sm
            WHERE sm.factory_id = v_factory
              AND sm.order_id = p_order_id
              AND (p_colorway_id IS NULL OR sm.colorway_id = p_colorway_id)
          )
        )
      )
      AND (
        v_q IS NULL
        OR u.unit_code ILIKE '%' || v_q || '%'
        OR COALESCE(u.attributes->>'roll_no', '') ILIKE '%' || v_q || '%'
        OR COALESCE(u.lot_no, '') ILIKE '%' || v_q || '%'
      )
  ), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_floor_grns(p_source text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
    FROM (
      SELECT c.id, c.challan_no, c.grn_no, c.invoice_ref, c.reference_no, c.source,
             c.status, c.supplier_name, c.style_material_id, c.row_version, c.created_at, c.received_at,
             (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) AS roll_count,
             (SELECT count(*) FROM public.mm_stock_units u
               WHERE u.in_challan_id = c.id
                 AND COALESCE((public._mm_unit_clearance(u.id)->>'cleared')::boolean, false)
             ) AS cleared_count
      FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory
        AND (p_source IS NULL OR c.source = p_source)
      ORDER BY c.created_at DESC
      LIMIT 40
    ) x
  ), '[]'::jsonb));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_list_inspection_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb)
    FROM (
      SELECT u.id, u.unit_code, u.source, u.status, u.length_m, u.qty_received, u.declared_width_in,
             u.color_ref, u.lot_no, u.attributes, u.style_material_id, u.in_challan_id,
             c.challan_no, c.grn_no, c.invoice_ref, c.supplier_name,
             cl.clearance,
             public._mm_unit_on_hold(u.id) AS on_hold,
             public._mm_fpt_threshold(u.id) AS fpt_max_points,
             CASE
               WHEN u.source = 'mill'
                 AND COALESCE((cl.clearance->>'tested')::boolean, false)
                 AND NOT COALESCE((cl.clearance->>'inspected')::boolean, false)
                 THEN 'optional'
               ELSE 'blocking'
             END AS queue_kind
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      CROSS JOIN LATERAL (SELECT public._mm_unit_clearance(u.id) AS clearance) cl
      WHERE u.factory_id = v_factory
        AND u.status IN ('pending_qc', 'in_stock')
        AND NOT public._mm_unit_on_hold(u.id)
        AND (
          COALESCE((cl.clearance->>'cleared')::boolean, false) = false
          OR (
            u.source = 'mill'
            AND COALESCE((cl.clearance->>'tested')::boolean, false)
            AND NOT COALESCE((cl.clearance->>'inspected')::boolean, false)
          )
        )
      ORDER BY u.created_at DESC
      LIMIT 200
    ) x
  ), '[]'::jsonb));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_list_mill_stock(p_search text DEFAULT NULL::text, p_alloc text DEFAULT NULL::text, p_place text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_search text;
  v_alloc text;
  v_place text;
  v_page integer;
  v_size integer;
  v_total integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_search := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_alloc := COALESCE(NULLIF(btrim(COALESCE(p_alloc, '')), ''), '');
  v_place := COALESCE(NULLIF(btrim(COALESCE(p_place, '')), ''), '');
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);

  SELECT count(*) INTO v_total
  FROM public.mm_mill_rolls r
  JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
  JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
  WHERE r.factory_id = v_factory
    AND (
      (r.status = 'draft' AND r.in_challan_id IS NULL)
      OR (c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
      OR EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      )
    )
    AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
    AND (
      v_place = ''
      OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) OR (v_place = 'at_process' AND public._mm_mill_at_process(r.id))
      OR (v_place = 'in_transit' AND c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
      OR (v_place = 'missing_wh' AND EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      ))
    )
    AND (
      v_search IS NULL
      OR lower(concat_ws(' ', r.unit_code, b.batch_no, ft.name, o.style_name, r.color_ref, r.lot_no)) LIKE '%' || v_search || '%'
    );

  RETURN public._mm_ok(jsonb_build_object(
    'total', v_total,
    'rows', COALESCE((
      SELECT jsonb_agg(x.obj)
      FROM (
        SELECT jsonb_build_object(
          'id', r.id,
          'unit_code', r.unit_code,
          'batch_no', b.batch_no,
          'fabric_type', ft.name,
          'color_ref', r.color_ref,
          'lot_no', r.lot_no,
          'length_m', r.length_m,
          'style_material_id', r.style_material_id,
          'style_name', o.style_name,
          'order_id', sm.order_id,
          'colorway_id', sm.colorway_id,
          'fabric_line_id', sm.colorway_material_id,
          'process_challan_id', (
            SELECT l.challan_id FROM public.mm_process_out_lines l
            WHERE l.mill_roll_id = r.id AND l.line_status = 'out'
            LIMIT 1
          ), 'place', CASE
            WHEN EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      ) THEN 'missing_wh'
            WHEN public._mm_mill_at_process(r.id) THEN 'at_process' WHEN r.status = 'draft' AND r.in_challan_id IS NULL THEN 'at_mill'
            ELSE 'in_transit'
          END
        ) AS obj
        FROM public.mm_mill_rolls r
        JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
        JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
        LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
        LEFT JOIN public.style_orders o ON o.id = sm.order_id
        LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
        WHERE r.factory_id = v_factory
          AND (
            (r.status = 'draft' AND r.in_challan_id IS NULL)
            OR (c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
            OR EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      )
          )
          AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
          AND (
            v_place = ''
            OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) OR (v_place = 'at_process' AND public._mm_mill_at_process(r.id))
            OR (v_place = 'in_transit' AND c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
      OR (v_place = 'missing_wh' AND EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      ))
          )
          AND (
            v_search IS NULL
            OR lower(concat_ws(' ', r.unit_code, b.batch_no, ft.name, o.style_name, r.color_ref, r.lot_no)) LIKE '%' || v_search || '%'
          )
        ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL) DESC, b.batch_no, r.unit_code
        OFFSET (v_page - 1) * v_size
        LIMIT v_size
      ) x
    ), '[]'::jsonb)
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_list_process_challans()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT c.id, c.challan_no, c.origin, c.status, v.name AS vendor_name, t.name AS process_name, c.created_at,
        (SELECT count(*)::int FROM public.mm_process_out_lines l WHERE l.challan_id = c.id) AS roll_count,
        (SELECT COALESCE(sum(l.qty), 0) FROM public.mm_process_out_lines l WHERE l.challan_id = c.id) AS qty,
        (SELECT count(*)::int FROM public.mm_process_out_lines l WHERE l.challan_id = c.id AND l.line_status = 'out') AS still_out
      FROM public.mm_process_challans c
      JOIN public.mm_process_vendors v ON v.id = c.vendor_id AND v.factory_id = v_factory
      JOIN public.mm_process_types t ON t.id = c.process_type_id AND t.factory_id = v_factory
      WHERE c.factory_id = v_factory
      ORDER BY c.created_at DESC
      LIMIT 200
    ) x
  ), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_putaway_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
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
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_rack_master()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'warehouse_id', v_wh,
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id,
        'parent_id', loc.parent_id,
        'code', loc.code,
        'name', loc.name,
        'location_type', loc.location_type,
        'is_pickable', loc.is_pickable,
        'capacity_rolls', loc.capacity_rolls, 'row_version', loc.row_version,
        'roll_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND public._mm_is_on_hand(u.status, loc.location_type)
        )
      ) ORDER BY loc.location_type, loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('zone', 'rack', 'bin')
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_receive_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.seq, t.name)
    FROM public.mm_fabric_types t
    WHERE t.factory_id = v_factory AND t.is_active
  ), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_stock_movements(p_search text DEFAULT NULL::text, p_kind text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        sl.qty_after,
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
          'qty_after', s.qty_after,
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
$function$
;

CREATE OR REPLACE FUNCTION public.mm_list_store_stock(p_style_material_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'style_material_id', sm.id,
        'style_name', o.style_name,
        'color_name', cw.name,
        'fabric_type', ft.name,
        'rolls', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND u.store_challan_id IS NULL
            AND public._mm_is_pickable_loc(u.current_location_id)
        )
      ) ORDER BY o.style_name, cw.name)
      FROM public.mm_style_materials sm
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      WHERE sm.factory_id = v_factory
        AND (p_style_material_id IS NULL OR sm.id = p_style_material_id)
        AND EXISTS (
          SELECT 1 FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND u.store_challan_id IS NULL
            AND public._mm_is_pickable_loc(u.current_location_id)
        )
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
        'shade', u.shade, 'shade_band', u.shade_band, 'lot_no', u.lot_no, 'source', u.source,
        'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND (p_style_material_id IS NULL OR u.style_material_id = p_style_material_id)
    ), '[]'::jsonb)
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_list_test_fields(p_fabric_type_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_factory := public._mm_require_ops('mm_inventory');
    EXCEPTION WHEN OTHERS THEN
      RETURN public._mm_err('ERROR', SQLERRM);
    END;
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type,
      'options', f.options, 'capture_site', f.capture_site
    ) ORDER BY f.seq, f.label)
    FROM public.mm_type_test_fields f
    WHERE f.factory_id = v_factory AND f.type_id = p_fabric_type_id AND f.is_active
  ), '[]'::jsonb));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_list_warehouse_locations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'warehouse_id', v_wh,
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id,
        'parent_id', loc.parent_id,
        'code', loc.code,
        'name', loc.name,
        'location_type', loc.location_type,
        'is_pickable', loc.is_pickable,
        'roll_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'
        )
      ) ORDER BY loc.location_type, loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND (loc.id = v_wh OR public._mm_loc_is_under(loc.id, v_wh))
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_warehouse_stock(p_search text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_buyer text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        u.qty_available,
        u.qty_received,
        u.qty_declared,
        u.qty_uom,
        u.uom,
        u.status,
        u.in_challan_id,
        u.store_challan_id,
        u.style_material_id,
        u.fabric_type_id,
        u.color_ref,
        u.shade,
        u.lot_no,
        u.on_hold,
        u.hold_reason,
        (SELECT i.points_per_100_sqyd FROM public.mm_warehouse_inspections i WHERE i.stock_unit_id = u.id ORDER BY i.inspected_at DESC NULLS LAST LIMIT 1) AS points_per_100_sqyd,
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
            fabric_name, fabric_type, location_code, location_name, challan_no, color_ref, shade, lot_no
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
          'qty', s.qty_available,
          'qty_available', s.qty_available,
          'qty_received', s.qty_received,
          'qty_declared', s.qty_declared,
          'qty_uom', s.qty_uom,
          'points_per_100_sqyd', s.points_per_100_sqyd,
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
          'shade', s.shade,
          'lot_no', s.lot_no,
          'on_hold', s.on_hold,
          'hold_reason', s.hold_reason,
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
$function$
;

CREATE OR REPLACE FUNCTION public.mm_putaway_rolls(p_unit_ids uuid[], p_location_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_loc public.mm_locations%ROWTYPE;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
  v_on integer := 0;
  v_already integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_location_id IS NULL OR p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls and a target location');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  SELECT * INTO v_loc FROM public.mm_locations WHERE id = p_location_id AND factory_id = v_factory AND is_active;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Location not found'); END IF;
  IF v_loc.location_type NOT IN ('rack', 'bin', 'rejected') THEN
    RETURN public._mm_err('INVALID', 'Choose a rack, bin, or the red-label area');
  END IF;
  IF v_loc.location_type IN ('rack', 'bin') AND NOT v_loc.is_pickable THEN
    RETURN public._mm_err('INVALID', 'That rack or bin is not active');
  END IF;
  IF NOT public._mm_loc_is_under(v_loc.id, v_wh) THEN
    RETURN public._mm_err('INVALID', 'Target must be in the warehouse');
  END IF;

  IF v_loc.location_type IN ('rack', 'bin') AND v_loc.capacity_rolls IS NOT NULL THEN
    SELECT count(*)::int INTO v_on
    FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory AND u.current_location_id = v_loc.id AND u.status = 'in_stock';
    SELECT count(*)::int INTO v_already
    FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory AND u.id = ANY (p_unit_ids) AND u.current_location_id = v_loc.id;
    IF (v_on - v_already + COALESCE(array_length(p_unit_ids, 1), 0)) > v_loc.capacity_rolls THEN
      RETURN public._mm_err(
        'CAPACITY',
        format(
          '%s holds %s of %s rolls. Move rolls off it or raise the limit in Material Management.',
          v_loc.code, v_on, v_loc.capacity_rolls
        )
      );
    END IF;
  END IF;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.status <> 'in_stock' OR v_unit.store_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not available to move');
    END IF;
    IF NOT public._mm_loc_is_under(v_unit.current_location_id, v_wh) THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not in the warehouse');
    END IF;
    UPDATE public.mm_stock_units SET
      current_location_id = v_loc.id,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    WHERE id = v_unit.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_loc.id, 'mm_locations', v_loc.id,
      CASE WHEN v_loc.location_type = 'rejected' THEN 'Moved to red label' ELSE 'Rack move' END
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('count', v_n, 'location_id', v_loc.id));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_receive_in_challan_lines(p_challan_id uuid, p_unit_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_missing uuid[];
  v_version integer;
BEGIN
  IF p_unit_ids IS NULL OR cardinality(p_unit_ids) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select the rolls that arrived');
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_unit_ids) AS wanted(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mm_stock_units u
      WHERE u.id = wanted.id AND u.in_challan_id = p_challan_id AND u.status = 'in_transit'
    )
  ) THEN
    RETURN public._mm_err('INVALID', 'A selected roll is not still in transit');
  END IF;
  SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[]), c.row_version
    INTO v_missing, v_version
  FROM public.mm_in_challans c
  LEFT JOIN public.mm_stock_units u
    ON u.in_challan_id = c.id AND u.status = 'in_transit' AND NOT (u.id = ANY (p_unit_ids))
  WHERE c.id = p_challan_id
  GROUP BY c.row_version;
  RETURN public.mm_receive_mill_in_challan(p_challan_id, '[]'::jsonb, v_version, v_missing);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_bundle(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recv jsonb;
  v_len jsonb;
  v_ins jsonb;
  v_rolls jsonb := COALESCE(p_payload->'inspection_rolls', '[]'::jsonb);
BEGIN
  v_recv := public.mm_receive_mill_floor(
    NULLIF(p_payload->>'id', '')::uuid,
    COALESCE(p_payload->'roll_edits', '[]'::jsonb),
    COALESCE((p_payload->>'row_version')::int, 1),
    CASE
      WHEN jsonb_typeof(p_payload->'missing_unit_ids') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'missing_unit_ids')::uuid)
      ELSE NULL
    END
  );
  IF COALESCE(v_recv->>'ok', 'false') <> 'true' THEN
    RAISE EXCEPTION '%', COALESCE(v_recv->>'message', v_recv->>'code', 'Receive failed');
  END IF;
  IF jsonb_typeof(p_payload->'lengths') = 'array' AND jsonb_array_length(p_payload->'lengths') > 0 THEN
    v_len := public.mm_confirm_received_lengths(
      NULLIF(p_payload->>'id', '')::uuid,
      p_payload->'lengths'
    );
    IF COALESCE(v_len->>'ok', 'false') <> 'true' THEN
      RAISE EXCEPTION '%', COALESCE(v_len->>'message', 'Length confirm failed');
    END IF;
  END IF;
  IF jsonb_typeof(v_rolls) = 'array' AND jsonb_array_length(v_rolls) > 0 THEN
    v_ins := public.mm_save_warehouse_inspections(NULLIF(p_payload->>'id', '')::uuid, v_rolls);
    IF COALESCE(v_ins->>'ok', 'false') <> 'true' THEN
      RAISE EXCEPTION '%', COALESCE(v_ins->>'message', 'Inspection save failed');
    END IF;
  END IF;
  RETURN public._mm_ok(jsonb_build_object(
    'receive', v_recv->'data',
    'lengths', v_len->'data',
    'inspection', v_ins->'data'
  ));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_floor(p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_has boolean; v_out jsonb;
BEGIN
  IF COALESCE(cardinality(p_missing_unit_ids), 0) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'mm_receive_mill_in_challan'
        AND pg_get_function_identity_arguments(p.oid) LIKE '%p_missing_unit_ids%'
    ) INTO v_has;
    IF NOT v_has THEN
      RETURN public._mm_err('WAITING_P4', 'Partial receive is not available yet');
    END IF;
    EXECUTE 'SELECT public.mm_receive_mill_in_challan($1, $2, $3, $4)'
      INTO v_out USING p_id, p_roll_edits, p_row_version, p_missing_unit_ids;
    RETURN v_out;
  END IF;
  RETURN public.mm_receive_mill_in_challan(p_id, p_roll_edits, p_row_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_receive_process_return(p_id uuid, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_ch public.mm_process_challans%ROWTYPE;
  v_elem jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_line_id uuid;
  v_same boolean;
  v_code text;
  v_qty numeric;
  v_shade text;
  v_color text;
  v_lot text;
  v_line public.mm_process_out_lines%ROWTYPE;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_unit public.mm_stock_units%ROWTYPE;
  v_child uuid;
  v_recv uuid;
  v_delta numeric;
  v_codes text[] := ARRAY[]::text[];
  v_row jsonb;
  v_grp record;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();
  IF p_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A process challan is required');
  END IF;
  IF p_rolls IS NULL OR jsonb_typeof(p_rolls) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Enter the rolls that came back');
  END IF;
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Process challan was not found'); END IF;
  IF v_ch.status = 'returned' THEN RETURN public._mm_err('CLOSED', 'This challan is already closed'); END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_rolls)
  LOOP
    BEGIN
      v_line_id := NULLIF(v_elem->>'source_line_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A return row is missing its sent roll');
    END;
    v_same := COALESCE((v_elem->>'same')::boolean, false);
    v_code := NULLIF(btrim(v_elem->>'unit_code'), '');
    BEGIN
      v_qty := (v_elem->>'qty')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'Qty must be a number');
    END;
    v_shade := NULLIF(btrim(v_elem->>'shade'), '');
    v_color := NULLIF(btrim(v_elem->>'color_ref'), '');
    v_lot := NULLIF(btrim(v_elem->>'lot_no'), '');
    IF v_line_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Each return row needs the sent roll'); END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN RETURN public._mm_err('INVALID', 'Return qty must be greater than zero'); END IF;
    IF NOT v_same AND v_code IS NULL THEN RETURN public._mm_err('REQUIRED', 'A new roll needs a roll number'); END IF;
    IF NOT v_same THEN
      IF lower(v_code) = ANY (v_codes) THEN RETURN public._mm_err('DUPLICATE', 'Return roll numbers must be unique'); END IF;
      v_codes := v_codes || lower(v_code);
    END IF;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'line_id', v_line_id, 'same', v_same, 'unit_code', v_code, 'qty', v_qty,
      'shade', v_shade, 'color_ref', v_color, 'lot_no', v_lot
    ));
  END LOOP;

  FOR v_grp IN
    SELECT line_id, count(*) AS n, bool_or(same) AS any_same, bool_or(NOT same) AS any_new
    FROM jsonb_to_recordset(v_clean) AS x(line_id uuid, same boolean)
    GROUP BY line_id
  LOOP
    IF v_grp.any_same AND v_grp.n > 1 THEN
      RETURN public._mm_err('INVALID', 'A sent roll cannot come back as itself and as a new roll');
    END IF;
    SELECT * INTO v_line FROM public.mm_process_out_lines
    WHERE id = v_grp.line_id AND challan_id = v_ch.id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A sent roll was not found on this challan'); END IF;
    IF v_line.line_status <> 'out' THEN RETURN public._mm_err('INVALID', 'That roll is already back'); END IF;
    IF v_grp.any_new THEN
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_clean) value WHERE (value->>'line_id')::uuid = v_grp.line_id
      LOOP
        v_code := v_row->>'unit_code';
        IF v_ch.origin = 'mill' THEN
          SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_line.mill_roll_id AND factory_id = v_factory;
          IF EXISTS (
            SELECT 1 FROM public.mm_mill_rolls r
            WHERE r.factory_id = v_factory AND r.mill_batch_id = v_roll.mill_batch_id AND lower(r.unit_code) = lower(v_code)
          ) THEN RETURN public._mm_err('DUPLICATE', 'That roll number is already used in this batch'); END IF;
        ELSE
          SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id AND factory_id = v_factory;
          IF v_unit.mill_batch_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.factory_id = v_factory AND u.mill_batch_id = v_unit.mill_batch_id AND lower(u.unit_code) = lower(v_code)
          ) THEN RETURN public._mm_err('DUPLICATE', 'That roll number is already used in this batch'); END IF;
          IF v_unit.mill_batch_id IS NULL AND EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.factory_id = v_factory AND u.mill_batch_id IS NULL AND u.unit_code = v_code
          ) THEN RETURN public._mm_err('DUPLICATE', 'That roll number is already used'); END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF v_ch.origin = 'warehouse' THEN
    PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
    v_recv := public._mm_recv_loc(v_factory);
    IF v_recv IS NULL THEN RAISE EXCEPTION 'RECEIVING_MISSING'; END IF;
  END IF;

  FOR v_grp IN
    SELECT line_id, bool_or(same) AS any_same
    FROM jsonb_to_recordset(v_clean) AS x(line_id uuid, same boolean)
    GROUP BY line_id
  LOOP
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_grp.line_id;
    IF v_grp.any_same THEN
      SELECT value INTO v_row FROM jsonb_array_elements(v_clean) value WHERE (value->>'line_id')::uuid = v_grp.line_id LIMIT 1;
      v_qty := (v_row->>'qty')::numeric;
      v_shade := NULLIF(v_row->>'shade', '');
      v_color := NULLIF(v_row->>'color_ref', '');
      v_lot := NULLIF(v_row->>'lot_no', '');
      IF v_ch.origin = 'mill' THEN
        UPDATE public.mm_mill_rolls
        SET length_m = v_qty, shade = v_shade, color_ref = v_color, lot_no = v_lot,
            updated_at = now(), updated_by = v_actor, row_version = row_version + 1
        WHERE id = v_line.mill_roll_id AND factory_id = v_factory;
        v_code := v_line.unit_code;
        v_child := v_line.mill_roll_id;
      ELSE
        SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id AND factory_id = v_factory FOR UPDATE;
        v_delta := v_qty - public._mm_unit_qty_received(v_unit);
        IF v_delta < -0.001 THEN
          PERFORM public._mm_ledger(v_factory, v_unit.id, 'QC_DEDUCT', -v_delta, v_unit.status, 'pending_qc', NULL, v_recv, 'mm_process_challans', v_ch.id, 'process return');
          PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
        ELSIF v_delta > 0.001 THEN
          PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
          PERFORM public._mm_ledger(v_factory, v_unit.id, 'ADJUST_PLUS', v_delta, v_unit.status, 'pending_qc', NULL, v_recv, 'mm_process_challans', v_ch.id, 'process return');
        END IF;
        UPDATE public.mm_stock_units
        SET status = 'pending_qc', current_location_id = v_recv, shade = v_shade, color_ref = v_color, lot_no = v_lot,
            length_m = v_qty, qc_result = NULL, updated_at = now(), updated_by = v_actor, row_version = row_version + 1
        WHERE id = v_unit.id;
        IF abs(v_delta) <= 0.001 THEN
          PERFORM public._mm_ledger(v_factory, v_unit.id, 'TRANSFER', 0, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_challans', v_ch.id, 'process return');
        END IF;
        v_code := v_unit.unit_code;
        v_child := v_unit.id;
      END IF;
      UPDATE public.mm_process_out_lines SET line_status = 'returned' WHERE id = v_line.id;
      INSERT INTO public.mm_process_return_lines (
        factory_id, challan_id, out_line_id, same_identity, unit_code, qty, uom, shade, color_ref, lot_no, mill_roll_id, stock_unit_id, created_by
      ) VALUES (
        v_factory, v_ch.id, v_line.id, true, v_code, v_qty, v_line.uom, v_shade, v_color, v_lot,
        CASE WHEN v_ch.origin = 'mill' THEN v_child ELSE NULL END,
        CASE WHEN v_ch.origin = 'warehouse' THEN v_child ELSE NULL END,
        v_actor
      );
    ELSE
      IF v_ch.origin = 'mill' THEN
        UPDATE public.mm_mill_rolls
        SET status = 'processed', updated_at = now(), updated_by = v_actor, row_version = row_version + 1
        WHERE id = v_line.mill_roll_id AND factory_id = v_factory;
        SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_line.mill_roll_id;
      ELSE
        SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id AND factory_id = v_factory FOR UPDATE;
        IF COALESCE(v_unit.qty_available, 0) > 0 THEN
          PERFORM public._mm_ledger(v_factory, v_unit.id, 'WRITE_OFF', v_unit.qty_available, 'at_process', 'written_off', NULL, NULL, 'mm_process_challans', v_ch.id, 're-rolled at process');
        END IF;
        UPDATE public.mm_stock_units
        SET status = 'written_off', current_location_id = NULL, updated_at = now(), updated_by = v_actor, row_version = row_version + 1
        WHERE id = v_unit.id;
      END IF;
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_clean) value WHERE (value->>'line_id')::uuid = v_grp.line_id
      LOOP
        v_code := v_row->>'unit_code';
        v_qty := (v_row->>'qty')::numeric;
        v_shade := NULLIF(v_row->>'shade', '');
        v_color := NULLIF(v_row->>'color_ref', '');
        v_lot := NULLIF(v_row->>'lot_no', '');
        IF v_ch.origin = 'mill' THEN
          INSERT INTO public.mm_mill_rolls (
            factory_id, mill_batch_id, style_material_id, unit_code, length_m, shade, lot_no,
            color_ref, attributes, status, fabric_type_id, parent_mill_roll_id, created_by, updated_by
          ) VALUES (
            v_factory, v_roll.mill_batch_id, v_roll.style_material_id, v_code, v_qty, v_shade, v_lot,
            v_color, COALESCE(v_roll.attributes, '{}'::jsonb), 'draft', v_roll.fabric_type_id, v_roll.id, v_actor, v_actor
          ) RETURNING id INTO v_child;
          INSERT INTO public.mm_process_return_lines (
            factory_id, challan_id, out_line_id, same_identity, unit_code, qty, uom, shade, color_ref, lot_no, mill_roll_id, created_by
          ) VALUES (
            v_factory, v_ch.id, v_line.id, false, v_code, v_qty, v_line.uom, v_shade, v_color, v_lot, v_child, v_actor
          );
        ELSE
          INSERT INTO public.mm_stock_units (
            factory_id, unit_code, unit_kind, style_material_id, source, uom, qty_uom,
            length_m, shade, lot_no, color_ref, attributes, mill_snapshot, status,
            current_location_id, fabric_type_id, mill_batch_id, mill_roll_id, declared_width_in,
            qty_declared, qty_received, qty_available, parent_stock_unit_id, created_by, updated_by
          ) VALUES (
            v_factory, v_code, v_unit.unit_kind, v_unit.style_material_id, v_unit.source,
            v_unit.uom, COALESCE(v_unit.qty_uom, v_unit.uom),
            v_qty, v_shade, v_lot, v_color, COALESCE(v_unit.attributes, '{}'::jsonb), v_unit.mill_snapshot,
            'pending_qc', v_recv, v_unit.fabric_type_id, v_unit.mill_batch_id, v_unit.mill_roll_id,
            v_unit.declared_width_in, v_qty, v_qty, 0, v_unit.id, v_actor, v_actor
          ) RETURNING id INTO v_child;
          PERFORM public._mm_ledger(v_factory, v_child, 'RECEIPT_IN', v_qty, 'pending_qc', 'pending_qc', v_recv, v_recv, 'mm_process_challans', v_ch.id, 'process return');
          INSERT INTO public.mm_process_return_lines (
            factory_id, challan_id, out_line_id, same_identity, unit_code, qty, uom, shade, color_ref, lot_no, stock_unit_id, created_by
          ) VALUES (
            v_factory, v_ch.id, v_line.id, false, v_code, v_qty, v_line.uom, v_shade, v_color, v_lot, v_child, v_actor
          );
        END IF;
      END LOOP;
      UPDATE public.mm_process_out_lines SET line_status = 'replaced' WHERE id = v_line.id;
    END IF;
  END LOOP;

  PERFORM public._mm_process_refresh(v_ch.id);
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_release_rolls(p_unit_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_n integer := 0;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  FOREACH v_id IN ARRAY COALESCE(p_unit_ids, ARRAY[]::uuid[]) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    UPDATE public.mm_stock_units
    SET on_hold = false, hold_reason = NULL, hold_by = NULL, hold_at = NULL,
        updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;
    PERFORM public._mm_ledger(
      v_factory, v_id, 'RELEASE', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_stock_units', v_id, 'released'
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('released', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_resolve_style_material(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_type_name text;
  v_type_id uuid;
  v_kind text;
  v_bom uuid;
  v_out public.mm_style_materials%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    RETURN public._mm_err('NO_PERMISSION', 'Not allowed');
  END;

  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric line are required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders o
    WHERE o.id = p_order_id AND o.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Order not found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.colorways c
    WHERE c.id = p_colorway_id AND c.order_id = p_order_id AND c.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Colorway not found');
  END IF;

  v_bom := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT cm.id, cm.kind, NULLIF(trim(cm.type), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_bom, v_kind, v_type_name
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_bom := NULL;
    END;
    IF v_bom IS NOT NULL AND v_kind IS DISTINCT FROM 'Fabric' THEN
      RETURN public._mm_err('INVALID', 'Pick a fabric line, not trim');
    END IF;
  END IF;

  IF v_bom IS NULL THEN
    SELECT id, name INTO v_type_id, v_type_name
    FROM public.mm_fabric_types
    WHERE id = p_colorway_material_id AND factory_id = v_factory AND is_active;
    IF v_type_id IS NULL THEN
      RETURN public._mm_err('NOT_FOUND', 'Fabric line not found');
    END IF;
  ELSE
    IF v_type_name IS NULL OR v_type_name = '' THEN
      RETURN public._mm_err('REQUIRED', 'This fabric line has no fabric type. Set it on the order first');
    END IF;
    SELECT id INTO v_type_id
    FROM public.mm_fabric_types
    WHERE factory_id = v_factory AND is_active AND lower(name) = lower(v_type_name)
    LIMIT 1;
    IF v_type_id IS NULL THEN
      RETURN public._mm_err('NOT_FOUND', 'Fabric type "' || v_type_name || '" is not in Material setup');
    END IF;
  END IF;

  IF v_bom IS NOT NULL THEN
    INSERT INTO public.mm_style_materials (
      factory_id, order_id, colorway_id, colorway_material_id, fabric_type_id, created_by, updated_by
    ) VALUES (
      v_factory, p_order_id, p_colorway_id, v_bom, v_type_id, public._mm_actor_id(), public._mm_actor_id()
    )
    ON CONFLICT (factory_id, colorway_material_id) WHERE colorway_material_id IS NOT NULL
    DO UPDATE SET
      fabric_type_id = EXCLUDED.fabric_type_id,
      colorway_id = EXCLUDED.colorway_id,
      order_id = EXCLUDED.order_id,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    RETURNING * INTO v_out;
  ELSE
    INSERT INTO public.mm_style_materials (
      factory_id, order_id, colorway_id, colorway_material_id, fabric_type_id, created_by, updated_by
    ) VALUES (
      v_factory, p_order_id, p_colorway_id, NULL, v_type_id, public._mm_actor_id(), public._mm_actor_id()
    )
    ON CONFLICT (factory_id, order_id, colorway_id, fabric_type_id) WHERE colorway_material_id IS NULL
    DO UPDATE SET
      updated_at = now(),
      updated_by = public._mm_actor_id()
    RETURNING * INTO v_out;
  END IF;
  RETURN public._mm_ok(to_jsonb(v_out));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_fabric_type(p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_name text;
  v_out public.mm_fabric_types%ROWTYPE;
  v_rv integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_name := trim(COALESCE(p_row->>'name', ''));
  IF v_name = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Type name is required'); END IF;
  v_id := NULLIF(p_row->>'id', '')::uuid;

  IF v_id IS NOT NULL THEN
    v_rv := COALESCE((p_row->>'row_version')::integer, 0);
    UPDATE public.mm_fabric_types SET
      name = v_name,
      remarks = NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),
      is_active = true,
      requires_shade_band = CASE
        WHEN p_row ? 'requires_shade_band' THEN COALESCE((p_row->>'requires_shade_band')::boolean, requires_shade_band)
        ELSE requires_shade_band
      END,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    WHERE id = v_id AND factory_id = v_factory AND row_version = v_rv
    RETURNING * INTO v_out;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.mm_fabric_types WHERE id = v_id AND factory_id = v_factory) THEN
        RETURN public._mm_err('STALE_VERSION', 'This type was changed elsewhere. Reload and try again');
      END IF;
      RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
    END IF;
    RETURN public._mm_ok(to_jsonb(v_out));
  END IF;

  INSERT INTO public.mm_fabric_types (
    factory_id, name, remarks, requires_shade_band, seq, created_by, updated_by
  ) VALUES (
    v_factory, v_name, NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),
    COALESCE((p_row->>'requires_shade_band')::boolean, false),
    COALESCE((SELECT max(seq) + 1 FROM public.mm_fabric_types WHERE factory_id = v_factory), 0),
    public._mm_actor_id(), public._mm_actor_id()
  )
  ON CONFLICT (factory_id, name) DO UPDATE SET
    remarks = EXCLUDED.remarks,
    is_active = true,
    requires_shade_band = CASE
      WHEN p_row ? 'requires_shade_band' THEN COALESCE((p_row->>'requires_shade_band')::boolean, public.mm_fabric_types.requires_shade_band)
      ELSE public.mm_fabric_types.requires_shade_band
    END,
    row_version = public.mm_fabric_types.row_version + 1,
    updated_at = now(),
    updated_by = public._mm_actor_id()
  RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_lay_consumptions(p_lay_id uuid, p_rows jsonb, p_style_material_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_role text;
  v_status text;
  v_apps jsonb;
  v_floor jsonb := '[]'::jsonb;
  v_lay public.cutting_lays%ROWTYPE;
  v_session public.cutting_sessions%ROWTYPE;
  v_sm_ids uuid[];
  v_cut uuid;
  v_recv uuid;
  v_row jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
  v_old public.mm_lay_unit_consumptions%ROWTYPE;
  v_opening numeric;
  v_used numeric;
  v_short numeric;
  v_end numeric;
  v_action text;
  v_closing numeric;
  v_on numeric;
  v_consumed_ok boolean;
  v_n integer := 0;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_new_status text;
  v_new_loc uuid;
BEGIN
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_actor IS NULL OR v_factory IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  SELECT p.user_role, p.status, COALESCE(p.assigned_apps, '[]'::jsonb)
    INTO v_role, v_status, v_apps
  FROM public.profiles p
  WHERE p.id = v_actor AND p.factory_id = v_factory;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'Active' THEN
    RETURN public._mm_err('FORBIDDEN', 'Floor user is not active');
  END IF;
  BEGIN
    v_floor := public.floor_user_derived_apps(v_actor);
  EXCEPTION WHEN OTHERS THEN
    v_floor := '[]'::jsonb;
  END;
  IF v_role NOT IN ('admin', 'superadmin')
     AND NOT (v_apps @> '["mm_inventory"]'::jsonb)
     AND NOT (COALESCE(v_floor, '[]'::jsonb) @> '["cutting"]'::jsonb)
  THEN
    RETURN public._mm_err('NO_PERMISSION', 'Cutting or inventory access is required');
  END IF;

  SELECT * INTO v_lay FROM public.cutting_lays
  WHERE id = p_lay_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Lay not found'); END IF;
  IF v_lay.bundles_generated THEN
    RETURN public._mm_err('CLOSED', 'This lay is closed');
  END IF;
  SELECT * INTO v_session FROM public.cutting_sessions
  WHERE id = v_lay.session_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Cutting session not found'); END IF;

  IF p_style_material_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_style_materials sm
      WHERE sm.id = p_style_material_id
        AND sm.factory_id = v_factory
        AND sm.order_id = v_session.order_id
        AND (v_session.colorway_id IS NULL OR sm.colorway_id = v_session.colorway_id)
    ) THEN
      RETURN public._mm_err('INVALID', 'Fabric line does not match this cut');
    END IF;
    v_sm_ids := ARRAY[p_style_material_id];
  ELSE
    SELECT COALESCE(array_agg(sm.id), ARRAY[]::uuid[]) INTO v_sm_ids
    FROM public.mm_style_materials sm
    WHERE sm.factory_id = v_factory
      AND sm.order_id = v_session.order_id
      AND (v_session.colorway_id IS NULL OR sm.colorway_id = v_session.colorway_id);
  END IF;

  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  v_recv := public._mm_recv_loc(v_factory);
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mm_stock_units_status_chk'
      AND pg_get_constraintdef(oid) LIKE '%consumed%'
  ) INTO v_consumed_ok;

  FOR v_old IN
    SELECT * FROM public.mm_lay_unit_consumptions
    WHERE cutting_lay_id = v_lay.id AND factory_id = v_factory
    FOR UPDATE
  LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_old.stock_unit_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('INVALID', 'Saved roll is missing');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.mm_lay_unit_consumptions later
      WHERE later.stock_unit_id = v_old.stock_unit_id
        AND later.cutting_lay_id <> v_lay.id
        AND later.recorded_at > v_old.recorded_at
    ) THEN
      RETURN public._mm_err('CONFLICT', 'A later cut already used this roll');
    END IF;
    v_on := COALESCE(public._mm_unit_on_hand(v_unit), 0);
    IF abs(v_on - v_old.closing_qty) > 0.05 THEN
      RETURN public._mm_err('CONFLICT', 'Roll balance changed since this lay was saved');
    END IF;
    IF v_old.end_bit_action = 'return'
       AND v_unit.current_location_id IS DISTINCT FROM v_recv
       AND v_unit.current_location_id IS DISTINCT FROM v_cut THEN
      RETURN public._mm_err('CONFLICT', 'This roll was put away. Move it before editing the lay');
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'REVERSAL', v_old.opening_qty - v_old.closing_qty,
      v_unit.status, 'issued', v_unit.current_location_id, v_cut,
      'cutting_lays', v_lay.id, 'lay edit'
    );
    UPDATE public.mm_stock_units
    SET status = 'issued',
        current_location_id = v_cut,
        is_remnant = false,
        updated_at = now(),
        updated_by = v_actor
    WHERE id = v_unit.id;
  END LOOP;

  DELETE FROM public.mm_lay_unit_consumptions
  WHERE cutting_lay_id = v_lay.id AND factory_id = v_factory;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RETURN public._mm_err('INVALID', 'Rows are required');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = NULLIF(v_row->>'stock_unit_id', '')::uuid
      AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'Roll not found');
    END IF;
    IF v_unit.id = ANY(v_seen) THEN
      RETURN public._mm_err('INVALID', 'A roll can be picked once on a lay');
    END IF;
    v_seen := v_seen || v_unit.id;
    IF v_unit.style_material_id IS NULL OR NOT (v_unit.style_material_id = ANY(v_sm_ids)) THEN
      RETURN public._mm_err('INVALID', 'Roll is not allocated to this style');
    END IF;
    IF public._mm_unit_on_hold(v_unit.id) OR public._mm_store_line_missing(v_unit.id) THEN
      RETURN public._mm_err('INVALID', 'Roll is on hold or missing');
    END IF;
    IF NOT (
      v_unit.status = 'issued'
      OR (v_unit.status = 'in_stock' AND v_unit.current_location_id = v_cut)
    ) THEN
      RETURN public._mm_err('INVALID', 'Roll is not issued to cutting');
    END IF;

    v_opening := COALESCE(public._mm_unit_on_hand(v_unit), 0);
    IF v_opening <= 0 THEN
      RETURN public._mm_err('INVALID', 'Roll has no balance left');
    END IF;
    v_used := COALESCE(NULLIF(v_row->>'used_qty', '')::numeric, 0);
    v_short := COALESCE(NULLIF(v_row->>'shortage_qty', '')::numeric, 0);
    v_end := COALESCE(NULLIF(v_row->>'end_bit', '')::numeric, 0);
    v_action := COALESCE(NULLIF(v_row->>'end_bit_action', ''), 'continue');
    IF v_action NOT IN ('continue', 'waste', 'return') THEN
      RETURN public._mm_err('INVALID', 'End bit action must be continue, waste, or return');
    END IF;
    IF v_used < 0 OR v_short < 0 OR v_end < 0 THEN
      RETURN public._mm_err('INVALID', 'Quantities cannot be negative');
    END IF;
    IF abs((v_used + v_short + v_end) - v_opening) > 0.05 THEN
      RETURN public._mm_err('INVALID', 'Used, shortage, and end bit must equal the opening balance');
    END IF;
    v_closing := CASE WHEN v_action IN ('continue', 'return') THEN v_end ELSE 0 END;
    v_new_status := v_unit.status;
    v_new_loc := v_unit.current_location_id;

    IF v_used <> 0 THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'CONSUME', -v_used,
        v_unit.status, v_unit.status, v_unit.current_location_id, v_unit.current_location_id,
        'cutting_lays', v_lay.id, 'consume'
      );
    END IF;
    IF v_short <> 0 THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'ADJUST_MINUS', -v_short,
        v_unit.status, v_unit.status, v_unit.current_location_id, v_unit.current_location_id,
        'cutting_lays', v_lay.id, 'shortage'
      );
    END IF;
    IF v_action = 'waste' AND v_end <> 0 THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'WASTE', -v_end,
        v_unit.status, v_unit.status, v_unit.current_location_id, v_unit.current_location_id,
        'cutting_lays', v_lay.id, 'waste'
      );
    END IF;
    IF v_action = 'return' THEN
      v_new_status := 'in_stock';
      v_new_loc := v_recv;
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'RETURN_FROM_CUTTING', 0,
        v_unit.status, v_new_status, v_unit.current_location_id, v_new_loc,
        'cutting_lays', v_lay.id, 'return from cutting'
      );
    ELSIF v_closing <= 0 THEN
      v_new_status := 'consumed';
      v_new_loc := NULL;
    END IF;

    UPDATE public.mm_stock_units
    SET status = v_new_status,
        current_location_id = v_new_loc,
        is_remnant = (v_action = 'return'),
        updated_at = now(),
        updated_by = v_actor
    WHERE id = v_unit.id;

    v_n := v_n + 1;
    INSERT INTO public.mm_lay_unit_consumptions (
      factory_id, cutting_lay_id, stock_unit_id, seq, plies,
      opening_qty, closing_qty, used_qty, shortage_qty, end_bit_action,
      recorded_by, created_by, updated_by
    ) VALUES (
      v_factory, v_lay.id, v_unit.id, v_n,
      NULLIF(v_row->>'plies', '')::integer,
      v_opening, v_closing, v_used, v_short, v_action,
      v_actor, v_actor, v_actor
    );
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('lay_id', v_lay.id, 'rows', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_mill_batch(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ft uuid;
  v_batch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
  v_date date;
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
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm_id;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, fabric_type_id, batch_no, mill_ref, production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, v_sm_id, v_ft, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''), public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id INTO v_batch;
    v_n := public._mm_insert_mill_batch_rolls(v_factory, v_sm_id, v_batch, v_mill, p_rolls);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
    WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_trim_requirement_param(p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_cat text;
  v_types jsonb;
  v_out public.mm_trim_requirement_params%ROWTYPE;
  v_rv integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_cat := trim(COALESCE(p_row->>'category', ''));
  IF v_cat = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Category is required'); END IF;
  v_types := COALESCE(p_row->'types', '[]'::jsonb);
  IF jsonb_typeof(v_types) <> 'array' THEN v_types := '[]'::jsonb; END IF;
  v_id := NULLIF(p_row->>'id', '')::uuid;

  IF v_id IS NOT NULL THEN
    v_rv := COALESCE((p_row->>'row_version')::integer, 0);
    UPDATE public.mm_trim_requirement_params SET
      category = v_cat, types = v_types,
      seq = COALESCE((p_row->>'seq')::integer, seq),
      is_active = true, row_version = row_version + 1,
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id AND factory_id = v_factory AND row_version = v_rv
    RETURNING * INTO v_out;
    IF NOT FOUND THEN RETURN public._mm_err('STALE_VERSION', 'Reload and try again'); END IF;
    RETURN public._mm_ok(to_jsonb(v_out));
  END IF;

  INSERT INTO public.mm_trim_requirement_params (
    factory_id, category, types, seq, created_by, updated_by
  ) VALUES (
    v_factory, v_cat, v_types, COALESCE((p_row->>'seq')::integer, 0), public._mm_actor_id(), public._mm_actor_id()
  )
  ON CONFLICT (factory_id, category) DO UPDATE SET
    types = EXCLUDED.types,
    seq = EXCLUDED.seq,
    is_active = true,
    row_version = public.mm_trim_requirement_params.row_version + 1,
    updated_at = now(),
    updated_by = public._mm_actor_id()
  RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'That trim category already exists');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_type_requirement_fields(p_type_id uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_fields jsonb;
  v_field jsonb;
  v_seq integer := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_label text;
  v_key text;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
  END IF;

  v_fields := COALESCE(p_fields, '[]'::jsonb);
  IF jsonb_typeof(v_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields)
  LOOP
    v_label := trim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each parameter needs a name'); END IF;
    v_seq := v_seq + 1;
    v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
    v_id := NULLIF(v_field->>'id', '')::uuid;

    IF v_id IS NOT NULL THEN
      UPDATE public.mm_type_requirement_fields SET
        key = v_key, label = v_label,
        remarks = NULLIF(trim(COALESCE(v_field->>'remarks', '')), ''),
        seq = v_seq, is_active = true, row_version = row_version + 1,
        updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_id AND factory_id = v_factory AND type_id = p_type_id
      RETURNING id INTO v_id;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.mm_type_requirement_fields (
        factory_id, type_id, key, label, remarks, seq, created_by, updated_by
      ) VALUES (
        v_factory, p_type_id, v_key, v_label,
        NULLIF(trim(COALESCE(v_field->>'remarks', '')), ''),
        v_seq, public._mm_actor_id(), public._mm_actor_id()
      )
      ON CONFLICT (type_id, key) DO UPDATE SET
        label = EXCLUDED.label, remarks = EXCLUDED.remarks, seq = EXCLUDED.seq,
        is_active = true, row_version = public.mm_type_requirement_fields.row_version + 1,
        updated_at = now(), updated_by = public._mm_actor_id()
      RETURNING id INTO v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE public.mm_type_requirement_fields SET
    is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE type_id = p_type_id AND factory_id = v_factory AND is_active AND NOT (id = ANY (v_ids));

  RETURN public._mm_ok(jsonb_build_object('attribute_ids', to_jsonb(v_ids)));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_fields jsonb;
  v_field jsonb;
  v_seq integer := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_label text;
  v_key text;
  v_data_type text;
  v_options jsonb;
  v_site text;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
  END IF;

  v_fields := COALESCE(p_fields, '[]'::jsonb);
  IF jsonb_typeof(v_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields)
  LOOP
    v_label := trim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each test field needs a name'); END IF;
    v_seq := v_seq + 1;
    v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
    v_data_type := COALESCE(NULLIF(v_field->>'data_type', ''), 'text');
    v_options := COALESCE(v_field->'options', '[]'::jsonb);
    IF jsonb_typeof(v_options) IS DISTINCT FROM 'array' THEN v_options := '[]'::jsonb; END IF;
    v_site := COALESCE(NULLIF(v_field->>'capture_site', ''), 'either');
    IF v_site NOT IN ('mill', 'warehouse', 'both', 'either') THEN v_site := 'either'; END IF;
    v_id := NULLIF(v_field->>'id', '')::uuid;

    IF v_id IS NOT NULL THEN
      UPDATE public.mm_type_test_fields SET
        key = v_key, label = v_label, data_type = v_data_type, options = v_options,
        capture_site = v_site,
        seq = v_seq, is_active = true, row_version = row_version + 1,
        updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_id AND factory_id = v_factory AND type_id = p_type_id
      RETURNING id INTO v_id;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.mm_type_test_fields (
        factory_id, type_id, key, label, data_type, options, capture_site, seq, created_by, updated_by
      ) VALUES (
        v_factory, p_type_id, v_key, v_label, v_data_type, v_options, v_site, v_seq, public._mm_actor_id(), public._mm_actor_id()
      )
      ON CONFLICT (type_id, key) DO UPDATE SET
        label = EXCLUDED.label, data_type = EXCLUDED.data_type, options = EXCLUDED.options,
        capture_site = EXCLUDED.capture_site,
        seq = EXCLUDED.seq, is_active = true,
        row_version = public.mm_type_test_fields.row_version + 1,
        updated_at = now(), updated_by = public._mm_actor_id()
      RETURNING id INTO v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE public.mm_type_test_fields SET
    is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE type_id = p_type_id AND factory_id = v_factory AND is_active AND NOT (id = ANY (v_ids));

  RETURN public._mm_ok(jsonb_build_object('attribute_ids', to_jsonb(v_ids)));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_mill_batch(p_fabric_type_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_color_ref text, p_lot_no text, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_mill := public._mm_loc(v_factory, 'MILL');
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, fabric_type_id, batch_no, mill_ref, production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, NULL, v_ft, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''), public._mm_actor_id(), public._mm_actor_id()
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
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_vendor_grn(p_fabric_type_id uuid, p_supplier_name text, p_uom text, p_color_ref text, p_lot_no text, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.mm_save_vendor_grn(
    NULL, p_fabric_type_id, p_supplier_name, NULL, CURRENT_DATE, p_uom, p_color_ref, p_lot_no, p_rolls
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_vendor_in_challan(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_supplier_name text, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ch uuid;
  v_no text;
  v_n integer;
  v_recv uuid;
  v_sup text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_sup := NULLIF(trim(COALESCE(p_supplier_name, '')), '');
  IF v_sup IS NULL THEN RETURN public._mm_err('REQUIRED', 'Supplier name is required'); END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_recv := public._mm_recv_loc(v_factory);
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  v_no := public.next_doc_no('GRN');
  INSERT INTO public.mm_in_challans (
    factory_id, challan_no, source, style_material_id, supplier_name, status,
    received_at, received_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, 'vendor', v_sm_id, v_sup, 'received', now(), public._mm_actor_id(), public._mm_actor_id(), public._mm_actor_id()
  ) RETURNING id INTO v_ch;
  BEGIN
    v_n := public._mm_insert_rolls(v_factory, v_sm_id, v_ch, 'vendor', 'pending_qc', v_recv, p_rolls, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_warehouse_inspections(p_id uuid, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_recv uuid;
  v_red uuid;
  v_row jsonb;
  v_def jsonb;
  v_result text;
  v_values jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
  v_new_status text;
  v_new_loc uuid;
  v_n integer := 0;
  v_measured numeric;
  v_width numeric;
  v_width_uom text;
  v_pts integer;
  v_one integer;
  v_p1 integer;
  v_p2 integer;
  v_p3 integer;
  v_p4 integer;
  v_score numeric;
  v_threshold numeric;
  v_computed text;
  v_override text;
  v_reason text;
  v_final text;
  v_insp uuid;
  v_type_id uuid;
  v_type_name text;
  v_current numeric;
  v_delta numeric;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source = 'mill' AND v_ch.status NOT IN ('received', 'partial', 'short_closed') THEN
    RETURN public._mm_err('INVALID', 'Receive this mill challan before testing');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_recv := public._mm_recv_loc(v_factory);
  v_red := COALESCE(public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL'), v_recv);

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_result := lower(NULLIF(btrim(COALESCE(v_row->>'result', '')), ''));
    IF v_result IS NULL THEN CONTINUE; END IF;
    IF v_result NOT IN ('pass', 'fail') THEN
      RETURN public._mm_err('INVALID', 'Each roll must be pass or fail');
    END IF;
    BEGIN
      SELECT * INTO v_unit FROM public.mm_stock_units
      WHERE id = (v_row->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory
      FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this challan'); END IF;
    IF v_unit.status IS DISTINCT FROM 'pending_qc' AND v_unit.status IS DISTINCT FROM 'in_stock' THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting for warehouse test');
    END IF;
    IF v_unit.qc_result IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.mm_warehouse_inspections i WHERE i.stock_unit_id = v_unit.id)
    THEN
      RETURN public._mm_err('LOCKED', 'This roll is already inspected');
    END IF;
    v_values := CASE WHEN jsonb_typeof(v_row->'values') = 'object' THEN v_row->'values' ELSE '{}'::jsonb END;
    v_measured := COALESCE(NULLIF(v_values->>'inspected_length', '')::numeric, NULLIF(v_row->>'inspected_length', '')::numeric);
    v_width := COALESCE(NULLIF(v_values->>'inspected_width_in', '')::numeric, NULLIF(v_values->>'cuttable_width', '')::numeric, NULLIF(v_row->>'cuttable_width', '')::numeric);
    IF jsonb_typeof(v_row->'defects') = 'array' AND jsonb_array_length(v_row->'defects') > 0
       AND (v_measured IS NULL OR v_width IS NULL) THEN
      RETURN public._mm_err('REQUIRED', 'Inspected length and width are required');
    END IF;
    IF v_measured IS NOT NULL AND v_width IS NOT NULL THEN
      v_pts := 0;
      IF jsonb_typeof(v_row->'defects') = 'array' THEN
        FOR v_def IN SELECT * FROM jsonb_array_elements(v_row->'defects') LOOP
          IF NULLIF(btrim(COALESCE(v_def->>'type_name', v_def->>'defect_code', '')), '') IS NULL THEN CONTINUE; END IF;
          v_one := CASE
            WHEN COALESCE(v_def->>'hole', '') IN ('true', 't', '1') THEN 4
            WHEN v_def->>'size_band' = 'le3' THEN 1
            WHEN v_def->>'size_band' = 'to6' THEN 2
            WHEN v_def->>'size_band' = 'to9' THEN 3
            WHEN v_def->>'size_band' = 'over9' THEN 4
            ELSE COALESCE(NULLIF(v_def->>'points', '')::integer, 0)
          END;
          v_pts := v_pts + GREATEST(v_one, 0);
        END LOOP;
      ELSE
        v_pts := COALESCE(NULLIF(v_values->>'pts_1','')::int, 0)
          + 2 * COALESCE(NULLIF(v_values->>'pts_2','')::int, 0)
          + 3 * COALESCE(NULLIF(v_values->>'pts_3','')::int, 0)
          + 4 * COALESCE(NULLIF(v_values->>'pts_4','')::int, 0);
      END IF;
      v_score := public._mm_fpt_score(v_pts, v_measured, COALESCE(v_unit.qty_uom, 'm'), v_width, COALESCE(NULLIF(v_values->>'width_uom',''), 'in'));
      v_threshold := public._mm_fpt_threshold(v_unit.id);
      v_computed := CASE WHEN v_score IS NULL OR v_score <= v_threshold THEN 'pass' ELSE 'fail' END;
      IF v_result IS DISTINCT FROM v_computed AND NULLIF(btrim(COALESCE(v_values->>'override_reason', v_row->>'override_reason', '')), '') IS NULL THEN
        RETURN public._mm_err('REQUIRED', 'An override needs a reason');
      END IF;
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_result := lower(NULLIF(btrim(COALESCE(v_row->>'result', '')), ''));
    IF v_result IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = (v_row->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory;
    v_values := CASE WHEN jsonb_typeof(v_row->'values') = 'object' THEN v_row->'values' ELSE '{}'::jsonb END;
    v_measured := COALESCE(NULLIF(v_values->>'inspected_length', '')::numeric, NULLIF(v_row->>'inspected_length', '')::numeric);
    v_width := COALESCE(NULLIF(v_values->>'inspected_width_in', '')::numeric, NULLIF(v_values->>'cuttable_width', '')::numeric, NULLIF(v_row->>'cuttable_width', '')::numeric);
    v_width_uom := COALESCE(NULLIF(v_values->>'width_uom', ''), 'in');
    v_p1 := 0; v_p2 := 0; v_p3 := 0; v_p4 := 0; v_pts := 0;
    v_score := NULL; v_computed := v_result; v_override := NULL; v_threshold := NULL;
    IF v_measured IS NOT NULL AND v_width IS NOT NULL THEN
      IF jsonb_typeof(v_row->'defects') = 'array' THEN
        FOR v_def IN SELECT * FROM jsonb_array_elements(v_row->'defects') LOOP
          IF NULLIF(btrim(COALESCE(v_def->>'type_name', v_def->>'defect_code', '')), '') IS NULL THEN CONTINUE; END IF;
          v_one := CASE
            WHEN COALESCE(v_def->>'hole', '') IN ('true', 't', '1') THEN 4
            WHEN v_def->>'size_band' = 'le3' THEN 1
            WHEN v_def->>'size_band' = 'to6' THEN 2
            WHEN v_def->>'size_band' = 'to9' THEN 3
            WHEN v_def->>'size_band' = 'over9' THEN 4
            ELSE COALESCE(NULLIF(v_def->>'points', '')::integer, 0)
          END;
          v_pts := v_pts + GREATEST(v_one, 0);
          IF v_one = 1 THEN v_p1 := v_p1 + 1;
          ELSIF v_one = 2 THEN v_p2 := v_p2 + 1;
          ELSIF v_one = 3 THEN v_p3 := v_p3 + 1;
          ELSIF v_one >= 4 THEN v_p4 := v_p4 + 1;
          END IF;
        END LOOP;
      ELSE
        v_p1 := COALESCE(NULLIF(v_values->>'pts_1','')::int, 0);
        v_p2 := COALESCE(NULLIF(v_values->>'pts_2','')::int, 0);
        v_p3 := COALESCE(NULLIF(v_values->>'pts_3','')::int, 0);
        v_p4 := COALESCE(NULLIF(v_values->>'pts_4','')::int, 0);
        v_pts := v_p1 + 2*v_p2 + 3*v_p3 + 4*v_p4;
      END IF;
      v_score := public._mm_fpt_score(v_pts, v_measured, COALESCE(v_unit.qty_uom, 'm'), v_width, v_width_uom);
      v_threshold := public._mm_fpt_threshold(v_unit.id);
      v_computed := CASE WHEN v_score IS NULL OR v_score <= v_threshold THEN 'pass' ELSE 'fail' END;
      IF v_result IS DISTINCT FROM v_computed THEN
        v_override := v_result;
      END IF;
    END IF;
    v_reason := NULLIF(btrim(COALESCE(v_values->>'override_reason', v_row->>'override_reason', '')), '');
    v_final := COALESCE(v_override, v_computed);
    v_current := COALESCE(public._mm_unit_qty_received(v_unit), 0);
    IF v_measured IS NOT NULL THEN
      v_delta := v_measured - v_current;
      IF abs(v_delta) > 0.0001 THEN
        PERFORM public._mm_ledger(
          v_factory, v_unit.id,
          CASE WHEN v_delta < 0 THEN 'QC_DEDUCT' ELSE 'ADJUST_PLUS' END,
          v_delta, v_unit.status, v_unit.status,
          v_unit.current_location_id, v_unit.current_location_id,
          'mm_warehouse_inspections', v_ch.id, 'length confirmed at inspection'
        );
        PERFORM public._mm_set_on_hand(v_unit.id, v_measured, true);
      END IF;
    END IF;

    v_new_status := CASE WHEN v_final = 'fail' THEN 'rejected' ELSE v_unit.status END;
    v_new_loc := CASE WHEN v_final = 'fail' THEN v_red ELSE v_unit.current_location_id END;

    BEGIN
      INSERT INTO public.mm_warehouse_inspections (
        factory_id, in_challan_id, stock_unit_id, result, field_values, remarks,
        inspected_length, cuttable_width, width_uom,
        pts_1, pts_2, pts_3, pts_4, points_per_100_sqyd, threshold_used,
        result_computed, result_override, override_reason, override_by, override_at,
        inspected_at, inspected_by, created_by, updated_by
      ) VALUES (
        v_factory, v_ch.id, v_unit.id, v_final, v_values,
        NULLIF(btrim(COALESCE(v_row->>'remarks', '')), ''),
        v_measured, v_width, v_width_uom,
        v_p1, v_p2, v_p3, v_p4, v_score, v_threshold,
        v_computed, v_override, v_reason,
        CASE WHEN v_override IS NULL THEN NULL ELSE public._mm_actor_id() END,
        CASE WHEN v_override IS NULL THEN NULL ELSE now() END,
        now(), public._mm_actor_id(), public._mm_actor_id(), public._mm_actor_id()
      ) RETURNING id INTO v_insp;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'This roll is already inspected';
    END;

    IF jsonb_typeof(v_row->'defects') = 'array' THEN
      FOR v_def IN SELECT * FROM jsonb_array_elements(v_row->'defects') LOOP
        v_type_name := NULLIF(btrim(COALESCE(v_def->>'type_name', v_def->>'defect_code', '')), '');
        IF v_type_name IS NULL THEN CONTINUE; END IF;
        v_one := CASE
          WHEN COALESCE(v_def->>'hole', '') IN ('true', 't', '1') THEN 4
          WHEN v_def->>'size_band' = 'le3' THEN 1
          WHEN v_def->>'size_band' = 'to6' THEN 2
          WHEN v_def->>'size_band' = 'to9' THEN 3
          WHEN v_def->>'size_band' = 'over9' THEN 4
          ELSE COALESCE(NULLIF(v_def->>'points', '')::integer, 1)
        END;
        IF v_one < 1 OR v_one > 4 THEN CONTINUE; END IF;
        INSERT INTO public.mm_defect_types (factory_id, name)
        VALUES (v_factory, v_type_name)
        ON CONFLICT (factory_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_type_id;
        INSERT INTO public.mm_inspection_defects (
          factory_id, inspection_id, defect_type_id, defect_code, points, size_band, hole
        ) VALUES (
          v_factory, v_insp, v_type_id, v_type_name, v_one,
          NULLIF(v_def->>'size_band', ''),
          COALESCE(v_def->>'hole', '') IN ('true', 't', '1')
        );
      END LOOP;
    END IF;

    UPDATE public.mm_stock_units SET
      qc_result = v_final,
      status = v_new_status,
      current_location_id = v_new_loc,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    WHERE id = v_unit.id;

    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', COALESCE(v_measured, v_unit.length_m), v_unit.status, v_new_status,
      v_unit.current_location_id, v_new_loc, 'mm_warehouse_inspections', v_ch.id,
      CASE WHEN v_final = 'pass' THEN 'Warehouse 4-point pass' ELSE 'Warehouse 4-point fail' END
    );
    v_n := v_n + 1;
  END LOOP;

  PERFORM public._mm_apply_clearance(ARRAY(SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id));
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'saved', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_save_warehouse_location(p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_id uuid;
  v_parent uuid;
  v_code text;
  v_name text;
  v_type text;
  v_pick boolean;
  v_parent_type text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_id := NULLIF(p_row->>'id', '')::uuid;
  v_code := upper(NULLIF(trim(COALESCE(p_row->>'code', '')), ''));
  v_name := NULLIF(trim(COALESCE(p_row->>'name', '')), '');
  v_type := NULLIF(trim(COALESCE(p_row->>'location_type', '')), '');
  v_parent := COALESCE(NULLIF(p_row->>'parent_id', '')::uuid, v_wh);
  IF v_name IS NULL THEN RETURN public._mm_err('REQUIRED', 'Name is required'); END IF;
  IF v_type IS NULL OR v_type NOT IN ('zone', 'rack', 'bin') THEN
    RETURN public._mm_err('INVALID', 'Location must be a zone, rack, or bin');
  END IF;
  IF v_code IS NULL THEN
    v_code := upper(left(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'), 24));
  END IF;
  IF v_parent IS DISTINCT FROM v_wh AND NOT public._mm_loc_is_under(v_parent, v_wh) THEN
    RETURN public._mm_err('INVALID', 'Parent must be under the warehouse');
  END IF;
  SELECT location_type INTO v_parent_type FROM public.mm_locations WHERE id = v_parent AND factory_id = v_factory;
  IF v_type = 'zone' AND v_parent_type NOT IN ('store', 'zone') THEN
    RETURN public._mm_err('INVALID', 'A zone sits under the warehouse or another zone');
  END IF;
  IF v_type = 'rack' AND v_parent_type NOT IN ('store', 'zone') THEN
    RETURN public._mm_err('INVALID', 'A rack sits under the warehouse or a zone');
  END IF;
  IF v_type = 'bin' AND v_parent_type IS DISTINCT FROM 'rack' THEN
    RETURN public._mm_err('INVALID', 'A bin sits under a rack');
  END IF;
  v_pick := v_type IN ('rack', 'bin');
  IF v_id IS NULL THEN
    INSERT INTO public.mm_locations (
      factory_id, parent_id, code, name, location_type, is_pickable, is_active, created_by, updated_by
    ) VALUES (
      v_factory, v_parent, v_code, v_name, v_type, v_pick, true, public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_locations
      WHERE id = v_id AND factory_id = v_factory AND location_type IN ('zone', 'rack', 'bin')
    ) THEN
      RETURN public._mm_err('NOT_FOUND', 'Location not found');
    END IF;
    UPDATE public.mm_locations SET
      parent_id = v_parent, code = v_code, name = v_name, location_type = v_type,
      is_pickable = v_pick, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'code', v_code));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE', 'That location code already exists');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_set_factory_feature(p_key text, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_mill boolean;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RETURN public._mm_err('NO_PERMISSION', 'Admin required');
  END IF;
  PERFORM public.assert_module_enabled('material');
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  IF p_key IS DISTINCT FROM 'in_house_mill' THEN
    RETURN public._mm_err('INVALID', 'Only in_house_mill can be toggled');
  END IF;
  v_mill := COALESCE(p_enabled, false);
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES (v_factory, 'in_house_mill', v_mill)
  ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (v_factory, 'receive_goods', NOT v_mill),
    (v_factory, 'test_rolls', NOT v_mill)
  ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  RETURN public._mm_ok(jsonb_build_object('in_house_mill', v_mill));
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
  RETURN public._mm_err('ERROR', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_set_mill_short_close(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_closed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_closed boolean;
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
  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric are required');
  END IF;
  v_closed := COALESCE(p_closed, false);
  UPDATE public.colorway_materials cm SET
    mill_short_closed = v_closed,
    mill_short_closed_at = CASE WHEN v_closed THEN now() ELSE NULL END,
    mill_short_closed_by = CASE WHEN v_closed THEN public._mm_actor_id() ELSE NULL END,
    updated_at = now()
  WHERE cm.id = p_colorway_material_id
    AND cm.factory_id = v_factory
    AND cm.order_id = p_order_id
    AND cm.colorway_id = p_colorway_id;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric line not found');
  END IF;
  RETURN public._mm_ok(jsonb_build_object('mill_short_closed', v_closed));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_short_close_in_challan(p_challan_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A reason is required');
  END IF;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_challan_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.status NOT IN ('pending', 'partial') THEN
    RETURN public._mm_err('INVALID', 'Only an open challan can be short-closed');
  END IF;
  FOR v_unit IN
    SELECT * FROM public.mm_stock_units
    WHERE in_challan_id = v_ch.id AND factory_id = v_factory AND status = 'in_transit'
    FOR UPDATE
  LOOP
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'WRITE_OFF', COALESCE(v_unit.qty_available, v_unit.length_m, 0),
      v_unit.status, 'missing', v_unit.current_location_id, NULL,
      'mm_in_challans', v_ch.id, 'missing in transit'
    );
    UPDATE public.mm_stock_units
    SET status = 'missing', current_location_id = NULL,
        row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_unit.id;
    UPDATE public.mm_in_challan_lines
    SET line_status = 'missing', remarks = btrim(p_reason)
    WHERE stock_unit_id = v_unit.id AND challan_id = v_ch.id;
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    RETURN public._mm_err('INVALID', 'No missing rolls to close');
  END IF;
  UPDATE public.mm_in_challans
  SET status = 'short_closed', row_version = row_version + 1,
      updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = v_ch.id;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'status', 'short_closed', 'written_off', v_n));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mm_unallocate_rolls(p_unit_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
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
      updated_by = public._mm_actor_id()
    WHERE id = v_unit.id;
    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = NULL,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
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
$function$
;

CREATE OR REPLACE FUNCTION public.mm_update_roll(p_unit_id uuid, p_patch jsonb, p_row_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = p_unit_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
  IF p_row_version IS NOT NULL AND v_unit.row_version IS DISTINCT FROM p_row_version THEN
    RETURN public._mm_err('STALE', 'Reload and try again');
  END IF;
  UPDATE public.mm_stock_units SET
    length_m = COALESCE(NULLIF(p_patch->>'length_m', '')::numeric, length_m),
    weight_kg = COALESCE(NULLIF(p_patch->>'weight_kg', '')::numeric, weight_kg),
    shade = COALESCE(NULLIF(trim(p_patch->>'shade'), ''), shade),
    lot_no = COALESCE(NULLIF(trim(p_patch->>'lot_no'), ''), lot_no),
    attributes = CASE WHEN jsonb_typeof(p_patch->'attributes') = 'object' THEN p_patch->'attributes' ELSE attributes END,
    mill_snapshot = mill_snapshot,
    row_version = row_version + 1,
    updated_at = now(),
    updated_by = public._mm_actor_id()
  WHERE id = v_unit.id;
  PERFORM public._mm_ledger(
    v_factory, v_unit.id, 'ADJUST_PLUS', 0, v_unit.status, v_unit.status,
    v_unit.current_location_id, v_unit.current_location_id, 'mm_stock_units', v_unit.id, 'Correction'
  );
  RETURN public._mm_ok(jsonb_build_object('id', v_unit.id));
END;
$function$
;

-- Views
CREATE OR REPLACE VIEW public.mm_v_mill_field_accuracy AS
SELECT x.factory_id,
    x.stock_unit_id,
    x.unit_code,
    x.mill_batch_id,
    x.key,
    x.declared,
    x.measured,
    x.measured - x.declared AS delta,
        CASE
            WHEN x.declared = 0::numeric THEN NULL::numeric
            ELSE round(100::numeric * (x.measured - x.declared) / abs(x.declared), 1)
        END AS delta_pct,
    x.inspected_at
   FROM ( SELECT u.factory_id,
            u.id AS stock_unit_id,
            u.unit_code,
            u.mill_batch_id,
            mill.key,
            _mm_safe_numeric(mill.value) AS declared,
            _mm_safe_numeric(wh.value) AS measured,
            i.inspected_at
           FROM mm_stock_units u
             JOIN mm_warehouse_inspections i ON i.stock_unit_id = u.id
             CROSS JOIN LATERAL jsonb_each_text(
                CASE
                    WHEN jsonb_typeof(u.mill_snapshot -> 'attributes'::text) = 'object'::text THEN u.mill_snapshot -> 'attributes'::text
                    ELSE '{}'::jsonb
                END) mill(key, value)
             JOIN LATERAL jsonb_each_text(
                CASE
                    WHEN jsonb_typeof(i.field_values) = 'object'::text THEN i.field_values
                    ELSE '{}'::jsonb
                END) wh(key, value) ON wh.key = mill.key
          WHERE u.source = 'mill'::text AND u.mill_batch_id IS NOT NULL) x
  WHERE x.declared IS NOT NULL AND x.measured IS NOT NULL
UNION ALL
 SELECT u.factory_id,
    u.id AS stock_unit_id,
    u.unit_code,
    u.mill_batch_id,
    'length'::text AS key,
    COALESCE(u.qty_declared, u.length_m) AS declared,
    i.inspected_length AS measured,
    i.inspected_length - COALESCE(u.qty_declared, u.length_m) AS delta,
        CASE
            WHEN COALESCE(u.qty_declared, u.length_m) IS NULL OR COALESCE(u.qty_declared, u.length_m) = 0::numeric THEN NULL::numeric
            ELSE round(100.0 * (i.inspected_length - COALESCE(u.qty_declared, u.length_m)) / abs(COALESCE(u.qty_declared, u.length_m)), 1)
        END AS delta_pct,
    i.inspected_at
   FROM mm_stock_units u
     JOIN mm_warehouse_inspections i ON i.stock_unit_id = u.id
  WHERE u.source = 'mill'::text AND u.mill_batch_id IS NOT NULL AND i.inspected_length IS NOT NULL AND COALESCE(u.qty_declared, u.length_m) IS NOT NULL;

CREATE OR REPLACE VIEW public.mm_v_mill_accuracy_summary AS
SELECT factory_id,
    mill_batch_id,
    key,
    count(*)::integer AS sample_count,
    round(avg(abs(delta_pct)) FILTER (WHERE delta_pct IS NOT NULL), 1) AS avg_abs_delta_pct,
    max(abs(delta_pct)) AS max_abs_delta_pct,
    min(declared) AS min_declared,
    max(declared) AS max_declared,
    min(measured) AS min_measured,
    max(measured) AS max_measured
   FROM mm_v_mill_field_accuracy a
  GROUP BY factory_id, mill_batch_id, key;

CREATE OR REPLACE VIEW public.mm_v_style_fabric_reconciliation AS
SELECT sm.factory_id,
    sm.id AS style_material_id,
    sm.order_id,
    cw.name AS color_name,
    COALESCE(ft.name, 'Fabric'::text) AS fabric_name,
    COALESCE(NULLIF(TRIM(BOTH FROM cm.unit), ''::text), ( SELECT u.qty_uom
           FROM mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.qty_uom IS NOT NULL
         LIMIT 1)) AS uom,
    cm.total_cons AS required,
    COALESCE(( SELECT sum(COALESCE(u.qty_received, u.length_m)) AS sum
           FROM mm_stock_units u
          WHERE u.style_material_id = sm.id AND (u.status = ANY (ARRAY['pending_qc'::text, 'in_stock'::text, 'rejected'::text, 'issued'::text, 'consumed'::text, 'at_process'::text]))), 0::numeric) AS received,
    COALESCE(( SELECT - sum(l.qty_delta)
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id AND l.entry_type = 'QC_DEDUCT'::text), 0::numeric) AS qc_deducted,
    COALESCE(( SELECT - sum(l.qty_delta)
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id AND l.entry_type = 'RETURN_TO_SUPPLIER'::text), 0::numeric) AS returned_to_supplier,
    COALESCE(( SELECT - sum(l.qty_delta)
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id AND l.entry_type = 'WRITE_OFF'::text), 0::numeric) AS written_off,
    COALESCE(( SELECT sum(u.qty_available) AS sum
           FROM mm_stock_units u
             JOIN mm_locations loc ON loc.id = u.current_location_id
          WHERE u.style_material_id = sm.id AND (u.status = ANY (ARRAY['pending_qc'::text, 'in_stock'::text, 'rejected'::text])) AND (loc.location_type = ANY (ARRAY['receiving'::text, 'rack'::text, 'bin'::text, 'rejected'::text]))), 0::numeric) AS on_hand_warehouse,
    COALESCE(( SELECT sum(u.qty_available) AS sum
           FROM mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'issued'::text), 0::numeric) AS at_cutting,
    COALESCE(( SELECT sum(l.qty) AS sum
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id AND l.entry_type = 'ISSUE_TO_CUTTING'::text), 0::numeric) AS issued_to_cutting,
    COALESCE(( SELECT - sum(l.qty_delta)
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id AND l.entry_type = 'CONSUME'::text), 0::numeric) AS consumed,
    COALESCE(( SELECT - sum(l.qty_delta)
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id AND l.entry_type = 'WASTE'::text), 0::numeric) AS waste,
    COALESCE(( SELECT sum(u.qty_available) AS sum
           FROM mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.is_remnant IS TRUE AND u.status = 'in_stock'::text), 0::numeric) AS returned_from_cutting,
    COALESCE(( SELECT sum(l.qty_delta) AS sum
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id), 0::numeric) - COALESCE(( SELECT sum(u.qty_available) AS sum
           FROM mm_stock_units u
          WHERE u.style_material_id = sm.id), 0::numeric) AS balance_check,
    COALESCE(( SELECT - sum(l.qty_delta)
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id AND l.entry_type = 'ADJUST_MINUS'::text AND btrim(COALESCE(l.note, ''::text)) = 'shortage'::text), 0::numeric) AS shortage
   FROM mm_style_materials sm
     LEFT JOIN colorways cw ON cw.id = sm.colorway_id
     LEFT JOIN mm_fabric_types ft ON ft.id = sm.fabric_type_id
     LEFT JOIN colorway_materials cm ON cm.id = sm.colorway_material_id;

-- Grants for replayed functions
REVOKE ALL ON FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mm_receive_store_challan(p_id uuid, p_missing_unit_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_store_challan(p_id uuid, p_missing_unit_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_receive_store_challan(p_id uuid, p_missing_unit_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer) TO service_role;
REVOKE ALL ON FUNCTION public.mm_receive_store_challan(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_store_challan(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_receive_store_challan(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public._mm_challan_header(p_ch mm_in_challans) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_insert_mill_batch_rolls(p_factory uuid, p_sm uuid, p_batch uuid, p_loc uuid, p_rolls jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_insert_rolls(p_factory uuid, p_sm uuid, p_challan uuid, p_source text, p_status text, p_loc uuid, p_rolls jsonb, p_freeze boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_refresh_in_challan_status(p_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_store_line_missing(p_unit_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_unit_clearance(p_unit_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_allocate_rolls_to_style(p_unit_ids uuid[], p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_allocate_rolls_to_style(p_unit_ids uuid[], p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_allocate_rolls_to_style(p_unit_ids uuid[], p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_confirm_received_lengths(p_challan_id uuid, p_lengths jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_confirm_received_lengths(p_challan_id uuid, p_lengths jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_confirm_received_lengths(p_challan_id uuid, p_lengths jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_create_store_challan(p_style_material_id uuid, p_unit_ids uuid[], p_challan_no text, p_reference_no text, p_sent_at date, p_remarks text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_create_store_challan(p_style_material_id uuid, p_unit_ids uuid[], p_challan_no text, p_reference_no text, p_sent_at date, p_remarks text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_create_store_challan(p_style_material_id uuid, p_unit_ids uuid[], p_challan_no text, p_reference_no text, p_sent_at date, p_remarks text) TO service_role;
REVOKE ALL ON FUNCTION public.mm_deactivate_rack_location(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_deactivate_rack_location(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_deactivate_rack_location(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_deactivate_warehouse_location(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_deactivate_warehouse_location(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_deactivate_warehouse_location(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_delete_fabric_type(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_delete_fabric_type(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_delete_fabric_type(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_delete_trim_requirement_param(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_delete_trim_requirement_param(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_delete_trim_requirement_param(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_dispatch_mill_rolls(p_unit_ids uuid[], p_challan_no text, p_reference_no text, p_to_location text, p_sent_at date, p_remarks text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_dispatch_mill_rolls(p_unit_ids uuid[], p_challan_no text, p_reference_no text, p_to_location text, p_sent_at date, p_remarks text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_dispatch_mill_rolls(p_unit_ids uuid[], p_challan_no text, p_reference_no text, p_to_location text, p_sent_at date, p_remarks text) TO service_role;
REVOKE ALL ON FUNCTION public.mm_disposition_rejected(p_unit_ids uuid[], p_action text, p_reason text, p_reference text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_disposition_rejected(p_unit_ids uuid[], p_action text, p_reason text, p_reference text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_disposition_rejected(p_unit_ids uuid[], p_action text, p_reason text, p_reference text) TO service_role;
REVOKE ALL ON FUNCTION public.mm_enable_module(p_config jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_enable_module(p_config jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_enable_module(p_config jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_exclude_roll(p_unit_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_exclude_roll(p_unit_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_exclude_roll(p_unit_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_floor_gaps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_floor_gaps() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_floor_gaps() TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_config_bundle() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_config_bundle() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_config_bundle() TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_expected_board(p_status text, p_search text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_expected_board(p_status text, p_search text, p_limit integer, p_offset integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_expected_board(p_status text, p_search text, p_limit integer, p_offset integer) TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_lay_report(p_lay_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_lay_report(p_lay_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_lay_report(p_lay_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_mill_line(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_line(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_line(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_ops_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_ops_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_ops_context() TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_process_challan(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_process_challan(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_process_challan(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_rack_ops_board() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_rack_ops_board() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_rack_ops_board() TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_store_challan(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_store_challan(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_store_challan(p_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_style_reconciliation(p_style_material_id uuid, p_order_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_style_reconciliation(p_style_material_id uuid, p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_style_reconciliation(p_style_material_id uuid, p_order_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_style_warehouse(p_order_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_style_warehouse(p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_style_warehouse(p_order_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_unallocated_mill() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_unallocated_mill() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_unallocated_mill() TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_warehouse_board(p_order_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_board(p_order_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_board(p_order_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_warehouse_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dashboard() TO service_role;
REVOKE ALL ON FUNCTION public.mm_get_warehouse_dispatch_board(p_order_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dispatch_board(p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dispatch_board(p_order_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_hold_rolls(p_unit_ids uuid[], p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_hold_rolls(p_unit_ids uuid[], p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_hold_rolls(p_unit_ids uuid[], p_reason text) TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_cutting_rolls(p_order_id uuid, p_colorway_id uuid, p_style_material_id uuid, p_search text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_cutting_rolls(p_order_id uuid, p_colorway_id uuid, p_style_material_id uuid, p_search text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_cutting_rolls(p_order_id uuid, p_colorway_id uuid, p_style_material_id uuid, p_search text) TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_floor_grns(p_source text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_floor_grns(p_source text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_floor_grns(p_source text) TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_inspection_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_inspection_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_inspection_queue() TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_mill_stock(p_search text, p_alloc text, p_place text, p_page integer, p_page_size integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_mill_stock(p_search text, p_alloc text, p_place text, p_page integer, p_page_size integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_mill_stock(p_search text, p_alloc text, p_place text, p_page integer, p_page_size integer) TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_process_challans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_process_challans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_process_challans() TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_putaway_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_putaway_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_putaway_queue() TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_rack_master() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_rack_master() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_rack_master() TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_receive_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_receive_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_receive_catalog() TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_stock_movements(p_search text, p_kind text, p_page integer, p_page_size integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_stock_movements(p_search text, p_kind text, p_page integer, p_page_size integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_stock_movements(p_search text, p_kind text, p_page integer, p_page_size integer) TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_store_stock(p_style_material_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_store_stock(p_style_material_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_store_stock(p_style_material_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_test_fields(p_fabric_type_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_test_fields(p_fabric_type_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_test_fields(p_fabric_type_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_warehouse_locations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_warehouse_locations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_warehouse_locations() TO service_role;
REVOKE ALL ON FUNCTION public.mm_list_warehouse_stock(p_search text, p_location text, p_buyer text, p_page integer, p_page_size integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_warehouse_stock(p_search text, p_location text, p_buyer text, p_page integer, p_page_size integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_list_warehouse_stock(p_search text, p_location text, p_buyer text, p_page integer, p_page_size integer) TO service_role;
REVOKE ALL ON FUNCTION public.mm_putaway_rolls(p_unit_ids uuid[], p_location_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_putaway_rolls(p_unit_ids uuid[], p_location_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_putaway_rolls(p_unit_ids uuid[], p_location_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_receive_in_challan_lines(p_challan_id uuid, p_unit_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_in_challan_lines(p_challan_id uuid, p_unit_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_receive_in_challan_lines(p_challan_id uuid, p_unit_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mm_receive_mill_bundle(p_payload jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_bundle(p_payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_bundle(p_payload jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_receive_mill_floor(p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_floor(p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_floor(p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mm_receive_process_return(p_id uuid, p_rolls jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_process_return(p_id uuid, p_rolls jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_receive_process_return(p_id uuid, p_rolls jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_release_rolls(p_unit_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_release_rolls(p_unit_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_release_rolls(p_unit_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mm_resolve_style_material(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_resolve_style_material(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_resolve_style_material(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_fabric_type(p_row jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_fabric_type(p_row jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_fabric_type(p_row jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_lay_consumptions(p_lay_id uuid, p_rows jsonb, p_style_material_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_lay_consumptions(p_lay_id uuid, p_rows jsonb, p_style_material_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_lay_consumptions(p_lay_id uuid, p_rows jsonb, p_style_material_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_mill_batch(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_rolls jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_mill_batch(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_rolls jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_mill_batch(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_rolls jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_trim_requirement_param(p_row jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_trim_requirement_param(p_row jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_trim_requirement_param(p_row jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_type_requirement_fields(p_type_id uuid, p_fields jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_type_requirement_fields(p_type_id uuid, p_fields jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_type_requirement_fields(p_type_id uuid, p_fields jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_unallocated_mill_batch(p_fabric_type_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_color_ref text, p_lot_no text, p_rolls jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_mill_batch(p_fabric_type_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_color_ref text, p_lot_no text, p_rolls jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_mill_batch(p_fabric_type_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_color_ref text, p_lot_no text, p_rolls jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_unallocated_vendor_grn(p_fabric_type_id uuid, p_supplier_name text, p_uom text, p_color_ref text, p_lot_no text, p_rolls jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_vendor_grn(p_fabric_type_id uuid, p_supplier_name text, p_uom text, p_color_ref text, p_lot_no text, p_rolls jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_vendor_grn(p_fabric_type_id uuid, p_supplier_name text, p_uom text, p_color_ref text, p_lot_no text, p_rolls jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_vendor_in_challan(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_supplier_name text, p_rolls jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_in_challan(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_supplier_name text, p_rolls jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_in_challan(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_supplier_name text, p_rolls jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_warehouse_inspections(p_id uuid, p_rolls jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_inspections(p_id uuid, p_rolls jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_inspections(p_id uuid, p_rolls jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_save_warehouse_location(p_row jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_location(p_row jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_location(p_row jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mm_set_factory_feature(p_key text, p_enabled boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_set_factory_feature(p_key text, p_enabled boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_set_factory_feature(p_key text, p_enabled boolean) TO service_role;
REVOKE ALL ON FUNCTION public.mm_set_mill_short_close(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_closed boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_set_mill_short_close(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_closed boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_set_mill_short_close(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_closed boolean) TO service_role;
REVOKE ALL ON FUNCTION public.mm_short_close_in_challan(p_challan_id uuid, p_reason text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_short_close_in_challan(p_challan_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_short_close_in_challan(p_challan_id uuid, p_reason text) TO service_role;
REVOKE ALL ON FUNCTION public.mm_unallocate_rolls(p_unit_ids uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_unallocate_rolls(p_unit_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_unallocate_rolls(p_unit_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.mm_update_roll(p_unit_id uuid, p_patch jsonb, p_row_version integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_update_roll(p_unit_id uuid, p_patch jsonb, p_row_version integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_update_roll(p_unit_id uuid, p_patch jsonb, p_row_version integer) TO service_role;
GRANT SELECT ON public.mm_v_mill_field_accuracy TO authenticated;
GRANT SELECT ON public.mm_v_mill_field_accuracy TO service_role;
GRANT SELECT ON public.mm_v_mill_accuracy_summary TO authenticated;
GRANT SELECT ON public.mm_v_mill_accuracy_summary TO service_role;
GRANT SELECT ON public.mm_v_style_fabric_reconciliation TO authenticated;
GRANT SELECT ON public.mm_v_style_fabric_reconciliation TO service_role;

NOTIFY pgrst, 'reload schema';
