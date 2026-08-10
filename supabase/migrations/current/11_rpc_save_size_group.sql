-- =============================================================================
-- save_size_group RPC
-- Atomic insert/update/delete for size_groups with factory scoping.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_size_group(
  p_action     text,
  p_factory_id uuid,
  p_id         uuid DEFAULT NULL,
  p_name       text DEFAULT NULL,
  p_buyer_id   uuid DEFAULT NULL,
  p_sizes      jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  id         uuid,
  factory_id uuid,
  buyer_id   uuid,
  name       text,
  sizes      jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id         uuid;
  v_factory_id uuid;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_action IS NULL THEN RAISE EXCEPTION 'action is required'; END IF;

  v_factory_id := p_factory_id;

  IF p_action = 'delete' THEN
    DELETE FROM public.size_groups sg WHERE sg.id = p_id AND sg.factory_id = v_factory_id;
    RETURN;
  END IF;

  IF p_action NOT IN ('insert', 'update') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;

  IF p_action = 'insert' THEN
    v_id := COALESCE(p_id, gen_random_uuid());
    INSERT INTO public.size_groups (id, factory_id, buyer_id, name, sizes)
    VALUES (v_id, v_factory_id, p_buyer_id, trim(p_name), COALESCE(p_sizes, '[]'::jsonb));
  ELSE
    v_id := p_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'id is required for update'; END IF;
    UPDATE public.size_groups sg SET
      name       = trim(p_name),
      buyer_id   = p_buyer_id,
      sizes      = COALESCE(p_sizes, '[]'::jsonb),
      updated_at = now()
    WHERE sg.id = v_id AND sg.factory_id = v_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Size group not found'; END IF;
  END IF;

  RETURN QUERY SELECT sg.id, sg.factory_id, sg.buyer_id, sg.name, sg.sizes, sg.created_at, sg.updated_at FROM public.size_groups sg WHERE sg.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_size_group(text, uuid, uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_size_group(text, uuid, uuid, text, uuid, jsonb) TO authenticated;
