COMMENT ON COLUMN public.mm_mill_rolls.qc_result IS
  'Current mill 4-point for this roll. Cleared when the roll returns from process.';
COMMENT ON COLUMN public.mm_warehouse_inspections.scope_kind IS
  'Work unit for this 4-point: mill_batch, in_challan, or process_challan.';

CREATE OR REPLACE FUNCTION public._mm_fpt_threshold(p_unit_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ft uuid;
  v_buyer uuid;
  v_points numeric;
BEGIN
  SELECT u.factory_id, COALESCE(u.fabric_type_id, sm.fabric_type_id), o.buyer_id
    INTO v_factory, v_ft, v_buyer
  FROM public.mm_stock_units u
  LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  WHERE u.id = p_unit_id;
  IF v_factory IS NULL THEN
    SELECT r.factory_id, r.fabric_type_id, o.buyer_id
      INTO v_factory, v_ft, v_buyer
    FROM public.mm_mill_rolls r
    LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
    LEFT JOIN public.style_orders o ON o.id = sm.order_id
    WHERE r.id = p_unit_id;
  END IF;
  SELECT t.max_points INTO v_points
  FROM public.mm_fpt_thresholds t
  WHERE t.factory_id = v_factory AND t.fabric_type_id = v_ft AND t.buyer_id = v_buyer;
  IF v_points IS NULL THEN
    SELECT f.fpt_max_points INTO v_points FROM public.mm_fabric_types f WHERE f.id = v_ft;
  END IF;
  RETURN COALESCE(v_points, 40);
END;
$function$;

CREATE OR REPLACE FUNCTION public._mm_mill_inspect_stale(p_mill_roll_id uuid, p_inspected_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.mm_process_return_lines r
    JOIN public.mm_process_challans c ON c.id = r.challan_id
    WHERE r.mill_roll_id = p_mill_roll_id
      AND COALESCE(c.returned_at, r.created_at) > p_inspected_at
  );
$function$;
;
