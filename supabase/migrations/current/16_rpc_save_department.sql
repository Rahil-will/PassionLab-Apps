-- =============================================================================
-- save_department RPC
-- Atomic insert/update/delete for departments + optional nested collections.
-- Insert path seeds workforce rates, defects, and reference operations when
-- the caller provides the payloads. Update only touches nested collections
-- that are explicitly passed. Store/outsource departments should pass NULL
-- for defects/workforce-rates payloads (intentional behaviour fix).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_department(
  p_action           text,
  p_factory_id       uuid,
  p_id               uuid DEFAULT NULL,
  p_department       jsonb DEFAULT '{}'::jsonb,
  p_defects          jsonb DEFAULT NULL,
  p_workforce_rates  jsonb DEFAULT NULL,
  p_operations       jsonb DEFAULT NULL
)
RETURNS TABLE (
  id                 uuid,
  factory_id         uuid,
  name               text,
  role               text,
  is_native          boolean,
  sequence           integer,
  planning_mode      text,
  transaction_enabled boolean,
  supervisor_enabled boolean,
  created_at         timestamptz,
  updated_at         timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
  v_name       text;
  v_role       text;
  v_is_native  boolean;
  v_sequence   integer;
  v_planning_mode text;
  v_transaction_enabled boolean;
  v_supervisor_enabled  boolean;
  v_rate       jsonb;
  v_op         jsonb;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for delete'; END IF;
    DELETE FROM public.assigned_resources WHERE department_id = v_id AND factory_id = v_factory_id;
    DELETE FROM public.defects WHERE department_id = v_id AND factory_id = v_factory_id;
    DELETE FROM public.department_workforce_rates WHERE department_id = v_id AND factory_id = v_factory_id;
    DELETE FROM public.operations WHERE department_id = v_id AND factory_id = v_factory_id;
    DELETE FROM public.fabric_components WHERE department_id = v_id AND factory_id = v_factory_id;
    DELETE FROM public.departments d WHERE d.id = v_id AND d.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_department IS NULL OR p_department = '{}'::jsonb THEN
    RAISE EXCEPTION 'department payload is required';
  END IF;

  v_name       := NULLIF(trim(p_department ->> 'name'), '');
  v_role       := NULLIF(p_department ->> 'role', '');
  v_is_native  := COALESCE((p_department -> 'is_native')::boolean, false);
  v_sequence   := COALESCE((p_department ->> 'sequence')::int, 0);
  v_planning_mode := NULLIF(p_department ->> 'planning_mode', '');
  v_transaction_enabled := COALESCE((p_department -> 'transaction_enabled')::boolean, true);
  v_supervisor_enabled  := COALESCE((p_department -> 'supervisor_enabled')::boolean, false);

  IF p_action = 'insert' AND v_name IS NULL THEN RAISE EXCEPTION 'Department name is required'; END IF;
  IF p_action = 'insert' AND v_role IS NULL THEN RAISE EXCEPTION 'Department role is required'; END IF;
  IF p_action = 'insert' AND v_planning_mode IS NULL THEN RAISE EXCEPTION 'planning_mode is required'; END IF;

  IF p_action = 'insert' THEN
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.departments (
      id, factory_id, name, role, is_native, sequence, planning_mode,
      transaction_enabled, supervisor_enabled
    ) VALUES (
      v_id, v_factory_id, v_name, v_role, v_is_native, v_sequence, v_planning_mode,
      v_transaction_enabled, v_supervisor_enabled
    );

    -- Seed workforce rates when provided (not for terminal departments)
    IF p_workforce_rates IS NOT NULL AND jsonb_typeof(p_workforce_rates) = 'array' AND jsonb_array_length(p_workforce_rates) > 0 THEN
      FOR v_rate IN SELECT jsonb_array_elements(p_workforce_rates) LOOP
        INSERT INTO public.department_workforce_rates (
          factory_id, department_id, label, shift_id, cost_per_hour,
          effective_month, is_current, sort_order
        ) VALUES (
          v_factory_id,
          v_id,
          v_rate ->> 'label',
          (v_rate ->> 'shift_id')::uuid,
          COALESCE((v_rate ->> 'cost_per_hour')::numeric, 0),
          COALESCE(NULLIF(v_rate ->> 'effective_month', '')::date, CURRENT_DATE),
          COALESCE((v_rate ->> 'is_current')::boolean, true),
          COALESCE((v_rate ->> 'sort_order')::int, 0)
        );
      END LOOP;
    END IF;

    -- Seed defects when provided (caller decides based on role/planning mode)
    IF p_defects IS NOT NULL AND jsonb_typeof(p_defects) = 'array' AND jsonb_array_length(p_defects) > 0 THEN
      DELETE FROM public.defects WHERE department_id = v_id AND factory_id = v_factory_id;
      INSERT INTO public.defects (factory_id, department_id, defects)
      VALUES (v_factory_id, v_id, p_defects);
    END IF;

    -- Seed reference operations when provided (storage / outsource)
    IF p_operations IS NOT NULL AND jsonb_typeof(p_operations) = 'array' AND jsonb_array_length(p_operations) > 0 THEN
      FOR v_op IN SELECT jsonb_array_elements(p_operations) LOOP
        INSERT INTO public.operations (
          factory_id, department_id, name, step_type, capture_app, is_active
        ) VALUES (
          v_factory_id,
          v_id,
          v_op ->> 'name',
          COALESCE(v_op ->> 'step_type', 'produce'),
          v_op ->> 'capture_app',
          COALESCE((v_op ->> 'is_active')::boolean, true)
        );
      END LOOP;
    END IF;
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.departments d SET
      name                = COALESCE(v_name, d.name),
      role                = COALESCE(v_role, d.role),
      is_native           = COALESCE(v_is_native, d.is_native),
      sequence            = COALESCE(v_sequence, d.sequence),
      planning_mode       = COALESCE(v_planning_mode, d.planning_mode),
      transaction_enabled = COALESCE(v_transaction_enabled, d.transaction_enabled),
      supervisor_enabled  = COALESCE(v_supervisor_enabled, d.supervisor_enabled),
      updated_at          = now()
    WHERE d.id = v_id AND d.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Department not found'; END IF;

    -- Replace nested collections only when caller explicitly provides them
    IF p_defects IS NOT NULL AND jsonb_typeof(p_defects) = 'array' THEN
      DELETE FROM public.defects WHERE department_id = v_id AND factory_id = v_factory_id;
      IF jsonb_array_length(p_defects) > 0 THEN
        INSERT INTO public.defects (factory_id, department_id, defects)
        VALUES (v_factory_id, v_id, p_defects);
      END IF;
    END IF;

    IF p_workforce_rates IS NOT NULL AND jsonb_typeof(p_workforce_rates) = 'array' THEN
      DELETE FROM public.department_workforce_rates WHERE department_id = v_id AND factory_id = v_factory_id;
      FOR v_rate IN SELECT jsonb_array_elements(p_workforce_rates) LOOP
        INSERT INTO public.department_workforce_rates (
          factory_id, department_id, label, shift_id, cost_per_hour,
          effective_month, is_current, sort_order
        ) VALUES (
          v_factory_id,
          v_id,
          v_rate ->> 'label',
          (v_rate ->> 'shift_id')::uuid,
          COALESCE((v_rate ->> 'cost_per_hour')::numeric, 0),
          COALESCE(NULLIF(v_rate ->> 'effective_month', '')::date, CURRENT_DATE),
          COALESCE((v_rate ->> 'is_current')::boolean, true),
          COALESCE((v_rate ->> 'sort_order')::int, 0)
        );
      END LOOP;
    END IF;

    IF p_operations IS NOT NULL AND jsonb_typeof(p_operations) = 'array' THEN
      DELETE FROM public.operations WHERE department_id = v_id AND factory_id = v_factory_id;
      FOR v_op IN SELECT jsonb_array_elements(p_operations) LOOP
        INSERT INTO public.operations (
          factory_id, department_id, name, step_type, capture_app, is_active
        ) VALUES (
          v_factory_id,
          v_id,
          v_op ->> 'name',
          COALESCE(v_op ->> 'step_type', 'produce'),
          v_op ->> 'capture_app',
          COALESCE((v_op ->> 'is_active')::boolean, true)
        );
      END LOOP;
    END IF;
  END IF;

  RETURN QUERY SELECT d.id, d.factory_id, d.name, d.role, d.is_native, d.sequence, d.planning_mode, d.transaction_enabled, d.supervisor_enabled, d.created_at, d.updated_at FROM public.departments d WHERE d.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_department(text, uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_department(text, uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;
