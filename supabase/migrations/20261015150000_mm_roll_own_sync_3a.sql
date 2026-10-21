-- Step 3a (roll consolidation): mm_rolls owns what the roll IS. Additive only.
-- New columns + backfill from custody (warehouse copy wins over mill copy) + custody -> roll sync + drift view.
ALTER TABLE public.mm_rolls
  ADD COLUMN IF NOT EXISTS shade text,
  ADD COLUMN IF NOT EXISTS length_m numeric,
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS width_in numeric,
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS allocated_style_material_id uuid REFERENCES public.mm_style_materials(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS mm_rolls_alloc_idx ON public.mm_rolls (allocated_style_material_id) WHERE allocated_style_material_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._mm_roll_props_sync()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_w numeric;
BEGIN
  IF NEW.roll_id IS NULL THEN RETURN NULL; END IF;
  -- the warehouse copy wins once it exists
  IF TG_TABLE_NAME = 'mm_mill_rolls' AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.roll_id = NEW.roll_id) THEN RETURN NULL; END IF;
  v_w := CASE WHEN TG_TABLE_NAME = 'mm_mill_rolls' THEN (to_jsonb(NEW)->>'width_in')::numeric ELSE (to_jsonb(NEW)->>'declared_width_in')::numeric END;
  UPDATE public.mm_rolls SET
    shade = NULLIF(btrim(COALESCE(NEW.shade, '')), ''),
    length_m = NEW.length_m,
    weight_kg = NEW.weight_kg,
    width_in = COALESCE(v_w, width_in),
    attributes = COALESCE(NEW.attributes, '{}'::jsonb),
    allocated_style_material_id = NEW.style_material_id
  WHERE id = NEW.roll_id
    AND (shade IS DISTINCT FROM NULLIF(btrim(COALESCE(NEW.shade, '')), '') OR length_m IS DISTINCT FROM NEW.length_m
         OR weight_kg IS DISTINCT FROM NEW.weight_kg OR width_in IS DISTINCT FROM COALESCE(v_w, width_in)
         OR attributes IS DISTINCT FROM COALESCE(NEW.attributes, '{}'::jsonb)
         OR allocated_style_material_id IS DISTINCT FROM NEW.style_material_id);
  RETURN NULL;
END $function$;

CREATE TRIGGER mm_mill_rolls_props_sync AFTER INSERT OR UPDATE ON public.mm_mill_rolls
FOR EACH ROW EXECUTE FUNCTION public._mm_roll_props_sync();
CREATE TRIGGER mm_stock_units_props_sync AFTER INSERT OR UPDATE ON public.mm_stock_units
FOR EACH ROW EXECUTE FUNCTION public._mm_roll_props_sync();

-- backfill: mill first, then warehouse overwrites
UPDATE public.mm_rolls r SET shade = NULLIF(btrim(COALESCE(m.shade, '')), ''), length_m = m.length_m, weight_kg = m.weight_kg,
  width_in = m.width_in, attributes = COALESCE(m.attributes, '{}'::jsonb), allocated_style_material_id = m.style_material_id
FROM public.mm_mill_rolls m WHERE m.roll_id = r.id;
UPDATE public.mm_rolls r SET shade = NULLIF(btrim(COALESCE(u.shade, '')), ''), length_m = u.length_m, weight_kg = u.weight_kg,
  width_in = COALESCE(u.declared_width_in, r.width_in), attributes = COALESCE(u.attributes, '{}'::jsonb), allocated_style_material_id = u.style_material_id
FROM public.mm_stock_units u WHERE u.roll_id = r.id;

-- drift check: must stay empty
CREATE OR REPLACE VIEW public.mm_roll_drift WITH (security_invoker = true) AS
SELECT r.id AS roll_id, r.roll_code, r.factory_id,
       CASE WHEN u.id IS NOT NULL THEN 'warehouse' ELSE 'mill' END AS custody,
       r.shade AS roll_shade, COALESCE(u.shade, m.shade) AS custody_shade,
       r.length_m AS roll_length, COALESCE(u.length_m, m.length_m) AS custody_length,
       r.color_name AS roll_colour, COALESCE(u.color_ref, m.color_ref) AS custody_colour,
       r.allocated_style_material_id AS roll_style, COALESCE(u.style_material_id, m.style_material_id) AS custody_style
FROM public.mm_rolls r
LEFT JOIN public.mm_stock_units u ON u.roll_id = r.id
LEFT JOIN public.mm_mill_rolls m ON m.roll_id = r.id AND u.id IS NULL
WHERE (u.id IS NOT NULL OR m.id IS NOT NULL) AND (
     r.shade IS DISTINCT FROM NULLIF(btrim(COALESCE(COALESCE(u.shade, m.shade), '')), '')
  OR r.length_m IS DISTINCT FROM COALESCE(u.length_m, m.length_m)
  OR r.allocated_style_material_id IS DISTINCT FROM COALESCE(u.style_material_id, m.style_material_id)
  OR (NULLIF(btrim(COALESCE(COALESCE(u.color_ref, m.color_ref), '')), '') IS NOT NULL
      AND r.color_name IS DISTINCT FROM btrim(COALESCE(u.color_ref, m.color_ref))));
REVOKE ALL ON public.mm_roll_drift FROM anon;
