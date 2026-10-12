-- Fix unit_form lookup on warehouse stock list.
-- mm_rolls has no stock_unit_id; link is mm_stock_units.roll_id -> mm_rolls.id.

DO $$
DECLARE
  v_src text;
  v_oid oid;
  v_bad text :=
    'COALESCE((SELECT r.unit_form FROM public.mm_rolls r WHERE r.stock_unit_id = u.id ORDER BY r.created_at DESC NULLS LAST LIMIT 1), ''roll'') AS unit_form';
  v_good text :=
    'COALESCE((SELECT r.unit_form FROM public.mm_rolls r WHERE r.id = u.roll_id), ''roll'') AS unit_form';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_warehouse_stock';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mm_list_warehouse_stock not found';
  END IF;

  v_src := pg_get_functiondef(v_oid);
  IF position(v_bad in v_src) = 0 THEN
    -- Already fixed, or unit_form not present yet.
    IF position(v_good in v_src) > 0 OR position('AS unit_form' in v_src) = 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'mm_list_warehouse_stock unit_form join pattern not recognized';
  END IF;

  v_src := replace(v_src, v_bad, v_good);
  EXECUTE v_src;
END;
$$;
