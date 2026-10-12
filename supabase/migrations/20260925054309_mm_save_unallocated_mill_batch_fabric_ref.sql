DROP FUNCTION IF EXISTS public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_mill_batch(
  p_fabric_type_id uuid,
  p_batch_no text,
  p_mill_ref text,
  p_production_date date,
  p_remarks text,
  p_color_ref text,
  p_lot_no text,
  p_rolls jsonb,
  p_fabric_ref_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ft uuid;
  v_batch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
  v_date date;
  v_color text;
  v_lot text;
  v_ref_name text;
  v_rolls jsonb;
  v_row jsonb;
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
  SELECT id INTO v_ft FROM public.mm_fabric_types
  WHERE id = p_fabric_type_id AND factory_id = v_factory AND is_active;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  v_color := NULLIF(trim(COALESCE(p_color_ref, '')), '');
  v_lot := NULLIF(trim(COALESCE(p_lot_no, '')), '');
  v_ref_name := NULLIF(trim(COALESCE(p_fabric_ref_name, '')), '');
  v_rolls := '[]'::jsonb;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_rolls := v_rolls || jsonb_build_array(
      v_row || jsonb_build_object(
        'color_ref', COALESCE(NULLIF(trim(COALESCE(v_row->>'color_ref', '')), ''), v_color),
        'lot_no', COALESCE(NULLIF(trim(COALESCE(v_row->>'lot_no', '')), ''), v_lot)
      )
    );
  END LOOP;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_mill := public._mm_loc(v_factory, 'MILL');
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, fabric_type_id, batch_no, mill_ref, fabric_ref_name, color_ref,
      production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, NULL, v_ft, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_ref_name, v_color, v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''),
      public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id INTO v_batch;
    v_n := public._mm_insert_mill_batch_rolls(v_factory, NULL, v_batch, v_mill, v_rolls);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
    WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb, text) TO authenticated, service_role;;
