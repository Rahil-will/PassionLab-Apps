-- Phase 1: module platform foundation.
-- Additive only. No production/shipment table changes. No desk_user role.
-- D18 remains Option B (nullable department_id; no new departments.role value).
-- D04 factory confirmation still pending (desktop testing/sorting default unchanged).

CREATE TABLE IF NOT EXISTS public.factory_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  module_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT factory_modules_key_check CHECK (
    module_key = ANY (ARRAY['core'::text, 'production'::text, 'shipment'::text, 'material'::text])
  ),
  CONSTRAINT factory_modules_factory_key_uidx UNIQUE (factory_id, module_key)
);

CREATE INDEX IF NOT EXISTS factory_modules_factory_idx
  ON public.factory_modules (factory_id);

ALTER TABLE public.factory_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS factory_modules_select ON public.factory_modules;
CREATE POLICY factory_modules_select ON public.factory_modules
  FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());

REVOKE ALL ON TABLE public.factory_modules FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.factory_modules FROM authenticated, anon;
GRANT SELECT ON TABLE public.factory_modules TO authenticated;
GRANT ALL ON TABLE public.factory_modules TO service_role;

COMMENT ON TABLE public.factory_modules IS
  'Per-factory module entitlement. Writes only via set_factory_module (admin SECURITY DEFINER).';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS assigned_apps jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.assigned_apps IS
  'Module permission keys (e.g. mm_*). Additive; legacy role/boolean flags unchanged. D19 desk_user deferred.';

CREATE TABLE IF NOT EXISTS public.doc_sequences (
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  year integer NOT NULL,
  last_no integer NOT NULL DEFAULT 0,
  CONSTRAINT doc_sequences_type_check CHECK (
    doc_type = ANY (ARRAY['GRN'::text, 'MV'::text, 'ROLL'::text, 'PACK'::text])
  ),
  CONSTRAINT doc_sequences_pk PRIMARY KEY (factory_id, doc_type, year),
  CONSTRAINT doc_sequences_last_no_nonneg CHECK (last_no >= 0)
);

ALTER TABLE public.doc_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS doc_sequences_select ON public.doc_sequences;
CREATE POLICY doc_sequences_select ON public.doc_sequences
  FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());

REVOKE ALL ON TABLE public.doc_sequences FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.doc_sequences FROM authenticated, anon;
GRANT SELECT ON TABLE public.doc_sequences TO authenticated;
GRANT ALL ON TABLE public.doc_sequences TO service_role;

COMMENT ON TABLE public.doc_sequences IS
  'Sequential document numbers for MM (GRN/MV/ROLL/PACK). Mutated only by next_doc_no.';

CREATE OR REPLACE FUNCTION public.next_doc_no(p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_year integer;
  v_yy text;
  v_next integer;
BEGIN
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN
    RAISE EXCEPTION 'NO_FACTORY';
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('GRN', 'MV', 'ROLL', 'PACK') THEN
    RAISE EXCEPTION 'INVALID_DOC_TYPE';
  END IF;

  v_year := EXTRACT(YEAR FROM now())::integer;
  v_yy := to_char(now(), 'YY');

  INSERT INTO public.doc_sequences AS ds (factory_id, doc_type, year, last_no)
  VALUES (v_factory, p_type, v_year, 1)
  ON CONFLICT (factory_id, doc_type, year)
  DO UPDATE SET last_no = ds.last_no + 1
  RETURNING ds.last_no INTO v_next;

  RETURN p_type || '-' || v_yy || '-' || lpad(v_next::text, 6, '0');
END;
$function$;

REVOKE ALL ON FUNCTION public.next_doc_no(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_doc_no(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.module_enabled(p_factory uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT fm.enabled
      FROM public.factory_modules fm
      WHERE fm.factory_id = p_factory
        AND fm.module_key = p_key
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.module_config(p_factory uuid, p_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT fm.config
      FROM public.factory_modules fm
      WHERE fm.factory_id = p_factory
        AND fm.module_key = p_key
    ),
    '{}'::jsonb
  );
$function$;

CREATE OR REPLACE FUNCTION public.assert_module_enabled(p_key text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.module_enabled(public.current_factory_id(), p_key) THEN
    RAISE EXCEPTION 'MODULE_DISABLED';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_factory_module(
  p_key text,
  p_enabled boolean,
  p_config jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_row public.factory_modules%ROWTYPE;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN
    RAISE EXCEPTION 'NO_FACTORY';
  END IF;

  IF p_key IS NULL OR p_key NOT IN ('core', 'production', 'shipment', 'material') THEN
    RAISE EXCEPTION 'INVALID_MODULE_KEY';
  END IF;

  INSERT INTO public.factory_modules AS fm (
    factory_id, module_key, enabled, enabled_at, config, created_at, updated_at
  ) VALUES (
    v_factory,
    p_key,
    COALESCE(p_enabled, false),
    CASE WHEN COALESCE(p_enabled, false) THEN now() ELSE NULL END,
    COALESCE(p_config, '{}'::jsonb),
    now(),
    now()
  )
  ON CONFLICT (factory_id, module_key)
  DO UPDATE SET
    enabled = COALESCE(p_enabled, false),
    config = COALESCE(p_config, '{}'::jsonb),
    enabled_at = CASE
      WHEN COALESCE(p_enabled, false) AND fm.enabled_at IS NULL THEN now()
      ELSE fm.enabled_at
    END,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.module_enabled(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.module_config(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_module_enabled(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_factory_module(text, boolean, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.module_enabled(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.module_config(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_module_enabled(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_factory_module(text, boolean, jsonb) TO authenticated, service_role;

INSERT INTO public.factory_modules (factory_id, module_key, enabled, enabled_at, config)
SELECT f.id, m.module_key, m.enabled, CASE WHEN m.enabled THEN now() ELSE NULL END, '{}'::jsonb
FROM public.factories f
CROSS JOIN (
  VALUES
    ('core', true),
    ('production', true),
    ('shipment', true),
    ('material', false)
) AS m(module_key, enabled)
ON CONFLICT (factory_id, module_key) DO NOTHING;
;
