-- Full width is a required spec field beside cuttable width.
-- Built-in dropdowns can change their options, and locked fields can apply to one fabric type.
-- Image URL leaves the reference section.

ALTER TABLE public.mm_fabric_form_fields DROP CONSTRAINT IF EXISTS mm_fabric_form_fields_storage_chk;
ALTER TABLE public.mm_fabric_form_fields ADD CONSTRAINT mm_fabric_form_fields_storage_chk CHECK (
     (storage = 'column'      AND is_system AND column_name IS NOT NULL AND spec_key IS NULL AND fabric_type_id IS NULL AND override_of IS NULL)
  OR (storage = 'spec_values' AND NOT is_system AND column_name IS NULL AND spec_key = key AND override_of IS NULL
      AND input_type IN ('text', 'number', 'decimal', 'select', 'toggle'))
  OR (storage = 'spec_values' AND is_system AND column_name IS NULL AND spec_key = key AND override_of IS NULL
      AND fabric_type_id IS NULL AND key = 'full_width' AND input_type = 'decimal')
  OR (storage = 'override'    AND NOT is_system AND column_name IS NULL AND spec_key IS NULL AND override_of IS NOT NULL
      AND fabric_type_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION public._mm_fabric_core_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT ARRAY['code','name','fabric_type','construction','composition','gsm','full_width','width_in','width_form','uom','color_method'] $$;

CREATE OR REPLACE FUNCTION public._mm_fabric_reserved_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT ARRAY['id','factory_id','code','name','fabric_type','fabric_type_id','construction','construction_id',
               'composition','composition_text','gsm','full_width','width','width_in','width_form','uom','color_method',
               'design_ref','greige_gsm','greige_width_in','spec_values','supplier_article_no','hsn_code',
               'image_url','remarks','status','merged_into_id','dedupe_key','row_version','created_at',
               'created_by','updated_at','updated_by'];
$$;

CREATE OR REPLACE FUNCTION public._mm_ensure_fabric_full_width(p_factory uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_gid uuid;
BEGIN
  SELECT id INTO v_gid
  FROM public.mm_fabric_form_groups
  WHERE factory_id = p_factory AND fabric_type_id IS NULL AND key = 'spec';
  IF v_gid IS NULL THEN RETURN; END IF;
  UPDATE public.mm_fabric_form_fields
  SET is_system = true,
      required = true,
      visible = true,
      locked_when_used = true,
      input_type = 'decimal',
      storage = 'spec_values',
      column_name = NULL,
      spec_key = 'full_width',
      label = CASE WHEN btrim(label) = '' THEN 'Full width' ELSE label END
  WHERE factory_id = p_factory AND key = 'full_width' AND override_of IS NULL
    AND fabric_type_id IS NULL AND storage = 'spec_values';
  INSERT INTO public.mm_fabric_form_fields (
    factory_id, group_id, fabric_type_id, key, spec_key, label, input_type, options, required,
    col_span, seq, storage, column_name, locked_when_used, is_system, visible, placeholder, help)
  SELECT p_factory, v_gid, NULL, 'full_width', 'full_width', 'Full width', 'decimal', '[]'::jsonb, true,
         1, 15, 'spec_values', NULL, true, true, true, 'e.g. 72', 'Full fabric width in inches.'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_form_fields f
    WHERE f.factory_id = p_factory AND f.key = 'full_width' AND f.override_of IS NULL
  );
END $$;

REVOKE ALL ON FUNCTION public._mm_ensure_fabric_full_width(uuid) FROM PUBLIC, anon, authenticated;

SELECT public._mm_ensure_fabric_full_width(f.id) FROM public.factories f;

UPDATE public.mm_fabric_form_fields
SET visible = false, updated_at = now()
WHERE key = 'image_url' AND is_system AND override_of IS NULL AND visible;

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
  PERFORM public._mm_ensure_fabric_full_width(v_factory);

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
        ) THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|"%" is a core field: its required setting is fixed', v_f.label;
        END IF;
        v_opts := v_f.options;
        IF v_f.input_type IN ('select', 'segment') AND fj ? 'options' THEN
          IF jsonb_typeof(fj->'options') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'INVALID|options must be an array';
          END IF;
          SELECT jsonb_agg(jsonb_build_object(
                   'value', COALESCE(NULLIF(btrim(o->>'value'), ''), btrim(o->>'label')),
                   'label', COALESCE(NULLIF(btrim(o->>'label'), ''), NULLIF(btrim(o->>'value'), ''))
                 ) ORDER BY t.ord)
            INTO v_opts
          FROM jsonb_array_elements(fj->'options') WITH ORDINALITY AS t(o, ord)
          WHERE btrim(COALESCE(o->>'value', o->>'label', '')) <> '';
          IF v_opts IS NULL OR jsonb_array_length(v_opts) = 0 THEN
            RAISE EXCEPTION 'REQUIRED|Dropdown "%" needs at least one value', v_f.label;
          END IF;
          IF (SELECT count(*) FROM jsonb_array_elements(v_opts) o)
             <> (SELECT count(DISTINCT lower(o->>'value')) FROM jsonb_array_elements(v_opts) o) THEN
            RAISE EXCEPTION 'INVALID|Option values must be unique';
          END IF;
          IF v_f.column_name IN ('width_form', 'uom', 'color_method') THEN
            EXECUTE format($q$
              SELECT string_agg(DISTINCT t.val, ', ')
              FROM (
                SELECT DISTINCT %I::text AS val
                FROM public.mm_fabrics
                WHERE factory_id = $1 AND %I IS NOT NULL
              ) t
              WHERE NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements($2) o WHERE o->>'value' = t.val
              )
            $q$, v_f.column_name, v_f.column_name)
            INTO v_removed
            USING v_factory, v_opts;
            IF v_removed IS NOT NULL THEN
              RAISE EXCEPTION 'OPTION_IN_USE|Option(s) % are used on fabrics and cannot be removed', v_removed;
            END IF;
          END IF;
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
          applies_to_type_ids = v_applies,
          options = CASE WHEN input_type IN ('select', 'segment') THEN v_opts ELSE options END,
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

SELECT public._mm_fabric_form_bump(f.id) FROM public.factories f;
