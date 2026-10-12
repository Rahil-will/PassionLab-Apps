CREATE OR REPLACE FUNCTION public._mm_actor_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_set text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN auth.uid();
  END IF;
  IF auth.role() = 'service_role' THEN
    v_set := NULLIF(current_setting('mm.actor_user', true), '');
    IF v_set IS NOT NULL THEN
      RETURN v_set::uuid;
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_actor_factory_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_set text;
  v_actor uuid;
  v_profile uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN public.current_factory_id();
  END IF;
  IF auth.role() = 'service_role' THEN
    v_actor := public._mm_actor_id();
    v_set := NULLIF(current_setting('mm.actor_factory', true), '');
    IF v_actor IS NOT NULL AND v_set IS NOT NULL THEN
      SELECT p.factory_id INTO v_profile
      FROM public.profiles p
      WHERE p.id = v_actor;
      IF v_profile IS NOT NULL AND v_profile = v_set::uuid THEN
        RETURN v_profile;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_actor_factory_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_actor_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mm_actor_factory_id() TO authenticated, service_role;

DO $sweep$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'mm\_%' OR p.proname LIKE '\_mm\_%')
      AND p.proname NOT IN ('_mm_actor_id', '_mm_actor_factory_id')
      AND pg_get_functiondef(p.oid) LIKE '%auth.uid()%'
  LOOP
    def := replace(pg_get_functiondef(r.oid), 'auth.uid()', 'public._mm_actor_id()');
    EXECUTE def;
  END LOOP;
END;
$sweep$;

CREATE OR REPLACE FUNCTION public._mm_require_ops(p_key text DEFAULT 'mm_roll_entry')
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_apps jsonb;
BEGIN
  PERFORM public.assert_module_enabled('material');
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'NO_FACTORY';
  END IF;
  IF public.is_factory_admin() THEN
    RETURN v_factory;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor
      AND p.factory_id = v_factory
      AND p.user_role IN ('admin', 'superadmin')
  ) THEN
    RETURN v_factory;
  END IF;
  SELECT COALESCE(p.assigned_apps, '[]'::jsonb) INTO v_apps
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.factory_id = v_factory;
  IF v_apps IS NULL OR NOT (
    v_apps @> to_jsonb(ARRAY[p_key])
    OR v_apps @> '["mm_inventory"]'::jsonb
    OR v_apps @> '["mm_roll_entry"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'NO_PERMISSION';
  END IF;
  RETURN v_factory;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_require_config()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_apps jsonb;
BEGIN
  PERFORM public.assert_module_enabled('material');
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'NO_FACTORY';
  END IF;
  IF public.is_factory_admin() THEN
    RETURN v_factory;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor
      AND p.factory_id = v_factory
      AND p.user_role IN ('admin', 'superadmin')
  ) THEN
    RETURN v_factory;
  END IF;
  SELECT COALESCE(p.assigned_apps, '[]'::jsonb) INTO v_apps
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.factory_id = v_factory;
  IF v_apps IS NULL OR NOT (v_apps @> '["mm_config"]'::jsonb) THEN
    RAISE EXCEPTION 'NO_PERMISSION';
  END IF;
  RETURN v_factory;
END;
$fn$;;
