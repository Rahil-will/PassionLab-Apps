-- S1: Material Management sub-switches + Fabric v4 native (Rahil 2026-10-09).
-- Switches (mm_factory_features): fabric_warehouse, fabric_mill, trims.
--   fabric_mill is mirrored to legacy 'in_house_mill' (old mill RPC guards read it).
--   Mill requires warehouse. Defaults when never set: warehouse = true, mill = in_house_mill, trims = false.
-- v4 is the only flow: _mm_v4_on() always true; fabric_v4 rows kept but ignored; mm_set_fabric_v4 revoked.

ALTER TABLE public.mm_factory_features DROP CONSTRAINT IF EXISTS mm_factory_features_key_chk;
ALTER TABLE public.mm_factory_features ADD CONSTRAINT mm_factory_features_key_chk
  CHECK (feature_key IN ('receive_goods', 'test_rolls', 'in_house_mill', 'fabric_v4', 'fabric_warehouse', 'fabric_mill', 'trims'));

CREATE OR REPLACE FUNCTION public._mm_v4_on(p_factory uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT true $function$;

CREATE OR REPLACE FUNCTION public._mm_feature(p_factory uuid, p_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE p_key
    WHEN 'fabric_warehouse' THEN COALESCE((SELECT enabled FROM public.mm_factory_features WHERE factory_id = p_factory AND feature_key = 'fabric_warehouse'), true)
    WHEN 'fabric_mill' THEN COALESCE((SELECT enabled FROM public.mm_factory_features WHERE factory_id = p_factory AND feature_key = 'fabric_mill'),
                                     (SELECT enabled FROM public.mm_factory_features WHERE factory_id = p_factory AND feature_key = 'in_house_mill'), false)
    WHEN 'trims' THEN COALESCE((SELECT enabled FROM public.mm_factory_features WHERE factory_id = p_factory AND feature_key = 'trims'), false)
    ELSE false END
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_material_features()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid := public.current_factory_id(); v_mod boolean;
BEGIN
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  SELECT enabled INTO v_mod FROM public.factory_modules WHERE factory_id = v_factory AND module_key = 'material';
  RETURN public._mm_ok(jsonb_build_object(
    'material', COALESCE(v_mod, false),
    'fabric_warehouse', COALESCE(v_mod, false) AND public._mm_feature(v_factory, 'fabric_warehouse'),
    'fabric_mill', COALESCE(v_mod, false) AND public._mm_feature(v_factory, 'fabric_warehouse') AND public._mm_feature(v_factory, 'fabric_mill'),
    'trims', COALESCE(v_mod, false) AND public._mm_feature(v_factory, 'trims')));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_set_material_feature(p_key text, p_enabled boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_on boolean := COALESCE(p_enabled, false);
BEGIN
  IF NOT public.is_factory_admin() THEN RETURN public._mm_err('NO_PERMISSION', 'Admin required'); END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  IF p_key NOT IN ('fabric_warehouse', 'fabric_mill', 'trims') THEN
    RETURN public._mm_err('INVALID', 'Switch must be fabric_warehouse, fabric_mill or trims');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.factory_modules WHERE factory_id = v_factory AND module_key = 'material' AND enabled) THEN
    RETURN public._mm_err('MODULE_DISABLED', 'Turn on Material Management first');
  END IF;
  IF p_key = 'fabric_mill' AND v_on AND NOT public._mm_feature(v_factory, 'fabric_warehouse') THEN
    RETURN public._mm_err('INVALID', 'Fabric mill needs Fabric warehouse on');
  END IF;

  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled) VALUES (v_factory, p_key, v_on)
  ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  IF p_key = 'fabric_mill' THEN
    INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled) VALUES (v_factory, 'in_house_mill', v_on)
    ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  END IF;
  IF p_key = 'fabric_warehouse' AND NOT v_on THEN   -- mill can't run without warehouse
    INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
    VALUES (v_factory, 'fabric_mill', false), (v_factory, 'in_house_mill', false)
    ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  END IF;
  IF v_on AND p_key IN ('fabric_warehouse', 'fabric_mill') THEN
    PERFORM public._mm_v4_seed_masters(v_factory);
    PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  END IF;
  RETURN public.mm_get_material_features();
END $function$;

GRANT EXECUTE ON FUNCTION public.mm_get_material_features() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_set_material_feature(text, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.mm_set_fabric_v4(boolean) FROM authenticated, anon, public;

-- Initial values: abc = warehouse on, mill on (was in_house_mill), trims off. Others = warehouse on, mill off, trims off.
INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
SELECT f.id, k.key,
  CASE k.key
    WHEN 'fabric_warehouse' THEN true
    WHEN 'fabric_mill' THEN (f.id = '8202873b-1003-4fee-9970-9a2ef4fa9fd3')
    ELSE false END
FROM public.factories f CROSS JOIN (VALUES ('fabric_warehouse'), ('fabric_mill'), ('trims')) k(key)
ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
UPDATE public.mm_factory_features SET enabled = (factory_id = '8202873b-1003-4fee-9970-9a2ef4fa9fd3')
WHERE feature_key = 'in_house_mill';
UPDATE public.mm_factory_features SET enabled = true WHERE feature_key = 'fabric_v4';
