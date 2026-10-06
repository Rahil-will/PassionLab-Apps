-- Phase 2 / group 1: MM configuration tables.
-- D18 Option B: mm_locations.department_id nullable; no departments.role change.
-- D01: public schema, mm_ prefix. Zero production/shipment edits.

-- Shared lockdown helper for mm_* tables (SELECT own factory; no authenticated DML).
CREATE OR REPLACE FUNCTION public._mm_lockdown_table(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_name text := p_table::text;
  v_pol text;
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  v_pol := replace(split_part(v_name, '.', 2), '"', '') || '_select';
  IF v_pol = '_select' THEN
    v_pol := replace(v_name, '.', '_') || '_select';
  END IF;
  -- Prefer unqualified relation name for policy id
  v_pol := (SELECT c.relname FROM pg_class c WHERE c.oid = p_table::oid) || '_mm_select';

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', v_pol, p_table);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (factory_id = public.current_factory_id())',
    v_pol, p_table
  );

  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', p_table);
  EXECUTE format(
    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE %s FROM authenticated, anon',
    p_table
  );
  EXECUTE format('GRANT SELECT ON TABLE %s TO authenticated', p_table);
  EXECUTE format('GRANT ALL ON TABLE %s TO service_role', p_table);
END;
$fn$;
REVOKE ALL ON FUNCTION public._mm_lockdown_table(regclass) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_lockdown_table(regclass) TO service_role;
-- ---------------------------------------------------------------------------
-- mm_material_groups
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_material_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  unit_kind text NOT NULL,
  qc_default text NOT NULL DEFAULT 'required',
  allows_inhouse boolean NOT NULL DEFAULT false,
  feeds_cutting boolean NOT NULL DEFAULT false,
  default_uom text NOT NULL DEFAULT 'm',
  end_bit_threshold numeric,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_material_groups_unit_kind_chk CHECK (unit_kind = ANY (ARRAY['roll'::text, 'pack'::text])),
  CONSTRAINT mm_material_groups_qc_default_chk CHECK (
    qc_default = ANY (ARRAY['required'::text, 'optional'::text, 'none'::text])
  ),
  CONSTRAINT mm_material_groups_factory_code_uidx UNIQUE (factory_id, code)
);
CREATE INDEX mm_material_groups_factory_idx ON public.mm_material_groups (factory_id);
SELECT public._mm_lockdown_table('public.mm_material_groups'::regclass);
-- ---------------------------------------------------------------------------
-- mm_test_templates (before types that may reference them)
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_test_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.mm_material_groups (id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_test_templates_version_chk CHECK (version >= 1),
  CONSTRAINT mm_test_templates_factory_group_name_ver_uidx UNIQUE (factory_id, group_id, name, version)
);
CREATE INDEX mm_test_templates_factory_idx ON public.mm_test_templates (factory_id);
CREATE INDEX mm_test_templates_group_idx ON public.mm_test_templates (group_id);
SELECT public._mm_lockdown_table('public.mm_test_templates'::regclass);
-- ---------------------------------------------------------------------------
-- mm_material_types
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_material_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.mm_material_groups (id) ON DELETE CASCADE,
  name text NOT NULL,
  test_template_id uuid REFERENCES public.mm_test_templates (id) ON DELETE SET NULL,
  test_scope text NOT NULL DEFAULT 'per_unit',
  sample_pct numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_material_types_test_scope_chk CHECK (
    test_scope = ANY (ARRAY['per_unit'::text, 'per_lot_sample'::text])
  ),
  CONSTRAINT mm_material_types_factory_group_name_uidx UNIQUE (factory_id, group_id, name)
);
CREATE INDEX mm_material_types_factory_idx ON public.mm_material_types (factory_id);
CREATE INDEX mm_material_types_group_idx ON public.mm_material_types (group_id);
SELECT public._mm_lockdown_table('public.mm_material_types'::regclass);
-- ---------------------------------------------------------------------------
-- mm_attribute_defs
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_attribute_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.mm_material_groups (id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL,
  unit text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  applies_to text NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_attribute_defs_data_type_chk CHECK (
    data_type = ANY (ARRAY[
      'text'::text, 'number'::text, 'decimal'::text, 'percent'::text, 'boolean'::text,
      'date'::text, 'select'::text, 'multiselect'::text, 'rating'::text, 'measure'::text
    ])
  ),
  CONSTRAINT mm_attribute_defs_applies_to_chk CHECK (
    applies_to = ANY (ARRAY['material'::text, 'unit'::text, 'test'::text])
  ),
  CONSTRAINT mm_attribute_defs_factory_group_key_uidx UNIQUE (factory_id, group_id, key)
);
CREATE INDEX mm_attribute_defs_factory_idx ON public.mm_attribute_defs (factory_id);
SELECT public._mm_lockdown_table('public.mm_attribute_defs'::regclass);
-- ---------------------------------------------------------------------------
-- mm_test_template_fields
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_test_template_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.mm_test_templates (id) ON DELETE CASCADE,
  attribute_def_id uuid NOT NULL REFERENCES public.mm_attribute_defs (id) ON DELETE RESTRICT,
  seq integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT false,
  spec_min numeric,
  spec_max numeric,
  spec_target numeric,
  spec_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_test_template_fields_template_attr_uidx UNIQUE (template_id, attribute_def_id)
);
CREATE INDEX mm_test_template_fields_factory_idx ON public.mm_test_template_fields (factory_id);
SELECT public._mm_lockdown_table('public.mm_test_template_fields'::regclass);
-- ---------------------------------------------------------------------------
-- mm_sort_rules (Phase 10 unused; table only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_sort_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.mm_material_groups (id) ON DELETE CASCADE,
  material_type_id uuid REFERENCES public.mm_material_types (id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 100,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  outcome_status text NOT NULL,
  outcome_grade text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_sort_rules_outcome_status_chk CHECK (
    outcome_status = ANY (ARRAY['accepted'::text, 'rejected'::text, 'on_hold'::text])
  )
);
CREATE INDEX mm_sort_rules_factory_idx ON public.mm_sort_rules (factory_id);
CREATE INDEX mm_sort_rules_group_priority_idx ON public.mm_sort_rules (group_id, priority);
SELECT public._mm_lockdown_table('public.mm_sort_rules'::regclass);
COMMENT ON TABLE public.mm_sort_rules IS
  'Sort rules engine — table created in Phase 2; evaluator lands in Phase 10.';
-- ---------------------------------------------------------------------------
-- mm_suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  supplies text NOT NULL DEFAULT 'both',
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_id text,
  linked_resource_id uuid REFERENCES public.assigned_resources (id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_suppliers_supplies_chk CHECK (
    supplies = ANY (ARRAY['fabric'::text, 'trims'::text, 'both'::text])
  ),
  CONSTRAINT mm_suppliers_factory_code_uidx UNIQUE (factory_id, code)
);
CREATE INDEX mm_suppliers_factory_idx ON public.mm_suppliers (factory_id);
SELECT public._mm_lockdown_table('public.mm_suppliers'::regclass);
-- ---------------------------------------------------------------------------
-- mm_locations (self parent_id; nullable department_id — D18 Option B)
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_locations (
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
CREATE INDEX mm_locations_factory_idx ON public.mm_locations (factory_id);
CREATE INDEX mm_locations_parent_idx ON public.mm_locations (parent_id);
SELECT public._mm_lockdown_table('public.mm_locations'::regclass);
COMMENT ON COLUMN public.mm_locations.department_id IS
  'Optional department binding (D18 Option B). Nullable; no new departments.role value.';
-- ---------------------------------------------------------------------------
-- mm_reason_codes
-- ---------------------------------------------------------------------------
CREATE TABLE public.mm_reason_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  category text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_reason_codes_category_chk CHECK (
    category = ANY (ARRAY[
      'adjust'::text, 'reject'::text, 'hold'::text, 'waste'::text, 'return'::text,
      'override'::text, 'variance'::text, 'writeoff'::text, 'correction'::text
    ])
  ),
  CONSTRAINT mm_reason_codes_factory_cat_code_uidx UNIQUE (factory_id, category, code)
);
CREATE INDEX mm_reason_codes_factory_idx ON public.mm_reason_codes (factory_id);
SELECT public._mm_lockdown_table('public.mm_reason_codes'::regclass);
