-- Auto-seed Material features when a factory is created
CREATE OR REPLACE FUNCTION public.mm_seed_factory_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (NEW.id, 'receive_goods', true),
    (NEW.id, 'test_rolls', true)
  ON CONFLICT (factory_id, feature_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mm_factory_features_seed_trg ON public.factories;
CREATE TRIGGER mm_factory_features_seed_trg
  AFTER INSERT ON public.factories
  FOR EACH ROW
  EXECUTE FUNCTION public.mm_seed_factory_features();
;
