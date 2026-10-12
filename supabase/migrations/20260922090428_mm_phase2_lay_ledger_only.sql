DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.oid = 'public.mm_save_lay_consumptions(uuid,jsonb,uuid)'::regprocedure;
  IF position('AND v_consumed_ok' in d) = 0 THEN
    RAISE EXCEPTION 'consumed gate not found';
  END IF;
  d := replace(d, 'AND v_consumed_ok ', '');
  IF position('_mm_set_on_hand(v_unit.id, v_old.opening_qty, false)' in d) = 0
     OR position('_mm_set_on_hand(v_unit.id, v_closing, false)' in d) = 0 THEN
    RAISE EXCEPTION 'set_on_hand calls not found';
  END IF;
  d := replace(d, '    PERFORM public._mm_set_on_hand(v_unit.id, v_old.opening_qty, false);' || chr(10), '');
  d := replace(d, '    PERFORM public._mm_set_on_hand(v_unit.id, v_closing, false);' || chr(10), '');
  IF position('_mm_set_on_hand' in d) > 0 THEN
    RAISE EXCEPTION 'set_on_hand remains';
  END IF;
  IF position('v_new_loc := NULL' in d) = 0 THEN
    RAISE EXCEPTION 'consumed location clear missing';
  END IF;
  EXECUTE d;
END
$do$;;
