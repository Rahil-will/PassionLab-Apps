-- =============================================================================
-- save_factory_user RPC
-- Atomic insert/update/delete for factory users (profiles + floor_user_access).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_factory_user(
  p_action                  text,
  p_factory_id              uuid,
  p_id                      uuid DEFAULT NULL,
  p_full_name               text DEFAULT NULL,
  p_email                   text DEFAULT NULL,
  p_floor_pin               text DEFAULT NULL,
  p_department_id           uuid DEFAULT NULL,
  p_user_role               text DEFAULT NULL,
  p_status                  text DEFAULT NULL,
  p_assigned_apps           jsonb DEFAULT NULL,
  p_assigned_operation_ids  jsonb DEFAULT NULL,
  p_can_produce             boolean DEFAULT NULL,
  p_handover_enabled        boolean DEFAULT NULL,
  p_workforce_enabled       boolean DEFAULT NULL,
  p_audit_enabled           boolean DEFAULT NULL,
  p_shipment_qa_enabled     boolean DEFAULT NULL,
  p_preferred_resource_ids  jsonb DEFAULT NULL
)
RETURNS TABLE (
  id                    uuid,
  factory_id            uuid,
  full_name             text,
  email                 text,
  user_role             text,
  floor_pin             text,
  status                text,
  created_at            timestamptz,
  updated_at            timestamptz,
  department_id         uuid,
  can_produce           boolean,
  handover_enabled      boolean,
  workforce_enabled     boolean,
  audit_enabled         boolean,
  shipment_qa_enabled   boolean,
  preferred_resource_ids jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
  v_email      text;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for delete'; END IF;
    DELETE FROM auth.users
    WHERE id IN (
      SELECT id FROM public.profiles WHERE id = v_id AND factory_id = v_factory_id
    );
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_action = 'insert' THEN
    v_id := public.create_factory_floor_user(
      v_factory_id,
      p_full_name,
      p_email,
      p_floor_pin,
      p_department_id,
      p_user_role,
      p_assigned_apps,
      p_assigned_operation_ids,
      COALESCE(p_workforce_enabled, false),
      p_status
    );

    UPDATE public.profiles SET
      can_produce           = COALESCE(p_can_produce, can_produce),
      handover_enabled      = COALESCE(p_handover_enabled, handover_enabled),
      workforce_enabled     = COALESCE(p_workforce_enabled, workforce_enabled),
      audit_enabled         = COALESCE(p_audit_enabled, audit_enabled),
      shipment_qa_enabled   = COALESCE(p_shipment_qa_enabled, shipment_qa_enabled),
      preferred_resource_ids = COALESCE(p_preferred_resource_ids, preferred_resource_ids)
    WHERE id = v_id;
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    v_email := lower(trim(p_email));

    UPDATE public.profiles SET
      full_name              = COALESCE(p_full_name, full_name),
      email                  = COALESCE(v_email, email),
      user_role              = COALESCE(p_user_role, user_role),
      department_id          = COALESCE(p_department_id, department_id),
      status                 = COALESCE(p_status, status),
      floor_pin              = COALESCE(public.hash_floor_pin(p_floor_pin), floor_pin),
      assigned_apps          = COALESCE(p_assigned_apps, assigned_apps),
      assigned_operation_ids = COALESCE(p_assigned_operation_ids, assigned_operation_ids),
      can_produce            = COALESCE(p_can_produce, can_produce),
      handover_enabled       = COALESCE(p_handover_enabled, handover_enabled),
      workforce_enabled      = COALESCE(p_workforce_enabled, workforce_enabled),
      audit_enabled          = COALESCE(p_audit_enabled, audit_enabled),
      shipment_qa_enabled    = COALESCE(p_shipment_qa_enabled, shipment_qa_enabled),
      preferred_resource_ids = COALESCE(p_preferred_resource_ids, preferred_resource_ids),
      updated_at             = now()
    WHERE id = v_id AND factory_id = v_factory_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;

    -- Keep auth identity in sync when email changes
    IF p_email IS NOT NULL AND v_email <> '' THEN
      UPDATE auth.users SET email = v_email, updated_at = now() WHERE id = v_id;
      UPDATE auth.identities
        SET identity_data = jsonb_build_object('sub', v_id::text, 'email', v_email),
            updated_at = now()
      WHERE user_id = v_id;
    END IF;

    -- Reconcile canonical floor_user_access if operation ids supplied
    IF p_assigned_operation_ids IS NOT NULL THEN
      PERFORM public.replace_floor_user_access(
        v_id,
        COALESCE(p_department_id, (SELECT department_id FROM public.profiles WHERE id = v_id)),
        COALESCE(p_handover_enabled, (SELECT handover_enabled FROM public.profiles WHERE id = v_id)),
        COALESCE(p_workforce_enabled, (SELECT workforce_enabled FROM public.profiles WHERE id = v_id)),
        COALESCE(p_audit_enabled, (SELECT audit_enabled FROM public.profiles WHERE id = v_id)),
        p_assigned_operation_ids,
        COALESCE(p_shipment_qa_enabled, (SELECT shipment_qa_enabled FROM public.profiles WHERE id = v_id))
      );
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM public.profiles WHERE id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_factory_user(text, uuid, uuid, text, text, text, uuid, text, text, jsonb, jsonb, boolean, boolean, boolean, boolean, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_factory_user(text, uuid, uuid, text, text, text, uuid, text, text, jsonb, jsonb, boolean, boolean, boolean, boolean, boolean, jsonb) TO authenticated;
