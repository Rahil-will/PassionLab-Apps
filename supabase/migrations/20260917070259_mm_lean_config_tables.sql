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
;
