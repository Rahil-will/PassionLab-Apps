CREATE OR REPLACE FUNCTION public.mm_allocate_mill_rolls_to_style(
  p_unit_ids uuid[],
  p_order_id uuid,
  p_colorway_id uuid,
  p_colorway_material_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ft uuid;
  v_uid uuid;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_n integer := 0;
  v_qty numeric := 0;
  v_have numeric := 0;
  v_required numeric := 0;
  v_style text;
  v_batch uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to assign');
  END IF;
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm_id;
  SELECT style_name INTO v_style FROM public.style_orders WHERE id = p_order_id;
  SELECT COALESCE(cm.total_cons, 0) INTO v_required
  FROM public.colorway_materials cm WHERE cm.id = p_colorway_material_id;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_roll.style_material_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'Select only General PO rolls');
    END IF;
    IF v_roll.status IS DISTINCT FROM 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'Assign only rolls still at the mill');
    END IF;
    IF public._mm_mill_at_process(v_roll.id) THEN
      RETURN public._mm_err('AT_PROCESS', 'A selected roll is at a process vendor');
    END IF;
    IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Fabric type must match the style fabric');
    END IF;
    UPDATE public.mm_mill_rolls SET
      style_material_id = v_sm_id,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    WHERE id = v_roll.id;
    v_n := v_n + 1;
    v_qty := v_qty + COALESCE(v_roll.length_m, 0);
  END LOOP;

  FOR v_batch IN
    SELECT DISTINCT mill_batch_id
    FROM public.mm_mill_rolls
    WHERE factory_id = v_factory AND id = ANY (p_unit_ids)
  LOOP
    UPDATE public.mm_mill_batches b SET
      style_material_id = v_sm_id,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    WHERE b.id = v_batch
      AND b.factory_id = v_factory
      AND b.style_material_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.mm_mill_rolls r
        WHERE r.mill_batch_id = b.id AND r.style_material_id IS NULL
      );
  END LOOP;

  SELECT COALESCE(sum(r.length_m), 0) INTO v_have
  FROM public.mm_mill_rolls r
  WHERE r.style_material_id = v_sm_id;

  RETURN public._mm_ok(jsonb_build_object(
    'count', v_n,
    'qty', v_qty,
    'style_material_id', v_sm_id,
    'over_allocated', (v_required > 0 AND v_have > v_required),
    'warnings', CASE
      WHEN v_required > 0 AND v_have > v_required THEN jsonb_build_array('over_required')
      ELSE '[]'::jsonb
    END
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_allocate_mill_rolls_to_style(uuid[], uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_allocate_mill_rolls_to_style(uuid[], uuid, uuid, uuid) TO authenticated, service_role;;
