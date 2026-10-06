DO $$
DECLARE
  v_src text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_save_warehouse_inspections(uuid,jsonb)'::regprocedure);
  v_hits := (length(v_src) - length(replace(v_src, '  v_insp uuid;', ''))) / length('  v_insp uuid;');
  IF v_hits <> 1 THEN RAISE EXCEPTION 'insp decl hits %', v_hits; END IF;
  v_src := replace(v_src, '  v_insp uuid;', E'  v_insp uuid;\n  v_shade text;');
  EXECUTE v_src;
END;
$$;;
