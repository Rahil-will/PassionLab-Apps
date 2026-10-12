CREATE OR REPLACE FUNCTION public.mm_set_mill_short_close(
  p_order_id uuid,
  p_colorway_id uuid,
  p_colorway_material_id uuid,
  p_closed boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_closed boolean;
  v_reason text;
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
  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric are required');
  END IF;
  v_closed := COALESCE(p_closed, false);
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_closed AND v_reason IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A short close needs a reason');
  END IF;
  UPDATE public.colorway_materials cm SET
    mill_short_closed = v_closed,
    mill_short_closed_at = CASE WHEN v_closed THEN now() ELSE NULL END,
    mill_short_closed_by = CASE WHEN v_closed THEN public._mm_actor_id() ELSE NULL END,
    mill_short_closed_reason = CASE WHEN v_closed THEN left(v_reason, 400) ELSE NULL END,
    updated_at = now()
  WHERE cm.id = p_colorway_material_id
    AND cm.factory_id = v_factory
    AND cm.order_id = p_order_id
    AND cm.colorway_id = p_colorway_id;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric line not found');
  END IF;
  RETURN public._mm_ok(jsonb_build_object(
    'mill_short_closed', v_closed,
    'mill_short_closed_reason', CASE WHEN v_closed THEN left(v_reason, 400) ELSE NULL END
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_set_mill_short_close(uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_set_mill_short_close(uuid, uuid, uuid, boolean, text) TO authenticated, service_role;;
