DO $$
DECLARE
  v_src text;
  v_old text := '    v_values := CASE WHEN jsonb_typeof(v_row->''values'') = ''object'' THEN v_row->''values'' ELSE ''{}''::jsonb END;';
  v_new text := '    v_values := CASE WHEN jsonb_typeof(v_row->''values'') = ''object'' THEN v_row->''values'' ELSE ''{}''::jsonb END;' || chr(10) || '    v_shade := NULLIF(btrim(COALESCE(v_row->>''shade'', v_values->>''shade'', v_unit.shade, '''')), '''');' || chr(10) || '    v_values := v_values - ''shade'';';
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_save_warehouse_inspections(uuid,jsonb)'::regprocedure);
  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  IF v_hits <> 2 THEN RAISE EXCEPTION 'values assign hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_old, v_new);
END;
$$;;
