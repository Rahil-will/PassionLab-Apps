-- mm_get_v4_config machines: add process_type_id + makes_fabric (New mill batch shows fabric-making machines only).
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_get_v4_config()'::regprocedure);
  IF position('''process_type_id'', m.process_type_id' in d) > 0 THEN RETURN; END IF;
  d := replace(d, $a$'name', m.name, 'specs', m.specs, 'is_active', m.is_active) ORDER BY m.code)$a$,
    $b$'name', m.name, 'specs', m.specs, 'is_active', m.is_active, 'process_type_id', m.process_type_id,
        'makes_fabric', COALESCE((SELECT t.makes_fabric FROM public.mm_process_types t WHERE t.id = m.process_type_id), false)) ORDER BY m.code)$b$);
  IF position('''process_type_id'', m.process_type_id' in d) = 0 THEN RAISE EXCEPTION 'v4 config patch failed'; END IF;
  EXECUTE d;
END $mig$;
