-- applied from local 20260924180000_mm_mill_allocate_and_short_close_reason.sql
ALTER TABLE public.colorway_materials ADD COLUMN IF NOT EXISTS mill_short_closed_reason text;
COMMENT ON COLUMN public.colorway_materials.mill_short_closed_reason IS 'Why mill dispatch was short-closed. Cleared when short close is cancelled.';
DROP FUNCTION IF EXISTS public.mm_set_mill_short_close(uuid, uuid, uuid, boolean);;
