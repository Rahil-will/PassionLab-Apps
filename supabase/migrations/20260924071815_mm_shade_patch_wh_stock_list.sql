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
  v_src := pg_get_functiondef(v_oid);

  v_old := '        u.shade,' || chr(10) || '        u.lot_no,';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'wh stock select hits %', v_hits; END IF;
  v_src := replace(v_src, v_old, '        u.shade,' || chr(10) || '        u.tested_shade,' || chr(10) || '        u.lot_no,');

  v_old := '            fabric_name, fabric_type, location_code, location_name, challan_no, color_ref, shade, lot_no';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'wh stock search hits %', v_hits; END IF;
  v_src := replace(v_src, v_old, '            fabric_name, fabric_type, location_code, location_name, challan_no, color_ref, shade, tested_shade, lot_no');

  v_old := '          ''shade'', s.shade,' || chr(10) || '          ''lot_no'', s.lot_no,';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'wh stock json hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_old, '          ''shade'', s.shade,' || chr(10) || '          ''tested_shade'', s.tested_shade,' || chr(10) || '          ''lot_no'', s.lot_no,');
END;
$$;;
