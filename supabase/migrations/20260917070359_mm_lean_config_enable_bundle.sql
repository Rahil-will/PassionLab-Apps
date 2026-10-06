CREATE OR REPLACE FUNCTION public.mm_seed_factory_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES (NEW.id, 'receive_goods', true), (NEW.id, 'test_rolls', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS mm_factory_features_seed_trg ON public.factories;
CREATE TRIGGER mm_factory_features_seed_trg
AFTER INSERT ON public.factories
FOR EACH ROW EXECUTE FUNCTION public.mm_seed_factory_features();

CREATE OR REPLACE FUNCTION public.mm_enable_module(p_config jsonb DEFAULT '{}'::jsonb)
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

CREATE OR REPLACE FUNCTION public.mm_get_config_bundle()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    PERFORM public.assert_module_enabled('material');
    v_factory := public.current_factory_id();
    IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
    IF NOT public.is_factory_admin() THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.assigned_apps @> '["mm_config"]'::jsonb
            OR p.assigned_apps @> '["mm_reports"]'::jsonb
          )
      ) THEN
        RETURN public._mm_err('NO_PERMISSION', 'mm_config or mm_reports required');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  RETURN public._mm_ok(jsonb_build_object(
    'types', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.seq, t.name)
      FROM public.mm_fabric_types t WHERE t.factory_id = v_factory
    ), '[]'::jsonb),
    'test_fields', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f WHERE f.factory_id = v_factory
    ), '[]'::jsonb),
    'requirement_fields', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.seq, f.label)
      FROM public.mm_type_requirement_fields f WHERE f.factory_id = v_factory
    ), '[]'::jsonb),
    'trim_params', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.seq, p.category)
      FROM public.mm_trim_requirement_params p WHERE p.factory_id = v_factory AND p.is_active
    ), '[]'::jsonb),
    'attribute_defs', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(f) || jsonb_build_object(
          'applies_to', 'material',
          'data_type', 'text',
          'options', '[]'::jsonb
        )
        ORDER BY f.seq, f.label
      )
      FROM public.mm_type_requirement_fields f
      WHERE f.factory_id = v_factory AND f.is_active
    ), '[]'::jsonb)
  ));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_enable_module(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_config_bundle() TO authenticated, service_role;
;
