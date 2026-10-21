-- Checkbox input on fabric testing KPIs, and an optional numeric tolerance.
-- A value above the tolerance is flagged in the testing grid.
BEGIN;

ALTER TABLE public.mm_type_test_fields
  ADD COLUMN IF NOT EXISTS tolerance numeric;

ALTER TABLE public.mm_type_test_fields DROP CONSTRAINT IF EXISTS mm_type_test_fields_data_type_chk;
ALTER TABLE public.mm_type_test_fields
  ADD CONSTRAINT mm_type_test_fields_data_type_chk CHECK (
    data_type = ANY (ARRAY['text'::text, 'number'::text, 'decimal'::text, 'select'::text, 'checkbox'::text])
  );

CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := pg_get_functiondef(v_oid);
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN
    RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 120);
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;

DO $guard$
BEGIN
  IF position('v_tol' in (
    SELECT prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'mm_save_type_test_fields'
  )) > 0 THEN
    RETURN;
  END IF;

  PERFORM pg_temp.fx('mm_save_type_test_fields', $o$  v_options jsonb;
$o$, $n$  v_options jsonb;
  v_tol numeric;
$n$);

  PERFORM pg_temp.fx('mm_save_type_test_fields', $o$    v_options := COALESCE(v_field->'options', '[]'::jsonb);
    IF jsonb_typeof(v_options) IS DISTINCT FROM 'array' THEN v_options := '[]'::jsonb; END IF;
$o$, $n$    v_options := COALESCE(v_field->'options', '[]'::jsonb);
    IF jsonb_typeof(v_options) IS DISTINCT FROM 'array' THEN v_options := '[]'::jsonb; END IF;
    v_tol := NULLIF(v_field->>'tolerance', '')::numeric;
$n$);

  PERFORM pg_temp.fx('mm_save_type_test_fields', $o$data_type = v_data_type, options = v_options,
        seq = v_seq$o$, $n$data_type = v_data_type, options = v_options, tolerance = v_tol,
        seq = v_seq$n$);

  PERFORM pg_temp.fx('mm_save_type_test_fields', $o$options, seq, created_by$o$, $n$options, tolerance, seq, created_by$n$);

  PERFORM pg_temp.fx('mm_save_type_test_fields', $o$v_options, v_seq,$o$, $n$v_options, v_tol, v_seq,$n$);

  PERFORM pg_temp.fx('mm_save_type_test_fields', $o$options = EXCLUDED.options,
        seq = EXCLUDED.seq$o$, $n$options = EXCLUDED.options, tolerance = EXCLUDED.tolerance,
        seq = EXCLUDED.seq$n$);

  PERFORM pg_temp.fx(
    'mm_qc_get_scope',
    $o$'required_at_stages', to_jsonb(f.required_at_stages)$o$,
    $n$'required_at_stages', to_jsonb(f.required_at_stages), 'tolerance', f.tolerance$n$
  );
END $guard$;

COMMIT;
