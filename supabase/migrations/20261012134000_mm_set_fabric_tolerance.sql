CREATE OR REPLACE FUNCTION public.mm_set_fabric_tolerance(p_id uuid, p_gsm_tol_pct numeric, p_width_tol_pct numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF p_gsm_tol_pct IS NULL OR p_width_tol_pct IS NULL OR p_gsm_tol_pct < 0 OR p_width_tol_pct < 0 OR p_gsm_tol_pct > 50 OR p_width_tol_pct > 50 THEN
    RETURN public._mm_err('INVALID', 'Tolerance must be between 0 and 50 %');
  END IF;
  UPDATE public.mm_fabrics SET gsm_tol_pct = p_gsm_tol_pct, width_tol_pct = p_width_tol_pct, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id, 'gsm_tol_pct', p_gsm_tol_pct, 'width_tol_pct', p_width_tol_pct));
END $function$;
GRANT EXECUTE ON FUNCTION public.mm_set_fabric_tolerance(uuid, numeric, numeric) TO authenticated;
