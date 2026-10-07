-- Expose unit_form (roll|lap|pieces) on warehouse stock list; raise page_size cap to 500.
DO $$
DECLARE
  v_src text;
  v_oid oid;
  v_hits integer;
  v_old text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_warehouse_stock';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'mm_list_warehouse_stock not found';
  END IF;
  v_src := pg_get_functiondef(v_oid);

  -- page_size cap 100 → 500 (stock UI aggregates client-side)
  v_old := 'LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100)';
  IF position(v_old in v_src) > 0 THEN
    v_src := replace(v_src, v_old, 'LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 500)');
  END IF;

  -- Prefer tested_shade-era select list; fall back to shade/lot only
  IF position('u.tested_shade,' in v_src) > 0
     AND position('AS unit_form' in v_src) = 0 THEN
    v_old := '        u.shade,' || chr(10) || '        u.tested_shade,' || chr(10) || '        u.lot_no,';
    v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / greatest(length(v_old), 1);
    IF v_hits = 1 THEN
      v_src := replace(
        v_src,
        v_old,
        '        u.shade,' || chr(10) ||
        '        u.tested_shade,' || chr(10) ||
        '        u.lot_no,' || chr(10) ||
        '        COALESCE((SELECT r.unit_form FROM public.mm_rolls r WHERE r.stock_unit_id = u.id ORDER BY r.created_at DESC NULLS LAST LIMIT 1), ''roll'') AS unit_form,'
      );
    ELSE
      RAISE EXCEPTION 'wh stock unit_form select hits %', v_hits;
    END IF;
  ELSIF position('AS unit_form' in v_src) = 0 THEN
    v_old := '        u.shade,' || chr(10) || '        u.lot_no,';
    v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / greatest(length(v_old), 1);
    IF v_hits = 1 THEN
      v_src := replace(
        v_src,
        v_old,
        '        u.shade,' || chr(10) ||
        '        u.lot_no,' || chr(10) ||
        '        COALESCE((SELECT r.unit_form FROM public.mm_rolls r WHERE r.stock_unit_id = u.id ORDER BY r.created_at DESC NULLS LAST LIMIT 1), ''roll'') AS unit_form,'
      );
    ELSE
      RAISE EXCEPTION 'wh stock unit_form select (no tested_shade) hits %', v_hits;
    END IF;
  END IF;

  IF position('''unit_form'', s.unit_form' in v_src) = 0 THEN
    IF position('''tested_shade'', s.tested_shade' in v_src) > 0 THEN
      v_old := '          ''tested_shade'', s.tested_shade,' || chr(10) || '          ''lot_no'', s.lot_no,';
      v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / greatest(length(v_old), 1);
      IF v_hits <> 1 THEN RAISE EXCEPTION 'wh stock unit_form json hits %', v_hits; END IF;
      v_src := replace(
        v_src,
        v_old,
        '          ''tested_shade'', s.tested_shade,' || chr(10) ||
        '          ''lot_no'', s.lot_no,' || chr(10) ||
        '          ''unit_form'', s.unit_form,'
      );
    ELSE
      v_old := '          ''shade'', s.shade,' || chr(10) || '          ''lot_no'', s.lot_no,';
      v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / greatest(length(v_old), 1);
      IF v_hits <> 1 THEN RAISE EXCEPTION 'wh stock unit_form json (no tested_shade) hits %', v_hits; END IF;
      v_src := replace(
        v_src,
        v_old,
        '          ''shade'', s.shade,' || chr(10) ||
        '          ''lot_no'', s.lot_no,' || chr(10) ||
        '          ''unit_form'', s.unit_form,'
      );
    END IF;
  END IF;

  EXECUTE v_src;
END;
$$;
