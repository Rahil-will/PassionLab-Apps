ALTER TABLE public.mm_attribute_defs
  ADD COLUMN IF NOT EXISTS type_id uuid REFERENCES public.mm_material_types (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS mm_attribute_defs_type_idx ON public.mm_attribute_defs (type_id);

ALTER TABLE public.mm_attribute_defs
  DROP CONSTRAINT IF EXISTS mm_attribute_defs_factory_group_key_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS mm_attribute_defs_factory_group_type_key_uidx
  ON public.mm_attribute_defs (
    factory_id,
    group_id,
    COALESCE(type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    key
  );

CREATE OR REPLACE FUNCTION public.mm_save_attribute_def(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_group uuid;
  v_key text;
  v_existing record;
  v_rv integer;
  v_in_use boolean;
  v_out public.mm_attribute_defs%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_id := NULLIF(p_row->>'id', '')::uuid;
  v_group := NULLIF(p_row->>'group_id', '')::uuid;
  v_rv := COALESCE((p_row->>'row_version')::integer, 1);

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.mm_attribute_defs WHERE id = v_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Attribute def not found'); END IF;
    IF v_existing.row_version IS DISTINCT FROM v_rv THEN
      RETURN public._mm_err('STALE_VERSION', 'Attribute was updated by another user');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.mm_materials m
      WHERE m.factory_id = v_factory AND m.attributes ? v_existing.key
    ) OR EXISTS (
      SELECT 1 FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.attributes ? v_existing.key
    ) OR EXISTS (
      SELECT 1 FROM public.mm_test_template_fields f WHERE f.attribute_def_id = v_id
    ) INTO v_in_use;

    IF (p_row ? 'key' AND NULLIF(p_row->>'key', '') IS DISTINCT FROM v_existing.key)
       OR (p_row ? 'data_type' AND NULLIF(p_row->>'data_type', '') IS DISTINCT FROM v_existing.data_type) THEN
      IF v_in_use THEN
        RETURN public._mm_err('INVALID_TRANSITION', 'key and data_type are immutable once in use');
      END IF;
    END IF;

    IF COALESCE((p_row->>'is_active')::boolean, true) = false OR (p_row->>'delete')::boolean = true THEN
      IF NOT v_in_use THEN
        DELETE FROM public.mm_attribute_defs WHERE id = v_id RETURNING * INTO v_out;
        RETURN public._mm_ok(to_jsonb(v_out));
      END IF;
      UPDATE public.mm_attribute_defs SET
        is_active = false,
        label = COALESCE(NULLIF(trim(p_row->>'label'), ''), label),
        is_required = COALESCE((p_row->>'is_required')::boolean, is_required),
        seq = COALESCE((p_row->>'seq')::integer, seq),
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_id
      RETURNING * INTO v_out;
      RETURN public._mm_ok(to_jsonb(v_out));
    END IF;

    UPDATE public.mm_attribute_defs SET
      type_id = CASE WHEN p_row ? 'type_id' THEN NULLIF(p_row->>'type_id', '')::uuid ELSE type_id END,
      label = COALESCE(NULLIF(trim(p_row->>'label'), ''), label),
      data_type = CASE WHEN NOT v_in_use THEN COALESCE(NULLIF(p_row->>'data_type', ''), data_type) ELSE data_type END,
      unit = CASE WHEN p_row ? 'unit' THEN NULLIF(p_row->>'unit', '') ELSE unit END,
      options = CASE WHEN p_row ? 'options' THEN COALESCE(p_row->'options', '[]'::jsonb) ELSE options END,
      applies_to = COALESCE(NULLIF(p_row->>'applies_to', ''), applies_to),
      is_required = COALESCE((p_row->>'is_required')::boolean, is_required),
      is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
      seq = COALESCE((p_row->>'seq')::integer, seq),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_id
    RETURNING * INTO v_out;
  ELSE
    IF v_group IS NULL OR NULLIF(trim(p_row->>'label'), '') IS NULL OR NULLIF(p_row->>'data_type', '') IS NULL
       OR NULLIF(p_row->>'applies_to', '') IS NULL THEN
      RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'group_id, label, data_type, applies_to required');
    END IF;
    v_key := COALESCE(NULLIF(public._mm_slugify(p_row->>'label'), ''), 'attr');
    INSERT INTO public.mm_attribute_defs (
      factory_id, group_id, type_id, key, label, data_type, unit, options, applies_to,
      is_required, is_active, seq, created_by, updated_by
    ) VALUES (
      v_factory, v_group, NULLIF(p_row->>'type_id', '')::uuid,
      v_key, trim(p_row->>'label'), p_row->>'data_type',
      NULLIF(p_row->>'unit', ''), COALESCE(p_row->'options', '[]'::jsonb), p_row->>'applies_to',
      COALESCE((p_row->>'is_required')::boolean, false),
      COALESCE((p_row->>'is_active')::boolean, true),
      COALESCE((p_row->>'seq')::integer, 0), auth.uid(), auth.uid()
    )
    RETURNING * INTO v_out;
  END IF;

  RETURN public._mm_ok(to_jsonb(v_out));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'Attribute key already exists for this fabric type');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_save_attribute_def(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mm_delete_material_type(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_existing record;
  v_in_use boolean;
  v_out public.mm_material_types%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  SELECT * INTO v_existing FROM public.mm_material_types WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric type not found'); END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.mm_materials m WHERE m.type_id = p_id
  ) INTO v_in_use;

  IF v_in_use THEN
    UPDATE public.mm_material_types SET
      is_active = false,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = p_id
    RETURNING * INTO v_out;
    RETURN public._mm_ok(to_jsonb(v_out) || jsonb_build_object('action', 'deactivated'));
  END IF;

  DELETE FROM public.mm_attribute_defs WHERE type_id = p_id;
  DELETE FROM public.mm_material_types WHERE id = p_id RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out) || jsonb_build_object('action', 'deleted'));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_delete_material_type(uuid) TO authenticated, service_role;;
