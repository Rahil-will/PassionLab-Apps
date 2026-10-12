-- Fabric name is built from construction, composition, GSM, and full width (width_in).
-- Cuttable width is a roll inspection figure and is not part of the name.

CREATE OR REPLACE FUNCTION public._mm_fabric_set_auto_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_cons text;
  v_gsm text;
  v_width text;
BEGIN
  SELECT c.name INTO v_cons
  FROM public.mm_fabric_constructions c
  WHERE c.id = NEW.construction_id;

  v_gsm := CASE
    WHEN NEW.gsm IS NULL THEN NULL
    ELSE rtrim(rtrim(to_char(NEW.gsm, 'FM999990.999'), '0'), '.') || ' GSM'
  END;
  v_width := CASE
    WHEN NEW.width_in IS NULL THEN NULL
    ELSE rtrim(rtrim(to_char(NEW.width_in, 'FM999990.999'), '0'), '.') || '" '
      || CASE lower(COALESCE(NEW.width_form, 'open'))
           WHEN 'tubular' THEN 'Tubular'
           ELSE 'Open'
         END
  END;

  NEW.name := concat_ws(' ',
    NULLIF(btrim(COALESCE(v_cons, '')), ''),
    NULLIF(btrim(COALESCE(NEW.composition_text, '')), ''),
    v_gsm,
    NULLIF(btrim(COALESCE(v_width, '')), '')
  );
  IF COALESCE(NEW.name, '') = '' THEN
    NEW.name := 'Fabric';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mm_fabrics_auto_name') THEN
    CREATE TRIGGER mm_fabrics_auto_name
      BEFORE INSERT OR UPDATE OF construction_id, composition_text, gsm, width_in, width_form, name
      ON public.mm_fabrics
      FOR EACH ROW
      EXECUTE FUNCTION public._mm_fabric_set_auto_name();
  END IF;
END $$;

UPDATE public.mm_fabrics SET width_in = width_in;
