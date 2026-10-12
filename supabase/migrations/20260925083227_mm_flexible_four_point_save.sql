CREATE OR REPLACE FUNCTION public.mm_save_inspections(p_scope_kind text, p_scope_id uuid, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_kind text;
  v_site text;
  v_occasion text;
  v_batch public.mm_mill_batches%ROWTYPE;
  v_ch public.mm_in_challans%ROWTYPE;
  v_proc public.mm_process_challans%ROWTYPE;
  v_recv uuid;
  v_red uuid;
  v_row jsonb;
  v_result text;
  v_values jsonb;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_unit public.mm_stock_units%ROWTYPE;
  v_id uuid;
  v_n integer := 0;
  v_measured numeric;
  v_width numeric;
  v_width_uom text;
  v_p1 integer;
  v_p2 integer;
  v_p3 integer;
  v_p4 integer;
  v_pts integer;
  v_score numeric;
  v_threshold numeric;
  v_computed text;
  v_override text;
  v_reason text;
  v_final text;
  v_insp uuid;
  v_new_status text;
  v_new_loc uuid;
  v_current numeric;
  v_delta numeric;
  v_uom text;
  v_mill_batch uuid;
  v_mill_roll uuid;
  v_stock uuid;
  v_qc boolean := false;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
    v_qc := true;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_factory := public._mm_require_ops('mm_roll_entry');
    EXCEPTION WHEN OTHERS THEN
      RETURN public._mm_err('ERROR', SQLERRM);
    END;
  END;
  v_kind := NULLIF(btrim(COALESCE(p_scope_kind, '')), '');
  IF v_kind IS NULL OR p_scope_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Inspection scope is required');
  END IF;
  IF v_kind NOT IN ('mill_batch', 'in_challan', 'process_challan') THEN
    RETURN public._mm_err('INVALID', 'Unknown inspection scope');
  END IF;
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' THEN
    RETURN public._mm_err('REQUIRED', 'Set pass or fail on at least one roll');
  END IF;

  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_recv := public._mm_recv_loc(v_factory);
  v_red := COALESCE(public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL'), v_recv);

  IF v_kind = 'mill_batch' THEN
    SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = p_scope_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Mill batch not found'); END IF;
    v_site := 'mill';
    v_occasion := 'after_allocate';
  ELSIF v_kind = 'in_challan' THEN
    SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_scope_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
    IF v_ch.source = 'mill' AND v_ch.status NOT IN ('received', 'partial', 'short_closed') THEN
      RETURN public._mm_err('INVALID', 'Receive this mill challan before testing');
    END IF;
    v_site := 'warehouse';
    v_occasion := 'inbound';
  ELSE
    SELECT * INTO v_proc FROM public.mm_process_challans WHERE id = p_scope_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Process challan was not found'); END IF;
    IF v_proc.status = 'open' AND NOT EXISTS (
      SELECT 1 FROM public.mm_process_return_lines r WHERE r.challan_id = v_proc.id
    ) THEN
      RETURN public._mm_err('INVALID', 'Receive the process return before inspecting');
    END IF;
    v_site := v_proc.origin;
    v_occasion := 'after_process';
  END IF;
  IF NOT v_qc AND v_kind = 'in_challan' THEN
    RETURN public._mm_err('NO_PERMISSION', 'mm_qc required');
  END IF;
  IF NOT v_qc AND v_kind = 'process_challan' AND v_proc.origin = 'warehouse' THEN
    RETURN public._mm_err('NO_PERMISSION', 'mm_qc required');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_result := lower(NULLIF(btrim(COALESCE(v_row->>'result', '')), ''));
    IF v_result IS NULL THEN CONTINUE; END IF;
    IF v_result NOT IN ('pass', 'fail') THEN
      RETURN public._mm_err('INVALID', 'Each roll must be pass or fail');
    END IF;
    BEGIN
      v_id := (v_row->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF v_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Each roll needs an id'); END IF;

    v_roll := NULL;
    v_unit := NULL;
    v_mill_roll := NULL;
    v_stock := NULL;
    v_mill_batch := NULL;

    IF v_kind = 'mill_batch' THEN
      SELECT * INTO v_roll FROM public.mm_mill_rolls
      WHERE id = v_id AND factory_id = v_factory AND mill_batch_id = v_batch.id FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this batch'); END IF;
      IF v_roll.status IS DISTINCT FROM 'draft' OR v_roll.in_challan_id IS NOT NULL OR public._mm_mill_at_process(v_roll.id) THEN
        RETURN public._mm_err('INVALID', 'Inspect only rolls still at the mill');
      END IF;
      v_mill_roll := v_roll.id;
      v_mill_batch := v_roll.mill_batch_id;
    ELSIF v_kind = 'in_challan' THEN
      SELECT * INTO v_unit FROM public.mm_stock_units
      WHERE id = v_id AND in_challan_id = v_ch.id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this challan'); END IF;
      IF v_unit.status IS DISTINCT FROM 'pending_qc' AND v_unit.status IS DISTINCT FROM 'in_stock' THEN
        RETURN public._mm_err('INVALID', 'A selected roll is not waiting for warehouse test');
      END IF;
      v_stock := v_unit.id;
    ELSE
      IF v_proc.origin = 'mill' THEN
        SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
        IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this process challan'); END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.mm_process_return_lines r
          WHERE r.challan_id = v_proc.id AND r.mill_roll_id = v_roll.id
        ) THEN
          RETURN public._mm_err('INVALID', 'Inspect only rolls that came back from process');
        END IF;
        v_mill_roll := v_roll.id;
        v_mill_batch := v_roll.mill_batch_id;
      ELSE
        SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
        IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this process challan'); END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.mm_process_return_lines r
          WHERE r.challan_id = v_proc.id AND r.stock_unit_id = v_unit.id
        ) THEN
          RETURN public._mm_err('INVALID', 'Inspect only rolls that came back from process');
        END IF;
        IF v_unit.status IS DISTINCT FROM 'pending_qc' AND v_unit.status IS DISTINCT FROM 'in_stock' THEN
          RETURN public._mm_err('INVALID', 'A selected roll is not waiting for warehouse test');
        END IF;
        v_stock := v_unit.id;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.mm_warehouse_inspections i
      WHERE i.scope_kind = v_kind AND i.scope_id = p_scope_id
        AND (
          (v_mill_roll IS NOT NULL AND i.mill_roll_id = v_mill_roll)
          OR (v_stock IS NOT NULL AND i.stock_unit_id = v_stock)
        )
    ) THEN
      RETURN public._mm_err('LOCKED', 'This roll is already inspected');
    END IF;

    v_values := CASE WHEN jsonb_typeof(v_row->'values') = 'object' THEN v_row->'values' ELSE '{}'::jsonb END;
    v_measured := COALESCE(NULLIF(v_values->>'inspected_length', '')::numeric, NULLIF(v_row->>'inspected_length', '')::numeric);
    v_width := COALESCE(NULLIF(v_values->>'inspected_width_in', '')::numeric, NULLIF(v_values->>'cuttable_width', '')::numeric, NULLIF(v_row->>'cuttable_width', '')::numeric);
    v_width_uom := COALESCE(NULLIF(v_values->>'width_uom', ''), 'in');
    v_p1 := 0; v_p2 := 0; v_p3 := 0; v_p4 := 0; v_pts := 0;
    v_score := NULL; v_computed := v_result; v_override := NULL; v_threshold := NULL;
    v_uom := COALESCE(v_unit.qty_uom, v_unit.uom, 'm');
    IF v_measured IS NOT NULL AND v_width IS NOT NULL THEN
      v_p1 := COALESCE(NULLIF(v_values->>'pts_1','')::int, 0);
      v_p2 := COALESCE(NULLIF(v_values->>'pts_2','')::int, 0);
      v_p3 := COALESCE(NULLIF(v_values->>'pts_3','')::int, 0);
      v_p4 := COALESCE(NULLIF(v_values->>'pts_4','')::int, 0);
      v_pts := v_p1 + 2*v_p2 + 3*v_p3 + 4*v_p4;
      v_score := public._mm_fpt_score(v_pts, v_measured, v_uom, v_width, v_width_uom);
      v_threshold := public._mm_fpt_threshold(COALESCE(v_stock, v_mill_roll));
      v_computed := CASE WHEN v_score IS NULL OR v_score <= v_threshold THEN 'pass' ELSE 'fail' END;
      IF v_result IS DISTINCT FROM v_computed THEN
        v_override := v_result;
      END IF;
    END IF;
    v_reason := NULLIF(btrim(COALESCE(v_values->>'override_reason', v_row->>'override_reason', '')), '');
    IF v_override IS NOT NULL AND v_reason IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'An override needs a reason');
    END IF;
    v_final := COALESCE(v_override, v_computed);

    IF v_stock IS NOT NULL AND v_measured IS NOT NULL THEN
      v_current := COALESCE(public._mm_unit_qty_received(v_unit), 0);
      v_delta := v_measured - v_current;
      IF abs(v_delta) > 0.0001 THEN
        PERFORM public._mm_ledger(
          v_factory, v_unit.id,
          CASE WHEN v_delta < 0 THEN 'QC_DEDUCT' ELSE 'ADJUST_PLUS' END,
          v_delta, v_unit.status, v_unit.status,
          v_unit.current_location_id, v_unit.current_location_id,
          'mm_warehouse_inspections', p_scope_id, 'length confirmed at inspection'
        );
        PERFORM public._mm_set_on_hand(v_unit.id, v_measured, true);
      END IF;
    END IF;

    v_new_status := CASE WHEN v_stock IS NOT NULL AND v_final = 'fail' THEN 'rejected' ELSE COALESCE(v_unit.status, v_roll.status) END;
    v_new_loc := CASE WHEN v_stock IS NOT NULL AND v_final = 'fail' THEN v_red ELSE v_unit.current_location_id END;

    BEGIN
      INSERT INTO public.mm_warehouse_inspections (
        factory_id, site, occasion, scope_kind, scope_id,
        mill_batch_id, mill_roll_id, in_challan_id, process_challan_id, stock_unit_id,
        result, field_values, remarks, shade,
        inspected_length, cuttable_width, width_uom,
        pts_1, pts_2, pts_3, pts_4, points_per_100_sqyd, threshold_used,
        result_computed, result_override, override_reason, override_by, override_at,
        inspected_at, inspected_by, created_by, updated_by
      ) VALUES (
        v_factory, v_site, v_occasion, v_kind, p_scope_id,
        v_mill_batch, v_mill_roll,
        CASE WHEN v_kind = 'in_challan' THEN p_scope_id ELSE NULL END,
        CASE WHEN v_kind = 'process_challan' THEN p_scope_id ELSE NULL END,
        v_stock,
        v_final, v_values,
        NULLIF(btrim(COALESCE(v_row->>'remarks', '')), ''),
        NULLIF(btrim(COALESCE(v_row->>'shade', v_values->>'shade', '')), ''),
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

    IF v_mill_roll IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        qc_result = v_final,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_mill_roll;
    END IF;

    IF v_stock IS NOT NULL THEN
      UPDATE public.mm_stock_units SET
        qc_result = v_final,
        status = v_new_status,
        current_location_id = v_new_loc,
        tested_shade = COALESCE(NULLIF(btrim(COALESCE(v_row->>'shade', v_values->>'shade', '')), ''), tested_shade),
        tested_shade_at = CASE WHEN NULLIF(btrim(COALESCE(v_row->>'shade', '')), '') IS NULL THEN tested_shade_at ELSE now() END,
        tested_shade_by = CASE WHEN NULLIF(btrim(COALESCE(v_row->>'shade', '')), '') IS NULL THEN tested_shade_by ELSE public._mm_actor_id() END,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_stock;
      PERFORM public._mm_ledger(
        v_factory, v_stock, 'TRANSFER', COALESCE(v_measured, v_unit.length_m), v_unit.status, v_new_status,
        v_unit.current_location_id, v_new_loc, 'mm_warehouse_inspections', p_scope_id,
        CASE WHEN v_final = 'pass' THEN 'Warehouse 4-point pass' ELSE 'Warehouse 4-point fail' END
      );
    END IF;
    v_n := v_n + 1;
  END LOOP;

  IF v_kind = 'in_challan' THEN
    PERFORM public._mm_apply_clearance(ARRAY(SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id));
  ELSIF v_kind = 'process_challan' AND v_proc.origin = 'warehouse' THEN
    PERFORM public._mm_apply_clearance(ARRAY(
      SELECT r.stock_unit_id FROM public.mm_process_return_lines r WHERE r.challan_id = v_proc.id AND r.stock_unit_id IS NOT NULL
    ));
  END IF;

  RETURN public._mm_ok(jsonb_build_object('id', p_scope_id, 'saved', v_n, 'scope_kind', v_kind));
END;
$function$;;
