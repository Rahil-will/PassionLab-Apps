-- Composition no longer has to total 100%. Drop the helper that said it must.

DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._mm_fabric_normalize(uuid, jsonb)'::regprocedure);
  d := replace(d,
    $old$  IF abs(v_sum - 100) > 0.01 THEN
    RETURN jsonb_build_object('error', public._mm_err('INVALID', 'Composition must total 100% (now ' || trim_scale(v_sum)::text || '%)'));
  END IF;
$old$, '');
  IF position('Composition must total 100%' in d) > 0 THEN
    RAISE EXCEPTION 'composition total check is still in _mm_fabric_normalize';
  END IF;
  EXECUTE d;

  d := pg_get_functiondef('public._mm_seed_fabric_form_schema(uuid)'::regprocedure);
  d := replace(d, '''Fibres must total 100%.''', 'NULL');
  IF position('Fibres must total 100%' in d) > 0 THEN
    RAISE EXCEPTION 'composition help is still in the form seed';
  END IF;
  EXECUTE d;
END $mig$;

UPDATE public.mm_fabric_form_fields
SET help = NULL, updated_at = now()
WHERE key = 'composition'
  AND help = 'Fibres must total 100%.';
