-- Desktop factory-scope enforcement (PRODIGI admin SPA):
-- 1. Views: security_invoker so RLS applies; revoke anon SELECT on KPI views
-- 2. log_desktop_shipment / log_desktop_rejection: wrap with current_factory_id() check
-- 3. ensure_factory_fabric_components: factory + admin guards; RAISE on mismatch
-- 4. Revoke EXECUTE on unvalidated / unused client-reachable RPCs
-- 5. Revoke anon EXECUTE on desktop-only save RPCs
--
-- COALESCE(user_role) on profiles_insert_own and multi-primary guard in
-- save_fabric_components already landed in 20260810140000 — not repeated here.
--
-- Audit coverage (15 write RPCs still missing log_audit_event) is a separate pass.

-- ---------------------------------------------------------------------------
-- 1. Views: make RLS apply
-- ---------------------------------------------------------------------------
ALTER VIEW public.v_department_kpis_by_shift SET (security_invoker = on);
ALTER VIEW public.v_department_progress SET (security_invoker = on);
ALTER VIEW public.v_daily_audit SET (security_invoker = on);
ALTER VIEW public.v_daily_quality SET (security_invoker = on);
-- Views have no business being anon-readable
REVOKE SELECT ON
  public.v_cutting_component_progress,
  public.v_daily_production,
  public.v_daily_quality,
  public.v_daily_target,
  public.v_day_floor_board,
  public.v_operation_progress,
  public.v_shift_minutes,
  public.v_shift_workforce_summary
FROM anon;
-- ---------------------------------------------------------------------------
-- 2. Desktop fulfillment: enforce tenant, not just role (rename-and-wrap)
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.log_desktop_shipment(uuid, jsonb)
  RENAME TO log_desktop_shipment_inner;
REVOKE ALL ON FUNCTION public.log_desktop_shipment_inner(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.log_desktop_shipment(p_factory_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RETURN jsonb_build_object('error', 'Factory mismatch', 'code', 'FACTORY_MISMATCH');
  END IF;
  RETURN public.log_desktop_shipment_inner(p_factory_id, p_payload);
END;
$$;
REVOKE ALL ON FUNCTION public.log_desktop_shipment(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_desktop_shipment(uuid, jsonb) TO authenticated;
ALTER FUNCTION public.log_desktop_rejection(uuid, jsonb)
  RENAME TO log_desktop_rejection_inner;
REVOKE ALL ON FUNCTION public.log_desktop_rejection_inner(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.log_desktop_rejection(p_factory_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RETURN jsonb_build_object('error', 'Factory mismatch', 'code', 'FACTORY_MISMATCH');
  END IF;
  RETURN public.log_desktop_rejection_inner(p_factory_id, p_payload);
END;
$$;
REVOKE ALL ON FUNCTION public.log_desktop_rejection(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_desktop_rejection(uuid, jsonb) TO authenticated;
-- ---------------------------------------------------------------------------
-- 3. Fabric seed: guard tenant + role; stop failing silently
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_factory_fabric_components(
  p_factory_id uuid,
  p_origin_department_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_factory_id IS NULL OR p_origin_department_id IS NULL THEN
    RETURN;
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.fabric_components fc WHERE fc.factory_id = p_factory_id
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.fabric_components (
    factory_id, department_id, code, fabric_type, is_primary
  ) VALUES (
    p_factory_id, p_origin_department_id, 'PRIMARY', 'Primary fabric', true
  );

  PERFORM public.log_audit_event(
    p_factory_id, 'insert', 'fabric_components', NULL,
    jsonb_build_object('seed', true, 'origin_department_id', p_origin_department_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_factory_fabric_components(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_factory_fabric_components(uuid, uuid)
  TO authenticated;
-- ---------------------------------------------------------------------------
-- 4. Unvalidated + uncalled: revoke rather than guess at a guard
--    get_department_kpis_by_shift: desktop export fetchDepartmentKpisByShift has
--    zero callers (primary path reads v_department_kpis_by_shift). Re-grant only
--    after adding current_factory_id() validation — see kpiAndProgress.ts comment.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_department_kpis_by_shift(uuid, uuid, date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_factory_app_configuration(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_factory_native_departments(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_internal_order_no(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_colorway_ready_to_ship_rpc(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
-- ---------------------------------------------------------------------------
-- 5. Desktop-only RPCs should not be anon-callable
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.save_factory_settings(
  uuid, text, text, text, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb
) FROM anon;
REVOKE ALL ON FUNCTION public.save_operation(
  text, uuid, uuid, uuid, text, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.save_support_dropdown(
  text, uuid, uuid, text, text, jsonb
) FROM anon;
REVOKE ALL ON FUNCTION public.save_fabric_components(
  uuid, uuid, jsonb, uuid[]
) FROM anon;
REVOKE ALL ON FUNCTION public.save_colorway_planning_remarks(
  uuid, uuid, uuid, text
) FROM anon;
REVOKE ALL ON FUNCTION public.delete_desktop_shipment(uuid, uuid) FROM anon;
-- Legacy desktop save RPCs — authenticated only (defense-in-depth; floor uses floor_capture*)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'save_buyer', 'save_department', 'save_shift', 'save_process_flow',
        'save_size_group', 'save_resource', 'save_style_order', 'save_line_plan',
        'save_order_routing', 'delete_style_order', 'save_support_dropdown'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
  END LOOP;
END $$;
