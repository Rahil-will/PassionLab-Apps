-- On hand and available counts split into rolls and laps. Demand and short stay on the list.

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

CREATE OR REPLACE FUNCTION public.mm_list_fabrics(p_filter jsonb DEFAULT '{}'::jsonb)
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
  v_cons uuid;
  v_status text[];
  v_limit integer := LEAST(GREATEST(COALESCE(public._mm_num(p_filter->>'limit')::integer, 500), 1), 2000);
  v_with_stock boolean := COALESCE((p_filter->>'with_stock')::boolean, false);
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_type := NULLIF(p_filter->>'fabric_type_id', '')::uuid;
    v_cons := NULLIF(p_filter->>'construction_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid filter id');
  END;
  IF jsonb_typeof(p_filter->'status') = 'array' THEN
    SELECT array_agg(x) INTO v_status FROM jsonb_array_elements_text(p_filter->'status') x;
  ELSE
    v_status := ARRAY['active'];
  END IF;
  IF COALESCE((p_filter->>'include_inactive')::boolean, false) THEN
    v_status := array_append(v_status, 'inactive');
  END IF;

  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    WITH st AS (
      SELECT rs.fabric_id,
             jsonb_agg(to_jsonb(rs) || jsonb_build_object('unit_form', r.unit_form)) AS rows
      FROM public._mm_roll_stock(v_factory) rs
      JOIN public.mm_rolls r ON r.id = rs.roll_id
      WHERE v_with_stock AND rs.fabric_id IS NOT NULL
      GROUP BY rs.fabric_id
    )
    SELECT jsonb_agg(r.j ORDER BY r.sort_status, r.code)
    FROM (
      SELECT f.code,
             CASE f.status WHEN 'active' THEN 0 ELSE 1 END AS sort_status,
             (to_jsonb(f) - 'dedupe_key') || jsonb_build_object(
               'fabric_type', jsonb_build_object('id', t.id, 'name', t.name),
               'construction', jsonb_build_object('id', c.id, 'name', c.name),
               'used_on_orders', COALESCE(u.orders, 0),
               'used_on_lines', COALESCE(u.lines, 0),
               'locked', public._mm_fabric_locked(f.id),
               'merged_into', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name)
                               FROM public.mm_fabrics m WHERE m.id = f.merged_into_id),
               'position', jsonb_build_object(
                 'demand', COALESCE(dem.demand, 0),
                 'short', greatest(0,
                   COALESCE(dem.demand, 0)
                   - COALESCE((public._mm_stock_totals(st.rows)->>'in_stock')::numeric, 0))
               )
             ) || CASE WHEN v_with_stock
                       THEN jsonb_build_object('stock', public._mm_stock_totals(st.rows))
                       ELSE '{}'::jsonb END AS j
      FROM public.mm_fabrics f
      JOIN public.mm_fabric_types t ON t.id = f.fabric_type_id
      JOIN public.mm_fabric_constructions c ON c.id = f.construction_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT cm.order_id) AS orders, count(*) AS lines
        FROM public.colorway_materials cm WHERE cm.fabric_id = f.id
      ) u ON true
      LEFT JOIN st ON st.fabric_id = f.id
      LEFT JOIN public._mm_fabric_demand(v_factory) dem ON dem.fabric_id = f.id
      WHERE f.factory_id = v_factory
        AND f.status = ANY (v_status)
        AND (v_type IS NULL OR f.fabric_type_id = v_type)
        AND (v_cons IS NULL OR f.construction_id = v_cons)
        AND (v_search IS NULL
             OR f.code ILIKE '%' || v_search || '%'
             OR f.name ILIKE '%' || v_search || '%'
             OR f.composition_text ILIKE '%' || v_search || '%'
             OR c.name ILIKE '%' || v_search || '%'
             OR COALESCE(f.design_ref, '') ILIKE '%' || v_search || '%'
             OR COALESCE(f.supplier_article_no, '') ILIKE '%' || v_search || '%')
      ORDER BY CASE f.status WHEN 'active' THEN 0 ELSE 1 END, f.code
      LIMIT v_limit
    ) r
  ), '[]'::jsonb),
  'counts', (
    SELECT jsonb_build_object(
      'active', count(*) FILTER (WHERE status = 'active'),
      'pending_review', 0,
      'inactive', count(*) FILTER (WHERE status = 'inactive'))
    FROM public.mm_fabrics WHERE factory_id = v_factory
  ),
  'unlinked_stock', CASE WHEN v_with_stock THEN (
    SELECT public._mm_stock_totals(jsonb_agg(to_jsonb(rs) || jsonb_build_object('unit_form', r.unit_form)))
    FROM public._mm_roll_stock(v_factory) rs
    JOIN public.mm_rolls r ON r.id = rs.roll_id
    WHERE rs.fabric_id IS NULL) END
  ));
END $$;
