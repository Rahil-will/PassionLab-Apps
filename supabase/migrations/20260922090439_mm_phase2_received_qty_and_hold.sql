DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.oid = 'public.mm_get_expected_board(text,text,integer,integer)'::regprocedure;
  IF position('sum(COALESCE(u.qty_received, u.length_m))' in d) = 0 THEN
    d := replace(d,
      'SELECT sum(u.length_m) FROM public.mm_stock_units u' || chr(10) || '          WHERE u.style_material_id = sm.id' || chr(10) || '            AND public._mm_counts_as_received(u.status)',
      'SELECT sum(COALESCE(u.qty_received, u.length_m)) FROM public.mm_stock_units u' || chr(10) || '          WHERE u.style_material_id = sm.id' || chr(10) || '            AND public._mm_counts_as_received(u.status)');
  END IF;
  IF position('sum(COALESCE(u.qty_received, u.length_m))' in d) = 0 THEN
    RAISE EXCEPTION 'received qty patch missed';
  END IF;
  EXECUTE d;

  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.oid = 'public.mm_create_store_challan(uuid,uuid[],text,text,date,text)'::regprocedure;
  IF position('_mm_unit_on_hold' in d) = 0 THEN
    d := replace(d,
      'RETURN public._mm_err(''INVALID'', ''A selected roll is not on a warehouse rack'');' || chr(10) || '    END IF;' || chr(10) || '    v_block := public._mm_cutting_param_block(v_unit);',
      'RETURN public._mm_err(''INVALID'', ''A selected roll is not on a warehouse rack'');' || chr(10) || '    END IF;' || chr(10) || '    IF public._mm_unit_on_hold(v_unit.id) THEN' || chr(10) || '      RETURN public._mm_err(''HOLD'', COALESCE(v_unit.unit_code, ''Roll'') || '' is on hold'');' || chr(10) || '    END IF;' || chr(10) || '    v_block := public._mm_cutting_param_block(v_unit);');
  END IF;
  IF position('_mm_unit_on_hold' in d) = 0 THEN
    RAISE EXCEPTION 'hold patch missed';
  END IF;
  EXECUTE d;
END
$do$;;
