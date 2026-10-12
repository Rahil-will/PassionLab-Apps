-- Lean Material config: only what Work Centers captures.
-- fabric types, per-type test KPIs, per-type requirement params, trim categories.
-- fabric_components stays the categories catalog (existing production table).

CREATE OR REPLACE FUNCTION public._mm_ok(p_data jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_data IS NULL THEN jsonb_build_object('ok', true)
              ELSE jsonb_build_object('ok', true, 'data', p_data) END;
$$;

CREATE OR REPLACE FUNCTION public._mm_err(p_code text, p_message text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('ok', false, 'code', p_code, 'message', p_message);
$$;

CREATE OR REPLACE FUNCTION public._mm_require_config()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_apps jsonb;
BEGIN
  PERFORM public.assert_module_enabled('material');
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RAISE EXCEPTION 'NO_FACTORY'; END IF;
  IF public.is_factory_admin() THEN RETURN v_factory; END IF;
  SELECT COALESCE(p.assigned_apps, '[]'::jsonb) INTO v_apps
  FROM public.profiles p WHERE p.id = auth.uid();
  IF v_apps IS NULL OR NOT (v_apps @> '["mm_config"]'::jsonb) THEN
    RAISE EXCEPTION 'NO_PERMISSION';
  END IF;
  RETURN v_factory;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_slugify(p_label text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(COALESCE(p_label, '')), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION public._mm_lockdown_table(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_pol text;
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  v_pol := (SELECT c.relname FROM pg_class c WHERE c.oid = p_table::oid) || '_mm_select';
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', v_pol, p_table);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (factory_id = public.current_factory_id())',
    v_pol, p_table
  );
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', p_table);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE %s FROM authenticated, anon', p_table);
  EXECUTE format('GRANT SELECT ON TABLE %s TO authenticated', p_table);
  EXECUTE format('GRANT ALL ON TABLE %s TO service_role', p_table);
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_ok(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_err(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_require_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_slugify(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_lockdown_table(regclass) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_lockdown_table(regclass) TO service_role;

CREATE TABLE IF NOT EXISTS public.mm_fabric_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  name text NOT NULL,
  remarks text,
  seq integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_fabric_types_factory_name_uidx UNIQUE (factory_id, name)
);
CREATE INDEX IF NOT EXISTS mm_fabric_types_factory_idx ON public.mm_fabric_types (factory_id);
SELECT public._mm_lockdown_table('public.mm_fabric_types'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_type_test_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES public.mm_fabric_types (id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  seq integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_type_test_fields_data_type_chk CHECK (
    data_type = ANY (ARRAY['text'::text, 'number'::text, 'decimal'::text, 'select'::text])
  ),
  CONSTRAINT mm_type_test_fields_type_key_uidx UNIQUE (type_id, key)
);
CREATE INDEX IF NOT EXISTS mm_type_test_fields_type_idx ON public.mm_type_test_fields (type_id);
SELECT public._mm_lockdown_table('public.mm_type_test_fields'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_type_requirement_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES public.mm_fabric_types (id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  remarks text,
  seq integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_type_requirement_fields_type_key_uidx UNIQUE (type_id, key)
);
CREATE INDEX IF NOT EXISTS mm_type_requirement_fields_type_idx ON public.mm_type_requirement_fields (type_id);
SELECT public._mm_lockdown_table('public.mm_type_requirement_fields'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_trim_requirement_params (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  category text NOT NULL,
  types jsonb NOT NULL DEFAULT '[]'::jsonb,
  seq integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_trim_requirement_params_factory_cat_uidx UNIQUE (factory_id, category)
);
CREATE INDEX IF NOT EXISTS mm_trim_requirement_params_factory_idx ON public.mm_trim_requirement_params (factory_id);
SELECT public._mm_lockdown_table('public.mm_trim_requirement_params'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_factory_features (
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (factory_id, feature_key),
  CONSTRAINT mm_factory_features_key_chk CHECK (
    feature_key = ANY (ARRAY['receive_goods'::text, 'test_rolls'::text])
  )
);
SELECT public._mm_lockdown_table('public.mm_factory_features'::regclass);

INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
SELECT f.id, k.feature_key, true
FROM public.factories f
CROSS JOIN (VALUES ('receive_goods'), ('test_rolls')) AS k(feature_key)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.mm_seed_factory_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES (NEW.id, 'receive_goods', true), (NEW.id, 'test_rolls', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS mm_factory_features_seed_trg ON public.factories;
CREATE TRIGGER mm_factory_features_seed_trg
AFTER INSERT ON public.factories
FOR EACH ROW EXECUTE FUNCTION public.mm_seed_factory_features();

CREATE OR REPLACE FUNCTION public.mm_enable_module(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RETURN public._mm_err('NO_PERMISSION', 'Admin required');
  END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  PERFORM public.set_factory_module('material', true, COALESCE(p_config, '{}'::jsonb));
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES (v_factory, 'receive_goods', true), (v_factory, 'test_rolls', true)
  ON CONFLICT DO NOTHING;
  RETURN public._mm_ok(jsonb_build_object('factory_id', v_factory));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_config_bundle()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    PERFORM public.assert_module_enabled('material');
    v_factory := public.current_factory_id();
    IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
    IF NOT public.is_factory_admin() THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.assigned_apps @> '["mm_config"]'::jsonb
            OR p.assigned_apps @> '["mm_reports"]'::jsonb
          )
      ) THEN
        RETURN public._mm_err('NO_PERMISSION', 'mm_config or mm_reports required');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  RETURN public._mm_ok(jsonb_build_object(
    'types', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.seq, t.name)
      FROM public.mm_fabric_types t WHERE t.factory_id = v_factory
    ), '[]'::jsonb),
    'test_fields', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f WHERE f.factory_id = v_factory
    ), '[]'::jsonb),
    'requirement_fields', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.seq, f.label)
      FROM public.mm_type_requirement_fields f WHERE f.factory_id = v_factory
    ), '[]'::jsonb),
    'trim_params', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seq, p.category)
      FROM public.mm_trim_requirement_params p WHERE p.factory_id = v_factory AND p.is_active
    ), '[]'::jsonb),
    'attribute_defs', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(f) || jsonb_build_object(
          'applies_to', 'material',
          'data_type', 'text',
          'options', '[]'::jsonb
        )
        ORDER BY f.seq, f.label
      )
      FROM public.mm_type_requirement_fields f
      WHERE f.factory_id = v_factory AND f.is_active
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_fabric_type(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_name text;
  v_out public.mm_fabric_types%ROWTYPE;
  v_rv integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_name := trim(COALESCE(p_row->>'name', ''));
  IF v_name = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Type name is required'); END IF;
  v_id := NULLIF(p_row->>'id', '')::uuid;

  IF v_id IS NOT NULL THEN
    v_rv := COALESCE((p_row->>'row_version')::integer, 0);
    UPDATE public.mm_fabric_types SET
      name = v_name,
      remarks = NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),
      is_active = true,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_id AND factory_id = v_factory AND row_version = v_rv
    RETURNING * INTO v_out;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.mm_fabric_types WHERE id = v_id AND factory_id = v_factory) THEN
        RETURN public._mm_err('STALE_VERSION', 'This type was changed elsewhere. Reload and try again');
      END IF;
      RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
    END IF;
    RETURN public._mm_ok(to_jsonb(v_out));
  END IF;

  INSERT INTO public.mm_fabric_types (
    factory_id, name, remarks, seq, created_by, updated_by
  ) VALUES (
    v_factory, v_name, NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),
    COALESCE((SELECT max(seq) + 1 FROM public.mm_fabric_types WHERE factory_id = v_factory), 0),
    auth.uid(), auth.uid()
  )
  ON CONFLICT (factory_id, name) DO UPDATE SET
    remarks = EXCLUDED.remarks,
    is_active = true,
    row_version = public.mm_fabric_types.row_version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_delete_fabric_type(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  UPDATE public.mm_fabric_types SET
    is_active = false,
    row_version = row_version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric type not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id, 'action', 'deactivated'));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_fields jsonb;
  v_field jsonb;
  v_seq integer := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_label text;
  v_key text;
  v_data_type text;
  v_options jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
  END IF;

  v_fields := COALESCE(p_fields, '[]'::jsonb);
  IF jsonb_typeof(v_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields)
  LOOP
    v_label := trim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each test field needs a name'); END IF;
    v_seq := v_seq + 1;
    v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
    v_data_type := COALESCE(NULLIF(v_field->>'data_type', ''), 'text');
    v_options := COALESCE(v_field->'options', '[]'::jsonb);
    IF jsonb_typeof(v_options) IS DISTINCT FROM 'array' THEN v_options := '[]'::jsonb; END IF;
    v_id := NULLIF(v_field->>'id', '')::uuid;

    IF v_id IS NOT NULL THEN
      UPDATE public.mm_type_test_fields SET
        key = v_key, label = v_label, data_type = v_data_type, options = v_options,
        seq = v_seq, is_active = true, row_version = row_version + 1,
        updated_at = now(), updated_by = auth.uid()
      WHERE id = v_id AND factory_id = v_factory AND type_id = p_type_id
      RETURNING id INTO v_id;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.mm_type_test_fields (
        factory_id, type_id, key, label, data_type, options, seq, created_by, updated_by
      ) VALUES (
        v_factory, p_type_id, v_key, v_label, v_data_type, v_options, v_seq, auth.uid(), auth.uid()
      )
      ON CONFLICT (type_id, key) DO UPDATE SET
        label = EXCLUDED.label, data_type = EXCLUDED.data_type, options = EXCLUDED.options,
        seq = EXCLUDED.seq, is_active = true,
        row_version = public.mm_type_test_fields.row_version + 1,
        updated_at = now(), updated_by = auth.uid()
      RETURNING id INTO v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE public.mm_type_test_fields SET
    is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE type_id = p_type_id AND factory_id = v_factory AND is_active AND NOT (id = ANY (v_ids));

  RETURN public._mm_ok(jsonb_build_object('attribute_ids', to_jsonb(v_ids)));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_type_requirement_fields(p_type_id uuid, p_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_fields jsonb;
  v_field jsonb;
  v_seq integer := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_label text;
  v_key text;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
  END IF;

  v_fields := COALESCE(p_fields, '[]'::jsonb);
  IF jsonb_typeof(v_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields)
  LOOP
    v_label := trim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each parameter needs a name'); END IF;
    v_seq := v_seq + 1;
    v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
    v_id := NULLIF(v_field->>'id', '')::uuid;

    IF v_id IS NOT NULL THEN
      UPDATE public.mm_type_requirement_fields SET
        key = v_key, label = v_label,
        remarks = NULLIF(trim(COALESCE(v_field->>'remarks', '')), ''),
        seq = v_seq, is_active = true, row_version = row_version + 1,
        updated_at = now(), updated_by = auth.uid()
      WHERE id = v_id AND factory_id = v_factory AND type_id = p_type_id
      RETURNING id INTO v_id;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.mm_type_requirement_fields (
        factory_id, type_id, key, label, remarks, seq, created_by, updated_by
      ) VALUES (
        v_factory, p_type_id, v_key, v_label,
        NULLIF(trim(COALESCE(v_field->>'remarks', '')), ''),
        v_seq, auth.uid(), auth.uid()
      )
      ON CONFLICT (type_id, key) DO UPDATE SET
        label = EXCLUDED.label, remarks = EXCLUDED.remarks, seq = EXCLUDED.seq,
        is_active = true, row_version = public.mm_type_requirement_fields.row_version + 1,
        updated_at = now(), updated_by = auth.uid()
      RETURNING id INTO v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE public.mm_type_requirement_fields SET
    is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE type_id = p_type_id AND factory_id = v_factory AND is_active AND NOT (id = ANY (v_ids));

  RETURN public._mm_ok(jsonb_build_object('attribute_ids', to_jsonb(v_ids)));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_trim_requirement_param(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_cat text;
  v_types jsonb;
  v_out public.mm_trim_requirement_params%ROWTYPE;
  v_rv integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_cat := trim(COALESCE(p_row->>'category', ''));
  IF v_cat = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Category is required'); END IF;
  v_types := COALESCE(p_row->'types', '[]'::jsonb);
  IF jsonb_typeof(v_types) <> 'array' THEN v_types := '[]'::jsonb; END IF;
  v_id := NULLIF(p_row->>'id', '')::uuid;

  IF v_id IS NOT NULL THEN
    v_rv := COALESCE((p_row->>'row_version')::integer, 0);
    UPDATE public.mm_trim_requirement_params SET
      category = v_cat, types = v_types,
      seq = COALESCE((p_row->>'seq')::integer, seq),
      is_active = true, row_version = row_version + 1,
      updated_at = now(), updated_by = auth.uid()
    WHERE id = v_id AND factory_id = v_factory AND row_version = v_rv
    RETURNING * INTO v_out;
    IF NOT FOUND THEN RETURN public._mm_err('STALE_VERSION', 'Reload and try again'); END IF;
    RETURN public._mm_ok(to_jsonb(v_out));
  END IF;

  INSERT INTO public.mm_trim_requirement_params (
    factory_id, category, types, seq, created_by, updated_by
  ) VALUES (
    v_factory, v_cat, v_types, COALESCE((p_row->>'seq')::integer, 0), auth.uid(), auth.uid()
  )
  RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'That trim category already exists');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_delete_trim_requirement_param(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  UPDATE public.mm_trim_requirement_params SET
    is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Trim category not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_enable_module(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_config_bundle() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_fabric_type(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_delete_fabric_type(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_type_test_fields(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_type_requirement_fields(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_trim_requirement_param(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_delete_trim_requirement_param(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
