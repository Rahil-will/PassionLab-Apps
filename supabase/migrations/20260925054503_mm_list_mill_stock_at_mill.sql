CREATE OR REPLACE FUNCTION public.mm_list_mill_stock(
  p_search text DEFAULT NULL::text,
  p_alloc text DEFAULT NULL::text,
  p_place text DEFAULT NULL::text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_search text;
  v_alloc text;
  v_page integer;
  v_size integer;
  v_total integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_search := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_alloc := COALESCE(NULLIF(btrim(COALESCE(p_alloc, '')), ''), '');
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);

  SELECT count(*) INTO v_total
  FROM public.mm_mill_rolls r
  JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
  JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
  WHERE r.factory_id = v_factory
    AND r.status = 'draft'
    AND r.in_challan_id IS NULL
    AND NOT public._mm_mill_at_process(r.id)
    AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
    AND (
      v_search IS NULL
      OR lower(concat_ws(' ', r.unit_code, b.batch_no, b.fabric_ref_name, b.color_ref, ft.name, o.style_name, cm.name, r.color_ref, r.lot_no, r.shade)) LIKE '%' || v_search || '%'
    );

  RETURN public._mm_ok(jsonb_build_object(
    'total', v_total,
    'rows', COALESCE((
      SELECT jsonb_agg(x.obj)
      FROM (
        SELECT jsonb_build_object(
          'id', r.id,
          'unit_code', r.unit_code,
          'mill_batch_id', r.mill_batch_id,
          'batch_no', b.batch_no,
          'fabric_type', ft.name,
          'fabric_ref_name', b.fabric_ref_name,
          'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), b.fabric_ref_name, ft.name),
          'color_ref', COALESCE(r.color_ref, b.color_ref),
          'color_name', cw.name,
          'shade', r.shade,
          'lot_no', r.lot_no,
          'length_m', r.length_m,
          'style_material_id', r.style_material_id,
          'style_name', o.style_name,
          'order_id', sm.order_id,
          'colorway_id', sm.colorway_id,
          'fabric_line_id', sm.colorway_material_id,
          'place', 'at_mill'
        ) AS obj
        FROM public.mm_mill_rolls r
        JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
        JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
        LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
        LEFT JOIN public.style_orders o ON o.id = sm.order_id
        LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
        LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
        WHERE r.factory_id = v_factory
          AND r.status = 'draft'
          AND r.in_challan_id IS NULL
          AND NOT public._mm_mill_at_process(r.id)
          AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
          AND (
            v_search IS NULL
            OR lower(concat_ws(' ', r.unit_code, b.batch_no, b.fabric_ref_name, b.color_ref, ft.name, o.style_name, cm.name, r.color_ref, r.lot_no, r.shade)) LIKE '%' || v_search || '%'
          )
        ORDER BY COALESCE(NULLIF(trim(cm.name), ''), b.fabric_ref_name, ft.name), b.batch_no, r.unit_code
        OFFSET (v_page - 1) * v_size
        LIMIT v_size
      ) x
    ), '[]'::jsonb)
  ));
END;
$function$;;
