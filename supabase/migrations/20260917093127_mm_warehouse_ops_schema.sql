-- Fabric mill / warehouse ops schema
ALTER TABLE public.doc_sequences DROP CONSTRAINT IF EXISTS doc_sequences_type_check;
ALTER TABLE public.doc_sequences
  ADD CONSTRAINT doc_sequences_type_check CHECK (
    doc_type = ANY (ARRAY['GRN'::text, 'MV'::text, 'ROLL'::text, 'PACK'::text, 'MILL'::text, 'SC'::text])
  );

CREATE OR REPLACE FUNCTION public.next_doc_no(p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_year integer;
  v_yy text;
  v_next integer;
BEGIN
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RAISE EXCEPTION 'NO_FACTORY'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('GRN', 'MV', 'ROLL', 'PACK', 'MILL', 'SC') THEN
    RAISE EXCEPTION 'INVALID_DOC_TYPE';
  END IF;
  v_year := EXTRACT(YEAR FROM now())::integer;
  v_yy := to_char(now(), 'YY');
  INSERT INTO public.doc_sequences AS ds (factory_id, doc_type, year, last_no)
  VALUES (v_factory, p_type, v_year, 1)
  ON CONFLICT (factory_id, doc_type, year)
  DO UPDATE SET last_no = ds.last_no + 1
  RETURNING ds.last_no INTO v_next;
  RETURN p_type || '-' || v_yy || '-' || lpad(v_next::text, 6, '0');
END;
$function$;

ALTER TABLE public.mm_factory_features DROP CONSTRAINT IF EXISTS mm_factory_features_key_chk;
ALTER TABLE public.mm_factory_features
  ADD CONSTRAINT mm_factory_features_key_chk CHECK (
    feature_key = ANY (ARRAY['receive_goods'::text, 'test_rolls'::text, 'in_house_mill'::text])
  );

INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
SELECT f.id, 'in_house_mill', true
FROM public.factories f
ON CONFLICT (factory_id, feature_key) DO NOTHING;

UPDATE public.mm_factory_features SET enabled = false
WHERE feature_key IN ('receive_goods', 'test_rolls');

CREATE OR REPLACE FUNCTION public.mm_seed_factory_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (NEW.id, 'receive_goods', false),
    (NEW.id, 'test_rolls', false),
    (NEW.id, 'in_house_mill', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$fn$;
;
