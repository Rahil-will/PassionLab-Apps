-- =============================================================================
-- Shared helper functions
-- NOTE: Do NOT use DROP CASCADE on these functions — it will silently drop all
-- dependent RLS policies. CREATE OR REPLACE handles updates safely.
-- =============================================================================


-- Automatically updates updated_at on any table that has it
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Returns the factory_id for the current user (JWT first, then profile row fallback).
CREATE OR REPLACE FUNCTION public.current_factory_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
  SELECT COALESCE(
    NULLIF(
      COALESCE(
        current_setting('request.jwt.claims', true)::jsonb->>'factory_id',
        current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'factory_id',
        current_setting('request.jwt.claims', true)::jsonb->'user_metadata'->>'factory_id'
      ),
      ''
    )::uuid,
    (SELECT p.factory_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
  );
$$;

-- Returns true if the current user is factory admin (JWT first, then profile row fallback).
CREATE OR REPLACE FUNCTION public.is_factory_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
  SELECT COALESCE(
    COALESCE(
      current_setting('request.jwt.claims', true)::jsonb->>'user_role',
      current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'user_role',
      current_setting('request.jwt.claims', true)::jsonb->'user_metadata'->>'user_role'
    ) IN ('admin','superadmin'),
    (SELECT p.user_role IN ('admin','superadmin') FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    false
  );
$$;

-- =============================================================================
-- Custom Access Token Hook
-- Injects factory_id and user_role from profiles into every JWT.
-- Enable in: Dashboard → Authentication → Hooks → Custom Access Token
-- URI: pg-functions://postgres/public/custom_access_token_hook
-- =============================================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth AS $$
DECLARE
  claims    jsonb;
  v_factory uuid;
  v_role    text;
BEGIN
  claims := event->'claims';
  BEGIN
    SELECT p.factory_id, p.user_role INTO v_factory, v_role
    FROM public.profiles p
    WHERE p.id = (event->>'user_id')::uuid LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RETURN event;
  END;
  IF v_factory IS NOT NULL THEN
    claims := jsonb_set(claims, '{factory_id}', to_jsonb(v_factory::text));
  END IF;
  IF v_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  END IF;
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT SELECT ON public.profiles TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;

-- Returns the next sequential internal order number for a factory (zero-padded to 5 digits)
CREATE OR REPLACE FUNCTION public.next_internal_order_no(p_factory_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next integer;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(internal_order_no,'\D','','g'),'')::integer), 0) + 1
  INTO v_next
  FROM public.style_orders
  WHERE factory_id = p_factory_id;
  RETURN lpad(v_next::text, 5, '0');
END;
$$;
