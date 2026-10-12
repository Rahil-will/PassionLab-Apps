CREATE OR REPLACE FUNCTION public.mm_save_fabric_type(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_name text;
  v_out public.mm_fabric_types%ROWTYPE;
  v_rv integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_name := trim(COALESCE(p_row->>'name', ''));
  IF v_name = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Type name is required'); END IF;
  v_id := NULLIF(p_row->>'id', '')::uuid;

  IF v_id IS NOT NULL THEN
    v_rv := COALESCE((p_row->>'row_version')::integer, 0);
    UPDATE public.mm_fabric_types SET
      name = v_name,
      remarks = NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),
      is_active = true,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_id AND factory_id = v_factory AND row_version = v_rv
    RETURNING * INTO v_out;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.mm_fabric_types WHERE id = v_id AND factory_id = v_factory) THEN
        RETURN public._mm_err('STALE_VERSION', 'This type was changed elsewhere. Reload and try again');
      END IF;
      RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
    END IF;
    RETURN public._mm_ok(to_jsonb(v_out));
  END IF;

  INSERT INTO public.mm_fabric_types (
    factory_id, name, remarks, seq, created_by, updated_by
  ) VALUES (
    v_factory, v_name, NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),
    COALESCE((SELECT max(seq) + 1 FROM public.mm_fabric_types WHERE factory_id = v_factory), 0),
    auth.uid(), auth.uid()
  )
  ON CONFLICT (factory_id, name) DO UPDATE SET
    remarks = EXCLUDED.remarks,
    is_active = true,
    row_version = public.mm_fabric_types.row_version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_delete_fabric_type(p_id uuid)
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

  UPDATE public.mm_fabric_types SET
    is_active = false,
    row_version = row_version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric type not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_id, 'action', 'deactivated'));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_save_fabric_type(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_delete_fabric_type(uuid) TO authenticated, service_role;
;
