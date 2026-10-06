CREATE OR REPLACE FUNCTION public.mm_save_trim_requirement_param(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_cat text;
  v_types jsonb;
  v_out public.mm_trim_requirement_params%ROWTYPE;
  v_rv integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_cat := trim(COALESCE(p_row->>'category', ''));
  IF v_cat = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Category is required'); END IF;
  v_types := COALESCE(p_row->'types', '[]'::jsonb);
  IF jsonb_typeof(v_types) <> 'array' THEN v_types := '[]'::jsonb; END IF;
  v_id := NULLIF(p_row->>'id', '')::uuid;

  IF v_id IS NOT NULL THEN
    v_rv := COALESCE((p_row->>'row_version')::integer, 0);
    UPDATE public.mm_trim_requirement_params SET
      category = v_cat, types = v_types,
      seq = COALESCE((p_row->>'seq')::integer, seq),
      is_active = true, row_version = row_version + 1,
      updated_at = now(), updated_by = auth.uid()
    WHERE id = v_id AND factory_id = v_factory AND row_version = v_rv
    RETURNING * INTO v_out;
    IF NOT FOUND THEN RETURN public._mm_err('STALE_VERSION', 'Reload and try again'); END IF;
    RETURN public._mm_ok(to_jsonb(v_out));
  END IF;

  INSERT INTO public.mm_trim_requirement_params (
    factory_id, category, types, seq, created_by, updated_by
  ) VALUES (
    v_factory, v_cat, v_types, COALESCE((p_row->>'seq')::integer, 0), auth.uid(), auth.uid()
  )
  RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out));
EXCEPTION WHEN unique_violation THEN
  RETURN public._mm_err('DUPLICATE_UNIT_CODE', 'That trim category already exists');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_delete_trim_requirement_param(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  UPDATE public.mm_trim_requirement_params SET
    is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Trim category not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_save_trim_requirement_param(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_delete_trim_requirement_param(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
;
