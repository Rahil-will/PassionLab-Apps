-- Pending item 4 audit (Rahil 2026-10-21): does a booked greige roll keep its booking across a dyeing round trip?
-- Regression test only — no schema/logic change. Always raises; 'SELFTEST PASS' = OK, everything rolled back.
-- Run:  select public._mm_v4_selftest_booking_lineage('<admin profile id>');   → error text starts with SELFTEST PASS or SELFTEST FAIL
CREATE OR REPLACE FUNCTION public._mm_v4_selftest_booking_lineage(p_admin uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  f uuid; v_fab uuid; v_ft uuid; v_sm uuid; v_roll uuid; v_unit uuid; r jsonb;
  unit_fac uuid; pt uuid; c1 uuid; ol uuid; v_child_roll uuid; v_booked uuid;
BEGIN
  SELECT factory_id INTO f FROM public.profiles WHERE id = p_admin;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_admin, 'role','authenticated','factory_id', f)::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_admin::text, true);

  SELECT id, fabric_type_id INTO v_fab, v_ft FROM public.mm_fabrics WHERE factory_id = f LIMIT 1;
  IF v_fab IS NULL THEN RAISE EXCEPTION 'SELFTEST SKIP: no fabric on this factory'; END IF;
  SELECT id INTO v_sm FROM public.mm_style_materials WHERE factory_id = f LIMIT 1;
  IF v_sm IS NULL THEN RAISE EXCEPTION 'SELFTEST SKIP: no style line on this factory'; END IF;
  SELECT id INTO pt FROM public.mm_process_types WHERE factory_id = f AND lower(name) = 'scouring & bleaching';
  IF pt IS NULL THEN RAISE EXCEPTION 'SELFTEST SKIP: no scouring process type'; END IF;

  -- Fresh GREIGE roll, 50kg in stock
  INSERT INTO public.mm_rolls (factory_id, roll_code, origin, fabric_id, fabric_type_id, stage_code, unit_form, produced_at, created_by)
  VALUES (f, 'ST-BOOK-SRC', 'inhouse', v_fab, v_ft, 'GREIGE', 'roll', now(), p_admin)
  RETURNING id INTO v_roll;
  INSERT INTO public.mm_stock_units (factory_id, unit_code, unit_kind, roll_id, source, uom, qty_uom,
    weight_kg, status, fabric_type_id, qty_declared, qty_received, qty_available, created_by, updated_by)
  VALUES (f, 'ST-BOOK-SRC', 'roll', v_roll, 'inhouse', 'kg', 'kg', 50, 'in_stock', v_ft, 50, 50, 50, p_admin, p_admin)
  RETURNING id INTO v_unit;

  -- Book it: the roll is GREIGE (not cuttable), so a style stamp on the stock unit must redirect to a booking on mm_rolls
  UPDATE public.mm_stock_units SET style_material_id = v_sm WHERE id = v_unit;
  IF (SELECT style_material_id FROM public.mm_stock_units WHERE id = v_unit) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST FAIL: stamping a greige roll left style_material_id set on the stock unit instead of booking it';
  END IF;
  SELECT booked_style_material_id INTO v_booked FROM public.mm_rolls WHERE id = v_roll;
  IF v_booked IS DISTINCT FROM v_sm THEN RAISE EXCEPTION 'SELFTEST FAIL: booking stamp did not land on mm_rolls.booked_style_material_id'; END IF;

  -- Send to an external process (dyeing-line stand-in)
  INSERT INTO public.mm_processing_vendors (factory_id, code, name, ownership, process_type_ids, is_active, created_by, updated_by)
  VALUES (f, 'ST-BOOK-SCOUR', 'Selftest scour unit', 'external', '{}', true, p_admin, p_admin)
  RETURNING id INTO unit_fac;
  r := public.mm_proc_send(jsonb_build_object('unit_facility_id', unit_fac, 'process_type_id', pt, 'roll_ids', jsonb_build_array(v_roll)));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL: send to process %', r; END IF;
  c1 := (r->'data'->>'id')::uuid;
  SELECT id INTO ol FROM public.mm_process_out_lines WHERE challan_id = c1 LIMIT 1;

  -- Return re-rolled: a NEW roll identity is created for the output, the path that must carry the booking forward
  r := public.mm_proc_return(jsonb_build_object('challan_id', c1,
    're_rolled', jsonb_build_array(jsonb_build_object('out_line_ids', jsonb_build_array(ol),
      'outputs', jsonb_build_array(jsonb_build_object('unit_code','ST-BOOK-OUT','qty',48))))));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'SELFTEST FAIL: process return %', r; END IF;

  SELECT roll_id INTO v_child_roll FROM public.mm_stock_units WHERE unit_code = 'ST-BOOK-OUT' AND factory_id = f;
  IF v_child_roll IS NULL THEN RAISE EXCEPTION 'SELFTEST FAIL: re-rolled output not found'; END IF;
  SELECT booked_style_material_id INTO v_booked FROM public.mm_rolls WHERE id = v_child_roll;
  IF v_booked IS DISTINCT FROM v_sm THEN
    RAISE EXCEPTION 'SELFTEST FAIL: booked greige roll lost its booking after the dyeing return (child %, booked %, expected %)', v_child_roll, v_booked, v_sm;
  END IF;

  RAISE EXCEPTION 'SELFTEST PASS: greige roll booked, sent to process, re-rolled on return, booking carried to the new roll';
END $$;
REVOKE ALL ON FUNCTION public._mm_v4_selftest_booking_lineage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._mm_v4_selftest_booking_lineage(uuid) TO service_role;
