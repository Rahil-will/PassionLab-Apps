-- =====================================================================
-- LOCK B (run in the SQL editor): remove retired tables, columns and functions.
-- Everything that read them was moved or rewritten (checked live, 2026-10-16).
-- All or nothing: if any step fails, nothing changes.
-- =====================================================================

DROP TRIGGER IF EXISTS mm_factory_features_seed_trg ON public.factories;

-- retired columns
ALTER TABLE public.mm_process_challans DROP COLUMN IF EXISTS vendor_id, DROP COLUMN IF EXISTS machine_id;
ALTER TABLE public.mm_rolls            DROP COLUMN IF EXISTS machine_id, DROP COLUMN IF EXISTS shift;
ALTER TABLE public.mm_in_challans      DROP COLUMN IF EXISTS machine_id, DROP COLUMN IF EXISTS shift, DROP COLUMN IF EXISTS to_facility_id;
ALTER TABLE public.mm_process_types    DROP COLUMN IF EXISTS default_return_mode, DROP COLUMN IF EXISTS machine_kinds,
  DROP COLUMN IF EXISTS output_unit_form, DROP COLUMN IF EXISTS makes_fabric,
  DROP COLUMN IF EXISTS resets_testing, DROP COLUMN IF EXISTS resets_inspection;

-- retired tables
DROP TABLE IF EXISTS public.mm_process_vendor_types;
DROP TABLE IF EXISTS public.mm_process_vendors;
DROP TABLE IF EXISTS public.mm_facility_process_types;
DROP TABLE IF EXISTS public.mm_process_lots;
DROP TABLE IF EXISTS public.mm_machines;
DROP TABLE IF EXISTS public.mm_facilities;
DROP TABLE IF EXISTS public.mm_factory_features;
DROP TABLE IF EXISTS public.mm_type_requirement_fields;
DROP TABLE IF EXISTS public.mm_fabric_constructions;
DROP TABLE IF EXISTS public.mm_defect_types;
DROP SCHEMA IF EXISTS zz_tmp CASCADE;

-- dead functions (after the tables, so their triggers are already gone)
DO $d$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
             '_mm_machine_internal_guard','_mm_inhouse_unit','_mm_is_fabric_maker','mm_proc_save_lots','mm_save_facility',
             'mm_save_machine','mm_list_process_challans','mm_save_process_catalog','mm_list_process_vendors',
             'mm_seed_factory_features','_mm_v4_selftest_wh','_mm_qc_out_of_tolerance')
  LOOP EXECUTE 'DROP FUNCTION ' || r.sig; END LOOP;
END $d$;

-- Knitting / Rolling are not processes (already switched off, never used on a challan)
DELETE FROM public.mm_process_types t
 WHERE lower(t.name) IN ('knitting', 'rolling')
   AND NOT EXISTS (SELECT 1 FROM public.mm_process_challans c WHERE c.process_type_id = t.id);

-- check: nothing left reads a retired table
DO $chk$
DECLARE v text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
    AND pg_get_functiondef(p.oid) ~ '\m(mm_facilities|mm_facility_process_types|mm_machines|mm_process_lots|mm_factory_features|mm_type_requirement_fields|mm_fabric_constructions|mm_defect_types|mm_process_vendors|mm_process_vendor_types)\M';
  IF v IS NOT NULL THEN RAISE EXCEPTION 'still referenced by: %', v; END IF;
END $chk$;
NOTIFY pgrst, 'reload schema';
