-- Stock list returns the hold flag. Style warehouse returns how much was sent back.
-- Edited from live pg_get_functiondef. Shade band is not part of this change.

DO $mm$
DECLARE
  v_def text;
  v_next text;
  v_hits int;
  v_anchor text;
BEGIN
  IF (
    SELECT count(*)
    FROM pg_proc
    WHERE proname = 'mm_list_warehouse_stock'
      AND pronamespace = 'public'::regnamespace
  ) <> 1 THEN
    RAISE EXCEPTION 'mm_list_warehouse_stock count is not 1';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_warehouse_stock';

  IF position('u.on_hold' IN v_def) > 0 THEN
    RAISE EXCEPTION 'stock list already returns on_hold';
  END IF;

  v_anchor := 'u.lot_no,';
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'stock u.lot_no hits %', v_hits;
  END IF;
  v_anchor := '''lot_no'', s.lot_no,';
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'stock json lot_no hits %', v_hits;
  END IF;

  v_next := replace(
    v_def,
    'u.lot_no,',
    E'u.lot_no,\n        u.on_hold,\n        u.hold_reason,'
  );
  v_next := replace(
    v_next,
    '''lot_no'', s.lot_no,',
    E'''lot_no'', s.lot_no,\n          ''on_hold'', s.on_hold,\n          ''hold_reason'', s.hold_reason,'
  );
  IF position('u.on_hold' IN v_next) = 0 OR position('''on_hold''' IN v_next) = 0 THEN
    RAISE EXCEPTION 'stock list hold fields missing after replace';
  END IF;
  EXECUTE v_next;

  IF (
    SELECT count(*)
    FROM pg_proc
    WHERE proname = 'mm_get_style_warehouse'
      AND pronamespace = 'public'::regnamespace
  ) <> 1 THEN
    RAISE EXCEPTION 'mm_get_style_warehouse count is not 1';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_style_warehouse';

  IF position('qty_returned' IN v_def) > 0 THEN
    RAISE EXCEPTION 'style warehouse already returns qty_returned';
  END IF;

  v_anchor := 'AND u.status = ''issued''), 0) AS qty_issued';
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 2 THEN
    RAISE EXCEPTION 'style qty_issued hits %', v_hits;
  END IF;

  v_next := replace(
    v_def,
    v_anchor,
    v_anchor || E',\n'
      || 'COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = ''returned_to_supplier''), 0) AS rolls_returned,'
      || E'\n'
      || 'COALESCE((SELECT sum(COALESCE(u.qty_received, u.length_m)) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = ''returned_to_supplier''), 0) AS qty_returned'
  );
  IF position('qty_returned' IN v_next) = 0 THEN
    RAISE EXCEPTION 'style returned qty missing after replace';
  END IF;
  EXECUTE v_next;
END
$mm$;

NOTIFY pgrst, 'reload schema';
