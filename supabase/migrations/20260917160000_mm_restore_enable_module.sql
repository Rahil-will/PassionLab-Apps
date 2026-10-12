-- Recreate mm_enable_module with required p_config so PostgREST exposes mm_enable_module(p_config).
DROP FUNCTION IF EXISTS public.mm_enable_module(jsonb);
DROP FUNCTION IF EXISTS public.mm_enable_module();

CREATE FUNCTION public.mm_enable_module(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RETURN public._mm_err('NO_PERMISSION', 'Admin required');
  END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  PERFORM public.set_factory_module('material', true, COALESCE(p_config, '{}'::jsonb));
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES (v_factory, 'receive_goods', true), (v_factory, 'test_rolls', true)
  ON CONFLICT DO NOTHING;
  RETURN public._mm_ok(jsonb_build_object('factory_id', v_factory));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_enable_module(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_enable_module(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.mm_enable_module(jsonb) IS
  'Turns on factory_modules.material and seeds mm_factory_features. Features are a second-level filter: vendor GRN (receive_goods) then test_rolls then challan to cutting; in-house mill skips GRN/test and enters already-tested rolls then dispatch challan.';

COMMENT ON TABLE public.mm_factory_features IS
  'Second-level Material filter after factory_modules.material is on. receive_goods = vendor GRN of rolls, then test_rolls, then challan to cutting store. When the mill is in-house, skip GRN/test UI: mill enters already-tested roll details and dispatch challan to cutting store.';

NOTIFY pgrst, 'reload schema';
