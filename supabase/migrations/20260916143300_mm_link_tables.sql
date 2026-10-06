-- Phase 2 / group 4: MM ↔ Production link tables (MM-owned).
-- Zero edits to production tables. Join cutting lot_no / lay fields in Phase 7 views.

CREATE TABLE public.mm_component_material_map (
  fabric_component_id uuid PRIMARY KEY REFERENCES public.fabric_components (id) ON DELETE CASCADE,
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.mm_materials (id) ON DELETE RESTRICT,
  consumption_per_pc numeric,
  consumption_uom text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id)
);
CREATE INDEX mm_component_material_map_factory_idx ON public.mm_component_material_map (factory_id);
CREATE INDEX mm_component_material_map_material_idx ON public.mm_component_material_map (material_id);
SELECT public._mm_lockdown_table('public.mm_component_material_map'::regclass);
CREATE TABLE public.mm_cutting_lot_map (
  cutting_session_lot_id uuid PRIMARY KEY REFERENCES public.cutting_session_lots (id) ON DELETE CASCADE,
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  mm_lot_id uuid NOT NULL REFERENCES public.mm_lots (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id)
);
CREATE INDEX mm_cutting_lot_map_factory_idx ON public.mm_cutting_lot_map (factory_id);
CREATE INDEX mm_cutting_lot_map_mm_lot_idx ON public.mm_cutting_lot_map (mm_lot_id);
SELECT public._mm_lockdown_table('public.mm_cutting_lot_map'::regclass);
COMMENT ON TABLE public.mm_cutting_lot_map IS
  'Links cutting_session_lots to mm_lots. cutting_session_lots.lot_no remains the production source of truth.';
CREATE TABLE public.mm_lay_unit_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  cutting_lay_id uuid NOT NULL REFERENCES public.cutting_lays (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  movement_line_id uuid REFERENCES public.mm_movement_lines (id) ON DELETE SET NULL,
  seq integer NOT NULL DEFAULT 1,
  plies integer,
  opening_qty numeric NOT NULL,
  closing_qty numeric NOT NULL,
  consumed_qty numeric GENERATED ALWAYS AS (opening_qty - closing_qty) STORED,
  end_bit_action text NOT NULL DEFAULT 'none',
  recorded_by uuid REFERENCES public.profiles (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_lay_unit_consumptions_end_bit_chk CHECK (
    end_bit_action = ANY (ARRAY['none'::text, 'waste'::text, 'return'::text])
  ),
  CONSTRAINT mm_lay_unit_consumptions_lay_unit_uidx UNIQUE (cutting_lay_id, stock_unit_id),
  CONSTRAINT mm_lay_unit_consumptions_row_version_chk CHECK (row_version >= 1),
  CONSTRAINT mm_lay_unit_consumptions_closing_chk CHECK (closing_qty <= opening_qty)
);
CREATE INDEX mm_lay_unit_consumptions_factory_idx ON public.mm_lay_unit_consumptions (factory_id);
CREATE INDEX mm_lay_unit_consumptions_unit_idx ON public.mm_lay_unit_consumptions (stock_unit_id);
SELECT public._mm_lockdown_table('public.mm_lay_unit_consumptions'::regclass);
COMMENT ON TABLE public.mm_lay_unit_consumptions IS
  'Roll consumption on a cutting lay. Join cutting_lays for marker_length/plies/fabric_shade — do not duplicate.';
