-- Mill batch list: qty and roll/lap counts per custody side.
-- Fabric on a batch is fixed; the list only reads it.

CREATE OR REPLACE FUNCTION public.mm_mill_list_batches_v4(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb := public._mm_mill_list_batches_v4_base(p_filter);
BEGIN
  IF NOT COALESCE((v->>'ok')::boolean, false) THEN RETURN v; END IF;
  RETURN jsonb_set(v, '{data,rows}', COALESCE((
    SELECT jsonb_agg(
      b || jsonb_build_object(
        'fabric_id', mb.fabric_id,
        'fabric_code', public._mm_fabric_code(mb.fabric_id),
        'fabric_name', fab.name,
        'fabric_uom', fab.uom,
        'buckets', COALESCE(bk.buckets, jsonb_build_object(
          'at_mill', jsonb_build_object('qty', 0, 'rolls', 0, 'laps', 0, 'pieces', 0),
          'at_process', jsonb_build_object('qty', 0, 'rolls', 0, 'laps', 0, 'pieces', 0),
          'dispatched', jsonb_build_object('qty', 0, 'rolls', 0, 'laps', 0, 'pieces', 0)
        ))
      )
      ORDER BY i)
    FROM jsonb_array_elements(v->'data'->'rows') WITH ORDINALITY e(b, i)
    LEFT JOIN public.mm_mill_batches mb ON mb.id = public._mm_juuid(b->>'id')
    LEFT JOIN public.mm_fabrics fab ON fab.id = mb.fabric_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'at_mill', jsonb_build_object(
          'qty', COALESCE(sum(x.qty) FILTER (WHERE x.side = 'mill'), 0),
          'rolls', count(*) FILTER (WHERE x.side = 'mill' AND x.unit_form = 'roll'),
          'laps', count(*) FILTER (WHERE x.side = 'mill' AND x.unit_form = 'lap'),
          'pieces', count(*) FILTER (WHERE x.side = 'mill' AND x.unit_form = 'pieces')),
        'at_process', jsonb_build_object(
          'qty', COALESCE(sum(x.qty) FILTER (WHERE x.side = 'processing'), 0),
          'rolls', count(*) FILTER (WHERE x.side = 'processing' AND x.unit_form = 'roll'),
          'laps', count(*) FILTER (WHERE x.side = 'processing' AND x.unit_form = 'lap'),
          'pieces', count(*) FILTER (WHERE x.side = 'processing' AND x.unit_form = 'pieces')),
        'dispatched', jsonb_build_object(
          'qty', COALESCE(sum(x.qty) FILTER (WHERE x.side = 'dispatched'), 0),
          'rolls', count(*) FILTER (WHERE x.side = 'dispatched' AND x.unit_form = 'roll'),
          'laps', count(*) FILTER (WHERE x.side = 'dispatched' AND x.unit_form = 'lap'),
          'pieces', count(*) FILTER (WHERE x.side = 'dispatched' AND x.unit_form = 'pieces'))
      ) AS buckets
      FROM (
        SELECT
          CASE
            WHEN EXISTS (
              SELECT 1 FROM public.mm_process_out_lines l
              WHERE l.roll_id = r.id AND l.line_status = 'out'
            ) THEN 'processing'
            WHEN mr.status = 'dispatched' OR u.id IS NOT NULL THEN 'dispatched'
            WHEN mr.status = 'draft' THEN 'mill'
            ELSE 'other'
          END AS side,
          COALESCE(r.unit_form, 'roll') AS unit_form,
          CASE
            WHEN lower(COALESCE(fab.uom, 'm')) = 'kg' THEN COALESCE(
              CASE WHEN lower(COALESCE(u.qty_uom, u.uom, '')) = 'kg' THEN u.qty_available END,
              mr.weight_kg, u.weight_kg, 0)
            ELSE COALESCE(
              CASE WHEN lower(COALESCE(u.qty_uom, u.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN u.qty_available END,
              mr.length_m, u.length_m, 0)
          END AS qty
        FROM public.mm_rolls r
        LEFT JOIN LATERAL (
          SELECT m.status, m.weight_kg, m.length_m
          FROM public.mm_mill_rolls m
          WHERE m.roll_id = r.id
          LIMIT 1
        ) mr ON true
        LEFT JOIN LATERAL (
          SELECT s.id, s.qty_available, s.qty_uom, s.uom, s.weight_kg, s.length_m
          FROM public.mm_stock_units s
          WHERE s.roll_id = r.id
          LIMIT 1
        ) u ON true
        WHERE mb.id IS NOT NULL AND r.mill_batch_id = mb.id
      ) x
    ) bk ON true
  ), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.mm_mill_list_batches_v4(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_mill_list_batches_v4(jsonb) TO authenticated, service_role;
