-- 4-point can be recorded at mill (batch), after process return, or on a
-- warehouse inbound challan. One result per roll per work unit. Process return
-- clears the previous result so the cloth can be inspected again.

ALTER TABLE public.mm_mill_rolls
  ADD COLUMN IF NOT EXISTS qc_result text;

ALTER TABLE public.mm_warehouse_inspections
  ALTER COLUMN in_challan_id DROP NOT NULL,
  ALTER COLUMN stock_unit_id DROP NOT NULL;

ALTER TABLE public.mm_warehouse_inspections
  ADD COLUMN IF NOT EXISTS site text,
  ADD COLUMN IF NOT EXISTS occasion text,
  ADD COLUMN IF NOT EXISTS scope_kind text,
  ADD COLUMN IF NOT EXISTS scope_id uuid,
  ADD COLUMN IF NOT EXISTS mill_batch_id uuid REFERENCES public.mm_mill_batches (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mill_roll_id uuid REFERENCES public.mm_mill_rolls (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS process_challan_id uuid REFERENCES public.mm_process_challans (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS inherited_from uuid REFERENCES public.mm_warehouse_inspections (id) ON DELETE SET NULL;

UPDATE public.mm_warehouse_inspections
SET
  site = COALESCE(site, 'warehouse'),
  occasion = COALESCE(occasion, 'inbound'),
  scope_kind = COALESCE(scope_kind, 'in_challan'),
  scope_id = COALESCE(scope_id, in_challan_id)
WHERE scope_kind IS NULL OR scope_id IS NULL OR site IS NULL OR occasion IS NULL;

ALTER TABLE public.mm_warehouse_inspections
  ALTER COLUMN site SET NOT NULL,
  ALTER COLUMN occasion SET NOT NULL,
  ALTER COLUMN scope_kind SET NOT NULL,
  ALTER COLUMN scope_id SET NOT NULL;

ALTER TABLE public.mm_mill_rolls DROP CONSTRAINT IF EXISTS mm_mill_rolls_qc_result_chk;
ALTER TABLE public.mm_mill_rolls
  ADD CONSTRAINT mm_mill_rolls_qc_result_chk
  CHECK (qc_result IS NULL OR qc_result = ANY (ARRAY['pass'::text, 'fail'::text]));

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_site_chk;
ALTER TABLE public.mm_warehouse_inspections
  ADD CONSTRAINT mm_warehouse_inspections_site_chk
  CHECK (site = ANY (ARRAY['mill'::text, 'warehouse'::text]));

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_occasion_chk;
ALTER TABLE public.mm_warehouse_inspections
  ADD CONSTRAINT mm_warehouse_inspections_occasion_chk
  CHECK (occasion = ANY (ARRAY['after_allocate'::text, 'after_process'::text, 'inbound'::text]));

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_scope_kind_chk;
ALTER TABLE public.mm_warehouse_inspections
  ADD CONSTRAINT mm_warehouse_inspections_scope_kind_chk
  CHECK (scope_kind = ANY (ARRAY['mill_batch'::text, 'in_challan'::text, 'process_challan'::text]));

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_scope_shape_chk;
ALTER TABLE public.mm_warehouse_inspections
  ADD CONSTRAINT mm_warehouse_inspections_scope_shape_chk
  CHECK (
    (scope_kind = 'mill_batch' AND mill_batch_id = scope_id AND mill_roll_id IS NOT NULL)
    OR (scope_kind = 'in_challan' AND in_challan_id = scope_id AND stock_unit_id IS NOT NULL)
    OR (scope_kind = 'process_challan' AND process_challan_id = scope_id
        AND (mill_roll_id IS NOT NULL OR stock_unit_id IS NOT NULL))
  );

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_unit_uidx;
DROP INDEX IF EXISTS public.mm_warehouse_inspections_unit_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS mm_insp_scope_mill_roll_uidx
  ON public.mm_warehouse_inspections (scope_kind, scope_id, mill_roll_id)
  WHERE mill_roll_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mm_insp_scope_stock_uidx
  ON public.mm_warehouse_inspections (scope_kind, scope_id, stock_unit_id)
  WHERE stock_unit_id IS NOT NULL;
;
