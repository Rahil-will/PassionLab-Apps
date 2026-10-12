CREATE TABLE IF NOT EXISTS public.mm_stock_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  unit_code text NOT NULL,
  unit_kind text NOT NULL DEFAULT 'roll',
  style_material_id uuid NOT NULL REFERENCES public.mm_style_materials (id) ON DELETE RESTRICT,
  in_challan_id uuid REFERENCES public.mm_in_challans (id) ON DELETE SET NULL,
  store_challan_id uuid REFERENCES public.mm_store_challans (id) ON DELETE SET NULL,
  source text NOT NULL,
  uom text NOT NULL DEFAULT 'm',
  length_m numeric,
  weight_kg numeric,
  shade text,
  lot_no text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  mill_snapshot jsonb,
  qc_result text,
  status text NOT NULL,
  current_location_id uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_stock_units_kind_chk CHECK (unit_kind = ANY (ARRAY['roll'::text, 'pack'::text])),
  CONSTRAINT mm_stock_units_source_chk CHECK (source = ANY (ARRAY['mill'::text, 'vendor'::text])),
  CONSTRAINT mm_stock_units_status_chk CHECK (
    status = ANY (ARRAY['draft'::text, 'in_transit'::text, 'pending_qc'::text, 'in_stock'::text, 'rejected'::text])
  ),
  CONSTRAINT mm_stock_units_qc_chk CHECK (qc_result IS NULL OR qc_result = ANY (ARRAY['pass'::text, 'fail'::text])),
  CONSTRAINT mm_stock_units_factory_code_uidx UNIQUE (factory_id, unit_code)
);
CREATE INDEX IF NOT EXISTS mm_stock_units_factory_status_idx ON public.mm_stock_units (factory_id, status);
CREATE INDEX IF NOT EXISTS mm_stock_units_style_idx ON public.mm_stock_units (style_material_id, status);
SELECT public._mm_lockdown_table('public.mm_stock_units'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_in_challan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  challan_id uuid NOT NULL REFERENCES public.mm_in_challans (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_in_challan_lines_unit_uidx UNIQUE (challan_id, stock_unit_id)
);
CREATE INDEX IF NOT EXISTS mm_in_challan_lines_challan_idx ON public.mm_in_challan_lines (challan_id);
SELECT public._mm_lockdown_table('public.mm_in_challan_lines'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_store_challan_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  challan_id uuid NOT NULL REFERENCES public.mm_store_challans (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_store_challan_lines_unit_uidx UNIQUE (challan_id, stock_unit_id)
);
CREATE INDEX IF NOT EXISTS mm_store_challan_lines_challan_idx ON public.mm_store_challan_lines (challan_id);
SELECT public._mm_lockdown_table('public.mm_store_challan_lines'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  entry_type text NOT NULL,
  qty_delta numeric NOT NULL DEFAULT 0,
  balance_after numeric NOT NULL DEFAULT 0,
  status_before text,
  status_after text,
  location_before uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  location_after uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  ref_table text,
  ref_id uuid,
  note text,
  actor_id uuid REFERENCES public.profiles (id),
  txn_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id)
);
CREATE INDEX IF NOT EXISTS mm_stock_ledger_unit_idx ON public.mm_stock_ledger (stock_unit_id, txn_at);
ALTER TABLE public.mm_stock_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_stock_ledger_mm_select ON public.mm_stock_ledger;
CREATE POLICY mm_stock_ledger_mm_select ON public.mm_stock_ledger
  FOR SELECT TO authenticated USING (factory_id = public.current_factory_id());
REVOKE ALL ON TABLE public.mm_stock_ledger FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.mm_stock_ledger FROM authenticated, anon;
GRANT SELECT ON TABLE public.mm_stock_ledger TO authenticated;
GRANT SELECT, INSERT ON TABLE public.mm_stock_ledger TO service_role;
;
