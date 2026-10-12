CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_red uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_red := public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL');
  RETURN public._mm_ok(jsonb_build_object(
    'warehouse_id', v_wh,
    'red_label_id', v_red,
    'rack_targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id, 'code', loc.code, 'name', loc.name, 'location_type', loc.location_type,
        'capacity_rolls', loc.capacity_rolls,
        'roll_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'
        )
      ) ORDER BY loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('rack', 'bin') AND loc.is_pickable
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb),
    'unassigned_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'uom', u.uom,
        'shade', u.shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY COALESCE(o.style_name, 'Unallocated'), cw.name, ch.challan_no NULLS LAST, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ), '[]'::jsonb),
    'racked_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'uom', u.uom,
        'shade', u.shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY loc.code, COALESCE(o.style_name, 'Unallocated'), cw.name, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ), '[]'::jsonb),
    'red_label_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'uom', u.uom,
        'shade', u.shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'source', u.source,
        'order_id', o.id, 'style_name', COALESCE(o.style_name, 'Unallocated'), 'style_ref', o.style_ref,
        'color_name', cw.name, 'fabric_type', ft.name,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'received_at', COALESCE(ch.received_at, u.created_at),
        'in_challan_id', ch.id, 'challan_no', ch.challan_no,
        'challan_source', ch.source, 'reference_no', ch.reference_no,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans ch ON ch.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND (u.status = 'rejected' OR loc.location_type = 'rejected')
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_putaway_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id, 'code', loc.code, 'name', loc.name, 'location_type', loc.location_type
      ) ORDER BY loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('rack', 'bin')
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'length_m', u.length_m,
        'shade', u.shade,
        'lot_no', u.lot_no,
        'color_ref', u.color_ref,
        'source', u.source,
        'style_name', COALESCE(o.style_name, 'Unallocated'),
        'color_name', cw.name,
        'fabric_type', ft.name,
        'location_code', loc.code,
        'location_name', loc.name
      ) ORDER BY COALESCE(o.style_name, 'Unallocated'), u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND NOT public._mm_is_pickable_loc(u.current_location_id)
    ), '[]'::jsonb)
  ));
END;
$fn$;;
