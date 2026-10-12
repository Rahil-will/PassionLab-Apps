ALTER TABLE public.mm_fabric_types
  ADD COLUMN IF NOT EXISTS fpt_max_points numeric DEFAULT 40;
UPDATE public.mm_fabric_types SET fpt_max_points = 40 WHERE fpt_max_points IS NULL;

ALTER TABLE public.mm_warehouse_inspections
  ADD COLUMN IF NOT EXISTS inspected_length numeric,
  ADD COLUMN IF NOT EXISTS cuttable_width numeric,
  ADD COLUMN IF NOT EXISTS width_uom text,
  ADD COLUMN IF NOT EXISTS pts_1 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pts_2 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pts_3 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pts_4 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_per_100_sqyd numeric,
  ADD COLUMN IF NOT EXISTS threshold_used numeric,
  ADD COLUMN IF NOT EXISTS result_computed text,
  ADD COLUMN IF NOT EXISTS result_override text,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS override_by uuid,
  ADD COLUMN IF NOT EXISTS override_at timestamptz;

ALTER TABLE public.mm_warehouse_inspections DROP COLUMN IF EXISTS total_points;
ALTER TABLE public.mm_warehouse_inspections
  ADD COLUMN total_points integer GENERATED ALWAYS AS (
    COALESCE(pts_1, 0) + 2 * COALESCE(pts_2, 0) + 3 * COALESCE(pts_3, 0) + 4 * COALESCE(pts_4, 0)
  ) STORED;

CREATE TABLE IF NOT EXISTS public.mm_fpt_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  buyer_id uuid REFERENCES public.buyers(id),
  fabric_type_id uuid REFERENCES public.mm_fabric_types(id),
  max_points numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (factory_id, buyer_id, fabric_type_id)
);

CREATE TABLE IF NOT EXISTS public.mm_defect_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (factory_id, name)
);

CREATE TABLE IF NOT EXISTS public.mm_inspection_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  inspection_id uuid NOT NULL REFERENCES public.mm_warehouse_inspections(id) ON DELETE CASCADE,
  defect_type_id uuid REFERENCES public.mm_defect_types(id),
  defect_code text,
  points integer NOT NULL CHECK (points BETWEEN 1 AND 4),
  size_band text,
  hole boolean NOT NULL DEFAULT false,
  position_from numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mm_fpt_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mm_defect_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mm_inspection_defects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mm_fpt_thresholds_factory ON public.mm_fpt_thresholds;
DROP POLICY IF EXISTS mm_defect_types_factory ON public.mm_defect_types;
DROP POLICY IF EXISTS mm_inspection_defects_factory ON public.mm_inspection_defects;
CREATE POLICY mm_fpt_thresholds_factory ON public.mm_fpt_thresholds FOR ALL
  USING (factory_id = public.current_factory_id()) WITH CHECK (factory_id = public.current_factory_id());
CREATE POLICY mm_defect_types_factory ON public.mm_defect_types FOR ALL
  USING (factory_id = public.current_factory_id()) WITH CHECK (factory_id = public.current_factory_id());
CREATE POLICY mm_inspection_defects_factory ON public.mm_inspection_defects FOR ALL
  USING (factory_id = public.current_factory_id()) WITH CHECK (factory_id = public.current_factory_id());

CREATE OR REPLACE FUNCTION public._mm_fpt_score(
  p_points numeric, p_length numeric, p_length_uom text, p_width numeric, p_width_uom text
) RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN COALESCE(p_length, 0) <= 0 OR COALESCE(p_width, 0) <= 0 THEN NULL
    ELSE round(
      COALESCE(p_points, 0) * 3600 / (
        (CASE WHEN lower(COALESCE(p_length_uom, 'm')) = 'yd' THEN p_length ELSE p_length / 0.9144 END)
        * (CASE WHEN lower(COALESCE(p_width_uom, 'in')) = 'cm' THEN p_width / 2.54 ELSE p_width END)
      ), 2)
  END;
$function$;

CREATE OR REPLACE FUNCTION public._mm_fpt_threshold(p_unit_id uuid)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ft uuid;
  v_buyer uuid;
  v_points numeric;
BEGIN
  SELECT u.factory_id, COALESCE(u.fabric_type_id, sm.fabric_type_id), o.buyer_id
    INTO v_factory, v_ft, v_buyer
  FROM public.mm_stock_units u
  LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  WHERE u.id = p_unit_id;
  SELECT t.max_points INTO v_points
  FROM public.mm_fpt_thresholds t
  WHERE t.factory_id = v_factory AND t.fabric_type_id = v_ft AND t.buyer_id = v_buyer;
  IF v_points IS NULL THEN
    SELECT f.fpt_max_points INTO v_points FROM public.mm_fabric_types f WHERE f.id = v_ft;
  END IF;
  RETURN COALESCE(v_points, 40);
END;
$function$;;
