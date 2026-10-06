-- Test + requirement params may share labels (e.g. GSM). Unique key must include applies_to.
-- Reuse inactive rows on re-add. Accept JSON-string field payloads from the client.

DROP INDEX IF EXISTS public.mm_attribute_defs_factory_group_type_key_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS mm_attribute_defs_factory_group_type_applies_key_uidx
  ON public.mm_attribute_defs (
    factory_id,
    group_id,
    COALESCE(type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    applies_to,
    key
  );

CREATE OR REPLACE FUNCTION public._mm_upsert_type_field(
  p_factory uuid,
  p_group_id uuid,
  p_type_id uuid,
  p_field jsonb,
  p_applies_to text,
  p_seq integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_attr_id uuid;
  v_found uuid;
  v_label text;
  v_key text;
  v_data_type text;
  v_options jsonb;
  v_remarks text;
BEGIN
  v_label := trim(COALESCE(p_field->>'label', ''));
  IF v_label = '' THEN
    RAISE EXCEPTION 'REQUIRED_ATTR_MISSING' USING ERRCODE = 'P0001';
  END IF;

  v_data_type := COALESCE(NULLIF(p_field->>'data_type', ''), 'text');
  v_options := COALESCE(p_field->'options', '[]'::jsonb);
  IF jsonb_typeof(v_options) = 'string' THEN
    BEGIN
      v_options := (v_options #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_options := '[]'::jsonb;
    END;
  END IF;
  IF jsonb_typeof(v_options) IS DISTINCT FROM 'array' THEN
    v_options := '[]'::jsonb;
  END IF;
  v_remarks := CASE WHEN p_field ? 'remarks' THEN NULLIF(trim(p_field->>'remarks'), '') ELSE NULL END;

  BEGIN
    v_attr_id := NULLIF(trim(COALESCE(p_field->>'id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_attr_id := NULL;
  END;

  IF v_attr_id IS NOT NULL THEN
    UPDATE public.mm_attribute_defs SET
      label = v_label,
      data_type = CASE WHEN p_applies_to = 'test' THEN v_data_type ELSE data_type END,
      options = CASE WHEN p_applies_to = 'test' THEN v_options ELSE options END,
      remarks = CASE WHEN p_field ? 'remarks' THEN v_remarks ELSE remarks END,
      seq = p_seq,
      type_id = p_type_id,
      applies_to = p_applies_to,
      is_active = true,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_attr_id AND factory_id = p_factory
    RETURNING id INTO v_found;
    IF v_found IS NOT NULL THEN
      RETURN v_found;
    END IF;
  END IF;

  v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');

  SELECT id INTO v_found
  FROM public.mm_attribute_defs
  WHERE factory_id = p_factory
    AND group_id = p_group_id
    AND type_id = p_type_id
    AND applies_to = p_applies_to
    AND key = v_key
  LIMIT 1;

  IF v_found IS NOT NULL THEN
    UPDATE public.mm_attribute_defs SET
      label = v_label,
      data_type = CASE WHEN p_applies_to = 'test' THEN v_data_type ELSE data_type END,
      options = CASE WHEN p_applies_to = 'test' THEN v_options ELSE options END,
      remarks = CASE WHEN p_field ? 'remarks' THEN v_remarks ELSE remarks END,
      seq = p_seq,
      is_active = true,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_found;
    RETURN v_found;
  END IF;

  INSERT INTO public.mm_attribute_defs (
    factory_id, group_id, type_id, key, label, data_type, options, applies_to, remarks,
    is_required, is_active, seq, created_by, updated_by
  ) VALUES (
    p_factory, p_group_id, p_type_id, v_key, v_label,
    CASE WHEN p_applies_to = 'test' THEN v_data_type ELSE 'text' END,
    CASE WHEN p_applies_to = 'test' THEN v_options ELSE '[]'::jsonb END,
    p_applies_to, v_remarks,
    false, true, p_seq, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_found;

  RETURN v_found;
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_upsert_type_field(uuid, uuid, uuid, jsonb, text, integer) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_type public.mm_material_types%ROWTYPE;
  v_fields jsonb;
  v_field jsonb;
  v_seq integer := 0;
  v_attr_id uuid;
  v_ids uuid[] := '{}';
  v_tmpl_id uuid;
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

  v_fields := COALESCE(p_fields, '[]'::jsonb);
  IF jsonb_typeof(v_fields) = 'string' THEN
    BEGIN
      v_fields := (v_fields #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
    END;
  END IF;
  IF jsonb_typeof(v_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields)
  LOOP
    v_seq := v_seq + 1;
    BEGIN
      v_attr_id := public._mm_upsert_type_field(
        v_factory, v_type.group_id, p_type_id, v_field, 'test', v_seq
      );
    EXCEPTION WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'A test field with that name already exists for this type');
    WHEN OTHERS THEN
      IF SQLERRM = 'REQUIRED_ATTR_MISSING' THEN
        RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each test field needs a name');
      END IF;
      RETURN public._mm_err('ERROR', SQLERRM);
    END;
    IF v_attr_id = ANY (v_ids) THEN
      RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'A test field with that name already exists for this type');
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
  v_fields jsonb;
  v_field jsonb;
  v_seq integer := 0;
  v_attr_id uuid;
  v_ids uuid[] := '{}';
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

  v_fields := COALESCE(p_fields, '[]'::jsonb);
  IF jsonb_typeof(v_fields) = 'string' THEN
    BEGIN
      v_fields := (v_fields #>> '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
    END;
  END IF;
  IF jsonb_typeof(v_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields)
  LOOP
    v_seq := v_seq + 1;
    BEGIN
      v_attr_id := public._mm_upsert_type_field(
        v_factory, v_type.group_id, p_type_id, v_field, 'material', v_seq
      );
    EXCEPTION WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'A parameter with that name already exists for this type');
    WHEN OTHERS THEN
      IF SQLERRM = 'REQUIRED_ATTR_MISSING' THEN
        RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each parameter needs a name');
      END IF;
      RETURN public._mm_err('ERROR', SQLERRM);
    END;
    IF v_attr_id = ANY (v_ids) THEN
      RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'A parameter with that name already exists for this type');
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

NOTIFY pgrst, 'reload schema';
