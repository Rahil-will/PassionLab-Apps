-- Per-roll testing grid against a receipt (in_challan) or a process challan. All or nothing.
CREATE OR REPLACE FUNCTION public.mm_qc_save_test_grid(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_kind text := p_payload->>'scope_kind'; v_sid uuid; v_row jsonb; v_r jsonb; v_n int := 0; v_code text; v_ids jsonb := '[]'::jsonb;
BEGIN
  IF v_kind IS NULL OR v_kind NOT IN ('in_challan','process_challan') THEN
    RETURN public._mm_err('INVALID','Test against a receipt or a process challan');
  END IF;
  BEGIN v_sid := NULLIF(p_payload->>'scope_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID','Invalid scope'); END;
  IF v_sid IS NULL THEN RETURN public._mm_err('REQUIRED','Pick the receipt or challan'); END IF;
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' THEN RETURN public._mm_err('REQUIRED','Nothing to save'); END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payload->'rows') LOOP
    CONTINUE WHEN NULLIF(v_row->>'result','') IS NULL;
    SELECT roll_code INTO v_code FROM public.mm_rolls WHERE id = NULLIF(v_row->>'roll_id','')::uuid;
    v_r := public.mm_qc_save_test(jsonb_build_object(
      'scope_kind', v_kind, 'scope_id', v_sid,
      'roll_ids', jsonb_build_array(v_row->>'roll_id'),
      'site_side', CASE WHEN v_kind = 'process_challan' THEN COALESCE(NULLIF(p_payload->>'site_side',''), 'warehouse') ELSE 'warehouse' END,
      'origin', COALESCE(NULLIF(p_payload->>'origin',''), 'own'),
      'result', v_row->>'result',
      'field_values', COALESCE(v_row->'values', '{}'::jsonb),
      'remarks', v_row->>'remarks'));
    IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '%: %', COALESCE(v_code, 'A roll'), COALESCE(v_r->>'message', 'could not be saved');
    END IF;
    v_ids := v_ids || COALESCE(v_r->'data'->'id', 'null'::jsonb);
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RETURN public._mm_err('REQUIRED','Set pass, fail or hold on at least one roll'); END IF;
  RETURN public._mm_ok(jsonb_build_object('saved', v_n, 'test_ids', v_ids));
EXCEPTION WHEN raise_exception THEN
  RETURN public._mm_err('INVALID', SQLERRM);
END $function$;
REVOKE ALL ON FUNCTION public.mm_qc_save_test_grid(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_qc_save_test_grid(jsonb) TO authenticated;
