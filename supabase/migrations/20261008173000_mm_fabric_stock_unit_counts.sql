-- Warehouse stock rows carry rolls/laps counts beside each quantity.
-- unit_form is attached before totals so the counts are real.

CREATE OR REPLACE FUNCTION public._mm_stock_totals(p_rows jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'rolls',          count(*) FILTER (WHERE x->>'bucket' <> 'issued'),
    'rolls_missing_qty', count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'qty' IS NULL AND x->>'uom' <> 'mixed'),
    'on_hand',        COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' <> 'issued'), 0),
    'on_hand_kg',     COALESCE(sum((x->>'qty_kg')::numeric) FILTER (WHERE x->>'bucket' <> 'issued'), 0),
    'on_hand_m',      COALESCE(sum((x->>'qty_m')::numeric) FILTER (WHERE x->>'bucket' <> 'issued'), 0),
    'free',           COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'style_material_id' IS NULL), 0),
    'allocated',      COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'style_material_id' IS NOT NULL), 0),
    'available',      COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'style_material_id' IS NULL), 0),
    'at_mill',        COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'at_mill'), 0),
    'at_processing',  COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'at_processing'), 0),
    'qc_pending',     COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'qc_pending'), 0),
    'on_hold',        COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'on_hold'), 0),
    'rejected',       COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'rejected'), 0),
    'in_stock',       COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'in_stock'), 0),
    'issued',         COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'issued'), 0),
    'on_hand_rolls',  count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'unit_form' = 'roll'),
    'on_hand_laps',   count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'unit_form' = 'lap'),
    'available_rolls', count(*) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'style_material_id' IS NULL AND x->>'unit_form' = 'roll'),
    'available_laps', count(*) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'style_material_id' IS NULL AND x->>'unit_form' = 'lap'),
    'unit_counts', jsonb_build_object(
      'on_hand', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'unit_form' = 'lap')),
      'free', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'style_material_id' IS NULL AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'style_material_id' IS NULL AND x->>'unit_form' = 'lap')),
      'allocated', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'style_material_id' IS NOT NULL AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'style_material_id' IS NOT NULL AND x->>'unit_form' = 'lap')),
      'at_mill', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' = 'at_mill' AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' = 'at_mill' AND x->>'unit_form' = 'lap')),
      'at_processing', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' = 'at_processing' AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' = 'at_processing' AND x->>'unit_form' = 'lap')),
      'qc_pending', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' = 'qc_pending' AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' = 'qc_pending' AND x->>'unit_form' = 'lap')),
      'on_hold', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' = 'on_hold' AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' = 'on_hold' AND x->>'unit_form' = 'lap')),
      'rejected', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' = 'rejected' AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' = 'rejected' AND x->>'unit_form' = 'lap')),
      'in_stock', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'unit_form' = 'lap')),
      'issued', jsonb_build_object(
        'rolls', count(*) FILTER (WHERE x->>'bucket' = 'issued' AND x->>'unit_form' = 'roll'),
        'laps',  count(*) FILTER (WHERE x->>'bucket' = 'issued' AND x->>'unit_form' = 'lap'))
    ),
    'rolls_by_bucket', jsonb_build_object(
       'at_mill',       count(*) FILTER (WHERE x->>'bucket' = 'at_mill'),
       'at_processing', count(*) FILTER (WHERE x->>'bucket' = 'at_processing'),
       'qc_pending',    count(*) FILTER (WHERE x->>'bucket' = 'qc_pending'),
       'on_hold',       count(*) FILTER (WHERE x->>'bucket' = 'on_hold'),
       'rejected',      count(*) FILTER (WHERE x->>'bucket' = 'rejected'),
       'in_stock',      count(*) FILTER (WHERE x->>'bucket' = 'in_stock'),
       'issued',        count(*) FILTER (WHERE x->>'bucket' = 'issued'))
  )
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x;
$$;

CREATE OR REPLACE FUNCTION public.mm_fabric_stock_summary(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_search text := NULLIF(btrim(COALESCE(p_filter->>'search', '')), '');
  v_type uuid;
  v_fabric uuid;
  v_unlinked boolean := COALESCE((p_filter->>'include_unlinked')::boolean, true);
  v_in_stock_only boolean := COALESCE((p_filter->>'only_with_stock')::boolean, false);
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_type := NULLIF(p_filter->>'fabric_type_id', '')::uuid;
    v_fabric := NULLIF(p_filter->>'fabric_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid filter id');
  END;

  RETURN public._mm_ok(jsonb_build_object('groups', COALESCE((
    WITH s AS (
      SELECT rs.roll_id, rs.roll_code, rs.fabric_id, rs.fabric_type_id, rs.side, rs.bucket,
             rs.style_material_id, rs.colour, rs.qty_kg, rs.qty_m, rs.qty, rs.uom,
             rs.stock_unit_id, rs.mill_roll_id, rs.out_line_id,
             to_jsonb(rs) || jsonb_build_object('unit_form', r.unit_form) AS j
      FROM public._mm_roll_stock(v_factory) rs
      JOIN public.mm_rolls r ON r.id = rs.roll_id
    ), grp AS (
      SELECT s.fabric_id,
             CASE WHEN s.fabric_id IS NULL THEN s.fabric_type_id END AS unlinked_type_id,
             jsonb_agg(s.j) AS rows
      FROM s
      WHERE (v_type IS NULL OR s.fabric_type_id = v_type)
        AND (v_fabric IS NULL OR s.fabric_id = v_fabric)
        AND (v_unlinked OR s.fabric_id IS NOT NULL)
      GROUP BY s.fabric_id, CASE WHEN s.fabric_id IS NULL THEN s.fabric_type_id END
    ), col AS (
      SELECT s.fabric_id, CASE WHEN s.fabric_id IS NULL THEN s.fabric_type_id END AS unlinked_type_id,
             COALESCE(s.colour, '') AS colour, jsonb_agg(s.j) AS rows
      FROM s
      GROUP BY 1, 2, 3
    )
    SELECT jsonb_agg(g.obj ORDER BY g.sort_unlinked, g.sort_code)
    FROM (
      SELECT (grp.fabric_id IS NULL) AS sort_unlinked, COALESCE(f.code, 'ZZZ') AS sort_code,
             jsonb_build_object(
               'fabric', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id', f.id, 'code', f.code, 'name', f.name, 'uom', f.uom, 'status', f.status,
                  'composition_text', f.composition_text, 'gsm', f.gsm, 'width_in', f.width_in,
                  'width_form', f.width_form, 'color_method', f.color_method, 'design_ref', f.design_ref,
                  'construction', (SELECT c.name FROM public.mm_fabric_constructions c WHERE c.id = f.construction_id)) END,
               'fabric_type', (SELECT jsonb_build_object('id', t.id, 'name', t.name)
                               FROM public.mm_fabric_types t
                               WHERE t.id = COALESCE(f.fabric_type_id, grp.unlinked_type_id)),
               'unlinked', grp.fabric_id IS NULL,
               'uom', COALESCE(f.uom, 'mixed'),
               'totals', public._mm_stock_totals(grp.rows),
               'colours', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('colour', NULLIF(col.colour, ''), 'totals', public._mm_stock_totals(col.rows))
                                   ORDER BY col.colour)
                  FROM col
                  WHERE col.fabric_id IS NOT DISTINCT FROM grp.fabric_id
                    AND col.unlinked_type_id IS NOT DISTINCT FROM grp.unlinked_type_id), '[]'::jsonb)
             ) AS obj
      FROM grp
      LEFT JOIN public.mm_fabrics f ON f.id = grp.fabric_id
      WHERE (v_search IS NULL
             OR f.code ILIKE '%' || v_search || '%'
             OR f.name ILIKE '%' || v_search || '%'
             OR f.composition_text ILIKE '%' || v_search || '%'
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(grp.rows) x WHERE x->>'colour' ILIKE '%' || v_search || '%'))
        AND (NOT v_in_stock_only OR (public._mm_stock_totals(grp.rows)->>'on_hand')::numeric > 0)
    ) g
  ), '[]'::jsonb)));
END $$;
