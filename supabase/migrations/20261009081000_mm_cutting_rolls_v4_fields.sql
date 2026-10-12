-- Cutting roll list: add v4 fields (roll_id, fabric, stage, unit_form, dye_lot, grade, shade, kg/m, in_cutting_store). Additive; same args.
CREATE OR REPLACE FUNCTION public.mm_list_cutting_rolls(p_order_id uuid, p_colorway_id uuid, p_style_material_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_cut uuid;
  v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_actor IS NULL OR v_factory IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', u.id,
      'unit_code', u.unit_code,
      'roll_no', COALESCE(u.attributes->>'roll_no', u.unit_code),
      'lot_no', u.lot_no,
      'width_in', u.declared_width_in,
      'opening_qty', public._mm_unit_on_hand(u),
      'uom', u.uom,
      'status', u.status,
      'style_material_id', u.style_material_id,
      'color_ref', u.color_ref,
      'is_remnant', u.is_remnant,
      'roll_id', r.id,
      'fabric_id', f.id,
      'fabric_code', f.code,
      'fabric_name', f.name,
      'stage_code', r.stage_code,
      'unit_form', COALESCE(r.unit_form, 'roll'),
      'width_form', r.width_form,
      'dye_lot', COALESCE(r.dye_lot, u.lot_no),
      'grade', r.grade,
      'shade', COALESCE(u.tested_shade, u.shade),
      'shade_band', u.shade_band,
      'qty_kg', CASE WHEN lower(COALESCE(u.uom, '')) IN ('kg', 'kgs') THEN public._mm_unit_on_hand(u) END,
      'qty_m', CASE WHEN lower(COALESCE(u.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN public._mm_unit_on_hand(u) END,
      'in_cutting_store', (u.status = 'in_stock' AND u.current_location_id = v_cut)
    ) ORDER BY COALESCE(r.dye_lot, u.lot_no) NULLS LAST, u.unit_code)
    FROM public.mm_stock_units u
    LEFT JOIN public.mm_rolls r ON r.id = u.roll_id
    LEFT JOIN public.mm_fabrics f ON f.id = r.fabric_id
    WHERE u.factory_id = v_factory
      AND public._mm_unit_on_hand(u) > 0
      AND NOT public._mm_unit_on_hold(u.id)
      AND NOT public._mm_store_line_missing(u.id)
      AND (u.status = 'issued' OR (u.status = 'in_stock' AND u.current_location_id = v_cut))
      AND (
        (p_style_material_id IS NOT NULL AND u.style_material_id = p_style_material_id)
        OR (
          p_style_material_id IS NULL
          AND u.style_material_id IN (
            SELECT sm.id FROM public.mm_style_materials sm
            WHERE sm.factory_id = v_factory
              AND sm.order_id = p_order_id
              AND (p_colorway_id IS NULL OR sm.colorway_id = p_colorway_id)
          )
        )
      )
      AND (
        v_q IS NULL
        OR u.unit_code ILIKE '%' || v_q || '%'
        OR COALESCE(u.attributes->>'roll_no', '') ILIKE '%' || v_q || '%'
        OR COALESCE(u.lot_no, '') ILIKE '%' || v_q || '%'
        OR COALESCE(r.dye_lot, '') ILIKE '%' || v_q || '%'
      )
  ), '[]'::jsonb));
END;
$function$;
