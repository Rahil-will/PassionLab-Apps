-- Same-rolls process return: when the out line UOM is kg, the returned qty also updates the roll's weight_kg
-- (before, only an explicit qty_kg did, so kg rolls kept their pre-process weight).
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_proc_return(jsonb)'::regprocedure);
  IF position($a$        weight_kg = COALESCE(NULLIF(v_e->>'qty_kg','')::numeric, weight_kg),$a$ in d) = 0 THEN RAISE EXCEPTION 'pattern not found'; END IF;
  d := replace(d, $a$        weight_kg = COALESCE(NULLIF(v_e->>'qty_kg','')::numeric, weight_kg),$a$,
    $b$        weight_kg = COALESCE(NULLIF(v_e->>'qty_kg','')::numeric, CASE WHEN lower(COALESCE(v_line.uom, '')) IN ('kg', 'kgs') THEN v_qty END, weight_kg),$b$);
  EXECUTE d;
END $mig$;
