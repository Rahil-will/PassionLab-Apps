-- Mill screens keep mill-declared roll values (mill_snapshot).
-- Warehouse receive no longer overwrites mill qty / test fields.

CREATE OR REPLACE FUNCTION public._mm_mill_length(p_unit public.mm_stock_units)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(p_unit.mill_snapshot->>'length_m', '')), '')::numeric,
    p_unit.length_m
  );
$fn$;

REVOKE ALL ON FUNCTION public._mm_mill_length(public.mm_stock_units) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_mill_length(public.mm_stock_units) TO authenticated, service_role;
;
