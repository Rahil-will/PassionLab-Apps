-- Phase 6 shade bands. Applied as mm_phase6_shade_band.
-- Warehouse assigns a band on allocated rolls. Mill shade stays the declared value.

ALTER TABLE public.mm_stock_units
  ADD COLUMN IF NOT EXISTS shade_band text,
  ADD COLUMN IF NOT EXISTS shade_band_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS shade_band_at timestamptz;

ALTER TABLE public.mm_fabric_types
  ADD COLUMN IF NOT EXISTS requires_shade_band boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.mm_set_shade_bands(p_assignments jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_row jsonb;
  v_id uuid;
  v_band text;
  v_unit public.mm_stock_units%ROWTYPE;
  v_clean jsonb := '[]'::jsonb;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();
  IF p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array' OR jsonb_array_length(p_assignments) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls and a shade band');
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_assignments)
  LOOP
    BEGIN
      v_id := NULLIF(v_row->>'unit_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    v_band := NULLIF(btrim(v_row->>'band'), '');
    IF v_id IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each row needs a roll');
    END IF;
    IF v_band IS NOT NULL AND length(v_band) > 20 THEN
      RETURN public._mm_err('INVALID', 'Shade band is too long');
    END IF;
    IF v_id = ANY (v_seen) THEN
      RETURN public._mm_err('DUPLICATE', 'A roll is listed twice');
    END IF;
    v_seen := v_seen || v_id;
    SELECT * INTO v_unit
    FROM public.mm_stock_units
    WHERE id = v_id AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found');
    END IF;
    IF v_unit.style_material_id IS NULL THEN
      RETURN public._mm_err('INVALID', 'Allocate the roll to a style before assigning a shade band');
    END IF;
    IF v_unit.status NOT IN ('pending_qc', 'in_stock') THEN
      RETURN public._mm_err('INVALID', COALESCE(v_unit.unit_code, 'Roll') || ' is not in the warehouse');
    END IF;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('id', v_id, 'band', v_band));
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_clean)
  LOOP
    UPDATE public.mm_stock_units
    SET shade_band = v_row->>'band',
        shade_band_by = v_actor,
        shade_band_at = now(),
        updated_at = now(),
        updated_by = v_actor,
        row_version = row_version + 1
    WHERE id = (v_row->>'id')::uuid
      AND factory_id = v_factory;
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('rolls', v_n));
END;
$fn$;

DO $patch$
DECLARE
  v_src text;
  v_next text;
  v_needle text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_save_fabric_type(jsonb)'::regprocedure);
  v_needle := $n$      name = v_name,
      remarks = NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),
      is_active = true,$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'fabric update hits %', v_hits; END IF;
  v_next := replace(v_src, v_needle, v_needle || $n$
      requires_shade_band = CASE
        WHEN p_row ? 'requires_shade_band' THEN COALESCE((p_row->>'requires_shade_band')::boolean, requires_shade_band)
        ELSE requires_shade_band
      END,$n$);
  v_needle := $n$    remarks = EXCLUDED.remarks,
    is_active = true,$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'fabric conflict hits %', v_hits; END IF;
  v_next := replace(v_next, v_needle, $n$    remarks = EXCLUDED.remarks,
    is_active = true,
    requires_shade_band = CASE
      WHEN p_row ? 'requires_shade_band' THEN COALESCE((p_row->>'requires_shade_band')::boolean, public.mm_fabric_types.requires_shade_band)
      ELSE public.mm_fabric_types.requires_shade_band
    END,$n$);
  v_needle := $n$    factory_id, name, remarks, seq, created_by, updated_by
  ) VALUES (
    v_factory, v_name, NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'fabric insert hits %', v_hits; END IF;
  v_next := replace(v_next, v_needle, $n$    factory_id, name, remarks, requires_shade_band, seq, created_by, updated_by
  ) VALUES (
    v_factory, v_name, NULLIF(trim(COALESCE(p_row->>'remarks', '')), ''),
    COALESCE((p_row->>'requires_shade_band')::boolean, false),$n$);
  IF position('COALESCE((SELECT max(seq)' in v_next) = 0 THEN
    RAISE EXCEPTION 'fabric seq expression missing';
  END IF;
  EXECUTE v_next;

  v_src := pg_get_functiondef('public.mm_get_style_warehouse(uuid)'::regprocedure);
  v_needle := $n$'shade', u.shade, 'lot_no'$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'style shade hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$'shade', u.shade, 'shade_band', u.shade_band, 'qty_available', u.qty_available, 'lot_no'$n$);

  v_src := pg_get_functiondef('public.mm_get_store_challan(uuid)'::regprocedure);
  v_needle := $n$'shade', u.shade$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'store get shade hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$'shade', u.shade, 'shade_band', u.shade_band$n$);

  v_src := pg_get_functiondef('public.mm_list_store_stock(uuid)'::regprocedure);
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'store stock shade hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$'shade', u.shade, 'shade_band', u.shade_band$n$);

  v_src := pg_get_functiondef('public.mm_get_warehouse_dispatch_board(uuid)'::regprocedure);
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 2 THEN RAISE EXCEPTION 'dispatch shade hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$'shade', u.shade, 'shade_band', u.shade_band$n$);

  v_src := pg_get_functiondef('public.mm_create_store_challan(uuid,uuid[],text,text,date,text)'::regprocedure);
  v_needle := $n$p_remarks text DEFAULT NULL::text)$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'store signature hits %', v_hits; END IF;
  v_next := replace(v_src, v_needle, $n$p_remarks text DEFAULT NULL::text, p_allow_mixed_shade boolean DEFAULT false)$n$);
  v_needle := $n$  v_block text;$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'store declare hits %', v_hits; END IF;
  v_next := replace(v_next, v_needle, $n$  v_block text;
  v_need boolean;
  v_missing_band boolean := false;
  v_bands text[] := ARRAY[]::text[];$n$);
  v_needle := $n$    IF v_block IS NOT NULL THEN
      RETURN public._mm_err('PARAMS', v_unit.unit_code || ': ' || v_block);
    END IF;
  END LOOP;$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'store param hits %', v_hits; END IF;
  v_next := replace(v_next, v_needle, $n$    IF v_block IS NOT NULL THEN
      RETURN public._mm_err('PARAMS', v_unit.unit_code || ': ' || v_block);
    END IF;
    SELECT COALESCE(ft.requires_shade_band, false) INTO v_need
    FROM public.mm_fabric_types ft
    WHERE ft.id = v_unit.fabric_type_id AND ft.factory_id = v_factory;
    IF COALESCE(v_need, false) AND NULLIF(btrim(COALESCE(v_unit.shade_band, '')), '') IS NULL THEN
      v_missing_band := true;
    END IF;
    IF NULLIF(btrim(COALESCE(v_unit.shade_band, '')), '') IS NOT NULL THEN
      v_bands := v_bands || lower(btrim(v_unit.shade_band));
    END IF;
  END LOOP;
  IF v_missing_band THEN
    RETURN public._mm_err('SHADE', 'Assign a shade band before sending this fabric to cutting');
  END IF;
  IF COALESCE(p_allow_mixed_shade, false) IS NOT TRUE
     AND (SELECT count(DISTINCT x) FROM unnest(v_bands) AS x) > 1 THEN
    RETURN public._mm_err('SHADE_MIX', 'Selected rolls are in more than one shade band');
  END IF;$n$);
  IF position('p_allow_mixed_shade' in v_next) = 0 THEN
    RAISE EXCEPTION 'store shade param missing';
  END IF;
  EXECUTE v_next;
  DROP FUNCTION public.mm_create_store_challan(uuid, uuid[], text, text, date, text);
END;
$patch$;

REVOKE ALL ON FUNCTION public.mm_set_shade_bands(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_create_store_challan(uuid, uuid[], text, text, date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_set_shade_bands(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_create_store_challan(uuid, uuid[], text, text, date, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
