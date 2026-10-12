CREATE OR REPLACE FUNCTION public.get_line_style_cards(
  p_factory_id uuid,
  p_resource_id uuid,
  p_department_id uuid,
  p_operation_def_id uuid,
  p_capture_app text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_factory_id IS NULL
     OR p_resource_id IS NULL
     OR p_department_id IS NULL
     OR p_operation_def_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'factoryId, resourceId, departmentId and operationDefId are required',
      'cards', '[]'::jsonb
    );
  END IF;

  WITH
  equiv_ops AS (
    SELECT DISTINCT o2.id
    FROM public.operations o
    JOIN public.operations o2
      ON o2.factory_id = o.factory_id
     AND o2.department_id IS NOT DISTINCT FROM o.department_id
     AND o2.name = o.name
    WHERE o.id = p_operation_def_id
      AND o.factory_id = p_factory_id
    UNION
    SELECT p_operation_def_id
  ),
  route_steps AS (
    SELECT
      ors.id AS order_route_id,
      ors.order_id,
      ors.visit_id,
      ors.dept_id,
      COALESCE(ors.operation_name, op.name, '') AS operation_name,
      COALESCE(ors.capture_app, 'hourly') AS capture_app,
      COALESCE(ors.step_type, 'produce') AS step_type,
      ors.operation_def_id,
      ors.seq
    FROM public.order_routing_steps ors
    LEFT JOIN public.operations op ON op.id = ors.operation_def_id
    WHERE ors.factory_id = p_factory_id
      AND ors.dept_id = p_department_id
      AND ors.operation_def_id IN (SELECT id FROM equiv_ops)
      AND (
        p_capture_app IS NULL
        OR NULLIF(trim(p_capture_app), '') IS NULL
        OR ors.capture_app = p_capture_app
      )
  ),
  cards_base AS (
    SELECT DISTINCT ON (la.id)
      la.id AS allocation_id,
      la.order_id,
      la.colorway_id,
      la.visit_id,
      la.qty AS planned,
      la.production_completed_at,
      la.completed_is_true,
      rs.order_route_id,
      rs.operation_name,
      rs.capture_app,
      rs.step_type,
      so.style_name,
      so.style_ref,
      so.po_number,
      so.buyer_id,
      so.image_url,
      so.status AS order_status,
      cw.name AS colorway_name
    FROM public.line_allocations la
    JOIN route_steps rs
      ON rs.order_id = la.order_id
     AND (
       (la.visit_id IS NOT NULL AND rs.visit_id IS NOT DISTINCT FROM la.visit_id)
       OR (la.visit_id IS NULL)
     )
    JOIN public.style_orders so
      ON so.id = la.order_id
     AND so.factory_id = p_factory_id
    LEFT JOIN public.colorways cw ON cw.id = la.colorway_id
    WHERE la.factory_id = p_factory_id
      AND la.line_id = p_resource_id
      AND (la.department_id IS NULL OR la.department_id = p_department_id)
    ORDER BY
      la.id,
      (rs.visit_id IS NOT DISTINCT FROM la.visit_id) DESC,
      rs.seq ASC
  ),
  hourly_prod AS (
    SELECT h.order_id, h.colorway_id, h.order_route_id,
      SUM(COALESCE(h.count, 0))::integer AS qty
    FROM public.hourly_counts h
    WHERE h.factory_id = p_factory_id
      AND h.resource_id = p_resource_id
      AND h.order_route_id IN (SELECT order_route_id FROM route_steps)
    GROUP BY h.order_id, h.colorway_id, h.order_route_id
  ),
  batch_prod AS (
    SELECT b.order_id, b.colorway_id, b.order_route_id,
      SUM(COALESCE(b.produced_qty, 0))::integer AS qty
    FROM public.batch_production b
    WHERE b.factory_id = p_factory_id
      AND b.resource_id = p_resource_id
      AND b.order_route_id IN (SELECT order_route_id FROM route_steps)
    GROUP BY b.order_id, b.colorway_id, b.order_route_id
  ),
  qc_prod AS (
    SELECT s.order_id, s.colorway_id, s.order_route_id,
      SUM(COALESCE(s.passed, 0) + COALESCE(s.rework_passed, 0))::integer AS qty
    FROM public.inspection_sessions s
    WHERE s.factory_id = p_factory_id
      AND s.order_route_id IN (SELECT order_route_id FROM route_steps)
      AND (s.resource_id IS NULL OR s.resource_id = p_resource_id)
    GROUP BY s.order_id, s.colorway_id, s.order_route_id
  ),
  cutting_prod AS (
    SELECT cs.order_id, cs.colorway_id, cs.order_route_id,
      SUM(COALESCE(cs.total_qty, 0))::integer AS qty
    FROM public.cutting_sessions cs
    WHERE cs.factory_id = p_factory_id
      AND cs.resource_id = p_resource_id
      AND cs.order_route_id IN (SELECT order_route_id FROM route_steps)
    GROUP BY cs.order_id, cs.colorway_id, cs.order_route_id
  ),
  assembled AS (
    SELECT c.*,
      CASE
        WHEN c.capture_app = 'batch' THEN COALESCE(bp.qty, 0)
        WHEN c.capture_app IN ('qc_log', 'shipment_qa') THEN COALESCE(qp.qty, 0)
        WHEN c.capture_app IN ('cutting_lay', 'cutting_bundle') THEN COALESCE(cp.qty, 0)
        ELSE COALESCE(hp.qty, 0)
      END AS produced
    FROM cards_base c
    LEFT JOIN hourly_prod hp
      ON hp.order_id = c.order_id
     AND hp.colorway_id IS NOT DISTINCT FROM c.colorway_id
     AND hp.order_route_id = c.order_route_id
    LEFT JOIN batch_prod bp
      ON bp.order_id = c.order_id
     AND bp.colorway_id IS NOT DISTINCT FROM c.colorway_id
     AND bp.order_route_id = c.order_route_id
    LEFT JOIN qc_prod qp
      ON qp.order_id = c.order_id
     AND qp.colorway_id IS NOT DISTINCT FROM c.colorway_id
     AND qp.order_route_id = c.order_route_id
    LEFT JOIN cutting_prod cp
      ON cp.order_id = c.order_id
     AND cp.colorway_id IS NOT DISTINCT FROM c.colorway_id
     AND cp.order_route_id = c.order_route_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'cards', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'allocationId', a.allocation_id,
          'orderId', a.order_id,
          'colorwayId', a.colorway_id,
          'visitId', a.visit_id,
          'orderRouteId', a.order_route_id,
          'styleName', COALESCE(a.style_name, ''),
          'styleRef', a.style_ref,
          'poNumber', a.po_number,
          'buyerId', a.buyer_id,
          'colorwayName', a.colorway_name,
          'operationName', NULLIF(a.operation_name, ''),
          'stepType', a.step_type,
          'captureApp', a.capture_app,
          'planned', COALESCE(a.planned, 0),
          'produced', COALESCE(a.produced, 0),
          'pct', CASE
            WHEN COALESCE(a.planned, 0) > 0
              THEN LEAST(ROUND((COALESCE(a.produced, 0)::numeric / a.planned) * 100), 100)
            ELSE 0
          END,
          'isCompleted', (
            a.production_completed_at IS NOT NULL
            OR a.completed_is_true IS TRUE
          ),
          'completedAt', a.production_completed_at,
          'imageUrl', a.image_url
        )
        ORDER BY a.style_name, a.colorway_name NULLS LAST, a.allocation_id
      )
      FROM assembled a
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_line_style_cards(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_line_style_cards(uuid, uuid, uuid, uuid, text)
  TO anon, authenticated, service_role;;
