ALTER TABLE public.mm_factory_features DROP CONSTRAINT IF EXISTS mm_factory_features_key_chk;
ALTER TABLE public.mm_factory_features ADD CONSTRAINT mm_factory_features_key_chk
  CHECK (feature_key = ANY (ARRAY['receive_goods','test_rolls','in_house_mill','fabric_v4']));;
