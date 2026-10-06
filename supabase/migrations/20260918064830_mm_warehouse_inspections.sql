CREATE TABLE IF NOT EXISTS public.mm_warehouse_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  in_challan_id uuid NOT NULL REFERENCES public.mm_in_challans (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  result text NOT NULL,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  remarks text,
  inspected_at timestamptz NOT NULL DEFAULT now(),
  inspected_by uuid REFERENCES public.profiles (id),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_warehouse_inspections_result_chk CHECK (result = ANY (ARRAY['pass'::text, 'fail'::text])),
  CONSTRAINT mm_warehouse_inspections_row_version_chk CHECK (row_version >= 1),
  CONSTRAINT mm_warehouse_inspections_unit_uidx UNIQUE (stock_unit_id)
);
CREATE INDEX IF NOT EXISTS mm_warehouse_inspections_factory_idx ON public.mm_warehouse_inspections (factory_id);
CREATE INDEX IF NOT EXISTS mm_warehouse_inspections_challan_idx ON public.mm_warehouse_inspections (in_challan_id);
SELECT public._mm_lockdown_table('public.mm_warehouse_inspections'::regclass);
;
