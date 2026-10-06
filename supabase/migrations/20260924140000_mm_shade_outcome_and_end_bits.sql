-- Shade is mill identity + warehouse testing outcome, not a catalog metric.
-- End-bit returns get their own monitor table, filled from lay save.
--
-- DO NOT APPLY. Live MES already recorded:
--   mm_shade_endbit_schema
--   mm_shade_patch_insp_decl
--   mm_shade_patch_insp_values
--   mm_shade_patch_insp_insert
--   mm_shade_patch_lay_endbits
--   mm_shade_patch_readers
--   mm_shade_patch_wh_stock_list
--   mm_list_end_bit_returns
--   mm_shade_patch_mill_stock
-- Never reuse those names.

ALTER TABLE public.mm_warehouse_inspections
  ADD COLUMN IF NOT EXISTS shade text;

ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS tested_shade text,
  ADD COLUMN IF NOT EXISTS tested_shade_at timestamptz,
  ADD COLUMN IF NOT EXISTS tested_shade_by uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.mm_mill_rolls.shade IS 'Mill-declared shade. Identity column, not a test metric.';
COMMENT ON COLUMN public.mm_stock_units.shade IS 'Mill-declared shade copied onto the warehouse unit.';
COMMENT ON COLUMN public.mm_stock_units.tested_shade IS 'Warehouse shade recorded when 4-point / test metrics are saved.';
COMMENT ON COLUMN public.mm_warehouse_inspections.shade IS 'Shade outcome of this inspection.';

UPDATE public.mm_mill_rolls
SET shade = NULLIF(btrim(attributes->>'shade'), '')
WHERE NULLIF(btrim(shade), '') IS NULL
  AND NULLIF(btrim(attributes->>'shade'), '') IS NOT NULL;

UPDATE public.mm_warehouse_inspections
SET shade = NULLIF(btrim(field_values->>'shade'), '')
WHERE NULLIF(btrim(shade), '') IS NULL
  AND NULLIF(btrim(field_values->>'shade'), '') IS NOT NULL;

UPDATE public.mm_stock_units u
SET
  tested_shade = i.shade,
  tested_shade_at = COALESCE(i.inspected_at, now()),
  tested_shade_by = i.inspected_by
FROM public.mm_warehouse_inspections i
WHERE i.stock_unit_id = u.id
  AND NULLIF(btrim(i.shade), '') IS NOT NULL
  AND NULLIF(btrim(u.tested_shade), '') IS NULL;

UPDATE public.mm_type_test_fields
SET is_active = false, updated_at = now()
WHERE lower(key) = 'shade' OR lower(btrim(label)) = 'shade';

CREATE TABLE IF NOT EXISTS public.mm_end_bit_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units(id),
  cutting_lay_id uuid,
  store_challan_id uuid,
  qty numeric(12,3) NOT NULL CHECK (qty >= 0),
  qty_uom text,
  mill_shade text,
  tested_shade text,
  unit_code text,
  style_name text,
  returned_at timestamptz NOT NULL DEFAULT now(),
  returned_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS mm_end_bit_returns_factory_idx
  ON public.mm_end_bit_returns (factory_id, returned_at DESC);
CREATE INDEX IF NOT EXISTS mm_end_bit_returns_unit_idx
  ON public.mm_end_bit_returns (stock_unit_id);

ALTER TABLE public.mm_end_bit_returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_end_bit_returns_factory ON public.mm_end_bit_returns;
CREATE POLICY mm_end_bit_returns_factory ON public.mm_end_bit_returns
  FOR ALL USING (factory_id = public.current_factory_id())
  WITH CHECK (factory_id = public.current_factory_id());

REVOKE ALL ON TABLE public.mm_end_bit_returns FROM PUBLIC, anon, authenticated;
