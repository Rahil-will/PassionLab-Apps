-- Auto-name fix: yarn-dyed / melange / print fabrics with the same base spec are different SKUs (design_ref is in the dedupe key)
-- but got identical names. Append the colour method + design ref, e.g.
--   Single Jersey 100% Cotton 180 GSM 72" Open Print P-1042
-- Trigger also fires on color_method / design_ref changes now.
CREATE OR REPLACE FUNCTION public._mm_fabric_set_auto_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cons text;
  v_gsm text;
  v_width text;
  v_design text;
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
  v_design := CASE
    WHEN NEW.color_method IN ('yarn_dyed', 'melange', 'print') THEN
      concat_ws(' ',
        CASE NEW.color_method WHEN 'yarn_dyed' THEN 'Yarn Dyed' WHEN 'melange' THEN 'Melange' ELSE 'Print' END,
        NULLIF(btrim(COALESCE(NEW.design_ref, '')), ''))
    WHEN NEW.color_method = 'greige_only' THEN 'Greige'
    ELSE NULL
  END;

  NEW.name := concat_ws(' ',
    NULLIF(btrim(COALESCE(v_cons, '')), ''),
    NULLIF(btrim(COALESCE(NEW.composition_text, '')), ''),
    v_gsm,
    NULLIF(btrim(COALESCE(v_width, '')), ''),
    v_design
  );
  IF COALESCE(NEW.name, '') = '' THEN
    NEW.name := 'Fabric';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE TRIGGER mm_fabrics_auto_name
  BEFORE INSERT OR UPDATE OF construction_id, composition_text, gsm, width_in, width_form, color_method, design_ref, name
  ON public.mm_fabrics FOR EACH ROW EXECUTE FUNCTION public._mm_fabric_set_auto_name();

-- Re-run names for existing non-solid fabrics.
UPDATE public.mm_fabrics SET name = name WHERE color_method <> 'solid_dyed';
