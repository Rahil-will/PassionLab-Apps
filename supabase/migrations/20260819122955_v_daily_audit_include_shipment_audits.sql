CREATE OR REPLACE VIEW public.v_daily_audit
WITH (security_invoker = true) AS
SELECT
  a.factory_id,
  a.order_id,
  a.colorway_id,
  a.department_id,
  d.name AS department_name,
  a.line_allocation_id AS resource_allocation_id,
  a.resource_id,
  ar.resource_name,
  a.order_route_id AS operation_id,
  ors.operation_name,
  ors.step_type,
  a.shift_id,
  sm.shift_name,
  COALESCE(a.completed_at, a.logged_at)::date AS log_date,
  count(*)::integer AS lots,
  sum(CASE WHEN a.result = 'pass' THEN 1 ELSE 0 END)::integer AS lots_passed,
  sum(CASE WHEN a.result = 'fail' THEN 1 ELSE 0 END)::integer AS lots_failed,
  sum(COALESCE(a.sample_size, 0))::integer AS samples_inspected,
  sum(COALESCE(a.passed, 0))::integer AS passed,
  sum(COALESCE(a.failed, 0))::integer AS failed,
  sum(COALESCE(a.major_failed, 0))::integer AS major_failed,
  sum(COALESCE(a.minor_failed, 0))::integer AS minor_failed,
  (array_agg(a.aql_level ORDER BY a.logged_at DESC))[1] AS aql_level,
  CASE
    WHEN count(*) = 0 THEN NULL::numeric
    ELSE round(
      100.0 * sum(CASE WHEN a.result = 'pass' THEN 1 ELSE 0 END)::numeric / count(*)::numeric,
      2
    )
  END AS lots_pass_pct,
  CASE
    WHEN sum(COALESCE(a.sample_size, 0)) = 0 THEN NULL::numeric
    ELSE round(
      100.0 * sum(COALESCE(a.failed, 0))::numeric / sum(COALESCE(a.sample_size, 0))::numeric,
      2
    )
  END AS defective_pct
FROM public.audit_sessions a
LEFT JOIN public.order_routing_steps ors ON ors.id = a.order_route_id
LEFT JOIN public.departments d ON d.id = a.department_id
LEFT JOIN public.assigned_resources ar ON ar.id = a.resource_id
LEFT JOIN public.v_shift_minutes sm ON sm.shift_id = a.shift_id
WHERE a.status = 'completed'
GROUP BY
  a.factory_id,
  a.order_id,
  a.colorway_id,
  a.department_id,
  d.name,
  a.line_allocation_id,
  a.resource_id,
  ar.resource_name,
  a.order_route_id,
  ors.operation_name,
  ors.step_type,
  a.shift_id,
  sm.shift_name,
  (COALESCE(a.completed_at, a.logged_at)::date)

UNION ALL

SELECT
  sa.factory_id,
  sa.order_id,
  sa.colorway_id,
  td.id AS department_id,
  td.name AS department_name,
  NULL::uuid AS resource_allocation_id,
  NULL::uuid AS resource_id,
  NULL::text AS resource_name,
  NULL::uuid AS operation_id,
  initcap(replace(sa.audit_type, '_', ' ')) AS operation_name,
  'audit'::text AS step_type,
  NULL::uuid AS shift_id,
  NULL::text AS shift_name,
  COALESCE(sa.audit_date, COALESCE(sa.completed_at, sa.logged_at)::date) AS log_date,
  count(*)::integer AS lots,
  sum(CASE WHEN sa.result = 'pass' THEN 1 ELSE 0 END)::integer AS lots_passed,
  sum(CASE WHEN sa.result = 'fail' THEN 1 ELSE 0 END)::integer AS lots_failed,
  sum(COALESCE(sa.sample_size, 0))::integer AS samples_inspected,
  sum(COALESCE(sa.passed, 0))::integer AS passed,
  sum(COALESCE(sa.failed, 0))::integer AS failed,
  sum(COALESCE(sa.major_failed, 0))::integer AS major_failed,
  sum(COALESCE(sa.minor_failed, 0))::integer AS minor_failed,
  (array_agg(sa.aql_level ORDER BY sa.logged_at DESC))[1] AS aql_level,
  CASE
    WHEN count(*) = 0 THEN NULL::numeric
    ELSE round(
      100.0 * sum(CASE WHEN sa.result = 'pass' THEN 1 ELSE 0 END)::numeric / count(*)::numeric,
      2
    )
  END AS lots_pass_pct,
  CASE
    WHEN sum(COALESCE(sa.sample_size, 0)) = 0 THEN NULL::numeric
    ELSE round(
      100.0 * sum(COALESCE(sa.failed, 0))::numeric / sum(COALESCE(sa.sample_size, 0))::numeric,
      2
    )
  END AS defective_pct
FROM public.shipment_audits sa
JOIN LATERAL (
  SELECT d.id, d.name
  FROM public.departments d
  WHERE d.factory_id = sa.factory_id
    AND d.role = 'terminal'
  ORDER BY
    CASE WHEN d.name ILIKE 'shipment' THEN 0 ELSE 1 END,
    d.sequence DESC NULLS LAST
  LIMIT 1
) td ON true
WHERE sa.status = 'completed'
GROUP BY
  sa.factory_id,
  sa.order_id,
  sa.colorway_id,
  td.id,
  td.name,
  sa.audit_type,
  COALESCE(sa.audit_date, COALESCE(sa.completed_at, sa.logged_at)::date);

COMMENT ON VIEW public.v_daily_audit IS
  'Completed floor AQL (audit_sessions) plus buyer/shipment AQL (shipment_audits) by day. Shipment rows sit on the factory terminal department; operation_name is the audit type.';

GRANT SELECT ON public.v_daily_audit TO authenticated, anon;;
