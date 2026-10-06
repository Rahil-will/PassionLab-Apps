-- =============================================================================
-- save_order_routing RPC — atomic replace of order-level routing steps.
-- Freezes operation_name, step_type, capture_app from the operations catalog
-- at the moment of save. operation_def_id is a stable lineage pointer.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_order_routing(
  p_factory_id uuid,
  p_order_id   uuid,
  p_steps      jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step           jsonb;
  v_id             uuid;
  v_keep           uuid[] := ARRAY[]::uuid[];
  v_op_id          uuid;
  v_op             public.operations%ROWTYPE;
  v_dept_id        uuid;
  v_dept_name      text;
  v_visit_id       uuid;
  v_affected       uuid[] := ARRAY[]::uuid[];
  r                RECORD;
BEGIN
  IF p_factory_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'factory_id and order_id are required';
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch';
  END IF;
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized to save routing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders WHERE id = p_order_id AND factory_id = p_factory_id
  ) THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'steps must be a JSON array';
  END IF;

  -- First route save for this order clears any stale line allocations.
  IF NOT EXISTS (
    SELECT 1 FROM public.order_routing_steps
    WHERE factory_id = p_factory_id AND order_id = p_order_id
  ) THEN
    DELETE FROM public.line_allocations
    WHERE factory_id = p_factory_id AND order_id = p_order_id;
  END IF;

  CREATE TEMP TABLE _incoming_route_steps (
    id                     uuid NOT NULL,
    seq                    integer NOT NULL,
    operation_def_id       uuid NOT NULL,
    operation_name         text,
    step_type              text,
    capture_app            text,
    dept_id                uuid,
    dept_name              text,
    transaction_app        boolean,
    is_primary_output      boolean,
    is_dept_exit_operation boolean,
    visit_id               uuid NOT NULL,
    visit_no               integer
  ) ON COMMIT DROP;

  FOR v_step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
    v_id := NULLIF(trim(v_step->>'id'), '')::uuid;
    IF v_id IS NULL THEN v_id := gen_random_uuid(); END IF;

    v_op_id := NULLIF(trim(COALESCE(
      v_step->>'operation_def_id',
      v_step->>'operationDefId'
    )), '')::uuid;
    IF v_op_id IS NULL THEN
      RAISE EXCEPTION 'Each routing step requires operation_def_id (catalog operation)';
    END IF;

    SELECT * INTO v_op FROM public.operations
    WHERE id = v_op_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Operation definition % not found', v_op_id;
    END IF;

    v_dept_id := v_op.department_id;
    SELECT name INTO v_dept_name FROM public.departments WHERE id = v_dept_id;
    v_visit_id := NULLIF(trim(v_step->>'visit_id'), '')::uuid;
    IF v_visit_id IS NULL THEN v_visit_id := gen_random_uuid(); END IF;

    INSERT INTO _incoming_route_steps (
      id, seq, operation_def_id, operation_name, step_type, capture_app,
      dept_id, dept_name, transaction_app, is_primary_output, is_dept_exit_operation, visit_id
    ) VALUES (
      v_id,
      COALESCE((v_step->>'seq')::integer, (v_step->>'flow_step')::integer, 1),
      v_op_id,
      v_op.name,
      v_op.step_type,
      v_op.capture_app,
      v_dept_id,
      COALESCE(v_dept_name, 'Department'),
      COALESCE((v_step->>'transaction_app')::boolean, true),
      COALESCE((v_step->>'is_primary_output')::boolean, false),
      COALESCE((v_step->>'is_dept_exit_operation')::boolean, false),
      v_visit_id
    );
    v_keep := array_append(v_keep, v_id);
  END LOOP;

  -- Compute visit_no: sequential number per distinct visit_id ordered by min(seq)
  UPDATE _incoming_route_steps t
  SET visit_no = sub.visit_no
  FROM (
    SELECT visit_id, dense_rank() OVER (ORDER BY min(seq)) AS visit_no
    FROM _incoming_route_steps
    GROUP BY visit_id
  ) sub
  WHERE t.visit_id = sub.visit_id;

  -- Remove line_allocations for visits that are no longer on the route.
  FOR r IN
    SELECT DISTINCT ors.visit_id
    FROM public.order_routing_steps ors
    WHERE ors.factory_id = p_factory_id
      AND ors.order_id = p_order_id
      AND ors.visit_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM _incoming_route_steps irs
        WHERE irs.visit_id = ors.visit_id
      )
  LOOP
    v_affected := array_append(v_affected, r.visit_id);
  END LOOP;

  IF cardinality(v_affected) > 0 THEN
    DELETE FROM public.line_allocations la
    WHERE la.factory_id = p_factory_id
      AND la.order_id = p_order_id
      AND la.visit_id = ANY (v_affected);
  END IF;

  -- Remove orphan batch production rows when their route step disappears.
  IF to_regclass('public.batch_production') IS NOT NULL THEN
    DELETE FROM public.batch_production bp
    WHERE bp.factory_id = p_factory_id
      AND bp.order_id = p_order_id
      AND bp.order_route_id IN (
        SELECT ors.id
        FROM public.order_routing_steps ors
        WHERE ors.factory_id = p_factory_id
          AND ors.order_id = p_order_id
          AND (cardinality(v_keep) = 0 OR NOT (ors.id = ANY (v_keep)))
      );
  END IF;

  -- Avoid unique (order_id, seq) conflicts during the upsert pass.
  UPDATE public.order_routing_steps
  SET seq = seq + 100000
  WHERE factory_id = p_factory_id
    AND order_id = p_order_id;

  FOR r IN SELECT * FROM _incoming_route_steps ORDER BY seq LOOP
    INSERT INTO public.order_routing_steps (
      id, factory_id, order_id, seq,
      dept_id, dept_name, step_type, capture_app,
      transaction_app, operation_name, operation_def_id,
      is_primary_output, is_dept_exit_operation, visit_id, visit_no
    ) VALUES (
      r.id, p_factory_id, p_order_id, r.seq,
      r.dept_id, r.dept_name, r.step_type, r.capture_app,
      r.transaction_app, r.operation_name, r.operation_def_id,
      r.is_primary_output, r.is_dept_exit_operation, r.visit_id, r.visit_no
    )
    ON CONFLICT (id) DO UPDATE SET
      seq                    = EXCLUDED.seq,
      dept_id                = EXCLUDED.dept_id,
      dept_name              = EXCLUDED.dept_name,
      step_type              = EXCLUDED.step_type,
      capture_app            = EXCLUDED.capture_app,
      transaction_app        = EXCLUDED.transaction_app,
      operation_name         = EXCLUDED.operation_name,
      operation_def_id       = EXCLUDED.operation_def_id,
      is_primary_output      = EXCLUDED.is_primary_output,
      is_dept_exit_operation = EXCLUDED.is_dept_exit_operation,
      visit_id               = EXCLUDED.visit_id,
      visit_no               = EXCLUDED.visit_no,
      updated_at             = now();
  END LOOP;

  DELETE FROM public.order_routing_steps
  WHERE factory_id = p_factory_id
    AND order_id = p_order_id
    AND (cardinality(v_keep) = 0 OR NOT (id = ANY (v_keep)));
END;
$$;

REVOKE ALL ON FUNCTION public.save_order_routing(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_order_routing(uuid, uuid, jsonb) TO authenticated;
