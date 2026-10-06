-- Desktop security finish (PRODIGI admin SPA only — no floor/plapps changes):
-- JWT claims hygiene, fabric component bugs, audit observability, index cleanup.

-- ---------------------------------------------------------------------------
-- A. JWT claims hygiene
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'user_role', ''),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'user_role', ''),
    (SELECT p.user_role FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    ''
  );
$$;
CREATE OR REPLACE FUNCTION public.is_factory_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.current_user_role() IN ('admin', 'superadmin');
$$;
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.current_user_role() = 'superadmin';
$$;
CREATE OR REPLACE FUNCTION public.current_factory_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT COALESCE(
    NULLIF(
      COALESCE(
        current_setting('request.jwt.claims', true)::jsonb->>'factory_id',
        current_setting('request.jwt.claims', true)::jsonb->'app_metadata'->>'factory_id'
      ),
      ''
    )::uuid,
    (SELECT p.factory_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
  );
$$;
DROP POLICY IF EXISTS factories_select ON public.factories;
CREATE POLICY factories_select ON public.factories
  FOR SELECT TO authenticated
  USING (id = current_factory_id() OR is_superadmin());
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid()
    AND user_role NOT IN ('admin', 'superadmin')
    AND (factory_id IS NULL OR factory_id = current_factory_id())
  );
-- ---------------------------------------------------------------------------
-- B. fabric_components — code collision, primary slot, index
-- ---------------------------------------------------------------------------
UPDATE public.fabric_components
SET is_primary = false
WHERE is_active = false AND is_primary;
DROP INDEX IF EXISTS public.fabric_components_primary_uidx;
CREATE UNIQUE INDEX fabric_components_primary_uidx
  ON public.fabric_components (factory_id)
  WHERE is_primary AND is_active;
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
  v_code text;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_origin_department_id IS NULL THEN RAISE EXCEPTION 'origin_department_id is required'; END IF;

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
        p_factory_id,
        p_origin_department_id,
        v_code,
        trim(v_row->>'fabric_type'),
        NULLIF(trim(v_row->>'remarks'), ''),
        COALESCE((v_row->>'is_primary')::boolean, false),
        true,
        v_now
      )
      RETURNING id INTO v_id;
    ELSE
      v_id := (v_row->>'id')::uuid;
      UPDATE public.fabric_components fc SET
        fabric_type = trim(v_row->>'fabric_type'),
        remarks = NULLIF(trim(v_row->>'remarks'), ''),
        is_primary = COALESCE((v_row->>'is_primary')::boolean, fc.is_primary),
        is_active = true,
        updated_at = v_now
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
  SELECT fc.*
  FROM public.fabric_components fc
  WHERE fc.factory_id = p_factory_id
    AND fc.is_active = true
  ORDER BY fc.created_at ASC, fc.fabric_type ASC;
END;
$$;
-- ---------------------------------------------------------------------------
-- C. log_audit_event — trust caller RPCs; warn instead of silent skip
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_factory_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE WARNING 'log_audit_event skipped: no auth.uid()';
    RETURN;
  END IF;
  IF p_factory_id IS NULL OR p_action IS NULL OR p_entity_type IS NULL THEN
    RAISE WARNING 'log_audit_event skipped: missing required field (factory_id=%, action=%, entity_type=%)',
      p_factory_id, p_action, p_entity_type;
    RETURN;
  END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE WARNING 'log_audit_event skipped: factory mismatch (requested=%, session=%)',
      p_factory_id, public.current_factory_id();
    RETURN;
  END IF;

  INSERT INTO public.audit_events (factory_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_factory_id,
    auth.uid(),
    p_action,
    p_entity_type,
    p_entity_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb) FROM PUBLIC;
-- D. delete_desktop_shipment: shipment_audits has no FK to shipments (order/colorway keyed only).
--    Hard delete in delete_desktop_shipment remains safe — no cascade change needed.

-- ---------------------------------------------------------------------------
-- E. Index cleanup — duplicate hourly_counts index
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.hourly_counts_operation_idx;
