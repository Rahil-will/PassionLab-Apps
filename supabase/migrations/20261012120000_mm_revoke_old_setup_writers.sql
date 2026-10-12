-- Setup now goes through mm_save_partner / mm_save_process. Old writers off.
REVOKE EXECUTE ON FUNCTION public.mm_save_process_catalog(jsonb) FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.mm_save_facility(jsonb) FROM authenticated, anon, public;
