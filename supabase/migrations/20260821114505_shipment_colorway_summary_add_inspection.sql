CREATE OR REPLACE FUNCTION public.get_shipment_colorway_summary(
  p_factory_id uuid,
  p_order_id uuid,
  p_colorway_id uuid
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
  IF p_factory_id IS NULL OR p_order_id IS NULL OR p_colorway_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'factoryId, orderId and colorwayId are required',
      'dept_rows', '[]'::jsonb,
      'journey', '[]'::jsonb,
      'rejections', '[]'::jsonb,
      'shipments', '[]'::jsonb,
      'inspection_failed', '[]'::jsonb,
      'rejected_by_size', '{}'::jsonb
    );
  END IF;

  WITH
  visit_ops AS (
    SELECT DISTINCT ON (
      ors.order_id,
      COALESCE(ors.visit_id::text, 'dept:' || ors.dept_id::text)
    )
      ors.factory_id,
      ors.order_id,
      ors.id AS operation_id,
      ors.visit_id,
      ors.dept_id,
      COALESCE(d.name, ors.dept_name, 'Department') AS dept_name,
      COALESCE(ors.operation_name, '') AS operation_name,
      COALESCE(ors.capture_app, 'transaction') AS capture_app,
      COALESCE(ors.step_type, 'produce') AS step_type,
      COALESCE(d.role, 'standard') AS dept_role,
      COALESCE(d.planning_mode, '') AS planning_mode,
      COALESCE(ors.is_primary_output, false) AS is_primary_output,
      COALESCE(ors.is_dept_exit_operation, false) AS is_dept_exit,
      ors.seq AS route_seq
    FROM public.order_routing_steps ors
    LEFT JOIN public.departments d ON d.id = ors.dept_id
    WHERE ors.factory_id = p_factory_id
      AND ors.order_id = p_order_id
    ORDER BY
      ors.order_id,
      COALESCE(ors.visit_id::text, 'dept:' || ors.dept_id::text),
      COALESCE(ors.is_primary_output, false) DESC,
      COALESCE(ors.is_dept_exit_operation, false) DESC,
      (COALESCE(ors.step_type, '') = 'produce') DESC,
      ors.seq DESC
  ),
  visit_ranked AS (
    SELECT v.*, ROW_NUMBER() OVER (ORDER BY v.route_seq, v.operation_id)::integer AS flow_step
    FROM visit_ops v
  ),
  op_prog AS (
    SELECT r.operation_id, r.qty_produced,
      COALESCE(r.qty_produced_by_size, '{}'::jsonb) AS qty_produced_by_size
    FROM public.operation_progress_rows(p_factory_id, p_order_id) r
    WHERE r.colorway_id IS NOT DISTINCT FROM p_colorway_id
  ),
  recv AS (
    SELECT hs.to_department_id AS dept_id, hs.to_visit_id AS visit_id,
      SUM(COALESCE(NULLIF(hs.received_qty, 0), hs.sent_qty, 0))::integer AS qty_received,
      public.jsonb_merge_sum_maps(ARRAY_AGG(
        CASE
          WHEN COALESCE(hs.received_qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.received_qty_by_size
          WHEN COALESCE(hs.qty_by_size, '{}'::jsonb) <> '{}'::jsonb THEN hs.qty_by_size
          ELSE '{}'::jsonb
        END
      )) AS qty_received_by_size
    FROM public.handover_slips hs
    WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
      AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND hs.status IN ('received', 'received_disputed', 'disputed', 'pending')
    GROUP BY hs.to_department_id, hs.to_visit_id
  ),
  sent AS (
    SELECT hs.from_department_id AS dept_id, hs.from_visit_id AS visit_id,
      SUM(COALESCE(hs.sent_qty, 0))::integer AS qty_sent,
      public.jsonb_merge_sum_maps(ARRAY_AGG(COALESCE(hs.qty_by_size, '{}'::jsonb))) AS qty_sent_by_size
    FROM public.handover_slips hs
    WHERE hs.factory_id = p_factory_id AND hs.order_id = p_order_id
      AND hs.colorway_id IS NOT DISTINCT FROM p_colorway_id
    GROUP BY hs.from_department_id, hs.from_visit_id
  ),
  recv_for_visit AS (
    SELECT v.operation_id,
      COALESCE((
        SELECT r.qty_received FROM recv r
        WHERE r.dept_id = v.dept_id AND r.visit_id IS NOT DISTINCT FROM v.visit_id
      ), (
        SELECT SUM(r.qty_received)::integer FROM recv r
        WHERE r.dept_id = v.dept_id AND v.visit_id IS NULL
      ), 0) AS qty_received,
      COALESCE((
        SELECT r.qty_received_by_size FROM recv r
        WHERE r.dept_id = v.dept_id AND r.visit_id IS NOT DISTINCT FROM v.visit_id
      ), '{}'::jsonb) AS qty_received_by_size
    FROM visit_ranked v
  ),
  sent_for_visit AS (
    SELECT v.operation_id,
      COALESCE((
        SELECT s.qty_sent FROM sent s
        WHERE s.dept_id = v.dept_id AND s.visit_id IS NOT DISTINCT FROM v.visit_id
      ), (
        SELECT SUM(s.qty_sent)::integer FROM sent s
        WHERE s.dept_id = v.dept_id AND v.visit_id IS NULL
      ), 0) AS qty_sent,
      COALESCE((
        SELECT s.qty_sent_by_size FROM sent s
        WHERE s.dept_id = v.dept_id AND s.visit_id IS NOT DISTINCT FROM v.visit_id
      ), '{}'::jsonb) AS qty_sent_by_size
    FROM visit_ranked v
  ),
  assembled AS (
    SELECT
      v.factory_id, v.order_id, p_colorway_id AS colorway_id,
      v.operation_id, v.visit_id, v.dept_id, v.dept_name, v.operation_name,
      v.flow_step, v.capture_app, v.dept_role, v.planning_mode,
      (v.dept_role = 'terminal' OR v.planning_mode = 'native_shipment') AS is_terminal_receive,
      COALESCE(rv.qty_received, 0) AS qty_received,
      COALESCE(rv.qty_received_by_size, '{}'::jsonb) AS qty_received_by_size,
      CASE
        WHEN v.dept_role = 'terminal' OR v.planning_mode = 'native_shipment'
          THEN COALESCE(op.qty_produced, 0)
        WHEN v.capture_app = 'transaction' OR v.planning_mode IN ('store', 'storage')
          THEN GREATEST(COALESCE(op.qty_produced, 0), COALESCE(sv.qty_sent, 0), COALESCE(rv.qty_received, 0))
        ELSE COALESCE(op.qty_produced, 0)
      END AS qty_produced,
      CASE
        WHEN v.capture_app = 'transaction' OR v.planning_mode IN ('store', 'storage') THEN
          CASE
            WHEN COALESCE(op.qty_produced, 0) > 0 THEN COALESCE(op.qty_produced_by_size, '{}'::jsonb)
            WHEN COALESCE(sv.qty_sent, 0) > 0 THEN COALESCE(sv.qty_sent_by_size, '{}'::jsonb)
            ELSE COALESCE(rv.qty_received_by_size, '{}'::jsonb)
          END
        ELSE COALESCE(op.qty_produced_by_size, '{}'::jsonb)
      END AS qty_produced_by_size,
      COALESCE(sv.qty_sent, 0) AS qty_sent,
      COALESCE(sv.qty_sent_by_size, '{}'::jsonb) AS qty_sent_by_size
    FROM visit_ranked v
    LEFT JOIN op_prog op ON op.operation_id = v.operation_id
    LEFT JOIN recv_for_visit rv ON rv.operation_id = v.operation_id
    LEFT JOIN sent_for_visit sv ON sv.operation_id = v.operation_id
  ),
  dept_rows AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'deptId', a.dept_id, 'deptName', a.dept_name, 'visitId', a.visit_id,
      'operationId', a.operation_id, 'operationName', NULLIF(a.operation_name, ''),
      'flowStep', a.flow_step, 'produced', a.qty_produced, 'producedBySize', a.qty_produced_by_size,
      'received', a.qty_received, 'receivedBySize', a.qty_received_by_size,
      'sent', a.qty_sent, 'sentBySize', a.qty_sent_by_size,
      'isTerminalReceive', a.is_terminal_receive
    ) ORDER BY a.flow_step), '[]'::jsonb) AS rows FROM assembled a
  ),
  journey AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'factory_id', a.factory_id, 'order_id', a.order_id, 'colorway_id', a.colorway_id,
      'operation_id', a.operation_id, 'visit_id', a.visit_id, 'dept_id', a.dept_id,
      'dept_name', a.dept_name, 'flow_step', a.flow_step, 'is_in_flow', true,
      'qty_received', a.qty_received, 'qty_produced', a.qty_produced, 'qty_sent', a.qty_sent,
      'qty_rejected', null, 'wip_qty', GREATEST(a.qty_produced - a.qty_sent, 0),
      'qty_received_by_size', a.qty_received_by_size,
      'qty_produced_by_size', a.qty_produced_by_size,
      'qty_sent_by_size', a.qty_sent_by_size,
      'status', CASE WHEN a.qty_produced <= 0 THEN 'pending'
        WHEN a.qty_sent >= a.qty_produced THEN 'completed' ELSE 'in_progress' END
    ) ORDER BY a.flow_step), '[]'::jsonb) AS rows FROM assembled a
  ),
  rej_rows AS (
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.logged_at DESC NULLS LAST), '[]'::jsonb) AS rows
    FROM public.rejections r
    WHERE r.factory_id = p_factory_id AND r.order_id = p_order_id
      AND r.colorway_id IS NOT DISTINCT FROM p_colorway_id
  ),
  insp_rows AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'colorway_id', s.colorway_id, 'department_id', s.department_id,
      'order_route_id', s.order_route_id, 'log_date', s.log_date,
      'failed', s.failed, 'failed_by_size', COALESCE(s.failed_by_size, '{}'::jsonb),
      'logged_at', s.logged_at
    ) ORDER BY s.logged_at DESC NULLS LAST), '[]'::jsonb) AS rows
    FROM public.inspection_sessions s
    WHERE s.factory_id = p_factory_id AND s.order_id = p_order_id
      AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
      AND COALESCE(s.failed, 0) > 0
  ),
  rej_by_size AS (
    SELECT COALESCE((
      SELECT jsonb_object_agg(size_key, qty) FROM (
        SELECT COALESCE(NULLIF(trim(r.size), ''), 'UNSPEC') AS size_key, SUM(r.qty)::integer AS qty
        FROM public.rejections r
        WHERE r.factory_id = p_factory_id AND r.order_id = p_order_id
          AND r.colorway_id IS NOT DISTINCT FROM p_colorway_id
        GROUP BY 1
      ) s
    ), '{}'::jsonb) AS map
  ),
  ship_rows AS (
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.logged_at DESC NULLS LAST), '[]'::jsonb) AS rows
    FROM public.shipments s
    WHERE s.factory_id = p_factory_id AND s.order_id = p_order_id
      AND s.colorway_id IS NOT DISTINCT FROM p_colorway_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'dept_rows', (SELECT rows FROM dept_rows),
    'journey', (SELECT rows FROM journey),
    'rejections', (SELECT rows FROM rej_rows),
    'shipments', (SELECT rows FROM ship_rows),
    'inspection_failed', (SELECT rows FROM insp_rows),
    'rejected_by_size', (SELECT map FROM rej_by_size)
  ) INTO v_result;

  RETURN v_result;
END;
$$;;
