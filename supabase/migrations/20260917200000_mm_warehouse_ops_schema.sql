-- Fabric mill / warehouse ops: inbound challans (mill + vendor) and store challans.
-- Live DB has lean config only (no Phase 2 stock tables). Create if missing; alter if present.

ALTER TABLE public.doc_sequences DROP CONSTRAINT IF EXISTS doc_sequences_type_check;
ALTER TABLE public.doc_sequences
  ADD CONSTRAINT doc_sequences_type_check CHECK (
    doc_type = ANY (ARRAY['GRN'::text, 'MV'::text, 'ROLL'::text, 'PACK'::text, 'MILL'::text, 'SC'::text])
  );

CREATE OR REPLACE FUNCTION public.next_doc_no(p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_year integer;
  v_yy text;
  v_next integer;
BEGIN
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RAISE EXCEPTION 'NO_FACTORY'; END IF;
  IF p_type IS NULL OR p_type NOT IN ('GRN', 'MV', 'ROLL', 'PACK', 'MILL', 'SC') THEN
    RAISE EXCEPTION 'INVALID_DOC_TYPE';
  END IF;
  v_year := EXTRACT(YEAR FROM now())::integer;
  v_yy := to_char(now(), 'YY');
  INSERT INTO public.doc_sequences AS ds (factory_id, doc_type, year, last_no)
  VALUES (v_factory, p_type, v_year, 1)
  ON CONFLICT (factory_id, doc_type, year)
  DO UPDATE SET last_no = ds.last_no + 1
  RETURNING ds.last_no INTO v_next;
  RETURN p_type || '-' || v_yy || '-' || lpad(v_next::text, 6, '0');
END;
$function$;

ALTER TABLE public.mm_factory_features DROP CONSTRAINT IF EXISTS mm_factory_features_key_chk;
ALTER TABLE public.mm_factory_features
  ADD CONSTRAINT mm_factory_features_key_chk CHECK (
    feature_key = ANY (ARRAY['receive_goods'::text, 'test_rolls'::text, 'in_house_mill'::text])
  );

INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
SELECT f.id, 'in_house_mill', true
FROM public.factories f
ON CONFLICT (factory_id, feature_key) DO NOTHING;

UPDATE public.mm_factory_features SET enabled = false
WHERE feature_key IN ('receive_goods', 'test_rolls');

CREATE OR REPLACE FUNCTION public.mm_seed_factory_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (NEW.id, 'receive_goods', false),
    (NEW.id, 'test_rolls', false),
    (NEW.id, 'in_house_mill', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$fn$;

CREATE TABLE IF NOT EXISTS public.mm_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  location_type text NOT NULL,
  department_id uuid REFERENCES public.departments (id) ON DELETE SET NULL,
  is_pickable boolean NOT NULL DEFAULT false,
  capacity_note text,
  is_active boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_locations_type_chk CHECK (
    location_type = ANY (ARRAY[
      'store'::text, 'zone'::text, 'rack'::text, 'bin'::text, 'receiving'::text,
      'qc'::text, 'rejected'::text, 'cutting'::text, 'department'::text, 'virtual'::text
    ])
  ),
  CONSTRAINT mm_locations_factory_code_uidx UNIQUE (factory_id, code)
);
CREATE INDEX IF NOT EXISTS mm_locations_factory_idx ON public.mm_locations (factory_id);
SELECT public._mm_lockdown_table('public.mm_locations'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_style_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.style_orders (id) ON DELETE CASCADE,
  colorway_id uuid NOT NULL REFERENCES public.colorways (id) ON DELETE CASCADE,
  colorway_material_id uuid,
  fabric_type_id uuid NOT NULL REFERENCES public.mm_fabric_types (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_style_materials_line_uidx UNIQUE (factory_id, order_id, colorway_id, fabric_type_id)
);
CREATE INDEX IF NOT EXISTS mm_style_materials_factory_idx ON public.mm_style_materials (factory_id);
CREATE INDEX IF NOT EXISTS mm_style_materials_order_idx ON public.mm_style_materials (order_id);
SELECT public._mm_lockdown_table('public.mm_style_materials'::regclass);

DO $fk$
BEGIN
  IF to_regclass('public.colorway_materials') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'mm_style_materials_bom_fk'
     ) THEN
    ALTER TABLE public.mm_style_materials
      ADD CONSTRAINT mm_style_materials_bom_fk
      FOREIGN KEY (colorway_material_id) REFERENCES public.colorway_materials (id) ON DELETE CASCADE;
  END IF;
END;
$fk$;

CREATE TABLE IF NOT EXISTS public.mm_in_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  challan_no text NOT NULL,
  source text NOT NULL,
  style_material_id uuid NOT NULL REFERENCES public.mm_style_materials (id) ON DELETE RESTRICT,
  supplier_name text,
  status text NOT NULL,
  sent_at timestamptz,
  received_at timestamptz,
  sent_by uuid REFERENCES public.profiles (id),
  received_by uuid REFERENCES public.profiles (id),
  remarks text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_in_challans_source_chk CHECK (source = ANY (ARRAY['mill'::text, 'vendor'::text])),
  CONSTRAINT mm_in_challans_status_chk CHECK (status = ANY (ARRAY['pending'::text, 'received'::text])),
  CONSTRAINT mm_in_challans_factory_no_uidx UNIQUE (factory_id, challan_no)
);
CREATE INDEX IF NOT EXISTS mm_in_challans_factory_src_idx
  ON public.mm_in_challans (factory_id, source, status);
SELECT public._mm_lockdown_table('public.mm_in_challans'::regclass);

CREATE TABLE IF NOT EXISTS public.mm_store_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  challan_no text NOT NULL,
  style_material_id uuid NOT NULL REFERENCES public.mm_style_materials (id) ON DELETE RESTRICT,
  from_location_id uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  to_location_id uuid REFERENCES public.mm_locations (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_by uuid REFERENCES public.profiles (id),
  received_at timestamptz,
  received_by uuid REFERENCES public.profiles (id),
  remarks text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_store_challans_status_chk CHECK (status = ANY (ARRAY['pending'::text, 'received'::text])),
  CONSTRAINT mm_store_challans_factory_no_uidx UNIQUE (factory_id, challan_no)
);
CREATE INDEX IF NOT EXISTS mm_store_challans_factory_idx
  ON public.mm_store_challans (factory_id, status);
SELECT public._mm_lockdown_table('public.mm_store_challans'::regclass);

DO $units$
BEGIN
  IF to_regclass('public.mm_stock_units') IS NULL THEN
    CREATE TABLE public.mm_stock_units (
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
    CREATE INDEX mm_stock_units_factory_status_idx ON public.mm_stock_units (factory_id, status);
    CREATE INDEX mm_stock_units_style_idx ON public.mm_stock_units (style_material_id, status);
    PERFORM public._mm_lockdown_table('public.mm_stock_units'::regclass);
  ELSE
    ALTER TABLE public.mm_stock_units ADD COLUMN IF NOT EXISTS style_material_id uuid;
    ALTER TABLE public.mm_stock_units ADD COLUMN IF NOT EXISTS in_challan_id uuid;
    ALTER TABLE public.mm_stock_units ADD COLUMN IF NOT EXISTS store_challan_id uuid;
    ALTER TABLE public.mm_stock_units ADD COLUMN IF NOT EXISTS mill_snapshot jsonb;
    ALTER TABLE public.mm_stock_units ADD COLUMN IF NOT EXISTS lot_no text;
    ALTER TABLE public.mm_stock_units ADD COLUMN IF NOT EXISTS qc_result text;
    ALTER TABLE public.mm_stock_units ALTER COLUMN material_id DROP NOT NULL;
    ALTER TABLE public.mm_stock_units DROP CONSTRAINT IF EXISTS mm_stock_units_source_chk;
    ALTER TABLE public.mm_stock_units
      ADD CONSTRAINT mm_stock_units_source_chk CHECK (
        source = ANY (ARRAY['mill'::text, 'vendor'::text, 'in_house'::text, 'external'::text])
      );
    ALTER TABLE public.mm_stock_units DROP CONSTRAINT IF EXISTS mm_stock_units_status_chk;
    ALTER TABLE public.mm_stock_units
      ADD CONSTRAINT mm_stock_units_status_chk CHECK (
        status = ANY (ARRAY[
          'draft'::text, 'in_transit'::text, 'pending_qc'::text, 'accepted'::text, 'rejected'::text, 'on_hold'::text,
          'in_stock'::text, 'issued_pending'::text, 'issued'::text, 'partially_consumed'::text,
          'consumed'::text, 'returned_to_supplier'::text, 'written_off'::text, 'cancelled'::text
        ])
      );
  END IF;
END;
$units$;

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

CREATE OR REPLACE FUNCTION public._mm_seed_ops_locations(p_factory uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_cut uuid;
BEGIN
  BEGIN
    v_cut := public.get_cutting_department_id(p_factory);
  EXCEPTION WHEN OTHERS THEN
    v_cut := NULL;
  END;

  INSERT INTO public.mm_locations AS loc (
    factory_id, code, name, location_type, department_id, is_pickable, is_active, created_by, updated_by
  ) VALUES
    (p_factory, 'MILL', 'Mill', 'virtual', NULL, false, true, p_actor, p_actor),
    (p_factory, 'WAREHOUSE', 'Fabric warehouse', 'store', NULL, true, true, p_actor, p_actor),
    (p_factory, 'CUTTING_STORE', 'Cutting store', 'cutting', v_cut, true, true, p_actor, p_actor)
  ON CONFLICT (factory_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    location_type = EXCLUDED.location_type,
    is_active = true,
    updated_at = now(),
    updated_by = p_actor;
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_seed_ops_locations(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_seed_ops_locations(uuid, uuid) TO service_role;

INSERT INTO public.mm_locations (factory_id, code, name, location_type, is_pickable, is_active)
SELECT f.id, loc.code, loc.name, loc.location_type, loc.pickable, true
FROM public.factories f
CROSS JOIN (
  VALUES
    ('MILL', 'Mill', 'virtual', false),
    ('WAREHOUSE', 'Fabric warehouse', 'store', true),
    ('CUTTING_STORE', 'Cutting store', 'cutting', true)
) AS loc(code, name, location_type, pickable)
ON CONFLICT (factory_id, code) DO NOTHING;
