-- Desktop read RPC factory-scope guards (PRODIGI admin SPA).
-- Rename-and-wrap: inner bodies unchanged; wrappers enforce current_factory_id().

CREATE OR REPLACE FUNCTION public._assert_desktop_factory_scope(p_factory_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF p_factory_id IS NULL THEN
    RAISE EXCEPTION 'factory_id is required';
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._assert_desktop_factory_scope(uuid)
  FROM PUBLIC, anon, authenticated;
-- ---------------------------------------------------------------------------
-- get_department_kpis — live fallback RPC (was missing from numbered migrations)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_department_kpis(
  p_factory_id uuid,
  p_department_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS SETOF public.v_department_kpis_by_shift
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY
  SELECT v.*
  FROM public.v_department_kpis_by_shift v
  WHERE v.factory_id = p_factory_id
    AND v.department_id = p_department_id
    AND v.log_date BETWEEN p_date_from AND p_date_to
  ORDER BY v.log_date, v.shift_name, v.order_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_department_kpis(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_department_kpis(uuid, uuid, date, date) TO authenticated;
-- ---------------------------------------------------------------------------
-- cutting_component_progress_rows
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.cutting_component_progress_rows(uuid, uuid)
  RENAME TO cutting_component_progress_rows_inner;
REVOKE ALL ON FUNCTION public.cutting_component_progress_rows_inner(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.cutting_component_progress_rows(
  p_factory_id uuid DEFAULT NULL::uuid,
  p_order_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  factory_id uuid, order_id uuid, colorway_id uuid, operation_id uuid, visit_id uuid,
  fabric_component_id uuid, fabric_code text, fabric_type text, is_primary boolean,
  qty integer, qty_by_size jsonb
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  IF p_factory_id IS NOT NULL THEN
    PERFORM public._assert_desktop_factory_scope(p_factory_id);
  END IF;
  RETURN QUERY SELECT * FROM public.cutting_component_progress_rows_inner(p_factory_id, p_order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cutting_component_progress_rows(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cutting_component_progress_rows(uuid, uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- operation_progress_rows
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.operation_progress_rows(uuid, uuid)
  RENAME TO operation_progress_rows_inner;
REVOKE ALL ON FUNCTION public.operation_progress_rows_inner(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.operation_progress_rows(
  p_factory_id uuid DEFAULT NULL::uuid,
  p_order_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  factory_id uuid, order_id uuid, colorway_id uuid, operation_id uuid, visit_id uuid,
  dept_id uuid, dept_name text, capture_app text, step_type text, dept_role text,
  is_primary_output boolean, route_seq integer, qty_produced integer, qty_produced_by_size jsonb
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  IF p_factory_id IS NOT NULL THEN
    PERFORM public._assert_desktop_factory_scope(p_factory_id);
  END IF;
  RETURN QUERY SELECT * FROM public.operation_progress_rows_inner(p_factory_id, p_order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.operation_progress_rows(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operation_progress_rows(uuid, uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- order_dept_progress_rows
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.order_dept_progress_rows(uuid, uuid)
  RENAME TO order_dept_progress_rows_inner;
REVOKE ALL ON FUNCTION public.order_dept_progress_rows_inner(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.order_dept_progress_rows(
  p_factory_id uuid DEFAULT NULL::uuid,
  p_order_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  factory_id uuid, order_id uuid, colorway_id uuid, visit_id uuid, dept_id uuid, dept_name text,
  flow_step integer, is_in_flow boolean, qty_received integer, qty_produced integer,
  qty_sent integer, qty_rejected integer, wip_qty integer, wip_qty_by_size jsonb,
  qty_received_by_size jsonb, qty_produced_by_size jsonb, qty_sent_by_size jsonb,
  qty_rejected_by_size jsonb, qty_in_transit integer, qty_missing_in_transit integer,
  status text, planned_qty integer, remaining_qty integer, available_to_send integer
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  IF p_factory_id IS NOT NULL THEN
    PERFORM public._assert_desktop_factory_scope(p_factory_id);
  END IF;
  RETURN QUERY SELECT * FROM public.order_dept_progress_rows_inner(p_factory_id, p_order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.order_dept_progress_rows(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_dept_progress_rows(uuid, uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_factory_production_summary
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_factory_production_summary(uuid)
  RENAME TO get_factory_production_summary_inner;
REVOKE ALL ON FUNCTION public.get_factory_production_summary_inner(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_factory_production_summary(p_factory_id uuid)
RETURNS TABLE(
  order_id uuid, colorway_id uuid, department_id uuid, operation_id uuid,
  output_qty integer, log_date date
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY SELECT * FROM public.get_factory_production_summary_inner(p_factory_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_factory_production_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_factory_production_summary(uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_factory_schedule_actuals
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_factory_schedule_actuals(uuid)
  RENAME TO get_factory_schedule_actuals_inner;
REVOKE ALL ON FUNCTION public.get_factory_schedule_actuals_inner(uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_factory_schedule_actuals(p_factory_id uuid)
RETURNS TABLE(
  line_allocation_id uuid, order_id uuid, colorway_id uuid, department_id uuid,
  operation_id uuid, qty integer, first_output_date date, last_output_date date
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY SELECT * FROM public.get_factory_schedule_actuals_inner(p_factory_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_factory_schedule_actuals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_factory_schedule_actuals(uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_order_colorway_actuals
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_order_colorway_actuals(uuid, uuid, uuid)
  RENAME TO get_order_colorway_actuals_inner;
REVOKE ALL ON FUNCTION public.get_order_colorway_actuals_inner(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_order_colorway_actuals(
  p_factory_id uuid, p_order_id uuid, p_colorway_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  line_allocation_id uuid, order_id uuid, colorway_id uuid, department_id uuid,
  operation_id uuid, qty integer, first_output_date date, last_output_date date
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY SELECT * FROM public.get_order_colorway_actuals_inner(p_factory_id, p_order_id, p_colorway_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_order_colorway_actuals(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_colorway_actuals(uuid, uuid, uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_style_kpis
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_style_kpis(uuid, uuid)
  RENAME TO get_style_kpis_inner;
REVOKE ALL ON FUNCTION public.get_style_kpis_inner(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_style_kpis(p_factory_id uuid, p_order_id uuid)
RETURNS SETOF public.v_department_kpis_by_shift
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY SELECT * FROM public.get_style_kpis_inner(p_factory_id, p_order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_style_kpis(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_style_kpis(uuid, uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_order_detail_bundle
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_order_detail_bundle(uuid, uuid)
  RENAME TO get_order_detail_bundle_inner;
REVOKE ALL ON FUNCTION public.get_order_detail_bundle_inner(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_order_detail_bundle(p_factory_id uuid, p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN public.get_order_detail_bundle_inner(p_factory_id, p_order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_order_detail_bundle(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_detail_bundle(uuid, uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_order_dept_progress
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_order_dept_progress(uuid, uuid, uuid, uuid, date)
  RENAME TO get_order_dept_progress_inner;
REVOKE ALL ON FUNCTION public.get_order_dept_progress_inner(uuid, uuid, uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_order_dept_progress(
  p_factory_id uuid, p_order_id uuid, p_colorway_id uuid, p_department_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN public.get_order_dept_progress_inner(
    p_factory_id, p_order_id, p_colorway_id, p_department_id, p_date
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_order_dept_progress(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_dept_progress(uuid, uuid, uuid, uuid, date) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_audit_report
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_audit_report(uuid, date, date, uuid, uuid, uuid)
  RENAME TO get_audit_report_inner;
REVOKE ALL ON FUNCTION public.get_audit_report_inner(uuid, date, date, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_audit_report(
  p_factory_id uuid, p_date_from date, p_date_to date,
  p_colorway_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid,
  p_department_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  factory_id uuid, order_id uuid, colorway_id uuid, department_id uuid, log_date date,
  lots integer, total_samples integer, total_passed integer, total_failed integer,
  total_major_failed integer, total_minor_failed integer, aql_level text, aql_pass_pct numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY SELECT * FROM public.get_audit_report_inner(
    p_factory_id, p_date_from, p_date_to, p_colorway_id, p_order_id, p_department_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_audit_report(uuid, date, date, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_audit_report(uuid, date, date, uuid, uuid, uuid) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_cut_to_ship_report
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_cut_to_ship_report(uuid, date, date, uuid, boolean)
  RENAME TO get_cut_to_ship_report_inner;
REVOKE ALL ON FUNCTION public.get_cut_to_ship_report_inner(uuid, date, date, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_cut_to_ship_report(
  p_factory_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date,
  p_buyer_id uuid DEFAULT NULL::uuid, p_balanced_only boolean DEFAULT NULL::boolean
)
RETURNS TABLE(
  factory_id uuid, order_id uuid, colorway_id uuid, style_name text, buyer_name text,
  po_number text, order_qty integer, cut_qty integer, cut_qty_source text, shipped_qty integer,
  rejected_qty integer, wip_qty integer, reconciliation_gap integer, is_balanced boolean,
  completion_pct numeric, order_status text, last_shipment_date date, cut_qty_by_size jsonb,
  cut_qty_by_component jsonb, shipped_qty_by_size jsonb, rejected_qty_by_size jsonb,
  wip_qty_by_size jsonb
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY SELECT * FROM public.get_cut_to_ship_report_inner(
    p_factory_id, p_date_from, p_date_to, p_buyer_id, p_balanced_only
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_cut_to_ship_report(uuid, date, date, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cut_to_ship_report(uuid, date, date, uuid, boolean) TO authenticated;
-- ---------------------------------------------------------------------------
-- get_handover_report
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_handover_report(uuid, date, date, uuid, uuid, text, uuid, uuid, text)
  RENAME TO get_handover_report_inner;
REVOKE ALL ON FUNCTION public.get_handover_report_inner(uuid, date, date, uuid, uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.get_handover_report(
  p_factory_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date,
  p_from_department_id uuid DEFAULT NULL::uuid, p_to_department_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT NULL::text, p_order_id uuid DEFAULT NULL::uuid,
  p_colorway_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid, order_id uuid, colorway_id uuid, from_department_id uuid, to_department_id uuid,
  sent_qty integer, received_qty integer, qty_by_size jsonb, received_qty_by_size jsonb,
  sent_at timestamptz, received_at timestamptz, status text, challan_number text, notes text,
  received_notes text, sent_by uuid, received_by uuid, style_name text, po_number text,
  colorway_name text, color_code text, from_department_name text, to_department_name text,
  sent_by_name text, received_by_name text, from_produce_operation_names text,
  to_produce_operation_names text, from_resource_name text, to_resource_name text,
  log_date date, shift_id uuid, shift_name text, hour_slot text, loss_closed_by uuid,
  loss_closed_by_name text, loss_closed_at timestamptz, loss_remark text,
  loss_rejection_id uuid, missing_in_transit integer
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY SELECT * FROM public.get_handover_report_inner(
    p_factory_id, p_date_from, p_date_to, p_from_department_id, p_to_department_id,
    p_status, p_order_id, p_colorway_id, p_search
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_handover_report(uuid, date, date, uuid, uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_handover_report(uuid, date, date, uuid, uuid, text, uuid, uuid, text)
  TO authenticated;
