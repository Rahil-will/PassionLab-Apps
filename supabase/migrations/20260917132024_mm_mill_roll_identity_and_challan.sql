-- applied from 20260917310000_mm_mill_roll_identity_and_challan.sql
ALTER TABLE public.mm_in_challans ADD COLUMN IF NOT EXISTS reference_no text, ADD COLUMN IF NOT EXISTS to_location text;
UPDATE public.mm_in_challans SET to_location = 'Warehouse' WHERE source = 'mill' AND NULLIF(trim(COALESCE(to_location, '')), '') IS NULL;
ALTER TABLE public.mm_stock_units DROP CONSTRAINT IF EXISTS mm_stock_units_factory_code_uidx;
DROP INDEX IF EXISTS public.mm_stock_units_factory_code_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS mm_stock_units_mill_batch_roll_uidx ON public.mm_stock_units (factory_id, mill_batch_id, lower(unit_code)) WHERE mill_batch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mm_stock_units_loose_code_uidx ON public.mm_stock_units (factory_id, unit_code) WHERE mill_batch_id IS NULL;;
