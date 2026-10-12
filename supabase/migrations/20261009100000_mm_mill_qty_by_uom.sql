-- Mill roll quantity by fabric UOM (2026-10-09).
-- Legacy rule kept: on old screens (Allocate rolls, locked) `length_m` carries the qty in the fabric UOM.
-- New: a roll needs kg OR m (not length only). For kg fabrics, weight_kg is the qty; if only length_m is given it is
-- treated as kg (legacy) and copied to weight_kg so kg totals work everywhere. Dispatch books qty in the fabric UOM.

CREATE OR REPLACE FUNCTION public._mm_mill_batch_uom(p_batch uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT lower(COALESCE(
    (SELECT f.uom FROM public.mm_mill_batches b JOIN public.mm_fabrics f ON f.id = b.fabric_id WHERE b.id = p_batch),
    (SELECT NULLIF(trim(cm.unit), '') FROM public.mm_mill_batches b
       JOIN public.mm_style_materials sm ON sm.id = b.style_material_id
       JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id WHERE b.id = p_batch),
    'm'))
$function$;

DO $mig$
DECLARE d text;
BEGIN
  -- 1. insert rolls: kg or m required; legacy kg qty copied to weight
  d := pg_get_functiondef('public._mm_insert_mill_batch_rolls(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
  IF position('Each roll needs length' in d) = 0 THEN RAISE EXCEPTION 'insert fn changed'; END IF;
  d := replace(d,
    $a$    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;$a$,
    $b$    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    IF COALESCE(v_len, 0) <= 0 AND COALESCE(v_wt, 0) <= 0 THEN RAISE EXCEPTION 'Each roll needs a quantity (kg or m)'; END IF;
    IF v_len IS NOT NULL AND v_len <= 0 THEN v_len := NULL; END IF;
    IF v_wt IS NOT NULL AND v_wt <= 0 THEN v_wt := NULL; END IF;
    IF v_wt IS NULL AND public._mm_mill_batch_uom(p_batch) IN ('kg', 'kgs') THEN v_wt := v_len; END IF;$b$);
  IF position('Each roll needs a quantity' in d) = 0 THEN RAISE EXCEPTION 'insert replace failed'; END IF;
  EXECUTE d;

  -- 2. update batch: same rule
  d := pg_get_functiondef('public.mm_update_mill_batch(uuid,text,text,date,text,jsonb,integer,text,text,boolean)'::regprocedure);
  d := replace(d,
    $a$    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN
      RETURN public._mm_err('INVALID', 'Each roll needs quantity greater than 0');
    END IF;$a$,
    $b$    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF COALESCE(v_len, 0) <= 0 AND COALESCE(NULLIF(v_row->>'weight_kg', '')::numeric, 0) <= 0 THEN
      RETURN public._mm_err('INVALID', 'Each roll needs quantity greater than 0');
    END IF;
    IF v_len IS NOT NULL AND v_len <= 0 THEN v_len := NULL; END IF;$b$);
  d := replace(d,
    $a$    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');$a$,
    $b$    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    IF v_wt IS NOT NULL AND v_wt <= 0 THEN v_wt := NULL; END IF;
    IF v_wt IS NULL AND public._mm_mill_batch_uom(v_batch.id) IN ('kg', 'kgs') THEN v_wt := v_len; END IF;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');$b$);
  IF position('_mm_mill_batch_uom(v_batch.id)' in d) = 0 OR position('COALESCE(v_len, 0) <= 0' in d) = 0 THEN RAISE EXCEPTION 'update replace failed'; END IF;
  EXECUTE d;

  -- 3. dispatch: UOM from the batch fabric first; qty in that UOM
  d := pg_get_functiondef('public.mm_dispatch_mill_rolls(uuid[],text,text,text,date,text)'::regprocedure);
  d := replace(d,
    $a$  SELECT COALESCE(
    (
      SELECT NULLIF(trim(u.uom), '')$a$,
    $b$  SELECT COALESCE(
    (
      SELECT public._mm_mill_batch_uom(r.mill_batch_id) FROM public.mm_mill_rolls r
      JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      WHERE r.id = p_unit_ids[1] AND (b.fabric_id IS NOT NULL OR b.style_material_id IS NOT NULL)
    ),
    (
      SELECT NULLIF(trim(u.uom), '')$b$);
  d := replace(d, $a$        v_uom, v_roll.length_m, v_roll.length_m, 0,$a$,
    $b$        v_uom,
        CASE WHEN lower(v_uom) IN ('kg', 'kgs') THEN COALESCE(v_roll.weight_kg, v_roll.length_m) ELSE COALESCE(v_roll.length_m, v_roll.weight_kg) END,
        CASE WHEN lower(v_uom) IN ('kg', 'kgs') THEN COALESCE(v_roll.weight_kg, v_roll.length_m) ELSE COALESCE(v_roll.length_m, v_roll.weight_kg) END,
        0,$b$);
  d := replace(d, $a$'RECEIPT_IN', v_roll.length_m,$a$,
    $b$'RECEIPT_IN', CASE WHEN lower(v_uom) IN ('kg', 'kgs') THEN COALESCE(v_roll.weight_kg, v_roll.length_m) ELSE COALESCE(v_roll.length_m, v_roll.weight_kg) END,$b$);
  IF position('_mm_mill_batch_uom(r.mill_batch_id)' in d) = 0 OR position($x$'RECEIPT_IN', CASE$x$ in d) = 0
     OR (length(d) - length(replace(d, 'THEN COALESCE(v_roll.weight_kg, v_roll.length_m)', ''))) / length('THEN COALESCE(v_roll.weight_kg, v_roll.length_m)') < 3 THEN
    RAISE EXCEPTION 'dispatch replace failed';
  END IF;
  EXECUTE d;
END $mig$;

-- 4. Data fix: kg mill rows with qty only in length_m get it as weight too.
UPDATE public.mm_mill_rolls r SET weight_kg = r.length_m
WHERE r.weight_kg IS NULL AND r.length_m > 0 AND public._mm_mill_batch_uom(r.mill_batch_id) IN ('kg', 'kgs');
UPDATE public.mm_stock_units u SET weight_kg = u.length_m
WHERE u.source = 'mill' AND u.weight_kg IS NULL AND u.length_m > 0 AND lower(COALESCE(u.qty_uom, u.uom, '')) IN ('kg', 'kgs');
