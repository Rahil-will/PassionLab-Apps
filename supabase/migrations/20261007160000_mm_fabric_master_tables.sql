-- Fabric master (SKU) + order fabric line columns.
-- mm_fabric_types stays the parent "type" (Knit / Woven) with its QC config.

-- ---------------------------------------------------------------------------
-- mm_fabric_constructions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mm_fabric_constructions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id     uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  fabric_type_id uuid NOT NULL REFERENCES public.mm_fabric_types (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (btrim(name) <> ''),
  seq            integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES public.profiles (id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.profiles (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS mm_fabric_constructions_name_uidx
  ON public.mm_fabric_constructions (factory_id, fabric_type_id, lower(btrim(name)));
SELECT public._mm_lockdown_table('public.mm_fabric_constructions'::regclass);

-- ---------------------------------------------------------------------------
-- mm_fabrics  (Fabric SKU)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mm_fabrics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id          uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL CHECK (btrim(name) <> ''),
  fabric_type_id      uuid NOT NULL REFERENCES public.mm_fabric_types (id) ON DELETE RESTRICT,
  construction_id     uuid NOT NULL REFERENCES public.mm_fabric_constructions (id) ON DELETE RESTRICT,
  composition         jsonb NOT NULL CHECK (jsonb_typeof(composition) = 'array' AND jsonb_array_length(composition) > 0),
  composition_text    text NOT NULL,
  gsm                 numeric NOT NULL CHECK (gsm > 0),
  width_in            numeric NOT NULL CHECK (width_in > 0),
  width_form          text NOT NULL CHECK (width_form IN ('open', 'tubular')),
  uom                 text NOT NULL CHECK (uom IN ('kg', 'm')),
  color_method        text NOT NULL CHECK (color_method IN ('solid_dyed', 'yarn_dyed', 'melange', 'print', 'greige_only')),
  design_ref          text,
  greige_gsm          numeric CHECK (greige_gsm IS NULL OR greige_gsm > 0),
  greige_width_in     numeric CHECK (greige_width_in IS NULL OR greige_width_in > 0),
  spec_values         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(spec_values) = 'object'),
  supplier_article_no text,
  hsn_code            text,
  image_url           text,
  remarks             text,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_review', 'inactive')),
  merged_into_id      uuid REFERENCES public.mm_fabrics (id) ON DELETE RESTRICT,
  dedupe_key          text NOT NULL,
  row_version         integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.profiles (id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_fabrics_code_uidx UNIQUE (factory_id, code),
  CONSTRAINT mm_fabrics_design_ref_chk CHECK (
    color_method NOT IN ('yarn_dyed', 'melange', 'print') OR NULLIF(btrim(design_ref), '') IS NOT NULL
  ),
  CONSTRAINT mm_fabrics_merge_chk CHECK (merged_into_id IS NULL OR (merged_into_id <> id AND status = 'inactive'))
);
CREATE UNIQUE INDEX IF NOT EXISTS mm_fabrics_dedupe_uidx
  ON public.mm_fabrics (factory_id, dedupe_key)
  WHERE merged_into_id IS NULL AND status <> 'inactive';
CREATE INDEX IF NOT EXISTS mm_fabrics_factory_status_idx ON public.mm_fabrics (factory_id, status);
CREATE INDEX IF NOT EXISTS mm_fabrics_type_idx ON public.mm_fabrics (fabric_type_id);
CREATE INDEX IF NOT EXISTS mm_fabrics_construction_idx ON public.mm_fabrics (construction_id);
CREATE INDEX IF NOT EXISTS mm_fabrics_merged_into_idx ON public.mm_fabrics (merged_into_id) WHERE merged_into_id IS NOT NULL;
SELECT public._mm_lockdown_table('public.mm_fabrics'::regclass);

-- ---------------------------------------------------------------------------
-- colorway_materials: link to fabric master + fabric colour + style line key
-- ---------------------------------------------------------------------------
ALTER TABLE public.colorway_materials
  ADD COLUMN IF NOT EXISTS fabric_id        uuid REFERENCES public.mm_fabrics (id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fabric_color     text,
  ADD COLUMN IF NOT EXISTS fabric_color_ref text,
  ADD COLUMN IF NOT EXISTS line_key         uuid,
  ADD COLUMN IF NOT EXISTS cons_overridden  boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS colorway_materials_line_key_idx
  ON public.colorway_materials (order_id, line_key);
CREATE INDEX IF NOT EXISTS colorway_materials_fabric_idx
  ON public.colorway_materials (fabric_id) WHERE fabric_id IS NOT NULL;

COMMENT ON COLUMN public.colorway_materials.fabric_color IS
  'Fabric colour for this colorway. NULL = same as the colorway name.';
COMMENT ON COLUMN public.colorway_materials.line_key IS
  'Same value on every colorway row of one style fabric/trim line.';
COMMENT ON COLUMN public.colorway_materials.total_cons IS
  'Required qty. Computed by trigger: cons_per_pc x colorways.adj_qty x (1 + PL% + W%). Client value ignored.';

-- mm_style_materials: SKU link
ALTER TABLE public.mm_style_materials
  ADD COLUMN IF NOT EXISTS fabric_id uuid REFERENCES public.mm_fabrics (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS mm_style_materials_fabric_idx
  ON public.mm_style_materials (fabric_id) WHERE fabric_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill line_key on existing rows: same line = same order, kind, name,
-- category, type and the n-th occurrence of that combination in a colorway.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT id, order_id, kind,
         lower(btrim(name)) AS n, lower(btrim(category)) AS c, lower(btrim(type)) AS t,
         row_number() OVER (
           PARTITION BY colorway_id, kind, lower(btrim(name)), lower(btrim(category)), lower(btrim(type))
           ORDER BY seq, id
         ) AS occ
  FROM public.colorway_materials
  WHERE line_key IS NULL
), keyed AS (
  SELECT order_id, kind, n, c, t, occ, gen_random_uuid() AS k
  FROM ranked
  GROUP BY order_id, kind, n, c, t, occ
)
UPDATE public.colorway_materials cm
SET line_key = keyed.k
FROM ranked
JOIN keyed USING (order_id, kind, n, c, t, occ)
WHERE cm.id = ranked.id;

-- ---------------------------------------------------------------------------
-- Seed constructions for existing fabric types
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_seed_fabric_constructions(p_factory uuid, p_type_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_type text;
  v_names text[];
  v_n integer := 0;
  i integer;
BEGIN
  SELECT lower(name) INTO v_type FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = p_factory;
  IF v_type IS NULL THEN RETURN 0; END IF;
  v_names := CASE
    WHEN v_type LIKE '%non%wov%' THEN ARRAY['Non-woven']
    WHEN v_type LIKE '%denim%'   THEN ARRAY['Denim 3/1 RHT', 'Denim 3/1 LHT', 'Denim 2/1', 'Denim Satin']
    WHEN v_type LIKE '%knit%'    THEN ARRAY['Single Jersey', '1x1 Rib', '2x2 Rib', 'Interlock', 'Pique', 'Fleece', 'French Terry', 'Waffle']
    WHEN v_type LIKE '%wov%'     THEN ARRAY['Poplin', 'Twill', 'Denim', 'Oxford', 'Canvas', 'Satin', 'Dobby']
    ELSE ARRAY[]::text[]
  END;
  FOR i IN 1 .. COALESCE(array_length(v_names, 1), 0) LOOP
    INSERT INTO public.mm_fabric_constructions (factory_id, fabric_type_id, name, seq)
    VALUES (p_factory, p_type_id, v_names[i], i * 10)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._mm_seed_fabric_constructions(uuid, uuid) FROM PUBLIC, anon, authenticated;

SELECT public._mm_seed_fabric_constructions(t.factory_id, t.id) FROM public.mm_fabric_types t;
