-- Expected receipts and the style fabric page need fabric type and category under the fabric name.
CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 160); END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$             cm.fabric_id, f.code AS fabric_code, f.name AS fabric_name,
             sm.id AS style_material_id$o$,
  $n$             cm.fabric_id, f.code AS fabric_code, f.name AS fabric_name,
             COALESCE(ft.name, NULLIF(btrim(cm.type), '')) AS fabric_type_name,
             CASE
               WHEN lower(btrim(COALESCE(cm.category, ''))) IN ('fabric', 'trim')
                 THEN NULLIF(btrim(cm.extras->>'fabricCategory'), '')
               ELSE COALESCE(NULLIF(btrim(cm.category), ''), NULLIF(btrim(cm.extras->>'fabricCategory'), ''))
             END AS fabric_category,
             sm.id AS style_material_id$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$      LEFT JOIN public.mm_fabrics f ON f.id = cm.fabric_id$o$,
  $n$      LEFT JOIN public.mm_fabrics f ON f.id = cm.fabric_id
      LEFT JOIN public.mm_fabric_types ft ON ft.id = f.fabric_type_id$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$      'fabric', CASE WHEN o.fabric_id IS NULL THEN NULL ELSE jsonb_build_object('id', o.fabric_id, 'code', o.fabric_code, 'name', o.fabric_name) END,$o$,
  $n$      'fabric_type', o.fabric_type_name,
      'fabric_category', o.fabric_category,
      'fabric', CASE WHEN o.fabric_id IS NULL THEN NULL ELSE jsonb_build_object('id', o.fabric_id, 'code', o.fabric_code, 'name', o.fabric_name, 'fabric_type', o.fabric_type_name) END,$n$
);
