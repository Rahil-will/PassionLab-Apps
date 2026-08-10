-- Revert 20260810170000_desktop_read_factory_guards.sql
-- That migration wrapped twelve SECURITY INVOKER report RPCs in SECURITY INVOKER
-- wrappers that call revoked helpers -> permission denied for every authenticated
-- caller. Those functions were already RLS-scoped; the guards were unnecessary.

DROP FUNCTION public.cutting_component_progress_rows(uuid, uuid);
ALTER FUNCTION public.cutting_component_progress_rows_inner(uuid, uuid)
  RENAME TO cutting_component_progress_rows;

DROP FUNCTION public.operation_progress_rows(uuid, uuid);
ALTER FUNCTION public.operation_progress_rows_inner(uuid, uuid)
  RENAME TO operation_progress_rows;

DROP FUNCTION public.order_dept_progress_rows(uuid, uuid);
ALTER FUNCTION public.order_dept_progress_rows_inner(uuid, uuid)
  RENAME TO order_dept_progress_rows;

DROP FUNCTION public.get_factory_production_summary(uuid);
ALTER FUNCTION public.get_factory_production_summary_inner(uuid)
  RENAME TO get_factory_production_summary;

DROP FUNCTION public.get_factory_schedule_actuals(uuid);
ALTER FUNCTION public.get_factory_schedule_actuals_inner(uuid)
  RENAME TO get_factory_schedule_actuals;

DROP FUNCTION public.get_order_colorway_actuals(uuid, uuid, uuid);
ALTER FUNCTION public.get_order_colorway_actuals_inner(uuid, uuid, uuid)
  RENAME TO get_order_colorway_actuals;

DROP FUNCTION public.get_style_kpis(uuid, uuid);
ALTER FUNCTION public.get_style_kpis_inner(uuid, uuid)
  RENAME TO get_style_kpis;

DROP FUNCTION public.get_order_detail_bundle(uuid, uuid);
ALTER FUNCTION public.get_order_detail_bundle_inner(uuid, uuid)
  RENAME TO get_order_detail_bundle;

DROP FUNCTION public.get_order_dept_progress(uuid, uuid, uuid, uuid, date);
ALTER FUNCTION public.get_order_dept_progress_inner(uuid, uuid, uuid, uuid, date)
  RENAME TO get_order_dept_progress;

DROP FUNCTION public.get_audit_report(uuid, date, date, uuid, uuid, uuid);
ALTER FUNCTION public.get_audit_report_inner(uuid, date, date, uuid, uuid, uuid)
  RENAME TO get_audit_report;

DROP FUNCTION public.get_cut_to_ship_report(uuid, date, date, uuid, boolean);
ALTER FUNCTION public.get_cut_to_ship_report_inner(uuid, date, date, uuid, boolean)
  RENAME TO get_cut_to_ship_report;

DROP FUNCTION public.get_handover_report(uuid, date, date, uuid, uuid, text, uuid, uuid, text);
ALTER FUNCTION public.get_handover_report_inner(uuid, date, date, uuid, uuid, text, uuid, uuid, text)
  RENAME TO get_handover_report;

-- Restore client access (anon stays revoked — that part was a real improvement)
GRANT EXECUTE ON FUNCTION public.cutting_component_progress_rows(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operation_progress_rows(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_dept_progress_rows(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_factory_production_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_factory_schedule_actuals(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_colorway_actuals(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_style_kpis(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_detail_bundle(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_dept_progress(uuid, uuid, uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_report(uuid, date, date, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cut_to_ship_report(uuid, date, date, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_handover_report(uuid, date, date, uuid, uuid, text, uuid, uuid, text) TO authenticated;

-- get_department_kpis: keep it, drop the guard call. It is SECURITY INVOKER and
-- v_department_kpis_by_shift is now security_invoker=on, so RLS scopes it.
CREATE OR REPLACE FUNCTION public.get_department_kpis(
  p_factory_id uuid, p_department_id uuid, p_date_from date, p_date_to date
)
RETURNS SETOF public.v_department_kpis_by_shift
LANGUAGE sql STABLE SET search_path TO public AS $$
  SELECT v.* FROM public.v_department_kpis_by_shift v
  WHERE v.factory_id = p_factory_id
    AND v.department_id = p_department_id
    AND v.log_date BETWEEN p_date_from AND p_date_to
  ORDER BY v.log_date, v.shift_name, v.order_id;
$$;
REVOKE ALL ON FUNCTION public.get_department_kpis(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_department_kpis(uuid, uuid, date, date) TO authenticated;

DROP FUNCTION IF EXISTS public._assert_desktop_factory_scope(uuid);

-- Fix the no-op anon revokes from 20260810160000 §5 (PUBLIC grant, not an anon grant)
REVOKE ALL ON FUNCTION public.save_factory_settings(uuid, text, text, text, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_operation(text, uuid, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_support_dropdown(text, uuid, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_fabric_components(uuid, uuid, jsonb, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_colorway_planning_remarks(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_desktop_shipment(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_factory_settings(uuid, text, text, text, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_operation(text, uuid, uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_support_dropdown(text, uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_fabric_components(uuid, uuid, jsonb, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_colorway_planning_remarks(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_desktop_shipment(uuid, uuid) TO authenticated;
