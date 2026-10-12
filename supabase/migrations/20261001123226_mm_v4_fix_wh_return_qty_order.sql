CREATE OR REPLACE FUNCTION public.mm_proc_return(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_factory uuid; v_actor uuid; v_ch public.mm_process_challans%ROWTYPE; v_ret uuid; v_ret_no text; v_deliver text;
  v_seen uuid[] := '{}'; v_e jsonb; v_o jsonb; v_lid uuid; v_lids uuid[]; v_line public.mm_process_out_lines%ROWTYPE;
  v_roll public.mm_mill_rolls%ROWTYPE; v_unit public.mm_stock_units%ROWTYPE; v_child uuid; v_recv uuid; v_qty numeric;
  v_delta numeric; v_out_mill uuid[] := '{}'; v_outputs jsonb := '[]'::jsonb; v_disp jsonb; v_code text;
  v_sm uuid; v_ft uuid; v_batch uuid; v_first boolean; v_wh_units uuid[] := '{}';
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = NULLIF(p_payload->>'challan_id','')::uuid AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Challan not found'); END IF;
  IF v_ch.status IN ('returned','void') THEN RETURN public._mm_err('CLOSED','This challan is closed'); END IF;
  v_deliver := COALESCE(NULLIF(p_payload->>'deliver_to',''), 'sender');
  IF v_deliver NOT IN ('sender','warehouse') THEN RETURN public._mm_err('INVALID','deliver_to must be sender or warehouse'); END IF;
  IF v_deliver = 'warehouse' AND v_ch.origin <> 'mill' THEN v_deliver := 'sender'; END IF;

  FOR v_lid IN
    SELECT (e->>'out_line_id')::uuid FROM jsonb_array_elements(COALESCE(p_payload->'same_rolls','[]'::jsonb)) e
    UNION ALL SELECT (x)::uuid FROM jsonb_array_elements(COALESCE(p_payload->'re_rolled','[]'::jsonb)) g,
                                   jsonb_array_elements_text(COALESCE(g->'out_line_ids','[]'::jsonb)) x
    UNION ALL SELECT (e->>'out_line_id')::uuid FROM jsonb_array_elements(COALESCE(p_payload->'write_offs','[]'::jsonb)) e
  LOOP
    IF v_lid = ANY (v_seen) THEN RETURN public._mm_err('INVALID','A sent roll appears twice in this return'); END IF;
    v_seen := v_seen || v_lid;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_lid AND challan_id = v_ch.id FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','A sent roll is not on this challan'); END IF;
    IF v_line.line_status <> 'out' THEN RETURN public._mm_err('INVALID', v_line.unit_code || ' is already back'); END IF;
  END LOOP;
  IF COALESCE(array_length(v_seen,1),0) = 0 THEN RETURN public._mm_err('REQUIRED','Enter what came back'); END IF;

  v_ret_no := COALESCE(NULLIF(btrim(COALESCE(p_payload->>'return_no','')), ''), public._mm_next_doc(v_factory, 'PR'));
  INSERT INTO public.mm_process_returns (factory_id, challan_id, return_no, returned_at, deliver_to, remarks, created_by)
  VALUES (v_factory, v_ch.id, v_ret_no, COALESCE(NULLIF(p_payload->>'returned_at','')::timestamptz, now()), v_deliver,
          NULLIF(p_payload->>'remarks',''), v_actor)
  RETURNING id INTO v_ret;

  IF v_ch.origin = 'warehouse' THEN
    PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
    v_recv := public._mm_recv_loc(v_factory);
  END IF;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'same_rolls','[]'::jsonb)) LOOP
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = (v_e->>'out_line_id')::uuid;
    v_qty := NULLIF(v_e->>'qty','')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION '%: return qty must be greater than zero', v_line.unit_code; END IF;
    IF v_ch.origin = 'mill' THEN
      UPDATE public.mm_mill_rolls SET length_m = v_qty,
        weight_kg = COALESCE(NULLIF(v_e->>'qty_kg','')::numeric, weight_kg),
        shade = COALESCE(NULLIF(v_e->>'shade',''), shade), color_ref = COALESCE(NULLIF(v_e->>'color_ref',''), color_ref),
        row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_line.mill_roll_id;
      v_out_mill := v_out_mill || v_line.mill_roll_id;
      v_child := v_line.mill_roll_id;
    ELSE
      SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
      v_delta := v_qty - COALESCE(v_unit.qty_available, 0);
      -- order matters: qty_available may never exceed qty_received
      IF v_delta < -0.001 THEN
        PERFORM public._mm_ledger(v_factory, v_unit.id, 'QC_DEDUCT', -v_delta, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process loss');
        PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
      ELSIF v_delta > 0.001 THEN
        PERFORM public._mm_set_on_hand(v_unit.id, GREATEST(v_qty, COALESCE(v_unit.qty_received, 0)), true);
        PERFORM public._mm_ledger(v_factory, v_unit.id, 'ADJUST_PLUS', v_delta, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process gain');
        PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
      ELSE
        PERFORM public._mm_ledger(v_factory, v_unit.id, 'TRANSFER', 0, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process return');
      END IF;
      UPDATE public.mm_stock_units SET status = 'pending_qc', current_location_id = v_recv, length_m = v_qty,
        weight_kg = COALESCE(NULLIF(v_e->>'qty_kg','')::numeric, weight_kg),
        shade = COALESCE(NULLIF(v_e->>'shade',''), shade), color_ref = COALESCE(NULLIF(v_e->>'color_ref',''), color_ref),
        qc_result = NULL, row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_unit.id;
      v_wh_units := v_wh_units || v_unit.id;
      v_child := v_unit.id;
    END IF;
    UPDATE public.mm_process_out_lines SET line_status = 'returned' WHERE id = v_line.id;
    INSERT INTO public.mm_process_return_lines (factory_id, challan_id, out_line_id, return_id, same_identity, unit_code, qty, uom,
      qty_kg, shade, color_ref, lot_no, mill_roll_id, stock_unit_id, stage_code, unit_form, width_form, grade, dye_lot, lot_id, created_by)
    VALUES (v_factory, v_ch.id, v_line.id, v_ret, true, v_line.unit_code, v_qty, v_line.uom,
      NULLIF(v_e->>'qty_kg','')::numeric, NULLIF(v_e->>'shade',''), NULLIF(v_e->>'color_ref',''), NULL,
      CASE WHEN v_ch.origin = 'mill' THEN v_child END, CASE WHEN v_ch.origin = 'warehouse' THEN v_child END,
      NULLIF(upper(v_e->>'stage_code'),''), NULLIF(v_e->>'unit_form',''), NULLIF(v_e->>'width_form',''),
      NULLIF(v_e->>'grade',''), NULLIF(v_e->>'dye_lot',''), COALESCE(NULLIF(v_e->>'lot_id','')::uuid, v_line.lot_id), v_actor);
    v_outputs := v_outputs || jsonb_build_object('roll_id', v_line.roll_id, 'unit_code', v_line.unit_code, 'same', true);
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'re_rolled','[]'::jsonb)) LOOP
    v_lids := ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(v_e->'out_line_ids','[]'::jsonb)) x);
    IF COALESCE(array_length(v_lids,1),0) = 0 OR jsonb_array_length(COALESCE(v_e->'outputs','[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'Each re-rolled group needs the sent rolls and the new rolls';
    END IF;
    v_sm := NULL; v_ft := NULL; v_batch := NULL; v_first := true;
    FOREACH v_lid IN ARRAY v_lids LOOP
      SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_lid;
      IF v_ch.origin = 'mill' THEN
        SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_line.mill_roll_id FOR UPDATE;
        IF v_first THEN v_sm := v_roll.style_material_id; v_ft := v_roll.fabric_type_id; v_batch := v_roll.mill_batch_id;
        ELSE
          IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN RAISE EXCEPTION 'Rolls re-rolled together must be the same fabric type'; END IF;
          IF v_roll.style_material_id IS DISTINCT FROM v_sm THEN v_sm := NULL; END IF;
        END IF;
        UPDATE public.mm_mill_rolls SET status = 'processed', row_version = row_version + 1, updated_at = now(), updated_by = v_actor
        WHERE id = v_roll.id;
      ELSE
        SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
        IF v_first THEN v_sm := v_unit.style_material_id; v_ft := v_unit.fabric_type_id; v_batch := v_unit.mill_batch_id;
        ELSE
          IF v_unit.fabric_type_id IS DISTINCT FROM v_ft THEN RAISE EXCEPTION 'Rolls re-rolled together must be the same fabric type'; END IF;
          IF v_unit.style_material_id IS DISTINCT FROM v_sm THEN v_sm := NULL; END IF;
        END IF;
        IF COALESCE(v_unit.qty_available,0) > 0 THEN
          PERFORM public._mm_ledger(v_factory, v_unit.id, 'WRITE_OFF', v_unit.qty_available, 'at_process', 'written_off', NULL, NULL,
            'mm_process_returns', v_ret, 're-rolled at process');
        END IF;
        UPDATE public.mm_stock_units SET status = 'written_off', current_location_id = NULL,
          row_version = row_version + 1, updated_at = now(), updated_by = v_actor WHERE id = v_unit.id;
      END IF;
      UPDATE public.mm_process_out_lines SET line_status = 'replaced' WHERE id = v_lid;
      v_first := false;
    END LOOP;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_lids[1];
    IF v_ch.origin = 'mill' THEN SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_line.mill_roll_id;
    ELSE SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id; END IF;

    FOR v_o IN SELECT * FROM jsonb_array_elements(v_e->'outputs') LOOP
      v_code := NULLIF(btrim(COALESCE(v_o->>'unit_code','')), '');
      v_qty := NULLIF(v_o->>'qty','')::numeric;
      IF v_code IS NULL THEN RAISE EXCEPTION 'Each new roll needs a roll number'; END IF;
      IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION '%: qty must be greater than zero', v_code; END IF;
      IF v_ch.origin = 'mill' THEN
        IF EXISTS (SELECT 1 FROM public.mm_mill_rolls r WHERE r.factory_id = v_factory AND r.mill_batch_id = v_batch AND lower(r.unit_code) = lower(v_code)) THEN
          RAISE EXCEPTION 'Roll % is already used in this batch', v_code;
        END IF;
        INSERT INTO public.mm_mill_rolls (factory_id, mill_batch_id, style_material_id, fabric_type_id, unit_code, length_m, weight_kg,
          shade, lot_no, color_ref, attributes, status, parent_mill_roll_id, created_by, updated_by)
        VALUES (v_factory, v_batch, v_sm, v_ft, v_code, v_qty, NULLIF(v_o->>'qty_kg','')::numeric,
          NULLIF(v_o->>'shade',''), v_roll.lot_no, COALESCE(NULLIF(v_o->>'color_ref',''), v_roll.color_ref),
          COALESCE(v_roll.attributes, '{}'::jsonb), 'draft', v_roll.id, v_actor, v_actor)
        RETURNING id INTO v_child;
        v_out_mill := v_out_mill || v_child;
      ELSE
        IF (v_batch IS NOT NULL AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.factory_id = v_factory AND u.mill_batch_id = v_batch AND lower(u.unit_code) = lower(v_code)))
           OR (v_batch IS NULL AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.factory_id = v_factory AND u.mill_batch_id IS NULL AND u.unit_code = v_code)) THEN
          RAISE EXCEPTION 'Roll % is already used', v_code;
        END IF;
        INSERT INTO public.mm_stock_units (factory_id, unit_code, unit_kind, style_material_id, source, uom, qty_uom, length_m, weight_kg,
          shade, lot_no, color_ref, attributes, mill_snapshot, status, current_location_id, fabric_type_id, mill_batch_id, mill_roll_id,
          declared_width_in, qty_declared, qty_received, qty_available, parent_stock_unit_id, created_by, updated_by)
        VALUES (v_factory, v_code, v_unit.unit_kind, v_sm, v_unit.source, v_unit.uom, COALESCE(v_unit.qty_uom, v_unit.uom), v_qty,
          NULLIF(v_o->>'qty_kg','')::numeric, NULLIF(v_o->>'shade',''), v_unit.lot_no, COALESCE(NULLIF(v_o->>'color_ref',''), v_unit.color_ref),
          COALESCE(v_unit.attributes, '{}'::jsonb), v_unit.mill_snapshot, 'pending_qc', v_recv, v_ft, v_batch, NULL,
          v_unit.declared_width_in, v_qty, v_qty, 0, v_unit.id, v_actor, v_actor)
        RETURNING id INTO v_child;
        PERFORM public._mm_ledger(v_factory, v_child, 'RECEIPT_IN', v_qty, 'pending_qc', 'pending_qc', v_recv, v_recv, 'mm_process_returns', v_ret, 'process return (re-rolled)');
        v_wh_units := v_wh_units || v_child;
      END IF;
      INSERT INTO public.mm_process_return_lines (factory_id, challan_id, out_line_id, return_id, same_identity, unit_code, qty, uom,
        qty_kg, shade, color_ref, mill_roll_id, stock_unit_id, stage_code, unit_form, width_form, grade, dye_lot, lot_id,
        parent_out_line_ids, created_by)
      VALUES (v_factory, v_ch.id, v_lids[1], v_ret, false, v_code, v_qty, v_line.uom, NULLIF(v_o->>'qty_kg','')::numeric,
        NULLIF(v_o->>'shade',''), NULLIF(v_o->>'color_ref',''),
        CASE WHEN v_ch.origin = 'mill' THEN v_child END, CASE WHEN v_ch.origin = 'warehouse' THEN v_child END,
        NULLIF(upper(v_o->>'stage_code'),''), NULLIF(v_o->>'unit_form',''), NULLIF(v_o->>'width_form',''),
        NULLIF(v_o->>'grade',''), NULLIF(v_o->>'dye_lot',''), COALESCE(NULLIF(v_o->>'lot_id','')::uuid, v_line.lot_id), v_lids, v_actor);
      v_outputs := v_outputs || jsonb_build_object('unit_code', v_code, 'same', false,
        'roll_id', CASE WHEN v_ch.origin = 'mill' THEN (SELECT roll_id FROM public.mm_mill_rolls WHERE id = v_child)
                        ELSE (SELECT roll_id FROM public.mm_stock_units WHERE id = v_child) END);
    END LOOP;
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'write_offs','[]'::jsonb)) LOOP
    IF NULLIF(btrim(COALESCE(v_e->>'reason','')), '') IS NULL THEN RAISE EXCEPTION 'A write-off needs a reason'; END IF;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = (v_e->>'out_line_id')::uuid;
    IF v_ch.origin = 'mill' THEN
      UPDATE public.mm_mill_rolls SET status = 'written_off', row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_line.mill_roll_id;
    ELSE
      SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
      IF COALESCE(v_unit.qty_available,0) > 0 THEN
        PERFORM public._mm_ledger(v_factory, v_unit.id, 'WRITE_OFF', v_unit.qty_available, 'at_process', 'written_off', NULL, NULL,
          'mm_process_returns', v_ret, 'written off at process: ' || (v_e->>'reason'));
      END IF;
      UPDATE public.mm_stock_units SET status = 'written_off', current_location_id = NULL,
        row_version = row_version + 1, updated_at = now(), updated_by = v_actor WHERE id = v_unit.id;
    END IF;
    UPDATE public.mm_process_out_lines SET line_status = 'written_off', write_off_reason = btrim(v_e->>'reason') WHERE id = v_line.id;
  END LOOP;

  PERFORM public._mm_process_refresh(v_ch.id);
  IF array_length(v_wh_units,1) > 0 THEN PERFORM public._mm_apply_clearance(v_wh_units); END IF;

  IF v_deliver = 'warehouse' AND array_length(v_out_mill,1) > 0 THEN
    v_disp := public.mm_dispatch_mill_rolls(v_out_mill,
      COALESCE(NULLIF(p_payload->'dispatch'->>'challan_no',''), public._mm_next_doc(v_factory, 'DC')),
      NULLIF(p_payload->'dispatch'->>'reference_no',''), COALESCE(NULLIF(p_payload->'dispatch'->>'to_location',''), 'Warehouse'),
      COALESCE(NULLIF(p_payload->>'returned_at','')::date, CURRENT_DATE), 'Delivered direct from ' || v_ch.challan_no);
    IF NOT COALESCE((v_disp->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'Return saved but dispatch failed: %', v_disp->>'message';
    END IF;
    UPDATE public.mm_process_returns SET in_challan_id = (v_disp->'data'->>'id')::uuid WHERE id = v_ret;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('return_id', v_ret, 'return_no', v_ret_no, 'outputs', v_outputs, 'dispatch', v_disp->'data'));
EXCEPTION WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
END $$;;
