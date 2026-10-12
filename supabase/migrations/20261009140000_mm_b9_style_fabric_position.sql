-- B9: mm_style_fabric_position(p_filter) — one row per style × colourway × fabric line (colorway_materials kind Fabric).
-- Required (line total_cons, line UOM) vs allocated rolls by custody (mill / processing / warehouse) and stage,
-- issued to cutting, short. Shared by the mill Style fabrics board and (later) the warehouse.
-- Qty is in the line UOM (kg → roll kg, m → roll m; else the fabric UOM qty).
-- Issued = received qty of non-remnant units issued/consumed (consumed units drop out of _mm_roll_stock).
-- Remnants back in the warehouse are shown separately and not counted as allocated (already counted in issued).

CREATE OR REPLACE FUNCTION public.mm_style_fabric_position(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_search text := NULLIF(btrim(COALESCE(p_filter->>'search', '')), '');
  v_buyer text := NULLIF(btrim(COALESCE(p_filter->>'buyer', '')), '');
  v_status text := NULLIF(p_filter->>'status', '');
  v_only_short boolean := COALESCE((p_filter->>'only_short')::boolean, false);
  v_include_closed boolean := COALESCE((p_filter->>'include_closed')::boolean, false);
  v_fabric uuid;
  v_order uuid;
  v_sm uuid;
  v_cm uuid;
  v_orders uuid[];
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_fabric := NULLIF(p_filter->>'fabric_id', '')::uuid;
    v_order := NULLIF(p_filter->>'order_id', '')::uuid;
    v_sm := NULLIF(p_filter->>'style_material_id', '')::uuid;
    v_cm := NULLIF(p_filter->>'colorway_material_id', '')::uuid;
    IF jsonb_typeof(p_filter->'order_ids') = 'array' THEN
      SELECT array_agg(x::uuid) INTO v_orders FROM jsonb_array_elements_text(p_filter->'order_ids') x;
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid filter id');
  END;
  IF v_status IS NOT NULL AND v_status NOT IN ('not_started', 'partial', 'covered', 'closed') THEN
    RETURN public._mm_err('INVALID', 'status must be not_started, partial, covered or closed');
  END IF;

  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    WITH lines AS (
      SELECT o.id AS order_id, o.style_name, o.style_ref, o.internal_order_no, o.po_number, o.buyer_name, o.status AS order_status,
             c.id AS colorway_id, c.name AS colorway_name, c.completion_status,
             cm.id AS colorway_material_id, cm.name AS line_name, cm.type AS line_type, cm.placement,
             COALESCE(NULLIF(btrim(cm.fabric_color), ''), c.name) AS colour,
             COALESCE(cm.total_cons, 0) AS required,
             CASE WHEN lower(btrim(COALESCE(cm.unit, ''))) IN ('kg', 'kgs') THEN 'kg'
                  WHEN lower(btrim(COALESCE(cm.unit, ''))) IN ('m', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres') THEN 'm'
                  ELSE COALESCE(f.uom, NULLIF(lower(btrim(cm.unit)), '')) END AS uom,
             COALESCE(cm.mill_short_closed, false) AS short_closed,
             cm.fabric_id, f.code AS fabric_code, f.name AS fabric_name,
             sm.id AS style_material_id
      FROM public.style_orders o
      JOIN public.colorways c ON c.order_id = o.id AND c.factory_id = v_factory
      JOIN public.colorway_materials cm ON cm.colorway_id = c.id AND cm.factory_id = v_factory AND cm.kind = 'Fabric'
      LEFT JOIN public.mm_fabrics f ON f.id = cm.fabric_id
      LEFT JOIN LATERAL (
        SELECT s.id FROM public.mm_style_materials s
        WHERE s.factory_id = v_factory AND s.order_id = o.id AND s.colorway_id = c.id AND s.colorway_material_id = cm.id
        ORDER BY s.created_at LIMIT 1) sm ON true
      WHERE o.factory_id = v_factory
        AND (v_orders IS NULL OR o.id = ANY (v_orders))
        AND (v_order IS NULL OR o.id = v_order)
        AND (v_cm IS NULL OR cm.id = v_cm)
        AND (v_sm IS NULL OR sm.id = v_sm)
        AND (v_fabric IS NULL OR cm.fabric_id = v_fabric)
        AND (v_buyer IS NULL OR o.buyer_name ILIKE '%' || v_buyer || '%')
        AND (v_search IS NULL OR o.style_name ILIKE '%' || v_search || '%' OR o.style_ref ILIKE '%' || v_search || '%'
             OR o.po_number ILIKE '%' || v_search || '%' OR o.internal_order_no ILIKE '%' || v_search || '%'
             OR f.code ILIKE '%' || v_search || '%' OR f.name ILIKE '%' || v_search || '%')
    ), stock AS (
      SELECT rs.style_material_id AS sm_id, rs.side, rs.bucket, rs.roll_id,
             COALESCE(su.is_remnant, false) AS is_remnant,
             r.stage_code, COALESCE(st.label, r.stage_code) AS stage_label, COALESCE(st.can_cut, true) AS can_cut, st.seq AS stage_seq,
             COALESCE(r.unit_form, 'roll') AS unit_form,
             rs.qty_kg, rs.qty_m, rs.qty
      FROM public._mm_roll_stock(v_factory) rs
      JOIN public.mm_rolls r ON r.id = rs.roll_id
      LEFT JOIN public.mm_fabric_stages st ON st.factory_id = v_factory AND st.code = r.stage_code
      LEFT JOIN public.mm_stock_units su ON su.id = rs.stock_unit_id
      WHERE rs.style_material_id IN (SELECT style_material_id FROM lines WHERE style_material_id IS NOT NULL)
        AND rs.bucket NOT IN ('rejected', 'issued')
    ), sq AS (
      SELECT s.*, l.colorway_material_id,
             CASE l.uom WHEN 'kg' THEN COALESCE(s.qty_kg, s.qty) WHEN 'm' THEN COALESCE(s.qty_m, s.qty) ELSE s.qty END AS q
      FROM stock s JOIN lines l ON l.style_material_id = s.sm_id
    ), issued AS (
      SELECT u.style_material_id AS sm_id, count(*)::int AS units,
             sum(COALESCE(u.qty_received, u.qty_declared, 0)) AS qty
      FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND NOT COALESCE(u.is_remnant, false)
        AND u.status IN ('issued', 'issued_pending', 'partially_consumed', 'consumed')
        AND u.style_material_id IN (SELECT style_material_id FROM lines WHERE style_material_id IS NOT NULL)
      GROUP BY 1
    ), agg AS (
      SELECT l.colorway_material_id AS cmid,
        COALESCE(sum(q.q) FILTER (WHERE NOT q.is_remnant), 0) AS allocated,
        COALESCE(sum(q.q) FILTER (WHERE q.side = 'mill'), 0) AS mill_qty,
        count(*) FILTER (WHERE q.side = 'mill' AND q.unit_form = 'roll')::int AS mill_rolls,
        count(*) FILTER (WHERE q.side = 'mill' AND q.unit_form = 'lap')::int AS mill_laps,
        COALESCE(sum(q.q) FILTER (WHERE q.side = 'processing'), 0) AS proc_qty,
        count(*) FILTER (WHERE q.side = 'processing' AND q.unit_form = 'roll')::int AS proc_rolls,
        count(*) FILTER (WHERE q.side = 'processing' AND q.unit_form = 'lap')::int AS proc_laps,
        COALESCE(sum(q.q) FILTER (WHERE q.side = 'warehouse' AND NOT q.is_remnant), 0) AS wh_qty,
        count(*) FILTER (WHERE q.side = 'warehouse' AND NOT q.is_remnant AND q.unit_form = 'roll')::int AS wh_rolls,
        count(*) FILTER (WHERE q.side = 'warehouse' AND NOT q.is_remnant AND q.unit_form = 'lap')::int AS wh_laps,
        COALESCE(sum(q.q) FILTER (WHERE q.side = 'warehouse' AND NOT q.is_remnant AND q.bucket = 'in_stock' AND q.can_cut), 0) AS ready_qty,
        COALESCE(sum(q.q) FILTER (WHERE q.side = 'warehouse' AND q.is_remnant), 0) AS remnant_qty,
        count(*) FILTER (WHERE q.side = 'warehouse' AND q.is_remnant)::int AS remnant_units
      FROM lines l LEFT JOIN sq q ON q.colorway_material_id = l.colorway_material_id
      GROUP BY 1
    ), stg AS (
      SELECT q.colorway_material_id,
             jsonb_agg(jsonb_build_object('stage_code', q.stage_code, 'stage_label', q.stage_label, 'can_cut', q.can_cut,
                                          'qty', q.qty_sum, 'rolls', q.n) ORDER BY COALESCE(q.stage_seq, 999), q.stage_code) AS stages
      FROM (SELECT colorway_material_id, stage_code, stage_label, can_cut, stage_seq, sum(q) AS qty_sum, count(*)::int AS n
            FROM sq WHERE NOT is_remnant GROUP BY 1, 2, 3, 4, 5) q
      GROUP BY 1
    ), fin AS (
      SELECT l.*, a.*, COALESCE(i.qty, 0) AS issued_qty, COALESCE(i.units, 0) AS issued_units, COALESCE(sg.stages, '[]'::jsonb) AS stages,
             GREATEST(l.required - a.allocated - COALESCE(i.qty, 0), 0) AS short,
             CASE WHEN l.short_closed OR l.completion_status IN ('closed', 'Closed') THEN 'closed'
                  WHEN a.allocated + COALESCE(i.qty, 0) <= 0 THEN 'not_started'
                  WHEN l.required > 0 AND a.allocated + COALESCE(i.qty, 0) >= l.required THEN 'covered'
                  ELSE 'partial' END AS status
      FROM lines l
      JOIN agg a ON a.cmid = l.colorway_material_id
      LEFT JOIN issued i ON i.sm_id = l.style_material_id
      LEFT JOIN stg sg ON sg.colorway_material_id = l.colorway_material_id
    )
    SELECT jsonb_agg(jsonb_build_object(
      'order_id', o.order_id, 'style_name', o.style_name, 'style_ref', o.style_ref, 'order_no', o.internal_order_no,
      'po_number', o.po_number, 'buyer_name', o.buyer_name, 'order_status', o.order_status,
      'colorway_id', o.colorway_id, 'colorway_name', o.colorway_name, 'colour', o.colour,
      'colorway_material_id', o.colorway_material_id, 'style_material_id', o.style_material_id,
      'line_name', o.line_name, 'line_type', o.line_type, 'placement', o.placement,
      'fabric', CASE WHEN o.fabric_id IS NULL THEN NULL ELSE jsonb_build_object('id', o.fabric_id, 'code', o.fabric_code, 'name', o.fabric_name) END,
      'uom', o.uom,
      'required', o.required,
      'allocated', o.allocated,
      'at_mill', jsonb_build_object('qty', o.mill_qty, 'rolls', o.mill_rolls, 'laps', o.mill_laps),
      'at_processing', jsonb_build_object('qty', o.proc_qty, 'rolls', o.proc_rolls, 'laps', o.proc_laps),
      'in_warehouse', jsonb_build_object('qty', o.wh_qty, 'rolls', o.wh_rolls, 'laps', o.wh_laps, 'ready_to_cut', o.ready_qty),
      'remnants', jsonb_build_object('qty', o.remnant_qty, 'units', o.remnant_units),
      'issued', jsonb_build_object('qty', o.issued_qty, 'units', o.issued_units),
      'stages', o.stages,
      'short', o.short,
      'short_closed', o.short_closed,
      'status', o.status)
      ORDER BY o.style_name, o.colorway_name, o.line_name)
    FROM fin o
    WHERE (v_include_closed OR v_status = 'closed' OR o.status <> 'closed')
      AND (v_status IS NULL OR o.status = v_status)
      AND (NOT v_only_short OR (o.short > 0 AND o.status <> 'closed'))
  ), '[]'::jsonb)));
END $function$;

GRANT EXECUTE ON FUNCTION public.mm_style_fabric_position(jsonb) TO authenticated;
