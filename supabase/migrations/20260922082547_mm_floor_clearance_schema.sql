ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS declared_width_in numeric,
  ADD COLUMN IF NOT EXISTS is_remnant boolean NOT NULL DEFAULT false;

ALTER TABLE public.mm_in_challans
  ADD COLUMN IF NOT EXISTS invoice_ref text,
  ADD COLUMN IF NOT EXISTS grn_no text;

CREATE UNIQUE INDEX IF NOT EXISTS mm_in_challans_factory_grn_no_uidx
  ON public.mm_in_challans (factory_id, grn_no)
  WHERE grn_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.mm_doc_sequences (
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  next_no integer NOT NULL DEFAULT 0,
  PRIMARY KEY (factory_id, doc_type),
  CONSTRAINT mm_doc_sequences_next_chk CHECK (next_no >= 0)
);

ALTER TABLE public.mm_doc_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_doc_sequences_factory ON public.mm_doc_sequences;
CREATE POLICY mm_doc_sequences_factory ON public.mm_doc_sequences
  FOR ALL TO authenticated
  USING (factory_id = public.current_factory_id())
  WITH CHECK (factory_id = public.current_factory_id());

CREATE TABLE IF NOT EXISTS public.mm_lay_unit_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  cutting_lay_id uuid NOT NULL REFERENCES public.cutting_lays (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  movement_line_id uuid,
  seq integer NOT NULL DEFAULT 1,
  plies integer,
  opening_qty numeric NOT NULL,
  closing_qty numeric NOT NULL,
  consumed_qty numeric GENERATED ALWAYS AS (opening_qty - closing_qty) STORED,
  used_qty numeric,
  shortage_qty numeric,
  end_bit_action text NOT NULL DEFAULT 'none',
  recorded_by uuid REFERENCES public.profiles (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_lay_unit_consumptions_end_bit_chk CHECK (
    end_bit_action = ANY (ARRAY['none', 'waste', 'return', 'continue'])
  ),
  CONSTRAINT mm_lay_unit_consumptions_lay_unit_uidx UNIQUE (cutting_lay_id, stock_unit_id),
  CONSTRAINT mm_lay_unit_consumptions_row_version_chk CHECK (row_version >= 1),
  CONSTRAINT mm_lay_unit_consumptions_closing_chk CHECK (closing_qty <= opening_qty)
);

ALTER TABLE public.mm_lay_unit_consumptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_lay_unit_consumptions_factory ON public.mm_lay_unit_consumptions;
CREATE POLICY mm_lay_unit_consumptions_factory ON public.mm_lay_unit_consumptions
  FOR ALL TO authenticated
  USING (factory_id = public.current_factory_id())
  WITH CHECK (factory_id = public.current_factory_id());;
