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
CREATE INDEX IF NOT EXISTS mm_in_challans_factory_src_idx ON public.mm_in_challans (factory_id, source, status);
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
CREATE INDEX IF NOT EXISTS mm_store_challans_factory_idx ON public.mm_store_challans (factory_id, status);
SELECT public._mm_lockdown_table('public.mm_store_challans'::regclass);
;
