DO $$
DECLARE
  v_src text;
  v_oid oid;
  v_name text;
  v_hits integer;
  v_old text := '''shade'', u.shade';
BEGIN
  FOR v_oid, v_name IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'mm_get_in_challan_rolls',
        'mm_get_rack_ops_board',
        'mm_get_store_challan',
        'mm_get_style_warehouse',
        'mm_get_supplier_return',
        'mm_get_warehouse_dispatch_board',
        'mm_list_store_stock'
      )
  LOOP
    v_src := pg_get_functiondef(v_oid);
    IF position('''tested_shade'', u.tested_shade' in v_src) > 0 THEN CONTINUE; END IF;
    v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
    IF v_hits < 1 THEN RAISE EXCEPTION '% shade json hits %', v_name, v_hits; END IF;
    EXECUTE replace(v_src, v_old, '''shade'', u.shade, ''tested_shade'', u.tested_shade');
  END LOOP;
END;
$$;;
