CREATE OR REPLACE FUNCTION public._mm_seed_ops_locations(p_factory uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cut uuid;
BEGIN
  BEGIN
    v_cut := public.get_cutting_department_id(p_factory);
  EXCEPTION WHEN OTHERS THEN
    v_cut := NULL;
  END;
  INSERT INTO public.mm_locations AS loc (
    factory_id, code, name, location_type, department_id, is_pickable, is_active, created_by, updated_by
  ) VALUES
    (p_factory, 'MILL', 'Mill', 'virtual', NULL, false, true, p_actor, p_actor),
    (p_factory, 'WAREHOUSE', 'Fabric warehouse', 'store', NULL, true, true, p_actor, p_actor),
    (p_factory, 'CUTTING_STORE', 'Cutting store', 'cutting', v_cut, true, true, p_actor, p_actor)
  ON CONFLICT (factory_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    location_type = EXCLUDED.location_type,
    is_active = true,
    updated_at = now(),
    updated_by = p_actor;
END;
$fn$;
REVOKE ALL ON FUNCTION public._mm_seed_ops_locations(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_seed_ops_locations(uuid, uuid) TO service_role;

INSERT INTO public.mm_locations (factory_id, code, name, location_type, is_pickable, is_active)
SELECT f.id, loc.code, loc.name, loc.location_type, loc.pickable, true
FROM public.factories f
CROSS JOIN (
  VALUES
    ('MILL', 'Mill', 'virtual', false),
    ('WAREHOUSE', 'Fabric warehouse', 'store', true),
    ('CUTTING_STORE', 'Cutting store', 'cutting', true)
) AS loc(code, name, location_type, pickable)
ON CONFLICT (factory_id, code) DO NOTHING;
;
