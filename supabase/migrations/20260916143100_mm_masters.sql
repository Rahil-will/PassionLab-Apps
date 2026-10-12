-- Phase 2 / group 2: MM material master.
-- stock_uom lock once units exist is enforced in Phase 3 RPCs (not a DB trigger).

CREATE TABLE public.mm_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.mm_material_groups (id) ON DELETE RESTRICT,
  type_id uuid REFERENCES public.mm_material_types (id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  color text,
  composition text,
  gsm_nominal numeric,
  width_nominal_cm numeric,
  stock_uom text NOT NULL,
  secondary_uom text,
  buyer_id uuid REFERENCES public.buyers (id) ON DELETE SET NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_materials_stock_uom_chk CHECK (
    stock_uom = ANY (ARRAY['m'::text, 'kg'::text, 'yd'::text, 'pcs'::text])
  ),
  CONSTRAINT mm_materials_factory_code_uidx UNIQUE (factory_id, code)
);
CREATE INDEX mm_materials_factory_idx ON public.mm_materials (factory_id);
CREATE INDEX mm_materials_group_idx ON public.mm_materials (group_id);
COMMENT ON COLUMN public.mm_materials.stock_uom IS
  'Fixed once stock units exist for this material. Enforce in Phase 3 mm_save_material RPC — no trigger.';
SELECT public._mm_lockdown_table('public.mm_materials'::regclass);
