CREATE OR REPLACE FUNCTION public._mm_unit_alloc_ok(
  p_status text, p_loc uuid, p_store uuid, p_wh uuid, p_cut uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT p_store IS NULL
    AND public._mm_stock_location_bucket(p_status, p_loc, p_wh, p_cut)
      IN ('pending_test', 'receiving', 'rack', 'red_label')
$$;

CREATE OR REPLACE FUNCTION public.mm_allocate_rolls_to_style(
  p_unit_ids uuid[],
  p_order_id uuid,
  p_colorway_id uuid,
  p_colorway_material_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ft uuid;
  v_wh uuid;
  v_cut uuid;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
  v_qty numeric := 0;
  v_have numeric := 0;
  v_required numeric := 0;
  v_style text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to allocate');
  END IF;
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm_id;
  SELECT style_name INTO v_style FROM public.style_orders WHERE id = p_order_id;
  SELECT COALESCE(cm.total_cons, 0) INTO v_required
  FROM public.colorway_materials cm WHERE cm.id = p_colorway_material_id;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.style_material_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'Select only unallocated rolls');
    END IF;
    IF v_unit.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Fabric type must match the style fabric');
    END IF;
    IF NOT public._mm_unit_alloc_ok(v_unit.status, v_unit.current_location_id, v_unit.store_challan_id, v_wh, v_cut) THEN
      RETURN public._mm_err('INVALID', 'Allocate only rolls in warehouse receiving, rack, test, or red label');
    END IF;
    UPDATE public.mm_stock_units SET
      style_material_id = v_sm_id,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = v_sm_id,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_unit.mill_roll_id AND factory_id = v_factory;
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'ALLOCATE', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_style_materials', v_sm_id, 'Allocated to ' || COALESCE(v_style, 'style')
    );
    v_n := v_n + 1;
    v_qty := v_qty + COALESCE(v_unit.length_m, 0);
  END LOOP;

  SELECT COALESCE(sum(u.length_m), 0) INTO v_have
  FROM public.mm_stock_units u
  WHERE u.style_material_id = v_sm_id
    AND (
      u.status = 'pending_qc'
      OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
      OR public._mm_loc_is_under(u.current_location_id, v_cut)
    );

  RETURN public._mm_ok(jsonb_build_object(
    'count', v_n,
    'style_material_id', v_sm_id,
    'over_allocated', (v_have > v_required)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_unallocate_rolls(p_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to unallocate');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.style_material_id IS NULL THEN
      RETURN public._mm_err('INVALID', 'Select only allocated rolls');
    END IF;
    IF NOT public._mm_unit_alloc_ok(v_unit.status, v_unit.current_location_id, v_unit.store_challan_id, v_wh, v_cut) THEN
      RETURN public._mm_err('INVALID', 'Unallocate only rolls still in the warehouse');
    END IF;
    UPDATE public.mm_stock_units SET
      style_material_id = NULL,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = NULL,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_unit.mill_roll_id AND factory_id = v_factory;
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'UNALLOCATE', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_stock_units', v_unit.id, 'Unallocated'
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('count', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_get_expected_board(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_save_unallocated_vendor_grn(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_unallocated_mill() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_unit_alloc_ok(text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_allocate_rolls_to_style(uuid[], uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_unallocate_rolls(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mm_get_expected_board(text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_vendor_grn(uuid, text, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_unallocated_mill() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_allocate_rolls_to_style(uuid[], uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_unallocate_rolls(uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';;
