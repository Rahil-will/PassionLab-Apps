-- =============================================================================
-- save_process_flow RPC
-- Atomic insert/update/delete/version for process_flows.
-- Validates duplicate step labels scoped to visit_number and preserves step ids.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_process_flow(
  p_action      text,
  p_factory_id  uuid,
  p_id          uuid DEFAULT NULL,
  p_old_id      uuid DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_steps       jsonb DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  factory_id  uuid,
  name        text,
  description text,
  steps       jsonb,
  created_at  timestamptz,
  updated_at  timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
  v_steps      jsonb;
  v_dup_visit  int;
  v_dup_label  text;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    DELETE FROM public.process_flows pf WHERE pf.id = p_id AND pf.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update', 'version') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Process flow name is required';
  END IF;

  v_steps := COALESCE(p_steps, '[]'::jsonb);
  IF jsonb_typeof(v_steps) <> 'array' THEN
    RAISE EXCEPTION 'Steps must be an array';
  END IF;

  -- Validate duplicate operation label per visit_number
  SELECT t.vn, t.label
    INTO v_dup_visit, v_dup_label
  FROM (
    SELECT (elem->>'visit_number')::int AS vn, lower(trim(elem->>'name')) AS label
    FROM jsonb_array_elements(v_steps) elem
    WHERE elem->>'name' IS NOT NULL AND trim(elem->>'name') <> ''
  ) t
  GROUP BY t.vn, t.label
  HAVING count(*) > 1
  LIMIT 1;

  IF v_dup_visit IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate operation label "%" in visit %', v_dup_label, 'visit_' || v_dup_visit;
  END IF;

  IF p_action = 'update' THEN
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.process_flows pf SET
      name        = COALESCE(trim(p_name), pf.name),
      description = COALESCE(NULLIF(trim(p_description), ''), pf.description),
      steps       = CASE WHEN p_steps IS NOT NULL THEN v_steps ELSE pf.steps END,
      updated_at  = now()
    WHERE pf.id = v_id AND pf.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Process flow not found'; END IF;
  ELSE
    v_id := COALESCE(p_id, gen_random_uuid());
    IF p_action = 'version' AND p_old_id IS NOT NULL THEN
      DELETE FROM public.process_flows pf WHERE pf.id = p_old_id AND pf.factory_id = v_factory_id;
    END IF;
    INSERT INTO public.process_flows (id, factory_id, name, description, steps)
    VALUES (v_id, v_factory_id, trim(p_name), NULLIF(trim(p_description), ''), v_steps);
  END IF;

  RETURN QUERY SELECT pf.id, pf.factory_id, pf.name, pf.description, pf.steps, pf.created_at, pf.updated_at FROM public.process_flows pf WHERE pf.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_process_flow(text, uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_process_flow(text, uuid, uuid, uuid, text, text, jsonb) TO authenticated;
