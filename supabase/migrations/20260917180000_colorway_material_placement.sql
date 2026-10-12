-- Trim placement is stored on each colorway material line.
-- colorways.materials remains the write store; this adds a real queryable placement column.

ALTER TABLE public.colorways
  ADD COLUMN IF NOT EXISTS materials jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.colorways.materials IS
  'Per-color fabric/trim lines (Material[] JSON). Trim lines include placement (where the trim sits on the garment).';

UPDATE public.colorways
SET materials = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN COALESCE(elem->>'category', '') = 'Trim'
        THEN elem || jsonb_build_object('placement', COALESCE(elem->>'placement', ''))
      ELSE elem
    END
  )
  FROM jsonb_array_elements(materials) AS elem
), '[]'::jsonb)
WHERE jsonb_typeof(materials) = 'array'
  AND materials <> '[]'::jsonb
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(materials) AS elem
    WHERE COALESCE(elem->>'category', '') = 'Trim'
      AND NOT (elem ? 'placement')
  );

CREATE OR REPLACE FUNCTION public.colorways_materials_ensure_placement()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.materials IS NULL OR jsonb_typeof(NEW.materials) IS DISTINCT FROM 'array' THEN
    NEW.materials := '[]'::jsonb;
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN COALESCE(e->>'category', '') = 'Trim'
        THEN e || jsonb_build_object('placement', COALESCE(e->>'placement', ''))
      ELSE e
    END
  ), '[]'::jsonb)
  INTO NEW.materials
  FROM jsonb_array_elements(NEW.materials) AS e;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS colorways_materials_ensure_placement_trg ON public.colorways;
CREATE TRIGGER colorways_materials_ensure_placement_trg
BEFORE INSERT OR UPDATE OF materials ON public.colorways
FOR EACH ROW
EXECUTE FUNCTION public.colorways_materials_ensure_placement();

CREATE OR REPLACE VIEW public.colorway_material_lines
WITH (security_invoker = true) AS
SELECT
  cw.factory_id,
  cw.order_id,
  cw.id AS colorway_id,
  elem->>'id' AS line_id,
  COALESCE(elem->>'category', '') AS category,
  COALESCE(elem->>'name', '') AS name,
  COALESCE(elem->>'placement', '') AS placement,
  COALESCE(elem->>'fabricCategory', '') AS fabric_category,
  COALESCE(elem->>'type', '') AS fabric_type,
  COALESCE(elem->>'trimCategory', '') AS trim_category,
  COALESCE(elem->>'trimType', '') AS trim_type,
  elem->>'perPc' AS per_pc,
  elem->>'avgCons' AS avg_cons
FROM public.colorways cw
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cw.materials, '[]'::jsonb)) AS elem
WHERE jsonb_typeof(COALESCE(cw.materials, '[]'::jsonb)) = 'array';

COMMENT ON VIEW public.colorway_material_lines IS
  'One row per colorway material line. placement is the trim placement column.';
COMMENT ON COLUMN public.colorway_material_lines.placement IS
  'Where the trim is placed on the garment. Empty for fabric lines.';

GRANT SELECT ON public.colorway_material_lines TO authenticated;
