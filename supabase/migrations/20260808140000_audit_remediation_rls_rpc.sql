-- Audit remediation (2026-08-08):
-- floor write role gate, desktop shipment delete RPC, audit/PIN hardening, factories insert lock.

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'user_role', ''),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'user_role', ''),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->'user_metadata'->>'user_role', ''),
    (SELECT p.user_role FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    ''
  );
$$;
CREATE OR REPLACE FUNCTION public.is_floor_data_writer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.current_user_role() IN (
    'operator', 'supervisor', 'auditor', 'quality_manager',
    'admin', 'superadmin'
  );
$$;
CREATE OR REPLACE FUNCTION public.can_desktop_fulfillment_write()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.current_user_role() IN ('admin', 'superadmin', 'quality_manager');
$$;
-- ---------------------------------------------------------------------------
-- Floor capture tables — block desktop viewer direct DML
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_sessions_factory_write ON public.audit_sessions;
CREATE POLICY audit_sessions_factory_write ON public.audit_sessions
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS batch_production_all ON public.batch_production;
DROP POLICY IF EXISTS batch_production_factory_write ON public.batch_production;
CREATE POLICY batch_production_factory_write ON public.batch_production
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS cutting_bundles_factory ON public.cutting_bundles;
CREATE POLICY cutting_bundles_factory ON public.cutting_bundles
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS cutting_lays_factory ON public.cutting_lays;
CREATE POLICY cutting_lays_factory ON public.cutting_lays
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS cutting_session_lots_factory ON public.cutting_session_lots;
CREATE POLICY cutting_session_lots_factory ON public.cutting_session_lots
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS cutting_sessions_factory ON public.cutting_sessions;
CREATE POLICY cutting_sessions_factory ON public.cutting_sessions
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS hourly_counts_factory_write ON public.hourly_counts;
CREATE POLICY hourly_counts_factory_write ON public.hourly_counts
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS inspection_sessions_write ON public.inspection_sessions;
CREATE POLICY inspection_sessions_write ON public.inspection_sessions
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS rejections_factory_write ON public.rejections;
CREATE POLICY rejections_factory_write ON public.rejections
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS shipment_audits_factory_write ON public.shipment_audits;
CREATE POLICY shipment_audits_factory_write ON public.shipment_audits
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
DROP POLICY IF EXISTS workforce_logs_factory_write ON public.workforce_logs;
CREATE POLICY workforce_logs_factory_write ON public.workforce_logs
  FOR ALL TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
-- Shipments: no direct DELETE — desktop uses delete_desktop_shipment RPC
DROP POLICY IF EXISTS shipments_factory_write ON public.shipments;
CREATE POLICY shipments_factory_insert ON public.shipments
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
CREATE POLICY shipments_factory_update ON public.shipments
  FOR UPDATE TO authenticated
  USING (factory_id = current_factory_id() AND public.is_floor_data_writer())
  WITH CHECK (factory_id = current_factory_id() AND public.is_floor_data_writer());
-- ---------------------------------------------------------------------------
-- Master / settings gaps
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS dept_workforce_rates_delete ON public.department_workforce_rates;
CREATE POLICY dept_workforce_rates_delete ON public.department_workforce_rates
  FOR DELETE TO authenticated
  USING (factory_id = current_factory_id() AND public.is_factory_admin());
DROP POLICY IF EXISTS factories_insert ON public.factories;
CREATE POLICY factories_insert ON public.factories
  FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin());
-- ---------------------------------------------------------------------------
-- delete_desktop_shipment (admin / QM — matches canCaptureOnDesktop)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_desktop_shipment(
  p_factory_id uuid,
  p_shipment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_deleted int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated', 'code', 'NOT_AUTHENTICATED');
  END IF;

  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RETURN jsonb_build_object('error', 'Factory mismatch', 'code', 'FACTORY_MISMATCH');
  END IF;

  IF NOT public.can_desktop_fulfillment_write() THEN
    RETURN jsonb_build_object('error', 'Not authorized', 'code', 'NOT_AUTHORIZED');
  END IF;

  IF p_shipment_id IS NULL THEN
    RETURN jsonb_build_object('error', 'shipment_id is required', 'code', 'MISSING_FIELDS');
  END IF;

  DELETE FROM public.shipments s
  WHERE s.id = p_shipment_id
    AND s.factory_id = p_factory_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('error', 'Shipment not found', 'code', 'NOT_FOUND');
  END IF;

  PERFORM public.log_audit_event(
    p_factory_id, 'delete', 'shipment', p_shipment_id, '{}'::jsonb
  );

  RETURN jsonb_build_object('deleted', v_deleted, 'id', p_shipment_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_desktop_shipment(uuid, uuid) TO authenticated;
-- Desktop fulfillment auth — align with canCaptureOnDesktop (include quality_manager)
CREATE OR REPLACE FUNCTION public.log_desktop_shipment(
  p_factory_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_operation_id uuid := NULLIF(p_payload->>'operationId', '')::uuid;
  v_visit_id uuid := NULLIF(p_payload->>'visitId', '')::uuid;
  v_ship_by_size jsonb := COALESCE(p_payload->'shippedQtyBySize', '{}'::jsonb);
  v_size_sum integer;
  v_po text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated', 'code', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT public.can_desktop_fulfillment_write() THEN
    RETURN jsonb_build_object('error', 'Not authorized', 'code', 'NOT_AUTHORIZED');
  END IF;

  IF v_order_id IS NULL OR v_colorway_id IS NULL THEN
    RETURN jsonb_build_object('error', 'orderId and colorwayId are required', 'code', 'MISSING_FIELDS');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = v_order_id AND factory_id = p_factory_id
  ) THEN
    RETURN jsonb_build_object('error', 'Order not found in factory', 'code', 'ORDER_NOT_FOUND');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.colorways
    WHERE id = v_colorway_id AND order_id = v_order_id
  ) THEN
    RETURN jsonb_build_object('error', 'Colorway not found', 'code', 'INVALID_COLORWAY');
  END IF;

  v_operation_id := COALESCE(v_operation_id, public.terminal_route_operation_id(v_order_id));
  IF v_operation_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Order has no routing steps — cannot log shipment',
      'code', 'MISSING_ROUTE'
    );
  END IF;

  IF v_visit_id IS NULL THEN
    SELECT ors.visit_id INTO v_visit_id
    FROM public.order_routing_steps ors
    WHERE ors.id = v_operation_id;
  END IF;

  IF COALESCE((p_payload->>'shippedQty')::integer, 0) <= 0 THEN
    RETURN jsonb_build_object('error', 'shippedQty must be a positive integer', 'code', 'INVALID_QTY');
  END IF;

  IF p_payload->>'shipmentType' IS NULL OR p_payload->>'shipmentType' NOT IN (
    'main', 'partial', 'replacement', 'sample', 'rejection_return'
  ) THEN
    RETURN jsonb_build_object('error', 'Invalid shipment type', 'code', 'INVALID_SHIPMENT_TYPE');
  END IF;

  IF v_ship_by_size <> '{}'::jsonb THEN
    v_size_sum := public.jsonb_sum_int_values(v_ship_by_size);
    IF v_size_sum <> (p_payload->>'shippedQty')::integer THEN
      RETURN jsonb_build_object(
        'error', 'shippedQtyBySize sum must equal shippedQty',
        'code', 'SIZE_TOTAL_MISMATCH',
        'details', jsonb_build_object(
          'shippedQty', (p_payload->>'shippedQty')::integer,
          'sizeSum', v_size_sum
        )
      );
    END IF;
  END IF;

  SELECT po_number INTO v_po
  FROM public.style_orders
  WHERE id = v_order_id AND factory_id = p_factory_id;

  INSERT INTO public.shipments (
    factory_id,
    order_id,
    colorway_id,
    order_route_id,
    visit_id,
    po_number,
    shipped_qty,
    shipped_qty_by_size,
    shipment_date,
    invoice_number,
    awb_number,
    destination,
    shipment_type,
    notes,
    logged_by,
    logged_at
  ) VALUES (
    p_factory_id,
    v_order_id,
    v_colorway_id,
    v_operation_id,
    v_visit_id,
    v_po,
    (p_payload->>'shippedQty')::integer,
    v_ship_by_size,
    COALESCE((p_payload->>'shipmentDate')::date, CURRENT_DATE),
    NULLIF(p_payload->>'invoiceNumber', ''),
    NULLIF(p_payload->>'awbNumber', ''),
    NULLIF(p_payload->>'destination', ''),
    p_payload->>'shipmentType',
    NULLIF(p_payload->>'notes', ''),
    v_user_id,
    COALESCE((p_payload->>'loggedAt')::timestamptz, now())
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'operationId', v_operation_id,
    'visitId', v_visit_id
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.log_desktop_rejection(
  p_factory_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_operation_id uuid := NULLIF(p_payload->>'operationId', '')::uuid;
  v_payload_size text := NULLIF(p_payload->>'size', '');
  v_qty integer := COALESCE((p_payload->>'qty')::integer, 0);
  v_reason_code text := COALESCE(NULLIF(p_payload->>'reasonCode', ''), 'unknown');
  v_reason_detail text := NULLIF(p_payload->>'reasonDetail', '');
  v_stage text := COALESCE(NULLIF(p_payload->>'stage', ''), 'desktop');
  v_rejected_date date := COALESCE((p_payload->>'rejectedDate')::date, CURRENT_DATE);
  v_notes text := NULLIF(p_payload->>'notes', '');
  v_logged_at timestamptz := COALESCE((p_payload->>'loggedAt')::timestamptz, now());
  v_defect_summary jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated', 'code', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT public.can_desktop_fulfillment_write() THEN
    RETURN jsonb_build_object('error', 'Not authorized', 'code', 'NOT_AUTHORIZED');
  END IF;

  IF v_order_id IS NULL OR v_colorway_id IS NULL THEN
    RETURN jsonb_build_object('error', 'orderId and colorwayId are required', 'code', 'MISSING_FIELDS');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = v_order_id AND factory_id = p_factory_id
  ) THEN
    RETURN jsonb_build_object('error', 'Order not found in factory', 'code', 'ORDER_NOT_FOUND');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.colorways
    WHERE id = v_colorway_id AND order_id = v_order_id
  ) THEN
    RETURN jsonb_build_object('error', 'Colorway not found', 'code', 'INVALID_COLORWAY');
  END IF;

  v_operation_id := COALESCE(v_operation_id, public.terminal_route_operation_id(v_order_id));
  IF v_operation_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Order has no routing steps — cannot log rejection',
      'code', 'MISSING_ROUTE'
    );
  END IF;

  IF v_qty <= 0 THEN
    RETURN jsonb_build_object('error', 'qty must be a positive integer', 'code', 'INVALID_QTY');
  END IF;

  v_defect_summary := jsonb_build_object(v_reason_code, v_qty);

  INSERT INTO public.rejections (
    factory_id,
    order_id,
    colorway_id,
    order_route_id,
    size,
    qty,
    reason_code,
    reason_detail,
    defect_summary,
    rejected_qty_by_size,
    image_urls,
    stage,
    rejected_date,
    notes,
    logged_by,
    logged_at
  ) VALUES (
    p_factory_id,
    v_order_id,
    v_colorway_id,
    v_operation_id,
    v_payload_size,
    v_qty,
    v_reason_code,
    v_reason_detail,
    v_defect_summary,
    CASE
      WHEN v_payload_size IS NOT NULL THEN jsonb_build_object(v_payload_size, v_qty)
      ELSE '{}'::jsonb
    END,
    ARRAY[]::text[],
    v_stage,
    v_rejected_date,
    v_notes,
    v_user_id,
    v_logged_at
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'operationId', v_operation_id,
    'inserted', 1
  );
END;
$function$;
-- ---------------------------------------------------------------------------
-- Harden log_audit_event (internal — no client EXECUTE)
-- ---------------------------------------------------------------------------
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
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF p_factory_id IS NULL OR p_action IS NULL OR p_entity_type IS NULL THEN
    RETURN;
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RETURN;
  END IF;
  IF NOT (public.is_factory_admin() OR public.can_desktop_fulfillment_write()) THEN
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
REVOKE ALL ON FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb) FROM PUBLIC;
-- ---------------------------------------------------------------------------
-- PIN rate-limit: avoid double-count on email login path
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.verify_floor_pin(uuid, text);
CREATE OR REPLACE FUNCTION public.verify_floor_pin(
  p_user_id uuid,
  p_pin text,
  p_record_attempt boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
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
    IF p_record_attempt THEN
      PERFORM public.record_floor_login_attempt(p_user_id, NULL, false);
    END IF;
    RETURN NULL;
  END IF;

  IF v_profile.department_id IS NULL THEN
    IF p_record_attempt THEN
      PERFORM public.record_floor_login_attempt(p_user_id, NULL, false);
    END IF;
    RETURN NULL;
  END IF;

  IF p_record_attempt THEN
    PERFORM public.record_floor_login_attempt(p_user_id, NULL, true);
  END IF;

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
VOLATILE SECURITY DEFINER
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

  IF v_profile.department_id IS NULL THEN
    PERFORM public.record_floor_login_attempt(NULL, p_email, false);
    RETURN NULL;
  END IF;

  PERFORM public.record_floor_login_attempt(NULL, p_email, true);

  RETURN public.verify_floor_pin(v_profile.id, v_pin, false)
         || jsonb_build_object('email', v_profile.email);
END;
$function$;
