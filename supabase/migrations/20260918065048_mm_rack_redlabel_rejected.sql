CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid; v_wh uuid; v_red uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_red := public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL');
  RETURN public._mm_ok(jsonb_build_object(
    'warehouse_id', v_wh, 'red_label_id', v_red,
    'rack_targets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', loc.id, 'code', loc.code, 'name', loc.name, 'location_type', loc.location_type, 'capacity_rolls', loc.capacity_rolls, 'roll_count', (SELECT count(*) FROM public.mm_stock_units u WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock')) ORDER BY loc.code) FROM public.mm_locations loc WHERE loc.factory_id = v_factory AND loc.is_active AND loc.location_type IN ('rack', 'bin') AND loc.is_pickable AND public._mm_loc_is_under(loc.id, v_wh)), '[]'::jsonb),
    'unassigned_rolls', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source, 'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name, 'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name) ORDER BY o.style_name, u.unit_code) FROM public.mm_stock_units u JOIN public.mm_style_materials sm ON sm.id = u.style_material_id JOIN public.style_orders o ON o.id = sm.order_id JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), '[]'::jsonb),
    'racked_rolls', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source, 'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name, 'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name) ORDER BY loc.code, u.unit_code) FROM public.mm_stock_units u JOIN public.mm_style_materials sm ON sm.id = u.style_material_id JOIN public.style_orders o ON o.id = sm.order_id JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), '[]'::jsonb),
    'red_label_rolls', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source, 'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name, 'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name) ORDER BY u.unit_code) FROM public.mm_stock_units u JOIN public.mm_style_materials sm ON sm.id = u.style_material_id JOIN public.style_orders o ON o.id = sm.order_id JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id WHERE u.factory_id = v_factory AND u.store_challan_id IS NULL AND public._mm_loc_is_under(u.current_location_id, v_wh) AND (u.status = 'rejected' OR loc.location_type = 'rejected')), '[]'::jsonb)
  ));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.mm_get_rack_ops_board() TO authenticated, service_role;
;
