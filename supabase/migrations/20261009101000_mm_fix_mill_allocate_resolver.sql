-- Fix: mm_allocate_mill_rolls_to_style called public.mm_resolve_style_material (dropped); helper is now _mm_resolve_style_material
-- (same args, same {ok,data:{id}} result). Restores Allocate rolls → From stock. No behaviour change.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_allocate_mill_rolls_to_style(uuid[],uuid,uuid,uuid)'::regprocedure);
  IF position('public.mm_resolve_style_material(' in d) = 0 THEN RAISE EXCEPTION 'pattern not found'; END IF;
  d := replace(d, 'public.mm_resolve_style_material(', 'public._mm_resolve_style_material(');
  EXECUTE d;
END $mig$;
