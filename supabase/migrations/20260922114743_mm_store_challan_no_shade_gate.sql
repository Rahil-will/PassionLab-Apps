-- Cutting and store dispatch do not refuse a challan because shade bands are missing or mixed.
-- Edits the live mm_create_store_challan body: drops p_allow_mixed_shade and the SHADE / SHADE_MIX returns.

DO $patch$
DECLARE
  v_src text;
  v_next text;
  v_needle text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_create_store_challan(uuid,uuid[],text,text,date,text,boolean)'::regprocedure);

  v_needle := 'p_remarks text DEFAULT NULL::text, p_allow_mixed_shade boolean DEFAULT false';
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'store signature hits %', v_hits;
  END IF;
  v_next := replace(v_src, v_needle, 'p_remarks text DEFAULT NULL::text');

  v_needle := $n$  v_block text;
  v_need boolean;
  v_missing_band boolean := false;
  v_bands text[] := ARRAY[]::text[];$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'store declare hits %', v_hits;
  END IF;
  v_next := replace(v_next, v_needle, '  v_block text;');

  v_needle := $n$    IF v_block IS NOT NULL THEN
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
  END IF;$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'store shade gate hits %', v_hits;
  END IF;
  v_next := replace(v_next, v_needle, $n$    IF v_block IS NOT NULL THEN
      RETURN public._mm_err('PARAMS', v_unit.unit_code || ': ' || v_block);
    END IF;
  END LOOP;$n$);

  IF position('SHADE_MIX' IN v_next) > 0
     OR position('p_allow_mixed_shade' IN v_next) > 0
     OR position('_mm_err(''SHADE''' IN v_next) > 0 THEN
    RAISE EXCEPTION 'shade gate still present';
  END IF;

  EXECUTE v_next;
  DROP FUNCTION public.mm_create_store_challan(uuid, uuid[], text, text, date, text, boolean);
END;
$patch$;

REVOKE ALL ON FUNCTION public.mm_create_store_challan(uuid, uuid[], text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_create_store_challan(uuid, uuid[], text, text, date, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
;
