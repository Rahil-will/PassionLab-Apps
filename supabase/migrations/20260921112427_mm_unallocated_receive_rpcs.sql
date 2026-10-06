CREATE OR REPLACE FUNCTION public.mm_save_unallocated_vendor_grn(
  p_fabric_type_id uuid,
  p_supplier_name text,
  p_uom text,
  p_color_ref text,
  p_lot_no text,
  p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch uuid;
  v_no text;
  v_n integer;
  v_recv uuid;
  v_sup text;
  v_ft uuid;
  v_uom text;
  v_color text;
  v_lot text;
  v_rolls jsonb;
  v_row jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_sup := NULLIF(trim(COALESCE(p_supplier_name, '')), '');
  IF v_sup IS NULL THEN RETURN public._mm_err('REQUIRED', 'Supplier name is required'); END IF;
  SELECT id INTO v_ft FROM public.mm_fabric_types
  WHERE id = p_fabric_type_id AND factory_id = v_factory AND is_active;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  v_uom := COALESCE(NULLIF(trim(COALESCE(p_uom, '')), ''), 'm');
  v_color := NULLIF(trim(COALESCE(p_color_ref, '')), '');
  v_lot := NULLIF(trim(COALESCE(p_lot_no, '')), '');
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Add at least one roll');
  END IF;
  v_rolls := '[]'::jsonb;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_rolls := v_rolls || jsonb_build_array(
      v_row || jsonb_build_object(
        'fabric_type_id', v_ft,
        'uom', v_uom,
        'color_ref', COALESCE(NULLIF(trim(COALESCE(v_row->>'color_ref', '')), ''), v_color),
        'lot_no', COALESCE(NULLIF(trim(COALESCE(v_row->>'lot_no', '')), ''), v_lot)
      )
    );
  END LOOP;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  v_no := public.next_doc_no('GRN');
  INSERT INTO public.mm_in_challans (
    factory_id, challan_no, source, style_material_id, supplier_name, status,
    received_at, received_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, 'vendor', NULL, v_sup, 'received', now(), auth.uid(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_ch;
  BEGIN
    v_n := public._mm_insert_rolls(v_factory, NULL, v_ch, 'vendor', 'pending_qc', v_recv, v_rolls, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_mill_batch(
  p_fabric_type_id uuid,
  p_batch_no text,
  p_mill_ref text,
  p_production_date date,
  p_remarks text,
  p_color_ref text,
  p_lot_no text,
  p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ft uuid;
  v_batch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
  v_date date;
  v_color text;
  v_lot text;
  v_rolls jsonb;
  v_row jsonb;
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
  SELECT id INTO v_ft FROM public.mm_fabric_types
  WHERE id = p_fabric_type_id AND factory_id = v_factory AND is_active;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  v_color := NULLIF(trim(COALESCE(p_color_ref, '')), '');
  v_lot := NULLIF(trim(COALESCE(p_lot_no, '')), '');
  v_rolls := '[]'::jsonb;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_rolls := v_rolls || jsonb_build_array(
      v_row || jsonb_build_object(
        'color_ref', COALESCE(NULLIF(trim(COALESCE(v_row->>'color_ref', '')), ''), v_color),
        'lot_no', COALESCE(NULLIF(trim(COALESCE(v_row->>'lot_no', '')), ''), v_lot)
      )
    );
  END LOOP;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, fabric_type_id, batch_no, mill_ref, production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, NULL, v_ft, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''), auth.uid(), auth.uid()
    ) RETURNING id INTO v_batch;
    v_n := public._mm_insert_mill_batch_rolls(v_factory, NULL, v_batch, v_mill, v_rolls);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
    WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
END;
$fn$;;
