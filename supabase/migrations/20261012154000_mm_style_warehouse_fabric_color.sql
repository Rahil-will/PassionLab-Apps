-- Style warehouse fabric rows include the fabric line colour.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_get_style_warehouse(uuid)'::regprocedure);
  IF position('AS fabric_color' in d) > 0 THEN
    RETURN;
  END IF;
  d := replace(
    d,
    'cw.name AS color_name, sm.id AS style_material_id,',
    'cw.name AS color_name, NULLIF(btrim(cm.fabric_color), '''') AS fabric_color, sm.id AS style_material_id,'
  );
  IF position('AS fabric_color' in d) = 0 THEN
    RAISE EXCEPTION 'style warehouse fabric colour replace failed';
  END IF;
  EXECUTE d;
END $mig$;
