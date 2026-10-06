-- Warehouse shade bands and optimistic concurrency.
-- Cutting and store-challan create do not refuse a lay or a dispatch
-- when a shade band is missing or mixed.

ALTER TABLE public.mm_fabric_types
  ADD COLUMN IF NOT EXISTS requires_shade_band boolean NOT NULL DEFAULT false;

ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS shade_band text,
  ADD COLUMN IF NOT EXISTS shade_band_by uuid,
  ADD COLUMN IF NOT EXISTS shade_band_at timestamptz;

CREATE OR REPLACE FUNCTION public.mm_set_shade_bands(p_assignments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_item jsonb;
  v_id uuid;
  v_band text;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();
  IF jsonb_typeof(COALESCE(p_assignments, 'null'::jsonb)) <> 'array' THEN
    RETURN public._mm_err('INVALID', 'Assignments must be a list');
  END IF;
  IF jsonb_array_length(p_assignments) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to assign a shade band');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_assignments)
  LOOP
    BEGIN
      v_id := NULLIF(trim(COALESCE(v_item->>'unit_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF v_id IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each assignment needs a roll');
    END IF;
    v_band := NULLIF(upper(trim(COALESCE(v_item->>'band', ''))), '');
    IF v_band IS NOT NULL AND v_band !~ '^[A-Z0-9]([A-Z0-9-]{0,15})$' THEN
      RETURN public._mm_err('INVALID', 'Shade band must be a short code such as A or B');
    END IF;

    SELECT * INTO v_unit
    FROM public.mm_stock_units
    WHERE id = v_id AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'Roll not found');
    END IF;
    IF v_unit.style_material_id IS NULL THEN
      RETURN public._mm_err('INVALID', 'Allocate the roll to a style before setting a shade band');
    END IF;
    IF v_unit.status NOT IN ('pending_qc', 'in_stock') THEN
      RETURN public._mm_err('INVALID', 'Shade band can be set while the roll is in stock or waiting for test');
    END IF;

    UPDATE public.mm_stock_units SET
      shade_band = v_band,
      shade_band_by = CASE WHEN v_band IS NULL THEN NULL ELSE v_actor END,
      shade_band_at = CASE WHEN v_band IS NULL THEN NULL ELSE now() END,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = v_actor
    WHERE id = v_unit.id;
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('updated', v_n));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_set_shade_bands(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_set_shade_bands(jsonb) TO authenticated, service_role;
;
