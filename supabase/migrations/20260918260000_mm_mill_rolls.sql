-- Mill-owned working rolls. Warehouse keeps mm_stock_units as the operational
-- table. Sync is once, at mill dispatch: INSERT a warehouse row, then mark the
-- mill roll dispatched. No backfill of historical mill-sourced stock units.

CREATE TABLE IF NOT EXISTS public.mm_mill_rolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  mill_batch_id uuid NOT NULL REFERENCES public.mm_mill_batches (id) ON DELETE RESTRICT,
  style_material_id uuid NOT NULL REFERENCES public.mm_style_materials (id) ON DELETE RESTRICT,
  unit_code text NOT NULL,
  length_m numeric,
  weight_kg numeric,
  shade text,
  lot_no text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  in_challan_id uuid REFERENCES public.mm_in_challans (id) ON DELETE SET NULL,
  dispatched_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_mill_rolls_status_chk CHECK (status = ANY (ARRAY['draft'::text, 'dispatched'::text]))
);

CREATE INDEX IF NOT EXISTS mm_mill_rolls_factory_batch_idx
  ON public.mm_mill_rolls (factory_id, mill_batch_id);
CREATE INDEX IF NOT EXISTS mm_mill_rolls_factory_status_idx
  ON public.mm_mill_rolls (factory_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS mm_mill_rolls_batch_code_uidx
  ON public.mm_mill_rolls (factory_id, mill_batch_id, lower(unit_code));

COMMENT ON TABLE public.mm_mill_rolls IS
  'Mill-owned working rolls. Warehouse must not query this table.';
COMMENT ON COLUMN public.mm_mill_rolls.in_challan_id IS
  'Mill record of which inbound challan this roll left on. Set at dispatch.';

SELECT public._mm_lockdown_table('public.mm_mill_rolls'::regclass);

ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS mill_roll_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mm_stock_units_mill_roll_fk'
  ) THEN
    ALTER TABLE public.mm_stock_units
      ADD CONSTRAINT mm_stock_units_mill_roll_fk
      FOREIGN KEY (mill_roll_id) REFERENCES public.mm_mill_rolls (id);
  END IF;
END;
$fk$;

CREATE UNIQUE INDEX IF NOT EXISTS mm_stock_units_mill_roll_uidx
  ON public.mm_stock_units (mill_roll_id)
  WHERE mill_roll_id IS NOT NULL;

COMMENT ON COLUMN public.mm_stock_units.mill_roll_id IS
  'Warehouse traceability back to mm_mill_rolls. Set once at mill dispatch. Null for vendor and for mill stock created before the mill-rolls split.';

