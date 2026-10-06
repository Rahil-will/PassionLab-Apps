-- Single-transaction saves for fabric test KPIs and requirement parameters.
-- Also adds remarks on attribute defs (used by requirement parameters).

ALTER TABLE public.mm_attribute_defs
  ADD COLUMN IF NOT EXISTS remarks text;

CREATE OR REPLACE FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_type public.mm_material_types%ROWTYPE;
  v_field jsonb;
  v_seq integer := 0;
  v_attr_id uuid;
  v_key text;
  v_ids uuid[] := '{}';
  v_data_type text;
  v_options jsonb;
  v_tmpl_id uuid;
  v_label text;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  SELECT * INTO v_type FROM public.mm_material_types
  WHERE id = p_type_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric type not found'); END IF;

  IF p_fields IS NOT NULL AND jsonb_typeof(p_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(COALESCE(p_fields, '[]'::jsonb))
  LOOP
    v_label := trim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN
      RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each test field needs a name');
    END IF;
    v_seq := v_seq + 1;
    v_data_type := COALESCE(NULLIF(v_field->>'data_type', ''), 'text');
    v_options := COALESCE(v_field->'options', '[]'::jsonb);
    IF jsonb_typeof(v_options) IS DISTINCT FROM 'array' THEN
      v_options := '[]'::jsonb;
    END IF;

    v_attr_id := NULLIF(v_field->>'id', '')::uuid;
    IF v_attr_id IS NOT NULL THEN
      UPDATE public.mm_attribute_defs SET
        label = v_label,
        data_type = v_data_type,
        options = v_options,
        remarks = CASE WHEN v_field ? 'remarks' THEN NULLIF(trim(v_field->>'remarks'), '') ELSE remarks END,
        seq = v_seq,
        type_id = p_type_id,
        applies_to = 'test',
        is_active = true,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_attr_id AND factory_id = v_factory
      RETURNING id INTO v_attr_id;
      IF v_attr_id IS NULL THEN
        RETURN public._mm_err('NOT_FOUND', 'Test field not found');
      END IF;
    ELSE
      v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
      INSERT INTO public.mm_attribute_defs (
        factory_id, group_id, type_id, key, label, data_type, options, applies_to,
        is_required, is_active, seq, created_by, updated_by
      ) VALUES (
        v_factory, v_type.group_id, p_type_id, v_key, v_label, v_data_type, v_options, 'test',
        false, true, v_seq, auth.uid(), auth.uid()
      )
      RETURNING id INTO v_attr_id;
    END IF;
    v_ids := array_append(v_ids, v_attr_id);
  END LOOP;

  IF v_type.test_template_id IS NOT NULL THEN
    v_tmpl_id := v_type.test_template_id;
    UPDATE public.mm_test_templates SET
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_tmpl_id AND factory_id = v_factory;
    DELETE FROM public.mm_test_template_fields WHERE template_id = v_tmpl_id;
  ELSE
    INSERT INTO public.mm_test_templates (
      factory_id, group_id, name, version, is_active, created_by, updated_by
    ) VALUES (
      v_factory, v_type.group_id, trim(v_type.name) || ' tests', 1, true, auth.uid(), auth.uid()
    )
    RETURNING id INTO v_tmpl_id;
    UPDATE public.mm_material_types SET
      test_template_id = v_tmpl_id,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = p_type_id;
  END IF;

  v_seq := 0;
  FOREACH v_attr_id IN ARRAY v_ids
  LOOP
    v_seq := v_seq + 1;
    INSERT INTO public.mm_test_template_fields (
      factory_id, template_id, attribute_def_id, seq, is_required, created_by, updated_by
    ) VALUES (
      v_factory, v_tmpl_id, v_attr_id, v_seq, false, auth.uid(), auth.uid()
    );
  END LOOP;

  UPDATE public.mm_attribute_defs SET
    is_active = false,
    row_version = row_version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE factory_id = v_factory
    AND type_id = p_type_id
    AND applies_to = 'test'
    AND is_active = true
    AND NOT (id = ANY (v_ids));

  RETURN public._mm_ok(jsonb_build_object(
    'template_id', v_tmpl_id,
    'attribute_ids', to_jsonb(v_ids)
  ));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'A test field with that name already exists for this type');
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
  v_type public.mm_material_types%ROWTYPE;
  v_field jsonb;
  v_seq integer := 0;
  v_attr_id uuid;
  v_key text;
  v_ids uuid[] := '{}';
  v_label text;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  SELECT * INTO v_type FROM public.mm_material_types
  WHERE id = p_type_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric type not found'); END IF;

  IF p_fields IS NOT NULL AND jsonb_typeof(p_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(COALESCE(p_fields, '[]'::jsonb))
  LOOP
    v_label := trim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN
      RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each parameter needs a name');
    END IF;
    v_seq := v_seq + 1;
    v_attr_id := NULLIF(v_field->>'id', '')::uuid;
    IF v_attr_id IS NOT NULL THEN
      UPDATE public.mm_attribute_defs SET
        label = v_label,
        remarks = CASE WHEN v_field ? 'remarks' THEN NULLIF(trim(v_field->>'remarks'), '') ELSE remarks END,
        seq = v_seq,
        type_id = p_type_id,
        applies_to = 'material',
        is_active = true,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_attr_id AND factory_id = v_factory
      RETURNING id INTO v_attr_id;
      IF v_attr_id IS NULL THEN
        RETURN public._mm_err('NOT_FOUND', 'Parameter not found');
      END IF;
    ELSE
      v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
      INSERT INTO public.mm_attribute_defs (
        factory_id, group_id, type_id, key, label, data_type, options, applies_to, remarks,
        is_required, is_active, seq, created_by, updated_by
      ) VALUES (
        v_factory, v_type.group_id, p_type_id, v_key, v_label, 'text', '[]'::jsonb, 'material',
        NULLIF(trim(COALESCE(v_field->>'remarks', '')), ''),
        false, true, v_seq, auth.uid(), auth.uid()
      )
      RETURNING id INTO v_attr_id;
    END IF;
    v_ids := array_append(v_ids, v_attr_id);
  END LOOP;

  UPDATE public.mm_attribute_defs SET
    is_active = false,
    row_version = row_version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE factory_id = v_factory
    AND type_id = p_type_id
    AND applies_to = 'material'
    AND is_active = true
    AND NOT (id = ANY (v_ids));

  RETURN public._mm_ok(jsonb_build_object('attribute_ids', to_jsonb(v_ids)));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'A parameter with that name already exists for this type');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_save_type_test_fields(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_type_requirement_fields(uuid, jsonb) TO authenticated, service_role;
