-- Dispatch and expected tables need the style line fabric colour, and expected needs roll/lap counts under allocated, booked, and ready.
CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name AND pg_get_function_identity_arguments(p.oid) = CASE p_name WHEN 'mm_get_warehouse_board' THEN 'p_order_ids uuid[]' ELSE 'p_filter jsonb' END;
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 160); END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;

SELECT pg_temp.fx(
  'mm_get_warehouse_board',
  $o$jsonb_build_object('fabric_id', x.fid, 'fabric_code', public._mm_fabric_code(x.fid)) ORDER BY ci)
             FROM jsonb_array_elements(o->'fabrics') WITH ORDINALITY e(c, ci)
             CROSS JOIN LATERAL (SELECT COALESCE(
                 (SELECT cm.fabric_id FROM public.colorway_materials cm WHERE cm.id = public._mm_juuid(c->>'fabric_line_id')),
                 (SELECT sm.fabric_id FROM public.mm_style_materials sm WHERE sm.id = public._mm_juuid(c->>'style_material_id'))) AS fid) x$o$,
  $n$jsonb_build_object('fabric_id', x.fid, 'fabric_code', public._mm_fabric_code(x.fid), 'fabric_color', x.fabric_color) ORDER BY ci)
             FROM jsonb_array_elements(o->'fabrics') WITH ORDINALITY e(c, ci)
             CROSS JOIN LATERAL (SELECT COALESCE(
                 (SELECT cm.fabric_id FROM public.colorway_materials cm WHERE cm.id = public._mm_juuid(c->>'fabric_line_id')),
                 (SELECT sm.fabric_id FROM public.mm_style_materials sm WHERE sm.id = public._mm_juuid(c->>'style_material_id'))) AS fid,
               (SELECT NULLIF(btrim(cm.fabric_color), '') FROM public.colorway_materials cm WHERE cm.id = public._mm_juuid(c->>'fabric_line_id')) AS fabric_color) x$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$COALESCE(NULLIF(btrim(cm.fabric_color), ''), c.name) AS colour,$o$,
  $n$COALESCE(NULLIF(btrim(cm.fabric_color), ''), c.name) AS colour,
             NULLIF(btrim(cm.fabric_color), '') AS fabric_color,$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$'colour', o.colour,$o$,
  $n$'colour', o.colour, 'fabric_color', o.fabric_color,$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$      SELECT l.colorway_material_id AS cmid, count(*)::int AS n,$o$,
  $n$      SELECT l.colorway_material_id AS cmid,
             count(*) FILTER (WHERE COALESCE(r.unit_form, 'roll') <> 'lap')::int AS n,
             count(*) FILTER (WHERE COALESCE(r.unit_form, 'roll') = 'lap')::int AS laps,$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$COALESCE(bk.q, 0) AS booked_qty, COALESCE(bk.n, 0) AS booked_rolls,$o$,
  $n$COALESCE(bk.q, 0) AS booked_qty, COALESCE(bk.n, 0) AS booked_rolls, COALESCE(bk.laps, 0) AS booked_laps,$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$'booked', jsonb_build_object('qty', o.booked_qty, 'rolls', o.booked_rolls),$o$,
  $n$'booked', jsonb_build_object('qty', o.booked_qty, 'rolls', o.booked_rolls, 'laps', o.booked_laps),$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$COALESCE(sum(q.q) FILTER (WHERE q.side = 'warehouse' AND NOT q.is_remnant AND q.bucket = 'in_stock' AND q.can_cut), 0) AS ready_qty,$o$,
  $n$COALESCE(sum(q.q) FILTER (WHERE q.side = 'warehouse' AND NOT q.is_remnant AND q.bucket = 'in_stock' AND q.can_cut), 0) AS ready_qty,
        count(*) FILTER (WHERE q.side = 'warehouse' AND NOT q.is_remnant AND q.bucket = 'in_stock' AND q.can_cut AND q.unit_form = 'roll')::int AS ready_rolls,
        count(*) FILTER (WHERE q.side = 'warehouse' AND NOT q.is_remnant AND q.bucket = 'in_stock' AND q.can_cut AND q.unit_form = 'lap')::int AS ready_laps,$n$
);

SELECT pg_temp.fx(
  'mm_style_fabric_position',
  $o$'in_warehouse', jsonb_build_object('qty', o.wh_qty, 'rolls', o.wh_rolls, 'laps', o.wh_laps, 'ready_to_cut', o.ready_qty),$o$,
  $n$'in_warehouse', jsonb_build_object('qty', o.wh_qty, 'rolls', o.wh_rolls, 'laps', o.wh_laps, 'ready_to_cut', o.ready_qty, 'ready_rolls', o.ready_rolls, 'ready_laps', o.ready_laps),$n$
);
