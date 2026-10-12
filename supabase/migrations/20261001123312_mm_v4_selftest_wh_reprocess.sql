-- Warehouse-side processing + reprocess regression test. Always raises; 'SELFTEST PASS' = OK, everything rolled back.
CREATE OR REPLACE FUNCTION public._mm_v4_selftest_wh(p_admin uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE f uuid; r jsonb; unit_fac uuid; pt uuid; u record; c1 uuid; c2 uuid; ol uuid[];
BEGIN
  SELECT factory_id INTO f FROM public.profiles WHERE id = p_admin;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_admin, 'role','authenticated','factory_id', f)::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_admin::text, true);
  PERFORM public.mm_set_fabric_v4(true);
  r := public.mm_save_facility('{"kind":"process_unit","ownership":"external","code":"ST-WASH","name":"Selftest washer"}');
  unit_fac := (r->'data'->>'id')::uuid;
  SELECT id INTO pt FROM public.mm_process_types WHERE factory_id = f AND lower(name) = 'washing';
  SELECT * INTO u FROM public.mm_stock_units WHERE factory_id = f AND status = 'in_stock' AND NOT COALESCE(on_hold,false) AND qty_available > 3 LIMIT 1;
  IF u.id IS NULL THEN RAISE EXCEPTION 'SELFTEST SKIP: no in-stock roll'; END IF;

  r := public.mm_proc_send(jsonb_build_object('side','warehouse','unit_facility_id',unit_fac,'process_type_id',pt,'roll_ids',jsonb_build_array(u.roll_id)));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL wh send %', r; END IF; c1 := (r->'data'->>'id')::uuid;
  ol := ARRAY(SELECT id FROM public.mm_process_out_lines WHERE challan_id = c1);
  r := public.mm_proc_return(jsonb_build_object('challan_id',c1,'same_rolls',jsonb_build_array(jsonb_build_object('out_line_id',ol[1],'qty',u.qty_available - 1))));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL wh return (loss) %', r; END IF;
  r := public.mm_qc_save_test(jsonb_build_object('scope_kind','process_challan','scope_id',c1,'site_side','warehouse','result','fail'));
  IF public._mm_qc_passport(u.roll_id)->'test'->>'status' <> 'FAILED' THEN RAISE EXCEPTION 'SELFTEST FAIL wh failed status'; END IF;
  r := public.mm_proc_send(jsonb_build_object('side','warehouse','unit_facility_id',unit_fac,'process_type_id',pt,'roll_ids',jsonb_build_array(u.roll_id),
        'purpose','reprocess','parent_challan_id',c1,'reprocess_reason','selftest'));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL wh reprocess send %', r; END IF; c2 := (r->'data'->>'id')::uuid;
  ol := ARRAY(SELECT id FROM public.mm_process_out_lines WHERE challan_id = c2);
  r := public.mm_proc_return(jsonb_build_object('challan_id',c2,'same_rolls',jsonb_build_array(jsonb_build_object('out_line_id',ol[1],'qty',u.qty_available + 2))));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL wh return (gain) %', r; END IF;
  IF (SELECT process_round FROM public.mm_rolls WHERE id = u.roll_id) <> 2 THEN RAISE EXCEPTION 'SELFTEST FAIL wh round'; END IF;
  IF public._mm_qc_passport(u.roll_id)->'test'->>'status' <> 'STALE' THEN RAISE EXCEPTION 'SELFTEST FAIL wh stale after reprocess'; END IF;
  IF (SELECT status FROM public.mm_stock_units WHERE id = u.id) <> 'in_stock' THEN RAISE EXCEPTION 'SELFTEST FAIL wh status'; END IF;
  IF (SELECT qty_available FROM public.mm_stock_units WHERE id = u.id) <> u.qty_available + 2 THEN RAISE EXCEPTION 'SELFTEST FAIL wh qty'; END IF;
  RAISE EXCEPTION 'SELFTEST PASS: warehouse send, loss return, failed test, reprocess, gain return, round 2, stale';
END $$;
REVOKE ALL ON FUNCTION public._mm_v4_selftest_wh(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mm_v4_selftest_wh(uuid) TO service_role;;
