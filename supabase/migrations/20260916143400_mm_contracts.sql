-- Phase 2 / group 5: CORE contract stubs (permissive).
-- Production caller hook is Phase 7 (floor_capture_cutting_bundles_generate).
-- Deviation: cutting_sessions has logged_at (not created_at) — use logged_at for D11 cutoff.

CREATE OR REPLACE FUNCTION public.contract_cutting_lay_can_close(p_lay_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_session_logged_at timestamptz;
  v_enabled boolean;
  v_enabled_at timestamptz;
BEGIN
  IF p_lay_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'lay_id is required');
  END IF;

  SELECT l.factory_id, s.logged_at
  INTO v_factory, v_session_logged_at
  FROM public.cutting_lays l
  JOIN public.cutting_sessions s ON s.id = l.session_id
  WHERE l.id = p_lay_id;

  IF v_factory IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Lay not found');
  END IF;

  SELECT fm.enabled, fm.enabled_at
  INTO v_enabled, v_enabled_at
  FROM public.factory_modules fm
  WHERE fm.factory_id = v_factory
    AND fm.module_key = 'material';

  -- Module off → always allow (production unchanged).
  IF COALESCE(v_enabled, false) = false THEN
    RETURN jsonb_build_object('ok', true, 'code', 'MODULE_OFF');
  END IF;

  -- Session predates material enable → not enforced (D11).
  IF v_enabled_at IS NOT NULL
     AND v_session_logged_at IS NOT NULL
     AND v_session_logged_at < v_enabled_at THEN
    RETURN jsonb_build_object('ok', true, 'code', 'PRE_ENABLE');
  END IF;

  -- Phase 2: still permissive. Phase 7 adds consumption-row enforcement.
  RETURN jsonb_build_object('ok', true);
END;
$function$;
CREATE OR REPLACE FUNCTION public.contract_material_for_component(p_component_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Real body in Phase 8 (available / issued qty). Stub for Phase 2.
  RETURN jsonb_build_object(
    'available', NULL,
    'component_id', p_component_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.contract_cutting_lay_can_close(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contract_material_for_component(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contract_cutting_lay_can_close(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_material_for_component(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.contract_cutting_lay_can_close(uuid) IS
  'CORE contract. Phase 2: module/cutoff branching only; Phase 7 tightens consumption check. Uses cutting_sessions.logged_at (no created_at).';
COMMENT ON FUNCTION public.contract_material_for_component(uuid) IS
  'CORE contract stub. Real availability body in Phase 8.';
