-- Login RPCs write to floor_login_attempts, so they cannot be STABLE
-- (STABLE runs in a read-only txn → 25006 on INSERT).

CREATE OR REPLACE FUNCTION public.verify_floor_pin(p_user_id uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF public.floor_login_rate_limited(p_user_id, NULL) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id AND status = 'Active';
  IF NOT FOUND OR v_profile.floor_pin IS NULL
     OR v_profile.floor_pin <> extensions.crypt(p_pin, v_profile.floor_pin) THEN
    PERFORM public.record_floor_login_attempt(p_user_id, NULL, false);
    RETURN NULL;
  END IF;

  IF v_profile.department_id IS NULL THEN
    PERFORM public.record_floor_login_attempt(p_user_id, NULL, false);
    RETURN NULL;
  END IF;

  PERFORM public.record_floor_login_attempt(p_user_id, NULL, true);

  RETURN jsonb_build_object(
    'id', v_profile.id,
    'full_name', v_profile.full_name,
    'user_role', v_profile.user_role,
    'department_id', v_profile.department_id,
    'handover_enabled', COALESCE(v_profile.handover_enabled, false),
    'workforce_enabled', COALESCE(v_profile.workforce_enabled, false),
    'audit_enabled', COALESCE(v_profile.audit_enabled, false),
    'can_produce', COALESCE(v_profile.can_produce, false),
    'shipment_qa_enabled', COALESCE(v_profile.shipment_qa_enabled, false),
    'preferred_resource_ids', COALESCE(v_profile.preferred_resource_ids, '[]'::jsonb),
    'assigned_apps', public.floor_user_derived_apps(p_user_id),
    'assigned_operation_ids', public.floor_user_operation_ids_json(p_user_id),
    'can_log_workforce', public.floor_user_can_log_workforce(p_user_id),
    'factory_id', v_profile.factory_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_floor_login_by_email(p_email text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_pin text := trim(p_pin);
BEGIN
  IF public.floor_login_rate_limited(NULL, p_email) THEN
    RETURN NULL;
  END IF;

  SELECT p.* INTO v_profile
  FROM public.profiles p
  WHERE lower(trim(p.email)) = lower(trim(p_email))
    AND p.status = 'Active'
    AND p.user_role IN ('operator', 'supervisor', 'auditor', 'quality_manager')
  LIMIT 1;

  IF NOT FOUND OR v_profile.floor_pin IS NULL
     OR v_profile.floor_pin <> extensions.crypt(v_pin, v_profile.floor_pin) THEN
    PERFORM public.record_floor_login_attempt(NULL, p_email, false);
    RETURN NULL;
  END IF;

  RETURN public.verify_floor_pin(v_profile.id, v_pin)
         || jsonb_build_object('email', v_profile.email);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_floor_pin(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_floor_login_by_email(text, text) TO anon, authenticated, service_role;
;
