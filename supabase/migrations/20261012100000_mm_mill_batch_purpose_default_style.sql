-- Batches made by the old style-batch save (Allocate rolls page, mm_save_mill_batch) have a style line but no purpose → default them to 'style'.
-- v6 sets purpose explicitly right after insert, so this only affects the old paths.
CREATE OR REPLACE FUNCTION public._mm_mill_batch_purpose_default()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.style_material_id IS NOT NULL AND NEW.purpose = 'stock' THEN NEW.purpose := 'style'; END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER mm_mill_batches_purpose_default BEFORE INSERT ON public.mm_mill_batches
FOR EACH ROW EXECUTE FUNCTION public._mm_mill_batch_purpose_default();
UPDATE public.mm_mill_batches SET purpose = 'style' WHERE style_material_id IS NOT NULL AND purpose = 'stock';
