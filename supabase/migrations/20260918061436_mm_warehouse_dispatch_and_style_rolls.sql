-- Warehouse dispatch (store challan) mill-dispatch UX + locked roll tests on style warehouse.

ALTER TABLE public.mm_store_challans
  ADD COLUMN IF NOT EXISTS reference_no text;

DROP FUNCTION IF EXISTS public.mm_create_store_challan(uuid, uuid[]);
;
