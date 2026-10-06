-- Phase 2 / group 6: mm_enable_module — admin enable + idempotent seed.
-- Seeds FABRIC/TRIMS groups, default reason codes, one Store root location.

CREATE OR REPLACE FUNCTION public.mm_enable_module(p_config jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_module jsonb;
  v_groups_before integer;
  v_reasons_before integer;
  v_locs_before integer;
  v_groups_after integer;
  v_reasons_after integer;
  v_locs_after integer;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN
    RAISE EXCEPTION 'NO_FACTORY';
  END IF;

  v_actor := auth.uid();

  SELECT count(*) INTO v_groups_before
  FROM public.mm_material_groups WHERE factory_id = v_factory;
  SELECT count(*) INTO v_reasons_before
  FROM public.mm_reason_codes WHERE factory_id = v_factory;
  SELECT count(*) INTO v_locs_before
  FROM public.mm_locations WHERE factory_id = v_factory;

  -- Flip entitlement (stamps enabled_at on first enable via set_factory_module).
  v_module := public.set_factory_module(
    'material',
    true,
    COALESCE(p_config, '{}'::jsonb)
  );

  -- Material groups (natural key: factory_id, code)
  INSERT INTO public.mm_material_groups AS g (
    factory_id, code, name, unit_kind, qc_default, allows_inhouse, feeds_cutting,
    default_uom, end_bit_threshold, is_system, is_active, created_by, updated_by
  ) VALUES
    (v_factory, 'FABRIC', 'Fabric', 'roll', 'required', true, true, 'm', 0.5, true, true, v_actor, v_actor),
    (v_factory, 'TRIMS', 'Trims', 'pack', 'optional', false, false, 'pcs', NULL, true, true, v_actor, v_actor)
  ON CONFLICT (factory_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    unit_kind = EXCLUDED.unit_kind,
    feeds_cutting = EXCLUDED.feeds_cutting,
    is_system = true,
    is_active = true,
    updated_at = now(),
    updated_by = v_actor;

  -- Default reason codes (natural key: factory_id, category, code)
  INSERT INTO public.mm_reason_codes AS r (
    factory_id, category, code, label, is_active, created_by, updated_by
  ) VALUES
    (v_factory, 'adjust', 'COUNT', 'Physical count adjustment', true, v_actor, v_actor),
    (v_factory, 'adjust', 'DAMAGE', 'Damaged in store', true, v_actor, v_actor),
    (v_factory, 'reject', 'FAIL_TEST', 'Failed lab / QC test', true, v_actor, v_actor),
    (v_factory, 'reject', 'SHADE', 'Shade mismatch', true, v_actor, v_actor),
    (v_factory, 'hold', 'PENDING_REVIEW', 'Pending QA review', true, v_actor, v_actor),
    (v_factory, 'waste', 'END_BIT', 'End bit below threshold', true, v_actor, v_actor),
    (v_factory, 'return', 'TO_SUPPLIER', 'Return to supplier', true, v_actor, v_actor),
    (v_factory, 'return', 'FROM_CUTTING', 'Return from cutting', true, v_actor, v_actor),
    (v_factory, 'override', 'MANUAL', 'Manual override of suggested sort', true, v_actor, v_actor),
    (v_factory, 'variance', 'DECLARED_VS_ENTERED', 'Declared vs entered variance', true, v_actor, v_actor),
    (v_factory, 'writeoff', 'UNUSABLE', 'Written off as unusable', true, v_actor, v_actor),
    (v_factory, 'correction', 'DATA_FIX', 'Non-qty data correction', true, v_actor, v_actor)
  ON CONFLICT (factory_id, category, code) DO UPDATE SET
    label = EXCLUDED.label,
    is_active = true,
    updated_at = now(),
    updated_by = v_actor;

  -- Root store location (natural key: factory_id, code)
  INSERT INTO public.mm_locations AS loc (
    factory_id, parent_id, code, name, location_type, department_id,
    is_pickable, is_active, created_by, updated_by
  ) VALUES (
    v_factory, NULL, 'STORE', 'Store', 'store', NULL,
    false, true, v_actor, v_actor
  )
  ON CONFLICT (factory_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    location_type = 'store',
    is_active = true,
    updated_at = now(),
    updated_by = v_actor;

  SELECT count(*) INTO v_groups_after
  FROM public.mm_material_groups WHERE factory_id = v_factory;
  SELECT count(*) INTO v_reasons_after
  FROM public.mm_reason_codes WHERE factory_id = v_factory;
  SELECT count(*) INTO v_locs_after
  FROM public.mm_locations WHERE factory_id = v_factory;

  RETURN jsonb_build_object(
    'ok', true,
    'module', v_module,
    'seed', jsonb_build_object(
      'groups_before', v_groups_before,
      'groups_after', v_groups_after,
      'reasons_before', v_reasons_before,
      'reasons_after', v_reasons_after,
      'locations_before', v_locs_before,
      'locations_after', v_locs_after
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.mm_enable_module(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_enable_module(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.mm_enable_module(jsonb) IS
  'Admin-only: enable material module and idempotently seed FABRIC/TRIMS, reason codes, Store location.';
