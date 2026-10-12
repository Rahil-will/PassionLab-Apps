DO $mm$
DECLARE
  v_def text;
  v_next text;
  v_hits integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'shade_band'
  ) THEN
    RAISE EXCEPTION 'shade_band column missing';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_style_warehouse';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_style_warehouse missing';
  END IF;
  IF position('u.shade_band' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''shade'',\s*u\.shade,\s*''lot_no'',\s*u\.lot_no,',
      '''shade'', u.shade, ''shade_band'', u.shade_band, ''qty_available'', u.qty_available, ''lot_no'', u.lot_no,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'u.shade_band', ''))) / length('u.shade_band');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'style warehouse shade_band hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_store_challan';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_store_challan missing';
  END IF;
  IF position('u.shade_band' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''shade'',\s*u\.shade,\s*''lot_no'',\s*u\.lot_no,',
      '''shade'', u.shade, ''shade_band'', u.shade_band, ''lot_no'', u.lot_no,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'u.shade_band', ''))) / length('u.shade_band');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'store challan shade_band hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_warehouse_dispatch_board';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_warehouse_dispatch_board missing';
  END IF;
  IF position('u.is_remnant' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''lot_no'',\s*u\.lot_no,\s*''attributes'',\s*u\.attributes,',
      '''lot_no'', u.lot_no, ''is_remnant'', u.is_remnant, ''attributes'', u.attributes,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'u.is_remnant', ''))) / length('u.is_remnant');
    IF v_hits <> 2 THEN
      RAISE EXCEPTION 'dispatch remnant hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_rack_master';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_list_rack_master missing';
  END IF;
  IF position('loc.row_version' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''capacity_rolls'',\s*loc\.capacity_rolls,',
      '''capacity_rolls'', loc.capacity_rolls, ''row_version'', loc.row_version,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'loc.row_version', ''))) / length('loc.row_version');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'rack master row_version hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_mill_line';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_mill_line missing';
  END IF;
  IF position('b.row_version' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''remarks'',\s*b\.remarks,',
      '''remarks'', b.remarks, ''row_version'', b.row_version,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'b.row_version', ''))) / length('b.row_version');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'mill line row_version hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_unallocated_mill';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_unallocated_mill missing';
  END IF;
  IF position('b.row_version' IN v_def) = 0 THEN
    v_next := regexp_replace(
      v_def,
      '''remarks'',\s*b\.remarks,',
      '''remarks'', b.remarks, ''row_version'', b.row_version,',
      'g'
    );
    v_hits := (length(v_next) - length(replace(v_next, 'b.row_version', ''))) / length('b.row_version');
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'unallocated mill row_version hits %', v_hits;
    END IF;
    EXECUTE v_next;
  END IF;
END
$mm$;
;
