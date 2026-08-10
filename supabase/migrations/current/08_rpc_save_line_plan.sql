-- =============================================================================
-- save_line_plan RPC — visit_id grain (ops from order_routing_steps at read time)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_line_plan(
  p_factory_id     uuid,
  p_order_id       uuid,
  p_colorway_plans jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_plan            jsonb;
  v_colorway_id     uuid;
  v_alloc           jsonb;
  v_alloc_id        uuid;
  v_keep_ids        uuid[] := ARRAY[]::uuid[];
  v_visit_id        uuid;
  v_department_id   uuid;
  v_department_name text;
  v_line_id         uuid;
  v_planning_mode   text;
  v_resource_type   text;
  v_resource_dept   uuid;
BEGIN
  IF p_factory_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'factory_id and order_id are required';
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized to save planning';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders WHERE id = p_order_id AND factory_id = p_factory_id
  ) THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF p_colorway_plans IS NULL OR jsonb_typeof(p_colorway_plans) <> 'array' THEN
    RAISE EXCEPTION 'colorway_plans must be a JSON array';
  END IF;

  FOR v_plan IN SELECT value FROM jsonb_array_elements(p_colorway_plans) LOOP
    v_colorway_id := NULLIF(trim(v_plan->>'colorway_id'), '')::uuid;
    IF v_colorway_id IS NULL THEN RAISE EXCEPTION 'Each plan entry requires colorway_id'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.colorways WHERE id = v_colorway_id AND order_id = p_order_id
    ) THEN RAISE EXCEPTION 'Colorway % does not belong to order', v_colorway_id; END IF;

    v_keep_ids := ARRAY[]::uuid[];

    IF v_plan ? 'allocations' AND jsonb_typeof(v_plan->'allocations') = 'array' THEN
      FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_plan->'allocations') LOOP
        v_alloc_id := NULLIF(trim(v_alloc->>'id'), '')::uuid;
        IF v_alloc_id IS NULL THEN v_alloc_id := gen_random_uuid(); END IF;

        v_visit_id := NULLIF(trim(COALESCE(
          v_alloc->>'visit_id',
          v_alloc->>'visitId'
        )), '')::uuid;
        IF v_visit_id IS NULL THEN
          RAISE EXCEPTION 'Each allocation requires visit_id';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.order_routing_steps ors
          WHERE ors.order_id = p_order_id
            AND ors.visit_id = v_visit_id
        ) THEN
          RAISE EXCEPTION 'visit_id % is not on order route', v_visit_id;
        END IF;

        v_department_id   := NULLIF(trim(v_alloc->>'department_id'), '')::uuid;
        v_department_name := NULLIF(trim(v_alloc->>'department_name'), '');
        v_line_id         := NULLIF(trim(v_alloc->>'line_id'), '')::uuid;

        SELECT
          COALESCE(
            v_department_id,
            NULLIF(trim(ors.dept_id::text), '')::uuid
          ),
          COALESCE(v_department_name, ors.dept_name)
        INTO v_department_id, v_department_name
        FROM public.order_routing_steps ors
        WHERE ors.order_id = p_order_id
          AND ors.visit_id = v_visit_id
        ORDER BY ors.seq NULLS LAST, ors.id
        LIMIT 1;

        IF v_department_id IS NULL AND v_line_id IS NOT NULL THEN
          SELECT ar.department_id, d.name
            INTO v_department_id, v_department_name
          FROM public.assigned_resources ar
          LEFT JOIN public.departments d ON d.id = ar.department_id
          WHERE ar.id = v_line_id;
        END IF;

        IF v_department_name IS NULL AND v_department_id IS NOT NULL THEN
          SELECT name INTO v_department_name
          FROM public.departments
          WHERE id = v_department_id;
        END IF;

        IF v_department_id IS NOT NULL THEN
          SELECT d.planning_mode INTO v_planning_mode
          FROM public.departments d
          WHERE d.id = v_department_id;
        END IF;

        IF COALESCE(v_planning_mode, '') = 'outsource' AND v_line_id IS NOT NULL THEN
          SELECT ar.resource_type, ar.department_id
            INTO v_resource_type, v_resource_dept
          FROM public.assigned_resources ar
          WHERE ar.id = v_line_id;

          IF v_resource_type IS DISTINCT FROM 'outsourced' THEN
            RAISE EXCEPTION 'Outsource planning requires an outsourced vendor resource (line_id %)', v_line_id;
          END IF;
          IF v_resource_dept IS DISTINCT FROM v_department_id THEN
            RAISE EXCEPTION 'Vendor resource must belong to the outsource work center';
          END IF;
        END IF;

        INSERT INTO public.line_allocations (
          id, factory_id, order_id, colorway_id,
          line_id, department_id, department_name,
          visit_id,
          qty, daily_target, hourly_target,
          start_date, end_date, completed_is_true,
          sam, kpi_inputs, status
        ) VALUES (
          v_alloc_id, p_factory_id, p_order_id, v_colorway_id,
          v_line_id, v_department_id, v_department_name,
          v_visit_id,
          COALESCE((v_alloc->>'qty')::integer, 0),
          COALESCE((v_alloc->>'daily_target')::integer, 0),
          NULLIF(v_alloc->>'hourly_target', '')::numeric,
          NULLIF(v_alloc->>'start_date', '')::date,
          NULLIF(v_alloc->>'end_date', '')::date,
          COALESCE((v_alloc->>'completed_is_true')::boolean, false),
          NULLIF(v_alloc->>'sam', '')::numeric,
          v_alloc->'kpi_inputs',
          COALESCE(NULLIF(v_alloc->>'status', ''), 'planned')
        )
        ON CONFLICT (id) DO UPDATE SET
          line_id             = EXCLUDED.line_id,
          department_id       = EXCLUDED.department_id,
          department_name     = EXCLUDED.department_name,
          visit_id            = EXCLUDED.visit_id,
          qty                 = EXCLUDED.qty,
          daily_target        = EXCLUDED.daily_target,
          hourly_target       = EXCLUDED.hourly_target,
          start_date          = EXCLUDED.start_date,
          end_date            = EXCLUDED.end_date,
          completed_is_true   = EXCLUDED.completed_is_true,
          sam                 = EXCLUDED.sam,
          kpi_inputs          = EXCLUDED.kpi_inputs,
          status              = EXCLUDED.status,
          updated_at          = now();

        v_keep_ids := array_append(v_keep_ids, v_alloc_id);
      END LOOP;
    END IF;

    DELETE FROM public.line_allocations
    WHERE factory_id = p_factory_id
      AND order_id = p_order_id
      AND colorway_id = v_colorway_id
      AND (cardinality(v_keep_ids) = 0 OR NOT (id = ANY (v_keep_ids)));
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.save_line_plan(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_line_plan(uuid, uuid, jsonb) TO authenticated;
