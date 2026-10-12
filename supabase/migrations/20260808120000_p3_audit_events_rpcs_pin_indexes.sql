-- P3 schema completion (skip company/HQ layer):
-- audit_events, PIN rate-limiting, performance indexes, admin save RPCs.

-- ---------------------------------------------------------------------------
-- audit_events (factory-scoped admin mutations)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_factory_created
  ON public.audit_events (factory_id, created_at DESC);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_select ON public.audit_events;
CREATE POLICY audit_events_select ON public.audit_events
  FOR SELECT TO authenticated
  USING (factory_id = current_factory_id() AND is_factory_admin());
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_factory_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF p_factory_id IS NULL OR p_action IS NULL OR p_entity_type IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.audit_events (factory_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_factory_id,
    auth.uid(),
    p_action,
    p_entity_type,
    p_entity_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;
-- ---------------------------------------------------------------------------
-- PIN rate-limiting (5 failures / 15 minutes per user or email)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.floor_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  email text,
  success boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_floor_login_attempts_profile_time
  ON public.floor_login_attempts (profile_id, attempted_at DESC)
  WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_floor_login_attempts_email_time
  ON public.floor_login_attempts (lower(email), attempted_at DESC)
  WHERE email IS NOT NULL;
ALTER TABLE public.floor_login_attempts ENABLE ROW LEVEL SECURITY;
-- No client policies — SECURITY DEFINER RPCs only.

CREATE OR REPLACE FUNCTION public.floor_login_rate_limited(
  p_profile_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.floor_login_attempts fla
    WHERE fla.attempted_at > now() - interval '15 minutes'
      AND fla.success = false
      AND (
        (p_profile_id IS NOT NULL AND fla.profile_id = p_profile_id)
        OR (p_email IS NOT NULL AND lower(fla.email) = lower(trim(p_email)))
      )
    GROUP BY COALESCE(fla.profile_id::text, lower(fla.email))
    HAVING count(*) >= 5
  );
$$;
CREATE OR REPLACE FUNCTION public.record_floor_login_attempt(
  p_profile_id uuid,
  p_email text,
  p_success boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  INSERT INTO public.floor_login_attempts (profile_id, email, success)
  VALUES (p_profile_id, NULLIF(lower(trim(p_email)), ''), COALESCE(p_success, false));
END;
$$;
CREATE OR REPLACE FUNCTION public.verify_floor_pin(p_user_id uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_result jsonb;
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
STABLE SECURITY DEFINER
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
-- ---------------------------------------------------------------------------
-- Performance indexes (SCHEMA_BACKLOG G)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_style_orders_factory_status_created
  ON public.style_orders (factory_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_counts_factory_order_date
  ON public.hourly_counts (factory_id, order_id, log_date);
CREATE INDEX IF NOT EXISTS idx_handover_slips_factory_order_sent
  ON public.handover_slips (factory_id, order_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_order_routing_steps_factory_dept
  ON public.order_routing_steps (factory_id, dept_id);
-- ---------------------------------------------------------------------------
-- save_factory_settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_factory_settings(
  p_factory_id uuid,
  p_name text DEFAULT NULL,
  p_code text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_default_shift_id uuid DEFAULT NULL,
  p_transaction_apps jsonb DEFAULT NULL,
  p_production_apps jsonb DEFAULT NULL,
  p_workforce_apps jsonb DEFAULT NULL,
  p_audit_apps jsonb DEFAULT NULL,
  p_shipment_apps jsonb DEFAULT NULL
)
RETURNS public.factories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_row public.factories%ROWTYPE;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  UPDATE public.factories f SET
    name = COALESCE(NULLIF(trim(p_name), ''), f.name),
    code = COALESCE(NULLIF(trim(p_code), ''), f.code),
    country = COALESCE(NULLIF(trim(p_country), ''), f.country),
    timezone = COALESCE(NULLIF(trim(p_timezone), ''), f.timezone),
    default_shift_id = COALESCE(p_default_shift_id, f.default_shift_id),
    transaction_apps = COALESCE(p_transaction_apps, f.transaction_apps),
    production_apps = COALESCE(p_production_apps, f.production_apps),
    workforce_apps = COALESCE(p_workforce_apps, f.workforce_apps),
    audit_apps = COALESCE(p_audit_apps, f.audit_apps),
    shipment_apps = COALESCE(p_shipment_apps, f.shipment_apps),
    updated_at = now()
  WHERE f.id = p_factory_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RAISE EXCEPTION 'Factory not found'; END IF;

  PERFORM public.log_audit_event(p_factory_id, 'update', 'factory', p_factory_id, '{}'::jsonb);
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_factory_settings(uuid, text, text, text, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
-- ---------------------------------------------------------------------------
-- save_fabric_components (batch upsert + soft-delete)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_fabric_components(
  p_factory_id uuid,
  p_origin_department_id uuid,
  p_rows jsonb,
  p_delete_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS SETOF public.fabric_components
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_ids uuid[] := '{}'::uuid[];
  v_now timestamptz := now();
  v_primary_id uuid;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_origin_department_id IS NULL THEN RAISE EXCEPTION 'origin_department_id is required'; END IF;

  IF p_delete_ids IS NOT NULL THEN
    UPDATE public.fabric_components fc
    SET is_active = false, updated_at = v_now
    WHERE fc.factory_id = p_factory_id
      AND fc.id = ANY(p_delete_ids);
  END IF;

  SELECT (elem->>'id')::uuid INTO v_primary_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS elem
  WHERE (elem->>'is_primary')::boolean IS TRUE
    AND COALESCE(elem->>'id', '') !~ '^temp_'
  LIMIT 1;

  IF v_primary_id IS NOT NULL THEN
    UPDATE public.fabric_components fc
    SET is_primary = false, updated_at = v_now
    WHERE fc.factory_id = p_factory_id AND fc.id <> v_primary_id;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    IF COALESCE(v_row->>'id', '') LIKE 'temp_%' OR NULLIF(v_row->>'id', '') IS NULL THEN
      IF (v_row->>'is_primary')::boolean IS TRUE THEN
        UPDATE public.fabric_components fc
        SET is_primary = false, updated_at = v_now
        WHERE fc.factory_id = p_factory_id;
      END IF;
      INSERT INTO public.fabric_components (
        factory_id, department_id, code, fabric_type, remarks, is_primary, is_active, updated_at
      ) VALUES (
        p_factory_id,
        p_origin_department_id,
        COALESCE(NULLIF(trim(v_row->>'code'), ''), 'fabric'),
        trim(v_row->>'fabric_type'),
        NULLIF(trim(v_row->>'remarks'), ''),
        COALESCE((v_row->>'is_primary')::boolean, false),
        true,
        v_now
      )
      RETURNING id INTO v_id;
    ELSE
      v_id := (v_row->>'id')::uuid;
      UPDATE public.fabric_components fc SET
        fabric_type = trim(v_row->>'fabric_type'),
        remarks = NULLIF(trim(v_row->>'remarks'), ''),
        is_primary = COALESCE((v_row->>'is_primary')::boolean, fc.is_primary),
        is_active = true,
        updated_at = v_now
      WHERE fc.id = v_id AND fc.factory_id = p_factory_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Fabric component not found: %', v_id; END IF;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  PERFORM public.log_audit_event(
    p_factory_id, 'upsert', 'fabric_components', NULL,
    jsonb_build_object('saved_ids', to_jsonb(v_ids), 'deleted_ids', to_jsonb(COALESCE(p_delete_ids, '{}'::uuid[])))
  );

  RETURN QUERY
  SELECT fc.*
  FROM public.fabric_components fc
  WHERE fc.factory_id = p_factory_id
    AND fc.is_active = true
  ORDER BY fc.created_at ASC, fc.fabric_type ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_fabric_components(uuid, uuid, jsonb, uuid[]) TO authenticated;
-- ---------------------------------------------------------------------------
-- save_operation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_operation(
  p_action text,
  p_factory_id uuid,
  p_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_step_type text DEFAULT 'produce',
  p_capture_app text DEFAULT NULL
)
RETURNS public.operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_id uuid;
  v_row public.operations%ROWTYPE;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  IF p_action = 'archive' THEN
    IF p_id IS NULL THEN RAISE EXCEPTION 'id is required for archive'; END IF;
    UPDATE public.operations o
    SET is_active = false, updated_at = now()
    WHERE o.id = p_id AND o.factory_id = p_factory_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found'; END IF;
    PERFORM public.log_audit_event(p_factory_id, 'archive', 'operation', p_id, '{}'::jsonb);
    RETURN v_row;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_action = 'insert' THEN
    IF p_department_id IS NULL THEN RAISE EXCEPTION 'department_id is required'; END IF;
    IF p_name IS NULL OR trim(p_name) = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.operations (
      id, factory_id, department_id, name, step_type, capture_app, is_active
    ) VALUES (
      v_id, p_factory_id, p_department_id, trim(p_name),
      COALESCE(NULLIF(trim(p_step_type), ''), 'produce'),
      NULLIF(trim(p_capture_app), ''),
      true
    )
    RETURNING * INTO v_row;
    PERFORM public.log_audit_event(p_factory_id, 'insert', 'operation', v_id, '{}'::jsonb);
    RETURN v_row;
  END IF;

  v_id := p_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
  UPDATE public.operations o SET
    department_id = COALESCE(p_department_id, o.department_id),
    name = COALESCE(NULLIF(trim(p_name), ''), o.name),
    step_type = COALESCE(NULLIF(trim(p_step_type), ''), o.step_type),
    capture_app = COALESCE(NULLIF(trim(p_capture_app), ''), o.capture_app),
    is_active = true,
    updated_at = now()
  WHERE o.id = v_id AND o.factory_id = p_factory_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found'; END IF;
  PERFORM public.log_audit_event(p_factory_id, 'update', 'operation', v_id, '{}'::jsonb);
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_operation(text, uuid, uuid, uuid, text, text, text) TO authenticated;
-- ---------------------------------------------------------------------------
-- save_colorway_planning_remarks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_colorway_planning_remarks(
  p_factory_id uuid,
  p_order_id uuid,
  p_colorway_id uuid,
  p_remarks text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_trimmed text := NULLIF(trim(p_remarks), '');
BEGIN
  IF p_factory_id IS NULL OR p_order_id IS NULL OR p_colorway_id IS NULL THEN
    RAISE EXCEPTION 'factory_id, order_id, and colorway_id are required';
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders so
    WHERE so.id = p_order_id AND so.factory_id = p_factory_id
  ) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  UPDATE public.colorways cw
  SET planning_remarks = v_trimmed, updated_at = now()
  WHERE cw.id = p_colorway_id
    AND cw.order_id = p_order_id
    AND cw.factory_id = p_factory_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Colorway not found'; END IF;

  PERFORM public.log_audit_event(
    p_factory_id, 'update', 'colorway', p_colorway_id,
    jsonb_build_object('order_id', p_order_id, 'field', 'planning_remarks')
  );

  RETURN p_colorway_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.save_colorway_planning_remarks(uuid, uuid, uuid, text) TO authenticated;
