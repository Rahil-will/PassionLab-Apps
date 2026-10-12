CREATE OR REPLACE FUNCTION public.mm_save_mill_batch(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid,
  p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_rolls jsonb
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
  v_batch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
  v_date date;
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
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm_id;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, fabric_type_id, batch_no, mill_ref, production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, v_sm_id, v_ft, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''), auth.uid(), auth.uid()
    ) RETURNING id INTO v_batch;
    v_n := public._mm_insert_mill_batch_rolls(v_factory, v_sm_id, v_batch, v_mill, p_rolls);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
    WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
END;
$fn$;;
