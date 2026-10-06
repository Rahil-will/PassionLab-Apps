DO $$
DECLARE
  v_src text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_save_warehouse_inspections(uuid,jsonb)'::regprocedure);

  v_old := 'factory_id, in_challan_id, stock_unit_id, result, field_values, remarks,';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'insp insert cols hits %', v_hits; END IF;
  v_src := replace(v_src, v_old, 'factory_id, in_challan_id, stock_unit_id, result, field_values, remarks, shade,');

  v_old := '        NULLIF(btrim(COALESCE(v_row->>''remarks'', '''')), ''''),' || chr(10) || '        v_measured, v_width, v_width_uom,';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'insp insert vals hits %', v_hits; END IF;
  v_src := replace(v_src, v_old, '        NULLIF(btrim(COALESCE(v_row->>''remarks'', '''')), ''''),' || chr(10) || '        v_shade,' || chr(10) || '        v_measured, v_width, v_width_uom,');

  v_old := '    UPDATE public.mm_stock_units SET' || chr(10) || '      qc_result = v_final,' || chr(10) || '      status = v_new_status,';
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'unit update hits %', v_hits; END IF;
  v_src := replace(v_src, v_old, '    UPDATE public.mm_stock_units SET' || chr(10) || '      qc_result = v_final,' || chr(10) || '      tested_shade = COALESCE(v_shade, tested_shade),' || chr(10) || '      tested_shade_at = CASE WHEN v_shade IS NULL THEN tested_shade_at ELSE now() END,' || chr(10) || '      tested_shade_by = CASE WHEN v_shade IS NULL THEN tested_shade_by ELSE public._mm_actor_id() END,' || chr(10) || '      status = v_new_status,');

  EXECUTE v_src;
END;
$$;;
