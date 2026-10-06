DO $patch$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_floor_call';
  IF def IS NULL THEN
    RAISE EXCEPTION 'mm_floor_call missing';
  END IF;
  IF position('mm_receive_mill_bundle' in def) = 0 THEN
    def := replace(def,
      'ELSIF p_fn = ''mm_get_lay_report'' THEN' || E'\n' || '    RETURN public.mm_get_lay_report((v_args->>''lay_id'')::uuid);',
      'ELSIF p_fn = ''mm_get_lay_report'' THEN' || E'\n' || '    RETURN public.mm_get_lay_report((v_args->>''lay_id'')::uuid);' || E'\n' ||
      '  ELSIF p_fn = ''mm_list_test_fields'' THEN' || E'\n' || '    RETURN public.mm_list_test_fields(NULLIF(v_args->>''fabric_type_id'', '''')::uuid);' || E'\n' ||
      '  ELSIF p_fn = ''mm_receive_mill_bundle'' THEN' || E'\n' || '    RETURN public.mm_receive_mill_bundle(v_args);'
    );
    IF position('mm_receive_mill_bundle' in def) = 0 THEN
      RAISE EXCEPTION 'patch did not match mm_floor_call body';
    END IF;
    EXECUTE def;
  END IF;
END;
$patch$;;
