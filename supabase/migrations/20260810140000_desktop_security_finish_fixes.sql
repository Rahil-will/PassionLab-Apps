-- Corrective fixes for 20260810120000_desktop_security_finish:
-- 1. NULL-safe profiles_insert_own (NULL user_role must not fail WITH CHECK)
-- 2. save_fabric_components — reject multi-primary payloads before unique index hit
-- 3. log_audit_event — no factory_id in WARNING text; explicit REVOKE from client roles

-- ---------------------------------------------------------------------------
-- 1. NULL-safe role check on profile self-insert
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND COALESCE(user_role, '') NOT IN ('admin', 'superadmin')
    AND (factory_id IS NULL OR factory_id = current_factory_id())
  );

-- ---------------------------------------------------------------------------
-- 2. save_fabric_components — upfront multi-primary guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_fabric_components(
  p_factory_id uuid,
  p_origin_department_id uuid,
  p_rows jsonb,
  p_delete_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS SETOF public.fabric_components
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_ids uuid[] := '{}'::uuid[];
  v_now timestamptz := now();
  v_primary_id uuid;
  v_primary_count int;
  v_code text;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_origin_department_id IS NULL THEN RAISE EXCEPTION 'origin_department_id is required'; END IF;

  SELECT count(*) INTO v_primary_count
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS e
  WHERE (e->>'is_primary')::boolean IS TRUE;

  IF v_primary_count > 1 THEN
    RAISE EXCEPTION 'Only one fabric component can be primary (received %)', v_primary_count;
  END IF;

  IF p_delete_ids IS NOT NULL THEN
    UPDATE public.fabric_components fc
    SET is_active = false, is_primary = false, updated_at = v_now
    WHERE fc.factory_id = p_factory_id
      AND fc.id = ANY(p_delete_ids);
  END IF;

  SELECT (elem->>'id')::uuid INTO v_primary_id
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) AS elem
  WHERE (elem->>'is_primary')::boolean IS TRUE
    AND COALESCE(elem->>'id', '') !~ '^temp_'
  LIMIT 1;

  IF v_primary_id IS NOT NULL THEN
    UPDATE public.fabric_components fc
    SET is_primary = false, updated_at = v_now
    WHERE fc.factory_id = p_factory_id AND fc.id <> v_primary_id;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    IF COALESCE(v_row->>'id', '') LIKE 'temp_%' OR NULLIF(v_row->>'id', '') IS NULL THEN
      IF (v_row->>'is_primary')::boolean IS TRUE THEN
        UPDATE public.fabric_components fc
        SET is_primary = false, updated_at = v_now
        WHERE fc.factory_id = p_factory_id;
      END IF;

      v_code := NULLIF(trim(v_row->>'code'), '');
      IF v_code IS NULL THEN
        LOOP
          v_code := 'fabric_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
          EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.fabric_components fc
            WHERE fc.factory_id = p_factory_id AND fc.code = v_code
          );
        END LOOP;
      END IF;

      INSERT INTO public.fabric_components (
        factory_id, department_id, code, fabric_type, remarks, is_primary, is_active, updated_at
      ) VALUES (
        p_factory_id, p_origin_department_id, v_code,
        trim(v_row->>'fabric_type'),
        NULLIF(trim(v_row->>'remarks'), ''),
        COALESCE((v_row->>'is_primary')::boolean, false),
        true, v_now
      )
      RETURNING id INTO v_id;
    ELSE
      v_id := (v_row->>'id')::uuid;
      UPDATE public.fabric_components fc SET
        fabric_type = trim(v_row->>'fabric_type'),
        remarks     = NULLIF(trim(v_row->>'remarks'), ''),
        is_primary  = COALESCE((v_row->>'is_primary')::boolean, fc.is_primary),
        is_active   = true,
        updated_at  = v_now
      WHERE fc.id = v_id AND fc.factory_id = p_factory_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Fabric component not found: %', v_id; END IF;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  PERFORM public.log_audit_event(
    p_factory_id, 'upsert', 'fabric_components', NULL,
    jsonb_build_object('saved_ids', to_jsonb(v_ids), 'deleted_ids', to_jsonb(COALESCE(p_delete_ids, '{}'::uuid[])))
  );

  RETURN QUERY
  SELECT fc.* FROM public.fabric_components fc
  WHERE fc.factory_id = p_factory_id AND fc.is_active = true
  ORDER BY fc.created_at ASC, fc.fabric_type ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. log_audit_event — no session factory in WARNING; owner-only EXECUTE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_factory_id uuid, p_action text, p_entity_type text,
  p_entity_id uuid DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE WARNING 'log_audit_event skipped: no auth.uid()';
    RETURN;
  END IF;
  IF p_factory_id IS NULL OR p_action IS NULL OR p_entity_type IS NULL THEN
    RAISE WARNING 'log_audit_event skipped: missing required field (action=%, entity_type=%)',
      p_action, p_entity_type;
    RETURN;
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE WARNING 'log_audit_event skipped: factory mismatch for entity_type=%', p_entity_type;
    RETURN;
  END IF;

  INSERT INTO public.audit_events (factory_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_factory_id, auth.uid(), p_action, p_entity_type, p_entity_id, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

COMMENT ON FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb) IS
  'Internal only. Callable solely from owner-owned SECURITY DEFINER RPCs. '
  'Never GRANT EXECUTE to anon or authenticated — the body has no caller authorization check, '
  'so a client-reachable grant makes this a forgeable audit-injection endpoint.';

REVOKE ALL ON FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
