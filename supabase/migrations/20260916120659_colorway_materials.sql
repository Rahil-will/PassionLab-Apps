ALTER TABLE public.colorways
  ADD COLUMN IF NOT EXISTS materials jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.colorways.materials IS
  'Per-color fabric/trim BOM lines (Material[] JSON). Used when Material module is on.';;
