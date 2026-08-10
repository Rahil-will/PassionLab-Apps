-- Unified line-allocation actuals RPCs.
--
-- `get_order_colorway_actuals`  -> order / colorway details page.
-- `get_factory_schedule_actuals` -> department schedule page (all line allocations).
--
-- Both route through `get_line_allocation_actuals`, which joins order_routing_steps
-- to line_allocations and then to the appropriate capture table based on the
-- operation's `capture_app`.  This keeps the data flow in one place:
-- route steps -> line_allocations -> capture tables.

CREATE OR REPLACE FUNCTION public.get_line_allocation_actuals(
  p_factory_id uuid,
  p_order_id uuid DEFAULT NULL,
  p_colorway_id uuid DEFAULT NULL
)
RETURNS TABLE (
  line_allocation_id uuid,
  order_id uuid,
  colorway_id uuid,
  department_id uuid,
  operation_id uuid,
  qty integer,
  first_output_date date,
  last_output_date date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH grid AS (
    SELECT g.*
    FROM public.standard_production_alloc_grid(p_factory_id, p_order_id) g
    WHERE (p_colorway_id IS NULL OR g.colorway_id = p_colorway_id)
  ),
  cutting_grid AS (
    -- Origin departments (cutting) are excluded from standard_production_alloc_grid,
    -- but they also have line allocations whose bundles are real output.
    SELECT
      la.factory_id,
      la.order_id,
      ors.id AS operation_id,
      ors.visit_id,
      la.department_id,
      ors.dept_name AS dept_name,
      COALESCE(ors.capture_app, 'cutting_bundle') AS capture_app,
      COALESCE(ors.step_type, 'produce') AS step_type,
      d.role AS dept_role,
      d.planning_mode,
      COALESCE(ors.is_primary_output, false) AS is_primary_output,
      la.id AS line_allocation_id,
      la.colorway_id
    FROM public.line_allocations la
    JOIN public.order_routing_steps ors
      ON ors.order_id = la.order_id
     AND ors.factory_id = la.factory_id
     AND ors.visit_id IS NOT DISTINCT FROM la.visit_id
    LEFT JOIN public.departments d ON d.id = la.department_id
    WHERE la.factory_id = p_factory_id
      AND (p_order_id IS NULL OR la.order_id = p_order_id)
      AND (p_colorway_id IS NULL OR la.colorway_id = p_colorway_id)
      AND COALESCE(d.role, 'standard') = 'origin'
  ),
  captured AS (
    -- hourly output (produce step only; loading step is receipt, not output)
    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      h.count AS qty,
      h.log_date AS output_date
    FROM grid g
    JOIN public.hourly_counts h
      ON h.factory_id = g.factory_id
      AND h.order_id = g.order_id
      AND h.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND h.order_route_id = g.operation_id
      AND h.line_allocation_id = g.line_allocation_id
    WHERE (g.capture_app = 'hourly' OR g.step_type IN ('loading', 'produce'))
      AND g.step_type <> 'loading'
      AND COALESCE(h.count, 0) > 0

    UNION ALL

    -- qc / shipment_qa output
    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      s.passed AS qty,
      s.log_date AS output_date
    FROM grid g
    JOIN public.inspection_sessions s
      ON s.factory_id = g.factory_id
      AND s.order_id = g.order_id
      AND s.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND s.order_route_id = g.operation_id
      AND s.line_allocation_id = g.line_allocation_id
    WHERE g.capture_app IN ('qc_log', 'shipment_qa')
      AND g.step_type <> 'loading'
      AND COALESCE(s.passed, 0) > 0

    UNION ALL

    -- batch output
    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      bp.produced_qty AS qty,
      bp.log_date AS output_date
    FROM grid g
    JOIN public.batch_production bp
      ON bp.factory_id = g.factory_id
      AND bp.order_id = g.order_id
      AND bp.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND bp.order_route_id = g.operation_id
      AND bp.line_allocation_id = g.line_allocation_id
    WHERE g.capture_app = 'batch'
      AND g.step_type <> 'loading'
      AND COALESCE(bp.produced_qty, 0) > 0

    UNION ALL

    -- outsource receive output
    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      owm.qty AS qty,
      (owm.occurred_at AT TIME ZONE 'UTC')::date AS output_date
    FROM grid g
    JOIN public.outsource_work_movements owm
      ON owm.factory_id = g.factory_id
      AND owm.order_id = g.order_id
      AND owm.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND owm.order_route_id = g.operation_id
      AND owm.line_allocation_id = g.line_allocation_id
    WHERE (g.capture_app = 'outsource' OR g.step_type = 'outsource')
      AND g.step_type <> 'loading'
      AND owm.movement_type = 'vendor_receive'
      AND owm.voided_at IS NULL
      AND COALESCE(owm.qty, 0) > 0

    UNION ALL

    -- cutting bundle output
    SELECT
      g.line_allocation_id,
      g.order_id,
      g.colorway_id,
      g.department_id,
      g.operation_id,
      cb.qty AS qty,
      cs.log_date AS output_date
    FROM cutting_grid g
    JOIN public.cutting_sessions cs
      ON cs.factory_id = g.factory_id
      AND cs.order_id = g.order_id
      AND cs.colorway_id IS NOT DISTINCT FROM g.colorway_id
      AND cs.order_route_id = g.operation_id
      AND cs.line_allocation_id = g.line_allocation_id
    JOIN public.cutting_bundles cb
      ON cb.session_id = cs.id
      AND cb.factory_id = g.factory_id
      AND cb.order_id = g.order_id
      AND cb.colorway_id IS NOT DISTINCT FROM g.colorway_id
    WHERE COALESCE(cb.qty, 0) > 0
  )
  SELECT
    line_allocation_id,
    order_id,
    colorway_id,
    department_id,
    operation_id,
    SUM(qty)::integer AS qty,
    MIN(output_date) AS first_output_date,
    MAX(output_date) AS last_output_date
  FROM captured
  GROUP BY line_allocation_id, order_id, colorway_id, department_id, operation_id
  ORDER BY order_id, line_allocation_id;
$$;

CREATE OR REPLACE FUNCTION public.get_order_colorway_actuals(
  p_factory_id uuid,
  p_order_id uuid,
  p_colorway_id uuid DEFAULT NULL
)
RETURNS TABLE (
  line_allocation_id uuid,
  order_id uuid,
  colorway_id uuid,
  department_id uuid,
  operation_id uuid,
  qty integer,
  first_output_date date,
  last_output_date date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.get_line_allocation_actuals(p_factory_id, p_order_id, p_colorway_id);
$$;

CREATE OR REPLACE FUNCTION public.get_factory_schedule_actuals(p_factory_id uuid)
RETURNS TABLE (
  line_allocation_id uuid,
  order_id uuid,
  colorway_id uuid,
  department_id uuid,
  operation_id uuid,
  qty integer,
  first_output_date date,
  last_output_date date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.get_line_allocation_actuals(p_factory_id, NULL::uuid, NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.get_line_allocation_actuals(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_line_allocation_actuals(uuid, uuid, uuid) TO authenticated, anon, service_role;

REVOKE ALL ON FUNCTION public.get_order_colorway_actuals(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_colorway_actuals(uuid, uuid, uuid) TO authenticated, anon, service_role;

REVOKE ALL ON FUNCTION public.get_factory_schedule_actuals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_factory_schedule_actuals(uuid) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
