CREATE OR REPLACE FUNCTION public.mm_update_mill_batch(
  p_batch_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text, p_rolls jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_factory uuid; v_batch public.mm_mill_batches%ROWTYPE; v_no text; v_date date; v_mill uuid; v_row jsonb; v_id uuid; v_code text; v_len numeric; v_wt numeric; v_shade text; v_lot text; v_attrs jsonb; v_new jsonb := '[]'::jsonb; v_n integer := 0; v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry'); EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF NOT COALESCE((SELECT enabled FROM public.mm_factory_features WHERE factory_id = v_factory AND feature_key = 'in_house_mill'), true) THEN RETURN public._mm_err('MILL_OFF', 'In-house mill is off'); END IF;
  IF p_batch_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch is required'); END IF;
  SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = p_batch_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Mill batch not found'); END IF;
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, v_batch.production_date, CURRENT_DATE);
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN RETURN public._mm_err('REQUIRED', 'Add at least one roll'); END IF;
  BEGIN
    UPDATE public.mm_mill_batches SET batch_no = v_no, mill_ref = NULLIF(trim(COALESCE(p_mill_ref, '')), ''), production_date = v_date, remarks = NULLIF(trim(COALESCE(p_remarks, '')), ''), row_version = row_version + 1, updated_at = now(), updated_by = auth.uid() WHERE id = v_batch.id;
  EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls) LOOP
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RETURN public._mm_err('INVALID', 'Each roll needs quantity greater than 0'); END IF;
    v_code := NULLIF(trim(COALESCE(v_row->>'unit_code', '')), '');
    IF v_code IS NULL THEN RETURN public._mm_err('REQUIRED', 'Each roll needs a roll number'); END IF;
    v_id := NULL;
    BEGIN v_id := NULLIF(trim(COALESCE(v_row->>'id', '')), '')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'A roll id is not valid'); END;
    IF v_id IS NULL THEN v_new := v_new || jsonb_build_array(v_row); CONTINUE; END IF;
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory AND mill_batch_id = v_batch.id;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A roll on this batch was not found'); END IF;
    IF v_unit.in_challan_id IS NOT NULL OR v_unit.status IS DISTINCT FROM 'draft' THEN CONTINUE; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    BEGIN
      UPDATE public.mm_stock_units SET unit_code = v_code, length_m = v_len, weight_kg = v_wt, shade = v_shade, lot_no = v_lot, attributes = v_attrs, row_version = row_version + 1, updated_at = now(), updated_by = auth.uid() WHERE id = v_unit.id;
    EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE', 'Roll ' || v_code || ' already exists in this batch');
    END;
    v_n := v_n + 1;
  END LOOP;
  IF jsonb_array_length(v_new) > 0 THEN
    BEGIN v_n := v_n + public._mm_insert_mill_batch_rolls(v_factory, v_batch.style_material_id, v_batch.id, v_mill, v_new);
    EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('INVALID', SQLERRM); END;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch.id, 'batch_no', v_no, 'roll_count', v_n));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb) TO authenticated, service_role;;
