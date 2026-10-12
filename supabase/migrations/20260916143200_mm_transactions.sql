-- Phase 2 / group 3: MM transactions.
-- mm_stock_ledger is append-only: no UPDATE/DELETE grants to authenticated/anon/service_role.

-- ---------------------------------------------------------------------------
-- mm_receipts
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  receipt_no text NOT NULL,
  group_id uuid NOT NULL REFERENCES public.mm_material_groups (id) ON DELETE RESTRICT,
  source text NOT NULL,
  supplier_id uuid REFERENCES public.mm_suppliers (id) ON DELETE SET NULL,
  mill_name text,
  challan_no text,
  invoice_no text,
  po_ref text,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid REFERENCES public.profiles (id),
  declared_units integer,
  declared_qty numeric,
  declared_uom text,
  default_location_id uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received',
  variance_reason_code text,
  variance_note text,
  channel text NOT NULL DEFAULT 'web',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  remarks text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_receipts_source_chk CHECK (source = ANY (ARRAY['external'::text, 'in_house'::text])),
  CONSTRAINT mm_receipts_status_chk CHECK (
    status = ANY (ARRAY[
      'received'::text, 'entry_in_progress'::text, 'entered'::text,
      'qc_in_progress'::text, 'closed'::text, 'cancelled'::text
    ])
  ),
  CONSTRAINT mm_receipts_channel_chk CHECK (
    channel = ANY (ARRAY['floor'::text, 'web'::text, 'web_fallback'::text])
  ),
  CONSTRAINT mm_receipts_factory_receipt_no_uidx UNIQUE (factory_id, receipt_no),
  CONSTRAINT mm_receipts_row_version_chk CHECK (row_version >= 1)
);
CREATE INDEX mm_receipts_factory_status_idx ON public.mm_receipts (factory_id, status);
SELECT public._mm_lockdown_table('public.mm_receipts'::regclass);
-- ---------------------------------------------------------------------------
-- mm_lots
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.mm_materials (id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL REFERENCES public.mm_receipts (id) ON DELETE CASCADE,
  lot_no text NOT NULL,
  shade_group text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_lots_factory_material_receipt_lot_uidx UNIQUE (factory_id, material_id, receipt_id, lot_no)
);
CREATE INDEX mm_lots_factory_idx ON public.mm_lots (factory_id);
CREATE INDEX mm_lots_receipt_idx ON public.mm_lots (receipt_id);
SELECT public._mm_lockdown_table('public.mm_lots'::regclass);
-- ---------------------------------------------------------------------------
-- mm_stock_units
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_stock_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  unit_code text NOT NULL,
  unit_kind text NOT NULL,
  material_id uuid NOT NULL REFERENCES public.mm_materials (id) ON DELETE RESTRICT,
  lot_id uuid REFERENCES public.mm_lots (id) ON DELETE SET NULL,
  receipt_id uuid REFERENCES public.mm_receipts (id) ON DELETE SET NULL,
  supplier_unit_no text,
  source text NOT NULL,
  uom text NOT NULL,
  received_qty numeric NOT NULL DEFAULT 0,
  current_qty numeric NOT NULL DEFAULT 0,
  length_m numeric,
  weight_kg numeric,
  width_cm numeric,
  gsm numeric,
  shade_group text,
  grade text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  current_location_id uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  qc_required boolean NOT NULL DEFAULT true,
  hold_reason_code text,
  issued_order_id uuid REFERENCES public.style_orders (id) ON DELETE SET NULL,
  issued_colorway_id uuid REFERENCES public.colorways (id) ON DELETE SET NULL,
  issued_component_id uuid REFERENCES public.fabric_components (id) ON DELETE SET NULL,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_stock_units_unit_kind_chk CHECK (unit_kind = ANY (ARRAY['roll'::text, 'pack'::text])),
  CONSTRAINT mm_stock_units_source_chk CHECK (source = ANY (ARRAY['external'::text, 'in_house'::text])),
  CONSTRAINT mm_stock_units_status_chk CHECK (
    status = ANY (ARRAY[
      'draft'::text, 'pending_qc'::text, 'accepted'::text, 'rejected'::text, 'on_hold'::text,
      'in_stock'::text, 'issued_pending'::text, 'issued'::text, 'partially_consumed'::text,
      'consumed'::text, 'returned_to_supplier'::text, 'written_off'::text, 'cancelled'::text
    ])
  ),
  CONSTRAINT mm_stock_units_factory_unit_code_uidx UNIQUE (factory_id, unit_code),
  CONSTRAINT mm_stock_units_row_version_chk CHECK (row_version >= 1)
);
CREATE INDEX mm_stock_units_factory_status_idx ON public.mm_stock_units (factory_id, status);
CREATE INDEX mm_stock_units_factory_material_status_idx
  ON public.mm_stock_units (factory_id, material_id, status);
CREATE INDEX mm_stock_units_lot_idx ON public.mm_stock_units (lot_id);
SELECT public._mm_lockdown_table('public.mm_stock_units'::regclass);
-- ---------------------------------------------------------------------------
-- mm_qc_inspections
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_qc_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.mm_receipts (id) ON DELETE CASCADE,
  lot_id uuid REFERENCES public.mm_lots (id) ON DELETE SET NULL,
  stock_unit_id uuid REFERENCES public.mm_stock_units (id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES public.mm_test_templates (id) ON DELETE RESTRICT,
  template_version integer NOT NULL,
  template_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_result text NOT NULL,
  inspected_at timestamptz NOT NULL DEFAULT now(),
  inspected_by uuid REFERENCES public.profiles (id),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_qc_inspections_overall_chk CHECK (
    overall_result = ANY (ARRAY['pass'::text, 'fail'::text, 'review'::text])
  ),
  CONSTRAINT mm_qc_inspections_target_chk CHECK (
    (lot_id IS NOT NULL AND stock_unit_id IS NULL)
    OR (lot_id IS NULL AND stock_unit_id IS NOT NULL)
    OR (lot_id IS NOT NULL AND stock_unit_id IS NOT NULL)
  )
);
CREATE INDEX mm_qc_inspections_factory_idx ON public.mm_qc_inspections (factory_id);
CREATE INDEX mm_qc_inspections_receipt_idx ON public.mm_qc_inspections (receipt_id);
SELECT public._mm_lockdown_table('public.mm_qc_inspections'::regclass);
-- ---------------------------------------------------------------------------
-- mm_sort_decisions
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_sort_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE CASCADE,
  inspection_id uuid REFERENCES public.mm_qc_inspections (id) ON DELETE SET NULL,
  suggested_status text,
  suggested_grade text,
  suggested_by_rule_id uuid REFERENCES public.mm_sort_rules (id) ON DELETE SET NULL,
  final_status text NOT NULL,
  final_grade text,
  shade_group text,
  qc_deduct_qty numeric NOT NULL DEFAULT 0,
  is_override boolean NOT NULL DEFAULT false,
  override_reason_code text,
  decided_by uuid REFERENCES public.profiles (id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_sort_decisions_final_status_chk CHECK (
    final_status = ANY (ARRAY['accepted'::text, 'rejected'::text, 'on_hold'::text])
  )
);
CREATE INDEX mm_sort_decisions_factory_idx ON public.mm_sort_decisions (factory_id);
CREATE INDEX mm_sort_decisions_unit_decided_idx
  ON public.mm_sort_decisions (stock_unit_id, decided_at DESC);
SELECT public._mm_lockdown_table('public.mm_sort_decisions'::regclass);
-- ---------------------------------------------------------------------------
-- mm_movements
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  movement_no text NOT NULL,
  movement_type text NOT NULL,
  from_location_id uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  to_location_id uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.style_orders (id) ON DELETE SET NULL,
  colorway_id uuid REFERENCES public.colorways (id) ON DELETE SET NULL,
  fabric_component_id uuid REFERENCES public.fabric_components (id) ON DELETE SET NULL,
  cutting_session_id uuid REFERENCES public.cutting_sessions (id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.profiles (id),
  acknowledged_by uuid REFERENCES public.profiles (id),
  acknowledged_at timestamptz,
  channel text NOT NULL DEFAULT 'floor',
  remarks text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_movements_type_chk CHECK (
    movement_type = ANY (ARRAY[
      'putaway'::text, 'transfer'::text, 'issue_to_cutting'::text, 'return_from_cutting'::text,
      'issue_to_dept'::text, 'return_from_dept'::text, 'to_rejected'::text, 'return_to_supplier'::text
    ])
  ),
  CONSTRAINT mm_movements_status_chk CHECK (
    status = ANY (ARRAY[
      'pending'::text, 'disputed'::text, 'completed'::text, 'cancelled'::text, 'reversed'::text
    ])
  ),
  CONSTRAINT mm_movements_channel_chk CHECK (
    channel = ANY (ARRAY['floor'::text, 'web'::text, 'web_fallback'::text])
  ),
  CONSTRAINT mm_movements_factory_movement_no_uidx UNIQUE (factory_id, movement_no),
  CONSTRAINT mm_movements_row_version_chk CHECK (row_version >= 1)
);
CREATE INDEX mm_movements_factory_status_idx ON public.mm_movements (factory_id, status);
SELECT public._mm_lockdown_table('public.mm_movements'::regclass);
-- ---------------------------------------------------------------------------
-- mm_movement_lines
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_movement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  movement_id uuid NOT NULL REFERENCES public.mm_movements (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  qty numeric NOT NULL,
  received_qty numeric,
  line_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_movement_lines_status_chk CHECK (
    line_status = ANY (ARRAY[
      'pending'::text, 'received'::text, 'short'::text, 'missing'::text, 'cancelled'::text
    ])
  ),
  CONSTRAINT mm_movement_lines_movement_unit_uidx UNIQUE (movement_id, stock_unit_id)
);
CREATE INDEX mm_movement_lines_factory_idx ON public.mm_movement_lines (factory_id);
CREATE INDEX mm_movement_lines_unit_idx ON public.mm_movement_lines (stock_unit_id);
SELECT public._mm_lockdown_table('public.mm_movement_lines'::regclass);
-- ---------------------------------------------------------------------------
-- mm_stock_ledger (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  entry_type text NOT NULL,
  qty_delta numeric NOT NULL DEFAULT 0,
  balance_after numeric NOT NULL,
  status_before text,
  status_after text,
  location_before uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  location_after uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  ref_table text,
  ref_id uuid,
  reason_code text,
  note text,
  reversal_of uuid REFERENCES public.mm_stock_ledger (id) ON DELETE SET NULL,
  channel text,
  actor_id uuid REFERENCES public.profiles (id),
  txn_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  -- updated_* present for convention; rows must never be updated
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_stock_ledger_entry_type_chk CHECK (
    entry_type = ANY (ARRAY[
      'RECEIPT_IN'::text, 'INHOUSE_IN'::text, 'QC_DEDUCT'::text, 'QC_REJECT'::text,
      'PUTAWAY'::text, 'TRANSFER'::text, 'HOLD'::text, 'RELEASE'::text,
      'ISSUE_TO_CUTTING'::text, 'ISSUE_TO_DEPT'::text, 'CONSUME'::text, 'WASTE'::text,
      'RETURN_FROM_CUTTING'::text, 'RETURN_FROM_DEPT'::text,
      'ADJUST_PLUS'::text, 'ADJUST_MINUS'::text,
      'RETURN_TO_SUPPLIER'::text, 'WRITE_OFF'::text, 'REVERSAL'::text
    ])
  )
);
CREATE INDEX mm_stock_ledger_factory_idx ON public.mm_stock_ledger (factory_id);
CREATE INDEX mm_stock_ledger_unit_txn_idx ON public.mm_stock_ledger (stock_unit_id, txn_at);
ALTER TABLE public.mm_stock_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_stock_ledger_mm_select ON public.mm_stock_ledger;
CREATE POLICY mm_stock_ledger_mm_select ON public.mm_stock_ledger
  FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());
-- Append-only: SELECT for authenticated; INSERT reserved for future SECURITY DEFINER RPCs
-- (service_role only for now). No UPDATE/DELETE grants to any client role.
REVOKE ALL ON TABLE public.mm_stock_ledger FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.mm_stock_ledger FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.mm_stock_ledger FROM service_role;
GRANT SELECT ON TABLE public.mm_stock_ledger TO authenticated;
GRANT SELECT, INSERT ON TABLE public.mm_stock_ledger TO service_role;
COMMENT ON TABLE public.mm_stock_ledger IS
  'Append-only stock ledger. Corrections are new REVERSAL rows. No UPDATE/DELETE grants.';
