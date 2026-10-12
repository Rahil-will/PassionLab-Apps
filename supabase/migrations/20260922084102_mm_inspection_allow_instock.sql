DO $patch$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_save_warehouse_inspections';
  IF position('IS DISTINCT FROM ''in_stock''' in def) = 0 THEN
    def := replace(def,
      'IF v_unit.status IS DISTINCT FROM ''pending_qc'' THEN',
      'IF v_unit.status IS DISTINCT FROM ''pending_qc'' AND v_unit.status IS DISTINCT FROM ''in_stock'' THEN');
    EXECUTE def;
  END IF;
END;
$patch$;;
