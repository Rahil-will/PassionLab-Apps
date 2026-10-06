ALTER TABLE public.mm_mill_batches
  ADD COLUMN IF NOT EXISTS fabric_ref_name text,
  ADD COLUMN IF NOT EXISTS color_ref text;

COMMENT ON COLUMN public.mm_mill_batches.fabric_ref_name IS
  'Mill fabric reference name. Kept after the batch is assigned to a style material.';
COMMENT ON COLUMN public.mm_mill_batches.color_ref IS
  'Mill color reference. Kept after the batch is assigned to a style material.';;
