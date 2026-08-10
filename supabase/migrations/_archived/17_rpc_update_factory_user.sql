-- =============================================================================
-- update_factory_user RPC
-- Scoped profile update for factory users (status/toggle and full edit).
-- Does NOT create or delete auth.users, and does NOT touch floor_pin.
-- floor_user_access/flags are managed separately via replace_floor_user_access.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_factory_user(
  p_factory_id  uuid,
  p_id          uuid,
  p_full_name   text DEFAULT NULL,
  p_status      text DEFAULT NULL,
  p_user_role   text DEFAULT NULL
)
RETURNS SETOF public.profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION 'id is required'; END IF;

  RETURN QUERY
    UPDATE public.profiles p
    SET
      full_name  = COALESCE(NULLIF(trim(p_full_name), ''), p.full_name),
      status     = COALESCE(p_status, p.status),
      user_role  = COALESCE(p_user_role, p.user_role),
      updated_at = now()
    WHERE p.id = p_id AND p.factory_id = p_factory_id
    RETURNING p.*;
END;
$$;

REVOKE ALL ON FUNCTION public.update_factory_user(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_factory_user(uuid, uuid, text, text, text) TO authenticated;
