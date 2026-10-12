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
$function$;

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
$function$;;
