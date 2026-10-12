-- When any cutting session is saved with cut qty (primary or secondary fabric),
-- promote style_orders.status from Not Started → Started.

CREATE OR REPLACE FUNCTION public.mark_style_order_started(
  p_factory_id uuid,
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_factory_id IS NULL OR p_order_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.style_orders
  SET
    status = 'Started',
    updated_at = now()
  WHERE id = p_order_id
    AND factory_id = p_factory_id
    AND COALESCE(status, 'Not Started') = 'Not Started';
END;
$$;

REVOKE ALL ON FUNCTION public.mark_style_order_started(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_style_order_started(uuid, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.floor_capture_cutting_session_upsert(
  p_factory_id uuid,
  p_user_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_department_id uuid;
  v_payload_dept uuid;
  v_order_id uuid;
  v_colorway_id uuid;
  v_order_route_id uuid;
  v_resource_id uuid;
  v_session_no text;
  v_ref_no text;
  v_fabric_type text;
  v_fabric_component_id uuid;
  v_comments text;
  v_size_ratio jsonb;
  v_log_date date;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_headcount jsonb;
  v_total_headcount integer;
  v_existing_id uuid;
  v_id uuid;
  v_cumulative jsonb;
  v_line_allocation_id uuid;
  v_shift_id uuid;
  v_produced_qty integer;
  v_kpi record;
  v_row jsonb;
BEGIN
  SELECT p.department_id INTO v_profile_department_id
  FROM public.profiles p
  WHERE p.id = p_user_id AND p.factory_id = p_factory_id AND p.status = 'Active';

  IF v_profile_department_id IS NULL THEN
    RETURN public.floor_capture_fail('Active profile required', 'NO_PROFILE');
  END IF;

  IF NOT public.profile_dept_can_capture_cutting(p_user_id, p_factory_id) THEN
    RETURN public.floor_capture_fail('Not authorized for cutting', 'REQUIRE_APP_LAY_REPORT');
  END IF;

  v_payload_dept := NULLIF(p_payload->>'departmentId', '')::uuid;
  IF v_payload_dept IS DISTINCT FROM v_profile_department_id THEN
    RETURN public.floor_capture_fail('departmentId must match user department', 'DEPT_MISMATCH');
  END IF;

  v_order_id := NULLIF(p_payload->>'orderId', '')::uuid;
  IF v_order_id IS NULL THEN
    RETURN public.floor_capture_fail('orderId is required', 'INVALID_ORDER');
  END IF;

  v_colorway_id := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_order_route_id := NULLIF(p_payload->>'orderRouteId', '')::uuid;
  v_resource_id := NULLIF(p_payload->>'resourceId', '')::uuid;
  v_shift_id := NULLIF(p_payload->>'shiftId', '')::uuid;
  v_session_no := trim(COALESCE(p_payload->>'sessionNo', p_payload->>'cutNo', ''));
  IF v_session_no = '' THEN
    RETURN public.floor_capture_fail('sessionNo is required', 'MISSING_SESSION_NO');
  END IF;

  v_fabric_component_id := NULLIF(p_payload->>'fabricComponentId', '')::uuid;
  v_fabric_type := trim(COALESCE(NULLIF(p_payload->>'fabricType', ''), 'Shell'));
  IF v_fabric_type = '' THEN
    RETURN public.floor_capture_fail('fabricType is required', 'INVALID_FABRIC_TYPE');
  END IF;

  IF v_fabric_component_id IS NOT NULL THEN
    SELECT fc.fabric_type INTO v_fabric_type
    FROM public.fabric_components fc
    WHERE fc.id = v_fabric_component_id AND fc.factory_id = p_factory_id;
    IF v_fabric_type IS NULL THEN
      RETURN public.floor_capture_fail('Invalid fabric component', 'INVALID_FABRIC_COMPONENT');
    END IF;
  ELSIF v_fabric_type IS NOT NULL THEN
    v_fabric_component_id := public.resolve_fabric_component_id(p_factory_id, v_fabric_type);
  END IF;

  v_ref_no := NULLIF(trim(COALESCE(p_payload->>'refNo', '')), '');
  v_comments := NULLIF(trim(COALESCE(p_payload->>'comments', '')), '');
  v_size_ratio := COALESCE(p_payload->'sizeRatio', '{}'::jsonb);
  v_log_date := COALESCE((p_payload->>'logDate')::date, CURRENT_DATE);
  v_headcount := COALESCE(p_payload->'headcountByCategory', '{}'::jsonb);
  v_total_headcount := public.jsonb_sum_int_values(v_headcount);

  v_start_time := (p_payload->>'startTime')::timestamptz;
  v_end_time := (p_payload->>'endTime')::timestamptz;
  IF v_start_time IS NULL OR v_end_time IS NULL OR v_end_time <= v_start_time THEN
    RETURN public.floor_capture_fail('Invalid start/end time', 'INVALID_TIME');
  END IF;

  v_line_allocation_id := NULLIF(p_payload->>'lineAllocationId', '')::uuid;
  IF v_line_allocation_id IS NULL THEN
    v_row := jsonb_build_object(
      'order_route_id', v_order_route_id,
      'operation_id', NULLIF(p_payload->>'operationId', '')::uuid,
      'flow_step_id', NULLIF(p_payload->>'flowStepId', '')::uuid,
      'colorway_id', v_colorway_id,
      'resource_id', v_resource_id,
      'line_allocation_id', NULL
    );
    v_order_route_id := COALESCE(v_order_route_id, public.capture_route_step_id(v_row));
    v_line_allocation_id := public.resolve_line_allocation_id(
      v_order_id, v_colorway_id, v_resource_id, v_order_route_id
    );
  END IF;

  SELECT s.id INTO v_existing_id
  FROM public.cutting_sessions s
  WHERE s.factory_id = p_factory_id
    AND s.order_id = v_order_id
    AND s.colorway_id IS NOT DISTINCT FROM v_colorway_id
    AND s.session_no = v_session_no;

  v_id := COALESCE(NULLIF(p_payload->>'id', '')::uuid, v_existing_id, gen_random_uuid());

  v_cumulative := COALESCE(p_payload->'sessionCutBySize', '{}'::jsonb);
  v_produced_qty := public.jsonb_sum_int_values(v_cumulative);

  SELECT * INTO v_kpi
  FROM public.compute_capture_session_kpi(
    p_factory_id,
    v_order_id,
    v_colorway_id,
    v_profile_department_id,
    v_resource_id,
    v_log_date,
    v_order_route_id,
    v_start_time,
    v_end_time,
    v_headcount,
    v_produced_qty
  );

  INSERT INTO public.cutting_sessions (
    id, factory_id, order_id, colorway_id, department_id, order_route_id, resource_id,
    line_allocation_id, shift_id, session_no, ref_no, fabric_type, fabric_component_id, cutting_table,
    comments, size_ratio, log_date, start_time, end_time, headcount_by_category, total_headcount,
    cumulative_cut_by_size,
    duration_mins, available_mins, sam, produced_mins, efficiency_pct,
    logged_by, logged_at
  )
  VALUES (
    v_id, p_factory_id, v_order_id, v_colorway_id, v_profile_department_id, v_order_route_id, v_resource_id,
    v_line_allocation_id, v_shift_id, v_session_no, v_ref_no, v_fabric_type, v_fabric_component_id, NULL,
    v_comments, v_size_ratio, v_log_date, v_start_time, v_end_time, v_headcount, v_total_headcount,
    v_cumulative,
    v_kpi.duration_mins, v_kpi.available_mins, v_kpi.sam, v_kpi.produced_mins, v_kpi.efficiency_pct,
    p_user_id, now()
  )
  ON CONFLICT (id) DO UPDATE SET
    ref_no = EXCLUDED.ref_no,
    fabric_type = EXCLUDED.fabric_type,
    fabric_component_id = COALESCE(EXCLUDED.fabric_component_id, public.cutting_sessions.fabric_component_id),
    resource_id = EXCLUDED.resource_id,
    line_allocation_id = COALESCE(EXCLUDED.line_allocation_id, public.cutting_sessions.line_allocation_id),
    shift_id = EXCLUDED.shift_id,
    comments = EXCLUDED.comments,
    size_ratio = EXCLUDED.size_ratio,
    log_date = EXCLUDED.log_date,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    headcount_by_category = EXCLUDED.headcount_by_category,
    total_headcount = EXCLUDED.total_headcount,
    cumulative_cut_by_size = EXCLUDED.cumulative_cut_by_size,
    duration_mins = EXCLUDED.duration_mins,
    available_mins = EXCLUDED.available_mins,
    sam = EXCLUDED.sam,
    produced_mins = EXCLUDED.produced_mins,
    efficiency_pct = EXCLUDED.efficiency_pct,
    logged_by = EXCLUDED.logged_by,
    logged_at = now();

  IF COALESCE(v_produced_qty, 0) > 0 THEN
    PERFORM public.mark_style_order_started(p_factory_id, v_order_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'cumulativeCutBySize', v_cumulative,
    'durationMins', v_kpi.duration_mins,
    'availableMins', v_kpi.available_mins,
    'sam', v_kpi.sam,
    'producedMins', v_kpi.produced_mins,
    'efficiencyPct', v_kpi.efficiency_pct,
    'shiftId', v_shift_id,
    'lineAllocationId', v_line_allocation_id,
    'fabricComponentId', v_fabric_component_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_capture_cutting_session_upsert(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.floor_capture_cutting_session_upsert(uuid, uuid, jsonb)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cutting_refresh_session_total(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_factory_id uuid;
  v_order_id uuid;
BEGIN
  UPDATE public.cutting_sessions s
  SET total_qty = COALESCE((
    SELECT SUM(l.total_qty)::integer
    FROM public.cutting_session_lots l
    WHERE l.session_id = p_session_id
  ), 0)
  WHERE s.id = p_session_id
  RETURNING s.total_qty, s.factory_id, s.order_id
  INTO v_total, v_factory_id, v_order_id;

  IF COALESCE(v_total, 0) > 0 THEN
    PERFORM public.mark_style_order_started(v_factory_id, v_order_id);
  END IF;
END;
$$;

UPDATE public.style_orders so
SET
  status = 'Started',
  updated_at = now()
WHERE COALESCE(so.status, 'Not Started') = 'Not Started'
  AND EXISTS (
    SELECT 1
    FROM public.cutting_sessions cs
    WHERE cs.order_id = so.id
      AND cs.factory_id = so.factory_id
      AND (
        COALESCE(cs.total_qty, 0) > 0
        OR public.jsonb_sum_int_values(COALESCE(cs.cumulative_cut_by_size, '{}'::jsonb)) > 0
      )
  );;
