-- Fabric form = ONE common list for every fabric.
-- * per-type scopes and per-type renames removed; each field has applies_to_type_ids (NULL = all types)
-- * tiers: core (logic depends on it) / standard (other built-ins) / custom
--     core:     label, help, placeholder, order, group, width editable. required / visible / input type / applies-to fixed.
--     standard: + hide, required, applies-to. input type fixed.
--     custom:   everything; key + input type lock once a fabric has a value.
-- * supersedes 20261008075238 mm_fabric_form_system_input_type (built-in labels now editable, input type fixed)

-- ---------------------------------------------------------------------------
-- 1. Column + fold old scopes (none in use today)
-- ---------------------------------------------------------------------------
ALTER TABLE public.mm_fabric_form_fields ADD COLUMN IF NOT EXISTS applies_to_type_ids uuid[];
ALTER TABLE public.mm_fabric_form_fields ADD CONSTRAINT mm_fabric_form_fields_applies_chk
  CHECK (applies_to_type_ids IS NULL OR cardinality(applies_to_type_ids) > 0);

UPDATE public.mm_fabric_form_fields
SET applies_to_type_ids = ARRAY[fabric_type_id], fabric_type_id = NULL
WHERE fabric_type_id IS NOT NULL AND override_of IS NULL;
-- (no per-type rename rows existed; the JSON and save ignore any override rows)
UPDATE public.mm_fabric_form_groups SET fabric_type_id = NULL WHERE fabric_type_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_fabric_core_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT ARRAY['code','name','fabric_type','construction','composition','gsm','width_in','width_form','uom','color_method'] $$;

CREATE OR REPLACE FUNCTION public._mm_fabric_field_tier(p_is_system boolean, p_key text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT CASE WHEN NOT p_is_system THEN 'custom'
                  WHEN p_key = ANY (public._mm_fabric_core_keys()) THEN 'core'
                  ELSE 'standard' END $$;

CREATE OR REPLACE FUNCTION public._mm_fabric_applies(p_ids uuid[], p_type uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT p_ids IS NULL OR (p_type IS NOT NULL AND p_type = ANY (p_ids)) $$;

REVOKE ALL ON FUNCTION public._mm_fabric_core_keys() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_field_tier(boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_applies(uuid[], uuid) FROM PUBLIC, anon, authenticated;

-- custom fields that apply to a fabric type (used by save validation + lock)
CREATE OR REPLACE FUNCTION public._mm_fabric_custom_fields(p_factory uuid, p_type uuid)
 RETURNS TABLE(spec_key text, label text, input_type text, options jsonb, required boolean, locked_when_used boolean, visible boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT f.spec_key, f.label, f.input_type, f.options, f.required, f.locked_when_used, f.visible
  FROM public.mm_fabric_form_fields f
  WHERE f.factory_id = p_factory
    AND f.storage = 'spec_values'
    AND f.override_of IS NULL
    AND public._mm_fabric_applies(f.applies_to_type_ids, p_type);
$function$;

-- ---------------------------------------------------------------------------
-- 3. Schema JSON (p_type NULL = full list for the editor; a type = only fields that apply)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_fabric_form_json(p_factory uuid, p_type uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'schema_version', public._mm_fabric_form_version(p_factory),
    'fabric_type_id', p_type,
    'custom_input_types', '["text","number","decimal","select","toggle"]'::jsonb,
    'fabric_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                              FROM public.mm_fabric_types t WHERE t.factory_id = p_factory AND t.is_active), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id, 'key', g.key, 'label', g.label, 'seq', g.seq,
        'collapsible', g.collapsible, 'default_open', g.default_open,
        'is_system', g.is_system, 'visible', g.visible, 'fabric_type_id', NULL,
        'fields', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', f.id, 'key', f.key, 'spec_key', f.spec_key,
            'label', f.label, 'help', f.help, 'placeholder', f.placeholder,
            'input_type', f.input_type, 'options', f.options,
            'required', f.required, 'required_when', f.required_when, 'visible_when', f.visible_when,
            'col_span', f.col_span, 'seq', f.seq, 'storage', f.storage, 'column_name', f.column_name,
            'locked_when_used', f.locked_when_used, 'is_system', f.is_system, 'visible', f.visible,
            'fabric_type_id', NULL,
            'applies_to_type_ids', to_jsonb(f.applies_to_type_ids),
            'tier', public._mm_fabric_field_tier(f.is_system, f.key),
            'group_id', f.group_id,
            'has_values', CASE WHEN f.storage = 'spec_values'
                               THEN public._mm_fabric_spec_key_used(p_factory, NULL, f.spec_key)
                               ELSE NULL END
          ) ORDER BY f.seq, f.label)
          FROM public.mm_fabric_form_fields f
          WHERE f.group_id = g.id
            AND f.override_of IS NULL
            AND (p_type IS NULL OR public._mm_fabric_applies(f.applies_to_type_ids, p_type))
        ), '[]'::jsonb)
      ) ORDER BY g.seq, g.label)
      FROM public.mm_fabric_form_groups g
      WHERE g.factory_id = p_factory
    ), '[]'::jsonb)
  );
$function$;

-- ---------------------------------------------------------------------------
-- 4. Save (one list). New signature: mm_save_fabric_form_schema(p_groups)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_save_fabric_form_schema(p_groups jsonb)
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
  v_tier text;
  v_applies uuid[];
  v_used boolean;
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

    IF v_g.id IS NULL THEN
      v_key := lower(btrim(COALESCE(gj->>'key', '')));
      IF v_key !~ '^[a-z][a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'INVALID|Group key "%" must be lowercase letters, digits, _', v_key; END IF;
      IF NULLIF(btrim(gj->>'label'), '') IS NULL THEN RAISE EXCEPTION 'REQUIRED|Group label is required'; END IF;
      INSERT INTO public.mm_fabric_form_groups (factory_id, fabric_type_id, key, label, seq, collapsible, default_open, is_system, visible, created_by, updated_by)
      VALUES (v_factory, NULL, v_key, btrim(gj->>'label'),
              COALESCE(public._mm_num(gj->>'seq')::integer, 900), COALESCE((gj->>'collapsible')::boolean, true),
              COALESCE((gj->>'default_open')::boolean, true), false, COALESCE((gj->>'visible')::boolean, true), v_actor, v_actor)
      RETURNING * INTO v_g;
    ELSIF COALESCE((gj->>'_delete')::boolean, false) THEN
      IF v_g.is_system THEN RAISE EXCEPTION 'SYSTEM_LOCKED|Built-in section "%" cannot be deleted', v_g.label; END IF;
      IF EXISTS (SELECT 1 FROM public.mm_fabric_form_fields WHERE group_id = v_g.id AND override_of IS NULL AND visible) THEN
        RAISE EXCEPTION 'INVALID|Move or hide the fields of "%" first', v_g.label;
      END IF;
      IF EXISTS (SELECT 1 FROM public.mm_fabric_form_fields WHERE group_id = v_g.id) THEN
        UPDATE public.mm_fabric_form_groups SET visible = false, updated_at = now(), updated_by = v_actor WHERE id = v_g.id;
      ELSE
        DELETE FROM public.mm_fabric_form_groups WHERE id = v_g.id;
      END IF;
      CONTINUE;
    ELSE
      IF v_g.is_system AND gj ? 'key' AND gj->>'key' IS DISTINCT FROM v_g.key THEN
        RAISE EXCEPTION 'SYSTEM_LOCKED|Built-in section key cannot change';
      END IF;
      IF v_g.is_system AND gj ? 'visible' AND (gj->>'visible')::boolean IS DISTINCT FROM v_g.visible THEN
        RAISE EXCEPTION 'SYSTEM_LOCKED|Built-in section "%" cannot be hidden', v_g.label;
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

    FOR fj IN SELECT value FROM jsonb_array_elements(COALESCE(gj->'fields', '[]'::jsonb)) LOOP
      IF NULLIF(fj->>'override_of', '') IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID|Per-type renames were removed. Rename the field itself.';
      END IF;
      v_fid := NULLIF(fj->>'id', '')::uuid;
      v_f := NULL;
      IF v_fid IS NOT NULL THEN
        SELECT * INTO v_f FROM public.mm_fabric_form_fields WHERE id = v_fid AND factory_id = v_factory AND override_of IS NULL;
        IF v_f.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND|Field not found'; END IF;
      END IF;

      -- applies to
      IF fj ? 'applies_to_type_ids' THEN
        IF jsonb_typeof(fj->'applies_to_type_ids') = 'null' THEN
          v_applies := NULL;
        ELSIF jsonb_typeof(fj->'applies_to_type_ids') = 'array' THEN
          SELECT array_agg(DISTINCT x::uuid) INTO v_applies FROM jsonb_array_elements_text(fj->'applies_to_type_ids') x;
          IF v_applies IS NOT NULL AND EXISTS (
               SELECT 1 FROM unnest(v_applies) t(id)
               WHERE NOT EXISTS (SELECT 1 FROM public.mm_fabric_types ft WHERE ft.id = t.id AND ft.factory_id = v_factory)) THEN
            RAISE EXCEPTION 'NOT_FOUND|Fabric type not found';
          END IF;
        ELSE
          RAISE EXCEPTION 'INVALID|Applies to must be a list of fabric types';
        END IF;
      ELSE
        v_applies := v_f.applies_to_type_ids;
      END IF;

      v_span := COALESCE(public._mm_num(fj->>'col_span')::smallint, v_f.col_span, 1);
      IF v_span NOT IN (1, 2) THEN RAISE EXCEPTION 'INVALID|Width must be 1 or 2 columns'; END IF;

      -- built-in fields
      IF v_f.id IS NOT NULL AND v_f.is_system THEN
        v_tier := public._mm_fabric_field_tier(true, v_f.key);
        IF COALESCE((fj->>'_delete')::boolean, false) THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|Built-in field "%" cannot be deleted%', v_f.label,
            CASE WHEN v_tier = 'standard' THEN '. Hide it instead.' ELSE '' END;
        END IF;
        IF (fj ? 'key'              AND fj->>'key' IS DISTINCT FROM v_f.key)
        OR (fj ? 'input_type'       AND NULLIF(fj->>'input_type', '') IS DISTINCT FROM v_f.input_type)
        OR (fj ? 'storage'          AND fj->>'storage' IS DISTINCT FROM v_f.storage)
        OR (fj ? 'column_name'      AND fj->>'column_name' IS DISTINCT FROM v_f.column_name)
        OR (fj ? 'locked_when_used' AND (fj->>'locked_when_used')::boolean IS DISTINCT FROM v_f.locked_when_used)
        THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|"%" is built in: its key and input type are fixed', v_f.label;
        END IF;
        IF v_tier = 'core' AND (
             (fj ? 'required' AND (fj->>'required')::boolean IS DISTINCT FROM v_f.required)
          OR (fj ? 'visible'  AND (fj->>'visible')::boolean  IS DISTINCT FROM v_f.visible)
          OR v_applies IS NOT NULL) THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|"%" is a core field: it always shows, for every fabric type, and its required setting is fixed', v_f.label;
        END IF;
        UPDATE public.mm_fabric_form_fields SET
          group_id = v_g.id,
          label = COALESCE(NULLIF(btrim(fj->>'label'), ''), label),
          help = CASE WHEN fj ? 'help' THEN NULLIF(btrim(fj->>'help'), '') ELSE help END,
          placeholder = CASE WHEN fj ? 'placeholder' THEN NULLIF(btrim(fj->>'placeholder'), '') ELSE placeholder END,
          seq = COALESCE(public._mm_num(fj->>'seq')::integer, seq),
          col_span = v_span,
          required = CASE WHEN v_tier = 'standard' THEN COALESCE((fj->>'required')::boolean, required) ELSE required END,
          visible  = CASE WHEN v_tier = 'standard' THEN COALESCE((fj->>'visible')::boolean, visible) ELSE visible END,
          applies_to_type_ids = CASE WHEN v_tier = 'standard' THEN v_applies ELSE NULL END,
          updated_at = now(), updated_by = v_actor
        WHERE id = v_f.id;
        CONTINUE;
      END IF;

      -- custom field: delete
      IF v_f.id IS NOT NULL AND COALESCE((fj->>'_delete')::boolean, false) THEN
        IF public._mm_fabric_spec_key_used(v_factory, NULL, v_f.spec_key) THEN
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
        IF EXISTS (SELECT 1 FROM public.mm_fabric_form_fields x
                   WHERE x.factory_id = v_factory AND x.override_of IS NULL AND x.key = v_key) THEN
          RAISE EXCEPTION 'DUPLICATE|Key "%" is already used', v_key;
        END IF;
        INSERT INTO public.mm_fabric_form_fields (
          factory_id, group_id, fabric_type_id, applies_to_type_ids, key, spec_key, label, input_type, options, required, col_span, seq,
          storage, locked_when_used, is_system, visible, placeholder, help, created_by, updated_by)
        VALUES (
          v_factory, v_g.id, NULL, v_applies, v_key, v_key, v_label, v_type, v_opts,
          COALESCE((fj->>'required')::boolean, false), v_span, COALESCE(public._mm_num(fj->>'seq')::integer, 100),
          'spec_values', COALESCE((fj->>'locked_when_used')::boolean, false), false,
          COALESCE((fj->>'visible')::boolean, true),
          NULLIF(btrim(COALESCE(fj->>'placeholder', '')), ''), NULLIF(btrim(COALESCE(fj->>'help', '')), ''),
          v_actor, v_actor);
      ELSE
        v_used := public._mm_fabric_spec_key_used(v_factory, NULL, v_f.spec_key);
        IF v_key <> v_f.key AND v_used THEN
          RAISE EXCEPTION 'KEY_IN_USE|Key "%" already has values on fabrics and cannot be renamed', v_f.key;
        END IF;
        IF v_key <> v_f.key AND EXISTS (SELECT 1 FROM public.mm_fabric_form_fields x
            WHERE x.factory_id = v_factory AND x.override_of IS NULL AND x.key = v_key AND x.id <> v_f.id) THEN
          RAISE EXCEPTION 'DUPLICATE|Key "%" is already used', v_key;
        END IF;
        IF v_type <> v_f.input_type AND v_used THEN
          RAISE EXCEPTION 'KEY_IN_USE|"%" already has values; its input type cannot change', v_f.label;
        END IF;
        IF v_type = 'select' THEN
          SELECT string_agg(DISTINCT x.val, ', ') INTO v_removed
          FROM (SELECT fb.spec_values->>v_f.spec_key AS val FROM public.mm_fabrics fb
                WHERE fb.factory_id = v_factory AND btrim(COALESCE(fb.spec_values->>v_f.spec_key, '')) <> '') x
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) o WHERE o->>'value' = x.val);
          IF v_removed IS NOT NULL THEN
            RAISE EXCEPTION 'OPTION_IN_USE|Option(s) % are used on fabrics and cannot be removed', v_removed;
          END IF;
        END IF;
        UPDATE public.mm_fabric_form_fields SET
          group_id = v_g.id, applies_to_type_ids = v_applies,
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
  RETURN public._mm_ok(public._mm_fabric_form_json(v_factory, NULL));
EXCEPTION
  WHEN raise_exception THEN
    IF position('|' IN SQLERRM) > 0 THEN
      RETURN public._mm_err(split_part(SQLERRM, '|', 1), substr(SQLERRM, position('|' IN SQLERRM) + 1));
    END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid id or value in schema payload');
  WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'A section or field with this key already exists');
END $$;

REVOKE ALL ON FUNCTION public.mm_save_fabric_form_schema(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_fabric_form_schema(jsonb) TO authenticated, service_role;

-- old two-argument call (older clients): the type is ignored, same rules
CREATE OR REPLACE FUNCTION public.mm_save_fabric_form_schema(p_fabric_type_id uuid, p_groups jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.mm_save_fabric_form_schema(p_groups) $$;

-- ---------------------------------------------------------------------------
-- 5. Fabric save: drop values of custom fields that don't apply to the type;
--    enforce "required" on standard built-ins
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_fabric_normalize_full(p_factory uuid, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm jsonb;
  v_err jsonb;
  v_spec jsonb;
  v_type uuid;
  v_missing text;
BEGIN
  v_norm := public._mm_fabric_normalize(p_factory, p_row);
  IF v_norm ? 'error' THEN RETURN v_norm; END IF;
  v_type := (v_norm->>'fabric_type_id')::uuid;
  SELECT COALESCE(jsonb_object_agg(e.key,
           CASE WHEN c.input_type = 'toggle' THEN lower(e.value #>> '{}') ELSE e.value #>> '{}' END), '{}'::jsonb)
  INTO v_spec
  FROM jsonb_each(COALESCE(v_norm->'spec_values', '{}'::jsonb)) e
  LEFT JOIN public._mm_fabric_custom_fields(p_factory, v_type) c ON c.spec_key = e.key
  WHERE c.spec_key IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.mm_fabric_form_fields x
                    WHERE x.factory_id = p_factory AND x.storage = 'spec_values' AND x.spec_key = e.key);
  v_norm := jsonb_set(v_norm, '{spec_values}', v_spec);
  v_err := public._mm_fabric_check_spec(p_factory, v_type, v_norm->'spec_values');
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('error', v_err); END IF;

  SELECT f.label INTO v_missing
  FROM public.mm_fabric_form_fields f
  WHERE f.factory_id = p_factory AND f.is_system AND f.override_of IS NULL
    AND f.required AND f.visible
    AND public._mm_fabric_field_tier(true, f.key) = 'standard'
    AND public._mm_fabric_applies(f.applies_to_type_ids, v_type)
    AND NULLIF(btrim(COALESCE(v_norm->>f.key, '')), '') IS NULL
  ORDER BY f.seq
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', v_missing || ' is required'));
  END IF;
  RETURN v_norm;
END $function$;
