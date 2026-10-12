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
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_mill_stock';
  v_src := pg_get_functiondef(v_oid);

  v_old := '          ''lot_no'', r.lot_no,' || chr(10) || '          ''length_m'', r.length_m,';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'mill stock json hits %', v_hits; END IF;
  v_src := replace(v_src, v_old, '          ''lot_no'', r.lot_no,' || chr(10) || '          ''shade'', r.shade,' || chr(10) || '          ''length_m'', r.length_m,');

  v_old := 'r.unit_code, b.batch_no, ft.name, o.style_name, r.color_ref, r.lot_no';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits < 1 THEN RAISE EXCEPTION 'mill stock search hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_old, 'r.unit_code, b.batch_no, ft.name, o.style_name, r.color_ref, r.lot_no, r.shade');
END;
$$;;
