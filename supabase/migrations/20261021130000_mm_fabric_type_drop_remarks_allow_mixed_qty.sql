-- Fabric types: drop remarks, and let a type list any qty units (weight and length can mix).
-- 1. mm_save_fabric_type stops reading/writing mm_fabric_types.remarks and stops blocking mixed qty bases.
-- 2. mm_fabric_types.remarks is dropped. Only mm_save_fabric_type referenced it (checked in pg_proc.prosrc).

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

SELECT pg_temp.fx('mm_save_fabric_type',
  $o$-- p_row: {id?, row_version?, name, remarks?, fpt_max_points?, qty_units?: ['m','yd'], width_units?: ['in','cm']}$o$,
  $n$-- p_row: {id?, row_version?, name, fpt_max_points?, qty_units?: ['m','yd'], width_units?: ['in','cm']}$n$);

SELECT pg_temp.fx('mm_save_fabric_type',
  $o$    IF (SELECT count(DISTINCT base) FROM public.mm_units WHERE code = ANY (v_qu)) > 1 THEN
      RETURN public._mm_err('INVALID', 'Qty units must all be weight (KG, LBS…) or all length (MTR, YD…), not both');
    END IF;
$o$,
  $n$$n$);

SELECT pg_temp.fx('mm_save_fabric_type',
  $o$name = v_name, remarks = NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''), is_active = true,$o$,
  $n$name = v_name, is_active = true,$n$);

SELECT pg_temp.fx('mm_save_fabric_type',
  $o$INSERT INTO public.mm_fabric_types (factory_id, name, remarks, fpt_max_points, qty_units, width_units, seq, created_by, updated_by)$o$,
  $n$INSERT INTO public.mm_fabric_types (factory_id, name, fpt_max_points, qty_units, width_units, seq, created_by, updated_by)$n$);

SELECT pg_temp.fx('mm_save_fabric_type',
  $o$VALUES (v_factory, v_name, NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''), v_fpt,$o$,
  $n$VALUES (v_factory, v_name, v_fpt,$n$);

SELECT pg_temp.fx('mm_save_fabric_type',
  $o$    remarks = EXCLUDED.remarks, is_active = true,$o$,
  $n$    is_active = true,$n$);

ALTER TABLE public.mm_fabric_types DROP COLUMN IF EXISTS remarks;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_fabric_types' AND column_name = 'remarks'
  ) THEN
    RAISE EXCEPTION 'mm_fabric_types.remarks still exists';
  END IF;
END $$;
