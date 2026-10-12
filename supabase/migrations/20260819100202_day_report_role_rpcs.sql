-- Day Report range RPCs keyed by departments.role (origin / standard / terminal).
CREATE INDEX IF NOT EXISTS idx_hourly_counts_factory_dept_log
  ON public.hourly_counts (factory_id, department_id, log_date);
CREATE INDEX IF NOT EXISTS idx_inspection_sessions_factory_dept_log
  ON public.inspection_sessions (factory_id, department_id, log_date);
CREATE INDEX IF NOT EXISTS idx_batch_production_factory_dept_log
  ON public.batch_production (factory_id, department_id, log_date);
CREATE INDEX IF NOT EXISTS idx_shipments_factory_date
  ON public.shipments (factory_id, shipment_date);

CREATE OR REPLACE FUNCTION public.get_day_origin_report(
  p_factory_id uuid, p_department_id uuid, p_date_from date, p_date_to date
)
RETURNS TABLE (
  id uuid, log_date date, started_at timestamptz, ended_at timestamptz,
  order_id uuid, colorway_id uuid, resource_id uuid, order_route_id uuid,
  session_no text, ref_no text, fabric_type text, fabric_code text,
  fabric_component_id uuid, is_primary_fabric boolean, lay_no text,
  headcount_by_category jsonb, output_qty integer, style_name text, style_ref text,
  buyer_name text, po_number text, color_name text, resource_name text,
  operation_name text, is_primary_output boolean, operation_def_id uuid
)
LANGUAGE sql STABLE SET search_path TO public AS $function$
  SELECT * FROM public.get_day_cutting_sessions(p_factory_id, p_department_id, p_date_from, p_date_to);
$function$;

CREATE OR REPLACE FUNCTION public.get_day_standard_report(
  p_factory_id uuid, p_department_id uuid, p_date_from date, p_date_to date
)
RETURNS TABLE (
  source text, id uuid, log_date date, hour_slot text, shift_id uuid,
  order_id uuid, colorway_id uuid, resource_id uuid, order_route_id uuid,
  qty integer, inspected_qty integer, started_at timestamptz, ended_at timestamptz,
  activity_no text, ref_no text, comment text, headcount_by_category jsonb,
  style_name text, style_ref text, buyer_name text, po_number text,
  color_name text, resource_name text, operation_name text, operation_def_id uuid
)
LANGUAGE sql STABLE SET search_path TO public AS $function$
  SELECT
    'hourly'::text, hc.id, hc.log_date, hc.hour_slot, hc.shift_id,
    hc.order_id, hc.colorway_id, hc.resource_id, hc.order_route_id,
    COALESCE(hc.count, 0), 0, NULL::timestamptz, NULL::timestamptz,
    NULL::text, NULL::text, NULL::text, NULL::jsonb,
    COALESCE(so.style_name, ''), COALESCE(so.style_ref, ''), COALESCE(so.buyer_name, ''), COALESCE(so.po_number, ''),
    CASE
      WHEN hc.colorway_id IS NULL THEN 'Order (legacy)'
      WHEN cw.id IS NULL THEN LEFT(hc.colorway_id::text, 8)
      WHEN NULLIF(BTRIM(COALESCE(cw.color_code, '')), '') IS NOT NULL
        THEN CONCAT(COALESCE(cw.name, ''), ' (', BTRIM(cw.color_code), ')')
      ELSE COALESCE(NULLIF(BTRIM(cw.name), ''), LEFT(hc.colorway_id::text, 8))
    END,
    COALESCE(ar.resource_name, '—'), COALESCE(ors.operation_name, ors.dept_name, 'Output'), ors.operation_def_id
  FROM public.hourly_counts hc
  LEFT JOIN public.style_orders so ON so.id = hc.order_id AND so.factory_id = hc.factory_id
  LEFT JOIN public.colorways cw ON cw.id = hc.colorway_id AND cw.factory_id = hc.factory_id
  LEFT JOIN public.assigned_resources ar ON ar.id = hc.resource_id AND ar.factory_id = hc.factory_id
  LEFT JOIN public.order_routing_steps ors ON ors.id = hc.order_route_id AND ors.factory_id = hc.factory_id
  WHERE hc.factory_id = p_factory_id AND hc.department_id = p_department_id
    AND hc.log_date >= p_date_from AND hc.log_date <= p_date_to
  UNION ALL
  SELECT
    'qc'::text, qs.id, qs.log_date, qs.hour_slot, qs.shift_id,
    qs.order_id, qs.colorway_id, qs.resource_id, qs.order_route_id,
    COALESCE(qs.passed, 0), COALESCE(qs.total_inspected, 0), NULL::timestamptz, NULL::timestamptz,
    NULL::text, NULL::text, NULL::text, NULL::jsonb,
    COALESCE(so.style_name, ''), COALESCE(so.style_ref, ''), COALESCE(so.buyer_name, ''), COALESCE(so.po_number, ''),
    CASE
      WHEN qs.colorway_id IS NULL THEN 'Order (legacy)'
      WHEN cw.id IS NULL THEN LEFT(qs.colorway_id::text, 8)
      WHEN NULLIF(BTRIM(COALESCE(cw.color_code, '')), '') IS NOT NULL
        THEN CONCAT(COALESCE(cw.name, ''), ' (', BTRIM(cw.color_code), ')')
      ELSE COALESCE(NULLIF(BTRIM(cw.name), ''), LEFT(qs.colorway_id::text, 8))
    END,
    COALESCE(ar.resource_name, '—'), COALESCE(ors.operation_name, ors.dept_name, 'Output'), ors.operation_def_id
  FROM public.inspection_sessions qs
  LEFT JOIN public.style_orders so ON so.id = qs.order_id AND so.factory_id = qs.factory_id
  LEFT JOIN public.colorways cw ON cw.id = qs.colorway_id AND cw.factory_id = qs.factory_id
  LEFT JOIN public.assigned_resources ar ON ar.id = qs.resource_id AND ar.factory_id = qs.factory_id
  LEFT JOIN public.order_routing_steps ors ON ors.id = qs.order_route_id AND ors.factory_id = qs.factory_id
  WHERE qs.factory_id = p_factory_id AND qs.department_id = p_department_id
    AND qs.log_date >= p_date_from AND qs.log_date <= p_date_to
  UNION ALL
  SELECT
    'batch'::text, bp.id, bp.log_date, NULL::text, bp.shift_id,
    bp.order_id, bp.colorway_id, bp.resource_id, bp.order_route_id,
    COALESCE(bp.produced_qty, 0), 0, bp.start_time, bp.end_time,
    bp.activity_no, bp.ref_no, bp.comment, COALESCE(bp.headcount_by_category, '{}'::jsonb),
    COALESCE(so.style_name, ''), COALESCE(so.style_ref, ''), COALESCE(so.buyer_name, ''), COALESCE(so.po_number, ''),
    CASE
      WHEN bp.colorway_id IS NULL THEN 'Order (legacy)'
      WHEN cw.id IS NULL THEN LEFT(bp.colorway_id::text, 8)
      WHEN NULLIF(BTRIM(COALESCE(cw.color_code, '')), '') IS NOT NULL
        THEN CONCAT(COALESCE(cw.name, ''), ' (', BTRIM(cw.color_code), ')')
      ELSE COALESCE(NULLIF(BTRIM(cw.name), ''), LEFT(bp.colorway_id::text, 8))
    END,
    COALESCE(ar.resource_name, '—'), COALESCE(ors.operation_name, ors.dept_name, 'Batch'), ors.operation_def_id
  FROM public.batch_production bp
  LEFT JOIN public.style_orders so ON so.id = bp.order_id AND so.factory_id = bp.factory_id
  LEFT JOIN public.colorways cw ON cw.id = bp.colorway_id AND cw.factory_id = bp.factory_id
  LEFT JOIN public.assigned_resources ar ON ar.id = bp.resource_id AND ar.factory_id = bp.factory_id
  LEFT JOIN public.order_routing_steps ors ON ors.id = bp.order_route_id AND ors.factory_id = bp.factory_id
  WHERE bp.factory_id = p_factory_id AND bp.department_id = p_department_id
    AND bp.log_date >= p_date_from AND bp.log_date <= p_date_to;
$function$;

CREATE OR REPLACE FUNCTION public.get_day_terminal_report(
  p_factory_id uuid, p_department_id uuid, p_date_from date, p_date_to date
)
RETURNS TABLE (
  id uuid, log_date date, started_at timestamptz, order_id uuid, colorway_id uuid,
  order_route_id uuid, output_qty integer, style_name text, style_ref text,
  buyer_name text, po_number text, color_name text, operation_name text,
  shipment_type text, destination text, invoice_number text, awb_number text, notes text
)
LANGUAGE sql STABLE SET search_path TO public AS $function$
  SELECT
    s.id, s.shipment_date, s.logged_at, s.order_id, s.colorway_id, s.order_route_id,
    COALESCE(s.shipped_qty, 0), COALESCE(so.style_name, ''), COALESCE(so.style_ref, ''),
    COALESCE(so.buyer_name, ''), COALESCE(so.po_number, ''),
    CASE
      WHEN s.colorway_id IS NULL THEN 'Order (legacy)'
      WHEN cw.id IS NULL THEN LEFT(s.colorway_id::text, 8)
      WHEN NULLIF(BTRIM(COALESCE(cw.color_code, '')), '') IS NOT NULL
        THEN CONCAT(COALESCE(cw.name, ''), ' (', BTRIM(cw.color_code), ')')
      ELSE COALESCE(NULLIF(BTRIM(cw.name), ''), LEFT(s.colorway_id::text, 8))
    END,
    COALESCE(ors.operation_name, ors.dept_name, 'Dispatch'),
    s.shipment_type, s.destination, s.invoice_number, s.awb_number, s.notes
  FROM public.shipments s
  LEFT JOIN public.style_orders so ON so.id = s.order_id AND so.factory_id = s.factory_id
  LEFT JOIN public.colorways cw ON cw.id = s.colorway_id AND cw.factory_id = s.factory_id
  LEFT JOIN public.order_routing_steps ors ON ors.id = s.order_route_id AND ors.factory_id = s.factory_id
  WHERE s.factory_id = p_factory_id
    AND s.shipment_date >= p_date_from AND s.shipment_date <= p_date_to
    AND EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = p_department_id AND d.factory_id = p_factory_id AND d.role = 'terminal'
    )
    AND (s.order_route_id IS NULL OR ors.dept_id IS NULL OR ors.dept_id = p_department_id)
  ORDER BY s.shipment_date, s.logged_at, s.id;
$function$;

REVOKE ALL ON FUNCTION public.get_day_origin_report(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_day_origin_report(uuid, uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.get_day_standard_report(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_day_standard_report(uuid, uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.get_day_terminal_report(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_day_terminal_report(uuid, uuid, date, date) TO authenticated;;
