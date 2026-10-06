CREATE OR REPLACE FUNCTION public._mm_insert_rolls(
  p_factory uuid, p_sm uuid, p_challan uuid, p_source text,
  p_status text, p_loc uuid, p_rolls jsonb, p_freeze boolean
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_code text;
  v_len numeric;
  v_wt numeric;
  v_shade text;
  v_lot text;
  v_color text;
  v_ft uuid;
  v_sm_ft uuid;
  v_attrs jsonb;
  v_snap jsonb;
  v_n integer := 0;
BEGIN
  IF p_source IS DISTINCT FROM 'vendor' THEN
    RAISE EXCEPTION 'Only vendor GRNs may insert new inbound rolls';
  END IF;
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;
  IF p_sm IS NOT NULL THEN
    SELECT fabric_type_id INTO v_sm_ft FROM public.mm_style_materials WHERE id = p_sm;
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_color := NULLIF(trim(COALESCE(v_row->>'color_ref', '')), '');
    v_ft := COALESCE(v_sm_ft, NULLIF(trim(COALESCE(v_row->>'fabric_type_id', '')), '')::uuid);
    IF v_ft IS NULL THEN RAISE EXCEPTION 'Fabric type is required'; END IF;
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    v_code := public.next_doc_no('ROLL');
    IF p_freeze THEN
      v_snap := jsonb_build_object(
        'length_m', v_len, 'weight_kg', v_wt, 'shade', v_shade, 'lot_no', v_lot,
        'color_ref', v_color, 'attributes', v_attrs
      );
    ELSE
      v_snap := NULL;
    END IF;
    INSERT INTO public.mm_stock_units (
      factory_id, unit_code, unit_kind, style_material_id, fabric_type_id, in_challan_id, source,
      uom, length_m, weight_kg, shade, lot_no, color_ref, attributes, mill_snapshot, status,
      current_location_id, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, v_ft, p_challan, p_source,
      COALESCE(NULLIF(trim(COALESCE(v_row->>'uom', '')), ''), 'm'),
      v_len, v_wt, v_shade, v_lot, v_color, v_attrs, v_snap, p_status, p_loc, auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (p_factory, p_challan, v_id, auth.uid());
    PERFORM public._mm_ledger(
      p_factory, v_id, 'RECEIPT_IN',
      v_len, NULL, p_status, NULL, p_loc, 'mm_in_challans', p_challan, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;;
