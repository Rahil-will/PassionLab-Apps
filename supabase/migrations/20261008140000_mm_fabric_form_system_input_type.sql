-- Built-in fabric form fields keep their names. Flexible controls (text, number,
-- decimal, select, toggle, segment) may change input type from a fabric-type scope.
-- Fixed controls (code, fabric type, construction, composition, image, remarks) stay locked.

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

      -- (b) system field: the name stays. A flexible control may change input type, from any scope.
      IF v_f.id IS NOT NULL AND v_f.is_system THEN
        IF COALESCE((fj->>'_delete')::boolean, false) THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|System field "%" cannot be deleted', v_f.label;
        END IF;
        IF fj ? 'label' AND NULLIF(btrim(fj->>'label'), '') IS NOT NULL
           AND btrim(fj->>'label') IS DISTINCT FROM v_f.label THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|Built-in field "%" cannot be renamed', v_f.label;
        END IF;
        IF (fj ? 'required'         AND (fj->>'required')::boolean         IS DISTINCT FROM v_f.required)
        OR (fj ? 'visible'          AND (fj->>'visible')::boolean          IS DISTINCT FROM v_f.visible)
        OR (fj ? 'locked_when_used' AND (fj->>'locked_when_used')::boolean IS DISTINCT FROM v_f.locked_when_used)
        OR (fj ? 'storage'          AND fj->>'storage'                     IS DISTINCT FROM v_f.storage)
        OR (fj ? 'column_name'      AND fj->>'column_name'                 IS DISTINCT FROM v_f.column_name)
        OR (fj ? 'key'              AND fj->>'key'                         IS DISTINCT FROM v_f.key)
        THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|"%" is a built-in field: only the input type can change', v_f.label;
        END IF;
        v_type := COALESCE(NULLIF(fj->>'input_type', ''), v_f.input_type);
        IF v_type IS DISTINCT FROM v_f.input_type
           AND (
             v_f.input_type NOT IN ('text', 'number', 'decimal', 'select', 'toggle', 'segment')
             OR v_type NOT IN ('text', 'number', 'decimal', 'select', 'toggle', 'segment')
           ) THEN
          RAISE EXCEPTION 'SYSTEM_LOCKED|"%" uses a fixed control', v_f.label;
        END IF;
        v_opts := CASE
          WHEN v_type IN ('select', 'segment') THEN COALESCE(fj->'options', v_f.options, '[]'::jsonb)
          ELSE '[]'::jsonb
        END;
        IF v_type IN ('select', 'segment') THEN
          IF jsonb_typeof(v_opts) IS DISTINCT FROM 'array' OR jsonb_array_length(v_opts) = 0 THEN
            RAISE EXCEPTION 'REQUIRED|Select field "%" needs options', v_f.label;
          END IF;
          IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_opts) o WHERE btrim(COALESCE(o->>'value', '')) = '') THEN
            RAISE EXCEPTION 'INVALID|Every option needs a value';
          END IF;
          SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'value', btrim(o->>'value'),
            'label', COALESCE(NULLIF(btrim(o->>'label'), ''), btrim(o->>'value')),
            'help', NULLIF(btrim(COALESCE(o->>'help', '')), '')
          )))
          INTO v_opts FROM jsonb_array_elements(v_opts) o;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.mm_fabric_form_groups WHERE id = v_g.id AND fabric_type_id IS NULL) THEN
          RAISE EXCEPTION 'INVALID|System field "%" must stay in a common group', v_f.label;
        END IF;
        v_span := COALESCE(public._mm_num(fj->>'col_span')::smallint, v_f.col_span);
        IF v_span NOT IN (1, 2) THEN RAISE EXCEPTION 'INVALID|Width must be 1 or 2 columns'; END IF;
        UPDATE public.mm_fabric_form_fields SET
          group_id = v_g.id,
          input_type = v_type,
          options = v_opts,
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

REVOKE ALL ON FUNCTION public.mm_save_fabric_form_schema(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_fabric_form_schema(uuid, jsonb) TO authenticated, service_role;
