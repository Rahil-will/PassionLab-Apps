-- Enforce rack/bin capacity on putaway, and expose red-labelled rolls so ops can move them back.

CREATE OR REPLACE FUNCTION public.mm_putaway_rolls(p_unit_ids uuid[], p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_loc public.mm_locations%ROWTYPE;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
  v_on integer := 0;
  v_already integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_location_id IS NULL OR p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls and a target location');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  SELECT * INTO v_loc FROM public.mm_locations WHERE id = p_location_id AND factory_id = v_factory AND is_active;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Location not found'); END IF;
  IF v_loc.location_type NOT IN ('rack', 'bin', 'rejected') THEN
    RETURN public._mm_err('INVALID', 'Choose a rack, bin, or the red-label area');
  END IF;
  IF v_loc.location_type IN ('rack', 'bin') AND NOT v_loc.is_pickable THEN
    RETURN public._mm_err('INVALID', 'That rack or bin is not active');
  END IF;
  IF NOT public._mm_loc_is_under(v_loc.id, v_wh) THEN
    RETURN public._mm_err('INVALID', 'Target must be in the warehouse');
  END IF;

  IF v_loc.location_type IN ('rack', 'bin') AND v_loc.capacity_rolls IS NOT NULL THEN
    SELECT count(*)::int INTO v_on
    FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory AND u.current_location_id = v_loc.id AND u.status = 'in_stock';
    SELECT count(*)::int INTO v_already
    FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory AND u.id = ANY (p_unit_ids) AND u.current_location_id = v_loc.id;
    IF (v_on - v_already + COALESCE(array_length(p_unit_ids, 1), 0)) > v_loc.capacity_rolls THEN
      RETURN public._mm_err(
        'CAPACITY',
        format(
          '%s holds %s of %s rolls. Move rolls off it or raise the limit in Material Management.',
          v_loc.code, v_on, v_loc.capacity_rolls
        )
      );
    END IF;
  END IF;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.status <> 'in_stock' OR v_unit.store_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not available to move');
    END IF;
    IF NOT public._mm_loc_is_under(v_unit.current_location_id, v_wh) THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not in the warehouse');
    END IF;
    UPDATE public.mm_stock_units SET
      current_location_id = v_loc.id,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_loc.id, 'mm_locations', v_loc.id,
      CASE WHEN v_loc.location_type = 'rejected' THEN 'Moved to red label' ELSE 'Rack move' END
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('count', v_n, 'location_id', v_loc.id));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
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
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY o.style_name, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ), '[]'::jsonb),
    'racked_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY loc.code, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ), '[]'::jsonb),
    'red_label_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND loc.location_type = 'rejected'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ), '[]'::jsonb)
  ));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_putaway_rolls(uuid[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_rack_ops_board() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
