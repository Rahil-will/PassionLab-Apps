-- Roll rows carry the latest test's values and remarks, so the testing grid
-- can show what was already entered for a roll instead of starting blank.

CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 120); END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;

SELECT pg_temp.fx('_mm_roll_row',
  $o$'last_test', (SELECT jsonb_build_object('result', t.result, 'origin', t.origin, 'tested_at', t.tested_at)$o$,
  $n$'last_test', (SELECT jsonb_build_object('result', t.result, 'origin', t.origin, 'tested_at', t.tested_at, 'field_values', COALESCE(t.field_values, '{}'::jsonb), 'remarks', t.remarks)$n$);

DO $$
BEGIN
  IF position('field_values' IN pg_get_functiondef('public._mm_roll_row'::regproc)) = 0 THEN
    RAISE EXCEPTION '_mm_roll_row does not carry last test values';
  END IF;
END $$;
