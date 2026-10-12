-- Fabric v4 self-test: runs the full scenario as a factory admin, then ALWAYS raises so everything rolls back.
-- Run:  select public._mm_v4_selftest('<admin profile id>');   → error text starts with SELFTEST PASS or SELFTEST FAIL
CREATE OR REPLACE FUNCTION public._mm_v4_selftest(p_admin uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_f uuid; v_log text := ''; r jsonb; v_mill uuid; v_dye uuid; v_k3 uuid; v_jet uuid; v_ft uuid; v_sm1 uuid; v_sm2 uuid;
  v_batch uuid; v_rolls uuid[]; v_pc1 uuid; v_pc2 uuid; v_pc3 uuid; v_ol uuid[]; v_children uuid[]; v_all uuid[]; v_pt uuid;
  v_ic uuid; v_units uuid[]; v_rack uuid; v_rv int; v_t uuid; v_x uuid;
  PROCEDURE_DUMMY int;
BEGIN
  SELECT factory_id INTO v_f FROM public.profiles WHERE id = p_admin;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_admin, 'role', 'authenticated', 'factory_id', v_f)::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_admin::text, true);

  r := public.mm_set_fabric_v4(true); IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL set_v4 %', r; END IF;
  SELECT id INTO v_mill FROM public.mm_facilities WHERE factory_id = v_f AND code = 'MILL-1';
  r := public.mm_save_facility('{"kind":"process_unit","ownership":"internal","code":"ST-DYE","name":"Selftest Dye House"}');
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL facility %', r; END IF; v_dye := (r->'data'->>'id')::uuid;
  r := public.mm_save_machine(jsonb_build_object('facility_id', v_mill, 'machine_kind','knitting','code','ST-K03'));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL machine K %', r; END IF; v_k3 := (r->'data'->>'id')::uuid;
  r := public.mm_save_machine(jsonb_build_object('facility_id', v_dye, 'machine_kind','jet_dyeing','code','ST-JET2'));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL machine J %', r; END IF; v_jet := (r->'data'->>'id')::uuid;
  v_log := v_log || 'masters ok; ';

  SELECT sm.id, sm.fabric_type_id INTO v_sm1, v_ft FROM public.mm_style_materials sm WHERE sm.factory_id = v_f
   AND EXISTS (SELECT 1 FROM public.mm_type_test_fields t WHERE t.type_id = sm.fabric_type_id AND t.is_active) ORDER BY sm.id LIMIT 1;
  SELECT id INTO v_sm2 FROM public.mm_style_materials WHERE factory_id = v_f AND fabric_type_id = v_ft AND id <> v_sm1 LIMIT 1;

  -- general batch, 7 greige rolls on K03
  r := public.mm_mill_save_batch_v4(jsonb_build_object('fabric_type_id', v_ft, 'batch_no', 'ST-B101', 'yarn_lot', 'YL-9',
        'intent_style_material_ids', jsonb_build_array(v_sm1, v_sm2),
        'rolls', (SELECT jsonb_agg(jsonb_build_object('unit_code', 'G' || g, 'length_m', 50 + g, 'weight_kg', 20, 'machine_id', v_k3,
                   'shift', 'A', 'width_form', 'tubular')) FROM generate_series(1,7) g)));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL batch %', r; END IF; v_batch := (r->'data'->>'id')::uuid;
  v_rolls := ARRAY(SELECT roll_id FROM public.mm_mill_rolls WHERE mill_batch_id = v_batch ORDER BY unit_code);
  IF (SELECT count(*) FROM public.mm_rolls WHERE id = ANY (v_rolls) AND stage_code = 'GREIGE' AND machine_id = v_k3) <> 7 THEN
    RAISE EXCEPTION 'SELFTEST FAIL registry tags';
  END IF;
  v_log := v_log || 'batch+registry ok; ';

  -- greige test on the batch
  r := public.mm_qc_save_test(jsonb_build_object('scope_kind','mill_batch','scope_id', v_batch, 'site_side','mill',
        'field_values', '{"gsm":"160"}'::jsonb, 'result','pass'));
  IF NOT (r->>'ok')::boolean OR (r->'data'->>'roll_count')::int <> 7 THEN RAISE EXCEPTION 'SELFTEST FAIL greige test %', r; END IF;
  IF public._mm_qc_passport(v_rolls[1])->'test'->>'status' <> 'PASS' THEN RAISE EXCEPTION 'SELFTEST FAIL greige passport %', public._mm_qc_passport(v_rolls[1]); END IF;
  v_log := v_log || 'greige test ok; ';

  SELECT id INTO v_pt FROM public.mm_process_types WHERE factory_id = v_f AND lower(name) = 'dyeing';
  -- PC1: G1..G3 re-rolled 3→2 ; PC2: G4..G6 same rolls ; G7 stays
  r := public.mm_proc_send(jsonb_build_object('side','mill','unit_facility_id', v_dye, 'process_type_id', v_pt,
        'roll_ids', to_jsonb(v_rolls[1:3])));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL send1 %', r; END IF; v_pc1 := (r->'data'->>'id')::uuid;
  r := public.mm_proc_send(jsonb_build_object('side','mill','unit_facility_id', v_dye, 'process_type_id', v_pt,
        'roll_ids', to_jsonb(v_rolls[4:6])));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL send2 %', r; END IF; v_pc2 := (r->'data'->>'id')::uuid;
  r := public.mm_proc_send(jsonb_build_object('side','mill','unit_facility_id', v_dye, 'process_type_id', v_pt, 'roll_ids', to_jsonb(v_rolls[1:1])));
  IF (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL double send allowed'; END IF;
  r := public.mm_qc_save_test(jsonb_build_object('scope_kind','rolls','roll_ids', to_jsonb(v_rolls[1:1]), 'site_side','mill','result','pass'));
  IF (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL test allowed while at process'; END IF;

  v_ol := ARRAY(SELECT id FROM public.mm_process_out_lines WHERE challan_id = v_pc1 ORDER BY unit_code);
  r := public.mm_proc_save_lots(v_pc1, jsonb_build_array(jsonb_build_object('lot_no','L-1','machine_id', v_jet, 'out_line_ids', to_jsonb(v_ol))));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL lots %', r; END IF;
  r := public.mm_proc_return(jsonb_build_object('challan_id', v_pc1, 're_rolled', jsonb_build_array(jsonb_build_object(
        'out_line_ids', to_jsonb(v_ol), 'outputs', jsonb_build_array(
          jsonb_build_object('unit_code','F1','qty',70,'qty_kg',27,'unit_form','lap','width_form','open','dye_lot','DL-1'),
          jsonb_build_object('unit_code','F2','qty',68,'qty_kg',26,'unit_form','lap','width_form','open','dye_lot','DL-1'))))));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL return1 %', r; END IF;
  v_children := ARRAY(SELECT (e->>'roll_id')::uuid FROM jsonb_array_elements(r->'data'->'outputs') e);
  IF (SELECT count(*) FROM public.mm_roll_lineage WHERE child_roll_id = ANY (v_children)) <> 6 THEN RAISE EXCEPTION 'SELFTEST FAIL lineage %', (SELECT count(*) FROM public.mm_roll_lineage WHERE child_roll_id = ANY (v_children)); END IF;
  IF (SELECT stage_code FROM public.mm_rolls WHERE id = v_children[1]) <> 'DYED' THEN RAISE EXCEPTION 'SELFTEST FAIL child stage'; END IF;
  IF public._mm_qc_passport(v_children[1])->'test'->>'status' <> 'NONE' THEN RAISE EXCEPTION 'SELFTEST FAIL child passport'; END IF;
  IF (SELECT status FROM public.mm_process_challans WHERE id = v_pc1) <> 'returned' THEN RAISE EXCEPTION 'SELFTEST FAIL pc1 status'; END IF;
  v_log := v_log || 're-roll+lineage ok; ';

  v_ol := ARRAY(SELECT id FROM public.mm_process_out_lines WHERE challan_id = v_pc2 ORDER BY unit_code);
  r := public.mm_proc_return(jsonb_build_object('challan_id', v_pc2, 'same_rolls', (SELECT jsonb_agg(jsonb_build_object('out_line_id', x, 'qty', 48)) FROM unnest(v_ol) x)));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL return2 %', r; END IF;
  IF public._mm_qc_passport(v_rolls[4])->'test'->>'status' <> 'STALE' THEN RAISE EXCEPTION 'SELFTEST FAIL stale %', public._mm_qc_passport(v_rolls[4]); END IF;
  IF (SELECT process_round FROM public.mm_rolls WHERE id = v_rolls[4]) <> 1 THEN RAISE EXCEPTION 'SELFTEST FAIL round'; END IF;
  v_log := v_log || 'same-roll round+stale ok; ';

  -- PC1 test pass (incomplete first, then complete)
  r := public.mm_qc_save_test(jsonb_build_object('scope_kind','process_challan','scope_id', v_pc1, 'site_side','processing',
        'field_values', '{"gsm":"180"}'::jsonb, 'result','pass'));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL test pc1 %', r; END IF;
  IF public._mm_qc_passport(v_children[1])->'test'->>'status' <> 'INCOMPLETE' THEN RAISE EXCEPTION 'SELFTEST FAIL incomplete %', public._mm_qc_passport(v_children[1]); END IF;
  r := public.mm_qc_save_test(jsonb_build_object('scope_kind','process_challan','scope_id', v_pc1, 'site_side','processing',
        'field_values', '{"gsm":"180","width":"60","shrinkage-l":"3","shrinkage-w":"2"}'::jsonb, 'result','pass'));
  IF NOT (r->>'ok')::boolean OR (r->'data'->>'supersedes_id') IS NULL THEN RAISE EXCEPTION 'SELFTEST FAIL test pc1 b %', r; END IF;
  IF public._mm_qc_passport(v_children[1])->'test'->>'status' <> 'PASS' THEN RAISE EXCEPTION 'SELFTEST FAIL pc1 pass %', public._mm_qc_passport(v_children[1]); END IF;

  -- PC2 test fails on shade → reprocess PC3 → pass
  r := public.mm_qc_save_test(jsonb_build_object('scope_kind','process_challan','scope_id', v_pc2, 'site_side','processing',
        'field_values', '{"gsm":"181","width":"60","shrinkage-l":"3","shrinkage-w":"2"}'::jsonb, 'result','fail', 'remarks','shade off'));
  IF public._mm_qc_passport(v_rolls[4])->'test'->>'status' <> 'FAILED' THEN RAISE EXCEPTION 'SELFTEST FAIL failed'; END IF;
  r := public.mm_proc_send(jsonb_build_object('side','mill','unit_facility_id', v_dye, 'process_type_id', v_pt, 'roll_ids', to_jsonb(v_rolls[4:6]),
        'purpose','reprocess','parent_challan_id', v_pc2, 'reprocess_reason','shade off'));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL reprocess send %', r; END IF; v_pc3 := (r->'data'->>'id')::uuid;
  v_ol := ARRAY(SELECT id FROM public.mm_process_out_lines WHERE challan_id = v_pc3);
  r := public.mm_proc_return(jsonb_build_object('challan_id', v_pc3, 'same_rolls', (SELECT jsonb_agg(jsonb_build_object('out_line_id', x, 'qty', 47)) FROM unnest(v_ol) x)));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL reprocess return %', r; END IF;
  IF public._mm_qc_passport(v_rolls[4])->'test'->>'status' <> 'STALE' THEN RAISE EXCEPTION 'SELFTEST FAIL reprocess stale %', public._mm_qc_passport(v_rolls[4]); END IF;
  r := public.mm_qc_save_test(jsonb_build_object('scope_kind','process_challan','scope_id', v_pc3, 'site_side','processing',
        'field_values', '{"gsm":"180","width":"60","shrinkage-l":"3","shrinkage-w":"2"}'::jsonb, 'result','pass'));
  IF public._mm_qc_passport(v_rolls[4])->'test'->>'status' <> 'PASS' THEN RAISE EXCEPTION 'SELFTEST FAIL reprocess pass %', public._mm_qc_passport(v_rolls[4]); END IF;
  v_log := v_log || 'tests+reprocess ok; ';

  -- inspections on the 5 processed rolls
  v_all := v_children || v_rolls[4:6];
  r := public.mm_qc_save_inspections(jsonb_build_object('site_side','processing', 'rows',
        (SELECT jsonb_agg(jsonb_build_object('roll_id', x, 'inspected_length', 50, 'cuttable_width', 58, 'pts_1', 2, 'pts_3', 1)) FROM unnest(v_all) x)));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL inspections %', r; END IF;
  v_log := v_log || 'inspections ok; ';

  -- allocate (via existing path: plain update fires the allocation log) then dispatch
  UPDATE public.mm_mill_rolls SET style_material_id = v_sm1 WHERE roll_id = ANY (v_all);
  IF (SELECT count(*) FROM public.mm_roll_allocations WHERE roll_id = ANY (v_all)) <> 5 THEN RAISE EXCEPTION 'SELFTEST FAIL alloc log'; END IF;
  r := public.mm_dispatch_mill_rolls(ARRAY(SELECT id FROM public.mm_mill_rolls WHERE roll_id = ANY (v_all)), 'ST-DC-1');
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL dispatch %', r; END IF; v_ic := (r->'data'->>'id')::uuid;
  IF (SELECT count(*) FROM public.mm_stock_units WHERE in_challan_id = v_ic AND roll_id = ANY (v_all)) <> 5 THEN RAISE EXCEPTION 'SELFTEST FAIL carry id'; END IF;
  IF (SELECT count(*) FROM public.mm_roll_allocations WHERE roll_id = ANY (v_all)) <> 5 THEN RAISE EXCEPTION 'SELFTEST FAIL alloc dup on dispatch'; END IF;
  v_log := v_log || 'dispatch carry-over ok; ';

  -- receive, putaway, gate
  SELECT row_version INTO v_rv FROM public.mm_in_challans WHERE id = v_ic;
  r := public.mm_receive_mill_in_challan(v_ic, '[]'::jsonb, v_rv);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL receive %', r; END IF;
  v_units := ARRAY(SELECT id FROM public.mm_stock_units WHERE in_challan_id = v_ic);
  PERFORM public._mm_apply_clearance(v_units);
  IF EXISTS (SELECT 1 FROM public.mm_stock_units WHERE id = ANY (v_units) AND status <> 'in_stock') THEN
    RAISE EXCEPTION 'SELFTEST FAIL clearance %', (SELECT jsonb_agg(status) FROM public.mm_stock_units WHERE id = ANY (v_units));
  END IF;
  SELECT id INTO v_rack FROM public.mm_locations WHERE factory_id = v_f AND location_type = 'rack' AND is_active AND is_pickable LIMIT 1;
  r := public.mm_putaway_rolls(v_units, v_rack);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL putaway %', r; END IF;
  r := public.mm_wh_list_readiness(jsonb_build_object('style_material_id', v_sm1));
  IF (SELECT count(*) FROM jsonb_array_elements(r->'data'->'rows') e WHERE e->>'roll_id' IN (SELECT unnest(v_all)::text) AND (e->'gate'->>'cut_ready')::boolean) <> 5 THEN
    RAISE EXCEPTION 'SELFTEST FAIL readiness %', r;
  END IF;

  -- a stale roll is blocked: mark one inspection void → INSPECTION_MISSING; then cut-at-risk lets it through
  SELECT id INTO v_x FROM public.mm_qc_inspections WHERE roll_id = v_all[1] AND voided_at IS NULL;
  r := public.mm_qc_void('inspection', v_x, 'selftest');
  r := public.mm_create_store_challan(v_sm1, v_units, 'ST-SC-1');
  IF (r->>'ok')::boolean OR r->>'code' <> 'CUT_GATE' THEN RAISE EXCEPTION 'SELFTEST FAIL gate did not block %', r; END IF;
  r := public.mm_qc_approve_cut_at_risk(ARRAY[v_all[1]], ARRAY['INSPECTION_MISSING'], 'selftest urgent');
  r := public.mm_create_store_challan(v_sm1, v_units, 'ST-SC-1');
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL gate after approval %', r; END IF;
  v_log := v_log || 'gate+cut-at-risk ok; ';

  -- read API smoke
  r := public.mm_get_v4_config();            IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL config %', r; END IF;
  r := public.mm_mill_list_batches_v4('{}'); IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL list batches %', r; END IF;
  r := public.mm_mill_get_batch_v4(v_batch); IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL get batch %', r; END IF;
  r := public.mm_proc_list_challans('{}');   IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL list challans %', r; END IF;
  r := public.mm_proc_get_challan(v_pc1);    IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL get challan %', r; END IF;
  r := public.mm_qc_get_scope('process_challan', v_pc1); IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL scope %', r; END IF;
  r := public.mm_qc_get_roll(v_children[1]); IF NOT (r->>'ok')::boolean OR jsonb_array_length(r->'data'->'ancestors') <> 3 THEN RAISE EXCEPTION 'SELFTEST FAIL get roll %', r; END IF;
  r := public.mm_qc_list_queue('{}');        IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL queue %', r; END IF;
  r := public.mm_list_rolls_v4('{"side":"mill","available_for":"process"}'); IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL list rolls %', r; END IF;
  r := public.mm_rpt_process_loss();         IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL loss %', r; END IF;
  r := public.mm_rpt_quality_by_machine();   IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL machine rpt %', r; END IF;
  v_log := v_log || 'read api ok; loss=' || COALESCE((r->'data'->'rows')::text, '');

  RAISE EXCEPTION 'SELFTEST PASS: %', v_log;
END $$;
REVOKE ALL ON FUNCTION public._mm_v4_selftest(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mm_v4_selftest(uuid) TO service_role;;
