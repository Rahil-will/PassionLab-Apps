CREATE OR REPLACE FUNCTION public.mm_get_warehouse_dispatch_board(p_order_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'pending', COALESCE((
      SELECT jsonb_agg(g.obj ORDER BY g.sort_name)
      FROM (
        SELECT jsonb_build_object(
          'style_material_id', sm.id,
          'order_id', o.id,
          'style_name', o.style_name,
          'color_name', cw.name,
          'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
          'fabric_type', ft.name,
          'fabric_type_id', ft.id,
          'uom', COALESCE((
            SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id ORDER BY u.created_at LIMIT 1
          ), NULLIF(trim(cm.unit), '')),
          'roll_count', (
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_pickable_loc(u.current_location_id)
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
          ),
          'qty', (
            SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_pickable_loc(u.current_location_id)
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
          ),
          'rolls', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
              'shade', u.shade, 'lot_no', u.lot_no, 'attributes', u.attributes,
              'mill_snapshot', u.mill_snapshot, 'source', u.source,
              'location_code', loc.code, 'location_name', loc.name,
              'fabric_type_id', ft.id
            ) ORDER BY u.unit_code)
            FROM public.mm_stock_units u
            JOIN public.mm_locations loc ON loc.id = u.current_location_id
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_pickable_loc(u.current_location_id)
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
          ), '[]'::jsonb)
        ) AS obj,
        o.style_name || ' ' || cw.name AS sort_name
        FROM public.mm_style_materials sm
        JOIN public.style_orders o ON o.id = sm.order_id
        JOIN public.colorways cw ON cw.id = sm.colorway_id
        JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
        LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
        WHERE sm.factory_id = v_factory
          AND (p_order_id IS NULL OR sm.order_id = p_order_id)
          AND EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_is_pickable_loc(u.current_location_id)
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
          )
      ) g
    ), '[]'::jsonb),
    'completed', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sc.id,
        'challan_no', sc.challan_no,
        'status', sc.status,
        'sent_at', sc.sent_at,
        'reference_no', sc.reference_no,
        'style_material_id', sm.id,
        'order_id', o.id,
        'style_name', o.style_name,
        'color_name', cw.name,
        'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
        'fabric_type', ft.name,
        'fabric_type_id', ft.id,
        'uom', (
          SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
          WHERE u.store_challan_id = sc.id LIMIT 1
        ),
        'roll_count', (SELECT count(*)::int FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id),
        'qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id),
        'rolls', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
            'shade', u.shade, 'lot_no', u.lot_no, 'attributes', u.attributes,
            'mill_snapshot', u.mill_snapshot, 'source', u.source,
            'location_code', loc.code, 'location_name', loc.name,
            'fabric_type_id', ft.id
          ) ORDER BY u.unit_code)
          FROM public.mm_stock_units u
          LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
          WHERE u.store_challan_id = sc.id
        ), '[]'::jsonb)
      ) ORDER BY sc.sent_at DESC NULLS LAST)
      FROM public.mm_store_challans sc
      JOIN public.mm_style_materials sm ON sm.id = sc.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sc.factory_id = v_factory
        AND (p_order_id IS NULL OR sm.order_id = p_order_id)
    ), '[]'::jsonb),
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('type_id', t.type_id, 'fields', t.fields) ORDER BY t.type_id)
      FROM (
        SELECT f.type_id, jsonb_agg(jsonb_build_object(
          'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options
        ) ORDER BY f.seq, f.label) AS fields
        FROM public.mm_type_test_fields f
        WHERE f.factory_id = v_factory AND f.is_active
        GROUP BY f.type_id
      ) t
    ), '[]'::jsonb)
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_get_warehouse_dispatch_board(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dispatch_board(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';;
