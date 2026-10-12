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

GRANT EXECUTE ON FUNCTION public.mm_save_type_test_fields(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_type_requirement_fields(uuid, jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
;
