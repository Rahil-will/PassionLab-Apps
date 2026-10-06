-- Phase 4 remainder. Applied as mm_phase4_mill_missing_flag.
-- Partial receive and short-close already exist. This shows a mill roll on
-- mill stock when its warehouse unit was short-closed as missing.

DO $mm$
DECLARE
  v_def text;
  v_next text;
  v_hits int;
  v_include text := E'(r.status = ''draft'' AND r.in_challan_id IS NULL)\n      OR (c.id IS NOT NULL AND c.status IN (''pending'', ''in_transit''))';
  v_include_page text := E'(r.status = ''draft'' AND r.in_challan_id IS NULL)\n            OR (c.id IS NOT NULL AND c.status IN (''pending'', ''in_transit''))';
  v_place text := E'''place'', CASE\n            WHEN r.status = ''draft'' AND r.in_challan_id IS NULL THEN ''at_mill''\n            ELSE ''in_transit''\n          END';
  v_filter text := E'OR (v_place = ''in_transit'' AND c.id IS NOT NULL AND c.status IN (''pending'', ''in_transit''))';
  v_missing text := E'EXISTS (\n        SELECT 1 FROM public.mm_stock_units u\n        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = ''missing''\n      )';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_mill_stock';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_list_mill_stock missing';
  END IF;
  IF position('missing_wh' IN v_def) > 0 THEN
    RAISE EXCEPTION 'mill stock already flags missing warehouse rolls';
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_include, ''))) / length(v_include);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'include hits %', v_hits;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_include_page, ''))) / length(v_include_page);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'include page hits %', v_hits;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_place, ''))) / length(v_place);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'place hits %', v_hits;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_filter, ''))) / length(v_filter);
  IF v_hits <> 2 THEN
    RAISE EXCEPTION 'filter hits %', v_hits;
  END IF;

  v_next := replace(v_def, v_include, v_include || E'\n      OR ' || v_missing);
  v_next := replace(v_next, v_include_page, v_include_page || E'\n            OR ' || v_missing);
  v_next := replace(
    v_next,
    v_place,
    E'''place'', CASE\n            WHEN ' || v_missing || E' THEN ''missing_wh''\n            WHEN r.status = ''draft'' AND r.in_challan_id IS NULL THEN ''at_mill''\n            ELSE ''in_transit''\n          END'
  );
  v_next := replace(
    v_next,
    v_filter,
    v_filter || E'\n      OR (v_place = ''missing_wh'' AND ' || v_missing || ')'
  );
  EXECUTE v_next;

  IF position('missing_wh' IN (
    SELECT prosrc FROM pg_proc WHERE proname = 'mm_list_mill_stock' AND pronamespace = 'public'::regnamespace
  )) = 0 THEN
    RAISE EXCEPTION 'missing flag did not land';
  END IF;
END
$mm$;

NOTIFY pgrst, 'reload schema';
