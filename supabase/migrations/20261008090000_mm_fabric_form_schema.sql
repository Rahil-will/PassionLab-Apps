-- Fabric master form schema (design: docs/superpowers/specs/2026-10-08-fabric-master-form-schema-design.md)
-- Common (factory-wide, fabric_type_id NULL) system groups/fields + per-type custom spec fields.

-- ===========================================================================
-- 1. Tables
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.mm_fabric_form_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id      uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  fabric_type_id  uuid REFERENCES public.mm_fabric_types (id) ON DELETE CASCADE,  -- NULL = common
  key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label           text NOT NULL CHECK (btrim(label) <> ''),
  seq             integer NOT NULL DEFAULT 0,
  collapsible     boolean NOT NULL DEFAULT false,
  default_open    boolean NOT NULL DEFAULT true,
  is_system       boolean NOT NULL DEFAULT false,
  visible         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.profiles (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_fabric_form_groups_system_common CHECK (NOT is_system OR fabric_type_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS mm_fabric_form_groups_key_uidx
  ON public.mm_fabric_form_groups (factory_id, COALESCE(fabric_type_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
SELECT public._mm_lockdown_table('public.mm_fabric_form_groups'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_fabric_form_fields (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id       uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  group_id         uuid NOT NULL REFERENCES public.mm_fabric_form_groups (id) ON DELETE RESTRICT,
  fabric_type_id   uuid REFERENCES public.mm_fabric_types (id) ON DELETE CASCADE,   -- NULL = common
  override_of      uuid REFERENCES public.mm_fabric_form_fields (id) ON DELETE CASCADE, -- per-type label override of a system field
  key              text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  spec_key         text CHECK (spec_key IS NULL OR spec_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label            text NOT NULL CHECK (btrim(label) <> ''),
  input_type       text NOT NULL CHECK (input_type IN (
                     'text', 'number', 'decimal', 'select', 'toggle',
                     'auto_code', 'textarea', 'image_url', 'segment', 'composition', 'fabric_type', 'construction')),
  options          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  required         boolean NOT NULL DEFAULT false,
  required_when    jsonb,          -- system only, e.g. {"color_method":["yarn_dyed","melange","print"]}
  visible_when     jsonb,          -- system only
  col_span         smallint NOT NULL DEFAULT 1 CHECK (col_span IN (1, 2)),
  seq              integer NOT NULL DEFAULT 0,
  storage          text NOT NULL CHECK (storage IN ('column', 'spec_values', 'override')),
  column_name      text,
  locked_when_used boolean NOT NULL DEFAULT false,
  is_system        boolean NOT NULL DEFAULT false,
  visible          boolean NOT NULL DEFAULT true,
  placeholder      text,
  help             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.profiles (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_fabric_form_fields_storage_chk CHECK (
       (storage = 'column'      AND is_system AND column_name IS NOT NULL AND spec_key IS NULL AND fabric_type_id IS NULL AND override_of IS NULL)
    OR (storage = 'spec_values' AND NOT is_system AND column_name IS NULL AND spec_key = key AND override_of IS NULL
        AND input_type IN ('text', 'number', 'decimal', 'select', 'toggle'))
    OR (storage = 'override'    AND NOT is_system AND column_name IS NULL AND spec_key IS NULL AND override_of IS NOT NULL
        AND fabric_type_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS mm_fabric_form_fields_key_uidx
  ON public.mm_fabric_form_fields (factory_id, COALESCE(fabric_type_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  WHERE override_of IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mm_fabric_form_fields_override_uidx
  ON public.mm_fabric_form_fields (factory_id, fabric_type_id, override_of)
  WHERE override_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS mm_fabric_form_fields_group_idx ON public.mm_fabric_form_fields (group_id);
SELECT public._mm_lockdown_table('public.mm_fabric_form_fields'::regclass);

-- ===========================================================================
-- 2. Seed (system groups/fields, factory-wide) + migrate legacy requirement fields
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._mm_seed_fabric_form_schema(p_factory uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g record;
  f record;
  v_gid uuid;
  v_spec uuid;
BEGIN
  FOR g IN SELECT * FROM (VALUES
    ('identity',     'Identity',       10, false, true),
    ('construction', 'Construction',   20, false, true),
    ('spec',         'Specification',  30, false, true),
    ('greige',       'Greige spec',    40, true,  false),
    ('colour',       'Colour',         50, false, true),
    ('reference',    'Reference',      60, true,  true)
  ) AS t(key, label, seq, collapsible, default_open)
  LOOP
    INSERT INTO public.mm_fabric_form_groups (factory_id, fabric_type_id, key, label, seq, collapsible, default_open, is_system)
    VALUES (p_factory, NULL, g.key, g.label, g.seq, g.collapsible, g.default_open, true)
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR f IN SELECT * FROM (VALUES
    -- group,        key,                  label,                    input_type,   column,                required, locked, span, seq, options, required_when, visible_when, placeholder, help
    ('identity',     'code',               'Code',                   'auto_code',  'code',                false, false, 1, 10, '[]', NULL, NULL, 'Auto', 'Assigned on save. Never changes.'),
    ('identity',     'name',               'Name',                   'text',       'name',                true,  false, 2, 20, '[]', NULL, NULL, 'e.g. Single Jersey 95% Cotton 5% Elastane 180 GSM', NULL),
    ('construction', 'fabric_type',        'Fabric type',            'fabric_type','fabric_type_id',      true,  true,  1, 10, '[]', NULL, NULL, NULL, NULL),
    ('construction', 'construction',       'Construction',           'construction','construction_id',    true,  true,  1, 20, '[]', NULL, NULL, NULL, NULL),
    ('construction', 'composition',        'Composition',            'composition','composition',         true,  true,  2, 30, '[]', NULL, NULL, NULL, 'Fibres must total 100%.'),
    ('spec',         'gsm',                'Finished GSM',           'decimal',    'gsm',                 true,  true,  1, 10, '[]', NULL, NULL, 'e.g. 180', NULL),
    ('spec',         'width_in',           'Cuttable width (in)',    'decimal',    'width_in',            true,  true,  1, 20, '[]', NULL, NULL, 'e.g. 72', NULL),
    ('spec',         'width_form',         'Width form',             'segment',    'width_form',          true,  true,  1, 30,
        '[{"value":"open","label":"Open"},{"value":"tubular","label":"Tubular"}]', NULL, NULL, NULL, NULL),
    ('spec',         'uom',                'UOM',                    'segment',    'uom',                 true,  true,  1, 40,
        '[{"value":"kg","label":"KG"},{"value":"m","label":"MTR"}]', NULL, NULL, NULL, NULL),
    ('greige',       'greige_gsm',         'Greige GSM',             'decimal',    'greige_gsm',          false, false, 1, 10, '[]', NULL, NULL, NULL, NULL),
    ('greige',       'greige_width_in',    'Greige width (in)',      'decimal',    'greige_width_in',     false, false, 1, 20, '[]', NULL, NULL, NULL, NULL),
    ('colour',       'color_method',       'Colour method',          'segment',    'color_method',        true,  true,  2, 10,
        '[{"value":"solid_dyed","label":"Solid dyed","help":"Colour set per order, same fabric any colour"},{"value":"yarn_dyed","label":"Yarn dyed","help":"Colour or stripe fixed at knitting/weaving"},{"value":"melange","label":"Melange","help":"Fibre-dyed mix, colour fixed"},{"value":"print","label":"Print","help":"Design fixed"},{"value":"greige_only","label":"Greige only","help":"Used undyed"}]',
        NULL, NULL, NULL, NULL),
    ('colour',       'design_ref',         'Design / colour ref',    'text',       'design_ref',          false, true,  2, 20, '[]',
        '{"color_method":["yarn_dyed","melange","print"]}', '{"color_method":["yarn_dyed","melange","print"]}', 'e.g. STR-0042 / Grey melange 15%', NULL),
    ('reference',    'supplier_article_no','Supplier article no',    'text',       'supplier_article_no', false, false, 1, 10, '[]', NULL, NULL, NULL, NULL),
    ('reference',    'hsn_code',           'HSN code',               'text',       'hsn_code',            false, false, 1, 20, '[]', NULL, NULL, NULL, NULL),
    ('reference',    'image_url',          'Image URL',              'image_url',  'image_url',           false, false, 2, 30, '[]', NULL, NULL, 'https://…', NULL),
    ('reference',    'remarks',            'Remarks',                'textarea',   'remarks',             false, false, 2, 40, '[]', NULL, NULL, NULL, NULL)
  ) AS t(grp, key, label, input_type, column_name, required, locked, span, seq, options, required_when, visible_when, placeholder, help)
  LOOP
    SELECT id INTO v_gid FROM public.mm_fabric_form_groups
    WHERE factory_id = p_factory AND fabric_type_id IS NULL AND key = f.grp;
    INSERT INTO public.mm_fabric_form_fields (
      factory_id, group_id, fabric_type_id, key, label, input_type, options, required, required_when, visible_when,
      col_span, seq, storage, column_name, locked_when_used, is_system, visible, placeholder, help)
    VALUES (
      p_factory, v_gid, NULL, f.key, f.label, f.input_type, f.options::jsonb, f.required, f.required_when::jsonb, f.visible_when::jsonb,
      f.span, f.seq, 'column', f.column_name, f.locked, true, true, f.placeholder, f.help)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- legacy mm_type_requirement_fields -> per-type custom spec fields (gsm / width are system columns now)
  SELECT id INTO v_spec FROM public.mm_fabric_form_groups
  WHERE factory_id = p_factory AND fabric_type_id IS NULL AND key = 'spec';
  INSERT INTO public.mm_fabric_form_fields (
    factory_id, group_id, fabric_type_id, key, spec_key, label, input_type, options, required, col_span, seq,
    storage, column_name, locked_when_used, is_system, visible)
  SELECT p_factory, v_spec, r.type_id,
         lower(regexp_replace(btrim(r.key), '[^a-zA-Z0-9_]+', '_', 'g')),
         lower(regexp_replace(btrim(r.key), '[^a-zA-Z0-9_]+', '_', 'g')),
         r.label, 'text', '[]'::jsonb, false, 1, 100 + r.seq, 'spec_values', NULL, false, false, r.is_active
  FROM public.mm_type_requirement_fields r
  WHERE r.factory_id = p_factory
    AND lower(btrim(r.key)) NOT IN ('gsm', 'width', 'width_in')
    AND lower(regexp_replace(btrim(r.key), '[^a-zA-Z0-9_]+', '_', 'g')) ~ '^[a-z][a-z0-9_]{1,40}$'
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public._mm_seed_fabric_form_schema(uuid) FROM PUBLIC, anon, authenticated;

SELECT public._mm_seed_fabric_form_schema(f.id) FROM public.factories f;

-- ===========================================================================
-- 3. Helpers
-- ===========================================================================
-- Reserved keys that custom fields may never use
CREATE OR REPLACE FUNCTION public._mm_fabric_reserved_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT ARRAY['id','factory_id','code','name','fabric_type','fabric_type_id','construction','construction_id',
               'composition','composition_text','gsm','width','width_in','width_form','uom','color_method',
               'design_ref','greige_gsm','greige_width_in','spec_values','supplier_article_no','hsn_code',
               'image_url','remarks','status','merged_into_id','dedupe_key','row_version','created_at',
               'created_by','updated_at','updated_by'];
$$;

-- Custom spec fields that apply to a fabric type (common + type-specific)
CREATE OR REPLACE FUNCTION public._mm_fabric_custom_fields(p_factory uuid, p_type uuid)
RETURNS TABLE (spec_key text, label text, input_type text, options jsonb, required boolean,
               locked_when_used boolean, visible boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT f.spec_key, f.label, f.input_type, f.options, f.required, f.locked_when_used, f.visible
  FROM public.mm_fabric_form_fields f
  WHERE f.factory_id = p_factory
    AND f.storage = 'spec_values'
    AND (f.fabric_type_id IS NULL OR f.fabric_type_id = p_type);
$$;

CREATE OR REPLACE FUNCTION public._mm_fabric_form_version(p_factory uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT next_no FROM public.mm_doc_sequences WHERE factory_id = p_factory AND doc_type = 'FAB_FORM'), 0);
$$;

CREATE OR REPLACE FUNCTION public._mm_fabric_form_bump(p_factory uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v integer;
BEGIN
  INSERT INTO public.mm_doc_sequences (factory_id, doc_type, next_no) VALUES (p_factory, 'FAB_FORM', 0)
  ON CONFLICT (factory_id, doc_type) DO NOTHING;
  UPDATE public.mm_doc_sequences SET next_no = next_no + 1
  WHERE factory_id = p_factory AND doc_type = 'FAB_FORM' RETURNING next_no INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public._mm_fabric_spec_key_used(p_factory uuid, p_type uuid, p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mm_fabrics
    WHERE factory_id = p_factory
      AND (p_type IS NULL OR fabric_type_id = p_type)
      AND spec_values ? p_key
      AND btrim(COALESCE(spec_values->>p_key, '')) <> ''
  );
$$;

-- Read the schema for a scope. p_type NULL = common only; else common + that type (overrides applied).
CREATE OR REPLACE FUNCTION public._mm_fabric_form_json(p_factory uuid, p_type uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'schema_version', public._mm_fabric_form_version(p_factory),
    'fabric_type_id', p_type,
    'custom_input_types', '["text","number","decimal","select","toggle"]'::jsonb,
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'key', g.key, 'label', g.label, 'seq', g.seq,
        'collapsible', g.collapsible, 'default_open', g.default_open,
        'is_system', g.is_system, 'visible', g.visible, 'fabric_type_id', g.fabric_type_id,
        'fields', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', f.id, 'key', f.key, 'spec_key', f.spec_key,
            'label', COALESCE(o.label, f.label),
            'help', COALESCE(o.help, f.help),
            'placeholder', COALESCE(o.placeholder, f.placeholder),
            'override_id', o.id,
            'input_type', f.input_type, 'options', f.options,
            'required', f.required, 'required_when', f.required_when, 'visible_when', f.visible_when,
            'col_span', f.col_span, 'seq', f.seq, 'storage', f.storage, 'column_name', f.column_name,
            'locked_when_used', f.locked_when_used, 'is_system', f.is_system, 'visible', f.visible,
            'fabric_type_id', f.fabric_type_id, 'group_id', f.group_id,
            'has_values', CASE WHEN f.storage = 'spec_values'
                               THEN public._mm_fabric_spec_key_used(p_factory, f.fabric_type_id, f.spec_key)
                               ELSE NULL END
          ) ORDER BY f.seq, f.label)
          FROM public.mm_fabric_form_fields f
          LEFT JOIN public.mm_fabric_form_fields o
            ON o.override_of = f.id AND o.fabric_type_id = p_type AND p_type IS NOT NULL
          WHERE f.group_id = g.id
            AND f.override_of IS NULL
            AND (f.fabric_type_id IS NULL OR f.fabric_type_id = p_type)
        ), '[]'::jsonb)
      ) ORDER BY g.seq, g.label)
      FROM public.mm_fabric_form_groups g
      WHERE g.factory_id = p_factory
        AND (g.fabric_type_id IS NULL OR g.fabric_type_id = p_type)
    ), '[]'::jsonb)
  );
$$;

-- ===========================================================================
-- 4. RPC: get schema
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.mm_get_fabric_form_schema(p_fabric_type_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  IF p_fabric_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_types WHERE id = p_fabric_type_id AND factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mm_fabric_form_groups WHERE factory_id = v_factory AND is_system) THEN
    PERFORM public._mm_seed_fabric_form_schema(v_factory);
  END IF;
  RETURN public._mm_ok(public._mm_fabric_form_json(v_factory, p_fabric_type_id));
END $$;

-- ===========================================================================
-- 5. RPC: save schema for one scope (p_fabric_type_id NULL = common)
--   p_groups: [{ id?, key, label, seq?, collapsible?, default_open?, visible?, _delete?,
--                fields: [{ id?, key, label, input_type, options?, required?, col_span?, seq?, visible?,
--                           placeholder?, help?, locked_when_used?, _delete?,
--                           override_of? (type scope, system field id: label/help/placeholder only) }] }]
--   Rows not sent are left untouched.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.mm_save_fabric_form_schema(p_fabric_type_id uuid, p_groups jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_actor uuid;
  gj jsonb;
  fj jsonb;
  v_gid uuid;
  v_g public.mm_fabric_form_groups%ROWTYPE;
  v_f public.mm_fabric_form_fields%ROWTYPE;
  v_fid uuid;
  v_key text;
  v_type text;
  v_opts jsonb;
  v_label text;
  v_span smallint;
  v_removed text;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('config');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  v_actor := public._mm_actor_id();
  IF jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN
    RETURN public._mm_err('INVALID', 'groups must be an array');
  END IF;
  IF p_fabric_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_types WHERE id = p_fabric_type_id AND factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mm_fabric_form_groups WHERE factory_id = v_factory AND is_system) THEN
    PERFORM public._mm_seed_fabric_form_schema(v_factory);
  END IF;

  FOR gj IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    v_gid := NULLIF(gj->>'id', '')::uuid;
    v_g := NULL;
    IF v_gid IS NOT NULL THEN
      SELECT * INTO v_g FROM public.mm_fabric_form_groups WHERE id = v_gid AND factory_id = v_factory;
      IF v_g.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND|Group not found'; END IF;
    END IF;

    -- ---------- group itself ----------
    IF v_g.id IS NULL THEN
      v_key := lower(btrim(COALESCE(gj->>'key', '')));
      IF v_key !~ '^[a-z][a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'INVALID|Group key "%" must be lowercase letters, digits, _', v_key; END IF;
      IF NULLIF(btrim(gj->>'label'), '') IS NULL THEN RAISE EXCEPTION 'REQUIRED|Group label is required'; END IF;
      INSERT INTO public.mm_fabric_form_groups (factory_id, fabric_type_id, key, label, seq, collapsible, default_open, is_system, visible, created_by, updated_by)
      VALUES (v_factory, p_fabric_type_id, v_key, btrim(gj->>'label'),
              COALESCE(public._mm_num(gj->>'seq')::integer, 900), COALESCE((gj->>'collapsible')::boolean, true),
              COALESCE((gj->>'default_open')::boolean, true), false, COALESCE((gj->>'visible')::boolean, true), v_actor, v_actor)
      RETURNING * INTO v_g;
    ELSIF COALESCE((gj->>'_delete')::boolean, false) THEN
      IF v_g.is_system THEN RAISE EXCEPTION 'SYSTEM_LOCKED|System group "%" cannot be deleted', v_g.label; END IF;
      IF v_g.fabric_type_id IS DISTINCT FROM p_fabric_type_id THEN RAISE EXCEPTION 'INVALID|Group "%" belongs to another scope', v_g.label; END IF;
      IF EXISTS (SELECT 1 FROM public.mm_fabric_form_fields WHERE group_id = v_g.id AND override_of IS NULL AND visible) THEN
        RAISE EXCEPTION 'INVALID|Move or hide the fields of "%" first', v_g.label;
      END IF;
      IF EXISTS (SELECT 1 FROM public.mm_fabric_form_fields WHERE group_id = v_g.id) THEN
        UPDATE public.mm_fabric_form_groups SET visible = false, updated_at = now(), updated_by = v_actor WHERE id = v_g.id;
      ELSE
        DELETE FROM public.mm_fabric_form_groups WHERE id = v_g.id;
      END IF;
      CONTINUE;
    ELSIF v_g.fabric_type_id IS NOT DISTINCT FROM p_fabric_type_id THEN
      -- same scope: editable props (system groups: label, seq, collapsible, default_open only)
      IF v_g.is_system AND gj ? 'key' AND gj->>'key' IS DISTINCT FROM v_g.key THEN
        RAISE EXCEPTION 'SYSTEM_LOCKED|System group key cannot change';
      END IF;
      IF v_g.is_system AND gj ? 'visible' AND (gj->>'visible')::boolean IS DISTINCT FROM v_g.visible THEN
        RAISE EXCEPTION 'SYSTEM_LOCKED|System group "%" cannot be hidden', v_g.label;
      END IF;
      UPDATE public.mm_fabric_form_groups SET
        label = COALESCE(NULLIF(btrim(gj->>'label'), ''), label),
        seq = COALESCE(public._mm_num(gj->>'seq')::integer, seq),
        collapsible = COALESCE((gj->>'collapsible')::boolean, collapsible),
        default_open = COALESCE((gj->>'default_open')::boolean, default_open),
        visible = CASE WHEN is_system THEN visible ELSE COALESCE((gj->>'visible')::boolean, visible) END,
        updated_at = now(), updated_by = v_actor
      WHERE id = v_g.id
      RETURNING * INTO v_g;
    END IF;
    -- (common group sent from a type scope: group props ignored, only its type fields are saved)

    IF v_g.fabric_type_id IS NOT NULL AND v_g.fabric_type_id IS DISTINCT FROM p_fabric_type_id THEN
      RAISE EXCEPTION 'INVALID|Group "%" belongs to another fabric type', v_g.label;
    END IF;

    -- ---------- fields ----------
    FOR fj IN SELECT value FROM jsonb_array_elements(COALESCE(gj->'fields', '[]'::jsonb)) LOOP
      v_fid := NULLIF(fj->>'id', '')::uuid;
      v_f := NULL;
      IF v_fid IS NOT NULL THEN
        SELECT * INTO v_f FROM public.mm_fabric_form_fields WHERE id = v_fid AND factory_id = v_factory;
        IF v_f.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND|Field not found'; END IF;
      END IF;

      -- (a) per-type override of a system field label/help/placeholder
      IF fj ? 'override_of' AND NULLIF(fj->>'override_of', '') IS NOT NULL THEN
        IF p_fabric_type_id IS NULL THEN RAISE EXCEPTION 'INVALID|Overrides are per fabric type'; END IF;
        SELECT * INTO v_f FROM public.mm_fabric_form_fields
        WHERE id = (fj->>'override_of')::uuid AND factory_id = v_factory AND is_system;
        IF v_f.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND|System field to override not found'; END IF;
        IF COALESCE((fj->>'_delete')::boolean, false) THEN
          DELETE FROM public.mm_fabric_form_fields
          WHERE override_of = v_f.id AND fabric_type_id = p_fabric_type_id;
        ELSE
          INSERT INTO public.mm_fabric_form_fields (
            factory_id, group_id, fabric_type_id, override_of, key, label, input_type, storage, help, placeholder, created_by, updated_by)
          VALUES (v_factory, v_f.group_id, p_fabric_type_id, v_f.id, v_f.key,
                  COALESCE(NULLIF(btrim(fj->>'label'), ''), v_f.label), v_f.input_type, 'override',
                  NULLIF(btrim(COALESCE(fj->>'help', '')), ''), NULLIF(btrim(COALESCE(fj->>'placeholder', '')), ''),
                  v_actor, v_actor)
          ON CONFLICT (factory_id, fabric_type_id, override_of) WHERE override_of IS NOT NULL
          DO UPDATE SET label = EXCLUDED.label, help = EXCLUDED.help, placeholder = EXCLUDED.placeholder,
                        updated_at = now(), updated_by = v_actor;
        END IF;
        CONTINUE;
      END IF;

      -- (b) system field: only label, help, placeholder, seq, col_span, group (common scope only)
      IF v_f.id IS NOT NULL AND v_f.is_system THEN
        IF p_fabric_type_id IS NOT NULL THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|Edit system field "%" in the common scope, or send override_of for a per-type label', v_f.label;
        END IF;
        IF COALESCE((fj->>'_delete')::boolean, false) THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|System field "%" cannot be deleted', v_f.label;
        END IF;
        IF (fj ? 'required'         AND (fj->>'required')::boolean         IS DISTINCT FROM v_f.required)
        OR (fj ? 'visible'          AND (fj->>'visible')::boolean          IS DISTINCT FROM v_f.visible)
        OR (fj ? 'locked_when_used' AND (fj->>'locked_when_used')::boolean IS DISTINCT FROM v_f.locked_when_used)
        OR (fj ? 'input_type'       AND fj->>'input_type'                  IS DISTINCT FROM v_f.input_type)
        OR (fj ? 'storage'          AND fj->>'storage'                     IS DISTINCT FROM v_f.storage)
        OR (fj ? 'column_name'      AND fj->>'column_name'                 IS DISTINCT FROM v_f.column_name)
        OR (fj ? 'key'              AND fj->>'key'                         IS DISTINCT FROM v_f.key)
        OR (fj ? 'options'          AND fj->'options'                      IS DISTINCT FROM v_f.options)
        THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|"%" is a system field: only label, help, placeholder, order, width and group can change', v_f.label;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.mm_fabric_form_groups WHERE id = v_g.id AND fabric_type_id IS NULL) THEN
          RAISE EXCEPTION 'INVALID|System field "%" must stay in a common group', v_f.label;
        END IF;
        v_span := COALESCE(public._mm_num(fj->>'col_span')::smallint, v_f.col_span);
        IF v_span NOT IN (1, 2) THEN RAISE EXCEPTION 'INVALID|Width must be 1 or 2 columns'; END IF;
        UPDATE public.mm_fabric_form_fields SET
          group_id = v_g.id,
          label = COALESCE(NULLIF(btrim(fj->>'label'), ''), label),
          help = CASE WHEN fj ? 'help' THEN NULLIF(btrim(fj->>'help'), '') ELSE help END,
          placeholder = CASE WHEN fj ? 'placeholder' THEN NULLIF(btrim(fj->>'placeholder'), '') ELSE placeholder END,
          seq = COALESCE(public._mm_num(fj->>'seq')::integer, seq),
          col_span = v_span,
          updated_at = now(), updated_by = v_actor
        WHERE id = v_f.id;
        CONTINUE;
      END IF;

      -- (c) custom spec field
      IF v_f.id IS NOT NULL AND v_f.fabric_type_id IS DISTINCT FROM p_fabric_type_id THEN
        RAISE EXCEPTION 'INVALID|Field "%" belongs to another scope', v_f.label;
      END IF;

      IF v_f.id IS NOT NULL AND COALESCE((fj->>'_delete')::boolean, false) THEN
        IF public._mm_fabric_spec_key_used(v_factory, v_f.fabric_type_id, v_f.spec_key) THEN
          UPDATE public.mm_fabric_form_fields SET visible = false, required = false, updated_at = now(), updated_by = v_actor
          WHERE id = v_f.id;
        ELSE
          DELETE FROM public.mm_fabric_form_fields WHERE id = v_f.id;
        END IF;
        CONTINUE;
      END IF;

      v_key := lower(btrim(COALESCE(fj->>'key', v_f.key, '')));
      v_type := COALESCE(NULLIF(fj->>'input_type', ''), v_f.input_type, 'text');
      v_opts := COALESCE(fj->'options', v_f.options, '[]'::jsonb);
      v_label := COALESCE(NULLIF(btrim(fj->>'label'), ''), v_f.label);
      v_span := COALESCE(public._mm_num(fj->>'col_span')::smallint, v_f.col_span, 1);

      IF v_key !~ '^[a-z][a-z0-9_]{1,40}$' THEN
        RAISE EXCEPTION 'INVALID|Key "%" must start with a letter and use lowercase letters, digits, _', v_key;
      END IF;
      IF v_key = ANY (public._mm_fabric_reserved_keys()) THEN
        RAISE EXCEPTION 'INVALID|"%" is reserved for a built-in fabric field', v_key;
      END IF;
      IF v_label IS NULL THEN RAISE EXCEPTION 'REQUIRED|Field label is required'; END IF;
      IF v_type NOT IN ('text', 'number', 'decimal', 'select', 'toggle') THEN
        RAISE EXCEPTION 'INVALID|Custom fields can be text, number, decimal, select or toggle';
      END IF;
      IF v_span NOT IN (1, 2) THEN RAISE EXCEPTION 'INVALID|Width must be 1 or 2 columns'; END IF;
      IF jsonb_typeof(v_opts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID|options must be an array'; END IF;
      IF v_type = 'select' THEN
        IF jsonb_array_length(v_opts) = 0 THEN RAISE EXCEPTION 'REQUIRED|Select field "%" needs options', v_label; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) o WHERE btrim(COALESCE(o->>'value', '')) = '') THEN
          RAISE EXCEPTION 'INVALID|Every option needs a value';
        END IF;
        IF (SELECT count(*) FROM jsonb_array_elements(v_opts) o) <> (SELECT count(DISTINCT lower(btrim(o->>'value'))) FROM jsonb_array_elements(v_opts) o) THEN
          RAISE EXCEPTION 'INVALID|Option values must be unique';
        END IF;
        SELECT jsonb_agg(jsonb_build_object('value', btrim(o->>'value'), 'label', COALESCE(NULLIF(btrim(o->>'label'), ''), btrim(o->>'value'))))
        INTO v_opts FROM jsonb_array_elements(v_opts) o;
      ELSE
        v_opts := '[]'::jsonb;
      END IF;

      IF v_f.id IS NULL THEN
        -- key unique across common + every type (common key) or common + this type (type key)
        IF EXISTS (
          SELECT 1 FROM public.mm_fabric_form_fields x
          WHERE x.factory_id = v_factory AND x.override_of IS NULL AND x.key = v_key
            AND (p_fabric_type_id IS NULL OR x.fabric_type_id IS NULL OR x.fabric_type_id = p_fabric_type_id)
        ) THEN
          RAISE EXCEPTION 'DUPLICATE|Key "%" is already used', v_key;
        END IF;
        INSERT INTO public.mm_fabric_form_fields (
          factory_id, group_id, fabric_type_id, key, spec_key, label, input_type, options, required, col_span, seq,
          storage, locked_when_used, is_system, visible, placeholder, help, created_by, updated_by)
        VALUES (
          v_factory, v_g.id, p_fabric_type_id, v_key, v_key, v_label, v_type, v_opts,
          COALESCE((fj->>'required')::boolean, false), v_span, COALESCE(public._mm_num(fj->>'seq')::integer, 100),
          'spec_values', COALESCE((fj->>'locked_when_used')::boolean, false), false,
          COALESCE((fj->>'visible')::boolean, true),
          NULLIF(btrim(COALESCE(fj->>'placeholder', '')), ''), NULLIF(btrim(COALESCE(fj->>'help', '')), ''),
          v_actor, v_actor);
      ELSE
        IF v_key <> v_f.key AND public._mm_fabric_spec_key_used(v_factory, v_f.fabric_type_id, v_f.spec_key) THEN
          RAISE EXCEPTION 'KEY_IN_USE|Key "%" already has values on fabrics and cannot be renamed', v_f.key;
        END IF;
        IF v_key <> v_f.key AND EXISTS (
          SELECT 1 FROM public.mm_fabric_form_fields x
          WHERE x.factory_id = v_factory AND x.override_of IS NULL AND x.key = v_key AND x.id <> v_f.id
            AND (v_f.fabric_type_id IS NULL OR x.fabric_type_id IS NULL OR x.fabric_type_id = v_f.fabric_type_id)
        ) THEN
          RAISE EXCEPTION 'DUPLICATE|Key "%" is already used', v_key;
        END IF;
        IF v_type <> v_f.input_type AND public._mm_fabric_spec_key_used(v_factory, v_f.fabric_type_id, v_f.spec_key) THEN
          RAISE EXCEPTION 'KEY_IN_USE|"%" already has values; its input type cannot change', v_f.label;
        END IF;
        IF v_type = 'select' THEN
          SELECT string_agg(DISTINCT x.val, ', ') INTO v_removed
          FROM (
            SELECT fb.spec_values->>v_f.spec_key AS val
            FROM public.mm_fabrics fb
            WHERE fb.factory_id = v_factory
              AND (v_f.fabric_type_id IS NULL OR fb.fabric_type_id = v_f.fabric_type_id)
              AND btrim(COALESCE(fb.spec_values->>v_f.spec_key, '')) <> ''
          ) x
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) o WHERE o->>'value' = x.val);
          IF v_removed IS NOT NULL THEN
            RAISE EXCEPTION 'OPTION_IN_USE|Option(s) % are used on fabrics and cannot be removed', v_removed;
          END IF;
        END IF;
        UPDATE public.mm_fabric_form_fields SET
          group_id = v_g.id,
          key = v_key, spec_key = v_key,
          label = v_label, input_type = v_type, options = v_opts,
          required = COALESCE((fj->>'required')::boolean, required),
          col_span = v_span,
          seq = COALESCE(public._mm_num(fj->>'seq')::integer, seq),
          locked_when_used = COALESCE((fj->>'locked_when_used')::boolean, locked_when_used),
          visible = COALESCE((fj->>'visible')::boolean, visible),
          placeholder = CASE WHEN fj ? 'placeholder' THEN NULLIF(btrim(fj->>'placeholder'), '') ELSE placeholder END,
          help = CASE WHEN fj ? 'help' THEN NULLIF(btrim(fj->>'help'), '') ELSE help END,
          updated_at = now(), updated_by = v_actor
        WHERE id = v_f.id;
      END IF;
    END LOOP;
  END LOOP;

  PERFORM public._mm_fabric_form_bump(v_factory);
  RETURN public._mm_ok(public._mm_fabric_form_json(v_factory, p_fabric_type_id));
EXCEPTION
  WHEN raise_exception THEN
    IF position('|' IN SQLERRM) > 0 THEN
      RETURN public._mm_err(split_part(SQLERRM, '|', 1), substr(SQLERRM, position('|' IN SQLERRM) + 1));
    END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid id or value in schema payload');
  WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'A group or field with this key already exists');
END $$;

-- ===========================================================================
-- 6. Fabric validation: custom spec fields enforced server-side
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._mm_fabric_check_spec(p_factory uuid, p_type uuid, p_spec jsonb)
RETURNS jsonb  -- NULL = ok, else _mm_err(...)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c record;
  v text;
BEGIN
  FOR c IN SELECT * FROM public._mm_fabric_custom_fields(p_factory, p_type) WHERE visible LOOP
    v := NULLIF(btrim(COALESCE(p_spec->>c.spec_key, '')), '');
    IF v IS NULL THEN
      IF c.required THEN RETURN public._mm_err('REQUIRED', c.label || ' is required'); END IF;
      CONTINUE;
    END IF;
    IF c.input_type = 'number' AND v !~ '^-?[0-9]+$' THEN
      RETURN public._mm_err('INVALID', c.label || ' must be a whole number');
    ELSIF c.input_type = 'decimal' AND v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN public._mm_err('INVALID', c.label || ' must be a number');
    ELSIF c.input_type = 'toggle' AND lower(v) NOT IN ('true', 'false') THEN
      RETURN public._mm_err('INVALID', c.label || ' must be true or false');
    ELSIF c.input_type = 'select' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.options) o WHERE o->>'value' = v) THEN
      RETURN public._mm_err('INVALID', c.label || ': "' || v || '" is not one of the options');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- wrap normalize: core rules first, then custom spec rules for the chosen type
CREATE OR REPLACE FUNCTION public._mm_fabric_normalize_full(p_factory uuid, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_norm jsonb;
  v_err jsonb;
  v_spec jsonb;
BEGIN
  v_norm := public._mm_fabric_normalize(p_factory, p_row);
  IF v_norm ? 'error' THEN RETURN v_norm; END IF;
  -- toggles stored as 'true' / 'false'
  SELECT COALESCE(jsonb_object_agg(e.key,
           CASE WHEN c.input_type = 'toggle' THEN lower(e.value #>> '{}') ELSE e.value #>> '{}' END), '{}'::jsonb)
  INTO v_spec
  FROM jsonb_each(v_norm->'spec_values') e
  LEFT JOIN public._mm_fabric_custom_fields(p_factory, (v_norm->>'fabric_type_id')::uuid) c ON c.spec_key = e.key;
  v_norm := jsonb_set(v_norm, '{spec_values}', v_spec);
  v_err := public._mm_fabric_check_spec(p_factory, (v_norm->>'fabric_type_id')::uuid, v_norm->'spec_values');
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;
  RETURN v_norm;
END $$;

REVOKE ALL ON FUNCTION public._mm_fabric_reserved_keys() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_custom_fields(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_form_version(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_form_bump(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_spec_key_used(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_form_json(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_check_spec(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_normalize_full(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_get_fabric_form_schema(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_save_fabric_form_schema(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_get_fabric_form_schema(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_fabric_form_schema(uuid, jsonb) TO authenticated, service_role;
