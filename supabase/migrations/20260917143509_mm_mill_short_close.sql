-- Mill fabric short close: lock further mill dispatch; cancel restores required status.

ALTER TABLE public.colorway_materials
  ADD COLUMN IF NOT EXISTS mill_short_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mill_short_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS mill_short_closed_by uuid;

COMMENT ON COLUMN public.colorway_materials.mill_short_closed IS
  'When true, mill dispatch is blocked for this fabric line until cancelled.';

CREATE OR REPLACE FUNCTION public._mm_mill_short_closed(p_style_material_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT cm.mill_short_closed
    FROM public.mm_style_materials sm
    JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
    WHERE sm.id = p_style_material_id
    LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.mm_set_mill_short_close(
  p_order_id uuid,
  p_colorway_id uuid,
  p_colorway_material_id uuid,
  p_closed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_closed boolean;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric are required');
  END IF;
  v_closed := COALESCE(p_closed, false);
  UPDATE public.colorway_materials cm SET
    mill_short_closed = v_closed,
    mill_short_closed_at = CASE WHEN v_closed THEN now() ELSE NULL END,
    mill_short_closed_by = CASE WHEN v_closed THEN auth.uid() ELSE NULL END,
    updated_at = now()
  WHERE cm.id = p_colorway_material_id
    AND cm.factory_id = v_factory
    AND cm.order_id = p_order_id
    AND cm.colorway_id = p_colorway_id;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric line not found');
  END IF;
  RETURN public._mm_ok(jsonb_build_object('mill_short_closed', v_closed));
END;
$fn$;
;
