CREATE OR REPLACE FUNCTION public.mm_receive_process_return(p_id uuid, p_rolls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
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
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_process_challans()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO public
AS $fn$
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
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_process_challan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO public
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.mm_receive_process_return(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_list_process_challans() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_get_process_challan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_receive_process_return(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_process_challans() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_process_challan(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
;
