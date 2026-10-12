DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.oid = 'public.mm_allocate_rolls_to_style(uuid[],uuid,uuid,uuid)'::regprocedure;
  d := replace(d,
    'SELECT COALESCE(sum(u.length_m), 0) INTO v_have' || chr(10) || '  FROM public.mm_stock_units u' || chr(10) || '  WHERE u.style_material_id = v_sm_id' || chr(10) || '    AND (' || chr(10) || '      u.status = ''pending_qc''' || chr(10) || '      OR (u.status = ''in_stock'' AND public._mm_loc_is_under(u.current_location_id, v_wh))' || chr(10) || '      OR public._mm_loc_is_under(u.current_location_id, v_cut)' || chr(10) || '    );',
    'SELECT COALESCE(sum(COALESCE(u.qty_received, u.length_m)), 0) INTO v_have' || chr(10) || '  FROM public.mm_stock_units u' || chr(10) || '  WHERE u.style_material_id = v_sm_id' || chr(10) || '    AND public._mm_counts_as_received(u.status);');
  IF position('_mm_counts_as_received(u.status)' in d) = 0 THEN
    RAISE EXCEPTION 'allocate received patch missed';
  END IF;
  EXECUTE d;
END
$do$;;
