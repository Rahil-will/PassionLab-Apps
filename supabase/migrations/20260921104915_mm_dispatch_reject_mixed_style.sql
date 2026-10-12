CREATE OR REPLACE FUNCTION public.mm_dispatch_mill_rolls(
  p_unit_ids uuid[],
  p_challan_no text,
  p_reference_no text DEFAULT NULL,
  p_to_location text DEFAULT 'Warehouse',
  p_sent_at date DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm uuid;
  v_ft uuid;
  v_ch uuid;
  v_no text;
  v_ref text;
  v_to text;
  v_uid uuid;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_n integer := 0;
  v_batch public.mm_mill_batches%ROWTYPE;
  v_mill uuid;
  v_uom text;
  v_stock uuid;
  v_snap jsonb;
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
  v_no := NULLIF(trim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Enter a challan number');
  END IF;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to dispatch');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_ref := NULLIF(trim(COALESCE(p_reference_no, '')), '');
  v_to := COALESCE(NULLIF(trim(COALESCE(p_to_location, '')), ''), 'Warehouse');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_roll.status <> 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting at the mill');
    END IF;
    IF v_sm IS NULL AND v_ft IS NULL THEN
      v_sm := v_roll.style_material_id;
      v_ft := v_roll.fabric_type_id;
    END IF;
    IF (v_roll.style_material_id IS NULL) IS DISTINCT FROM (v_sm IS NULL) THEN
      RETURN public._mm_err('INVALID', 'Select either unallocated rolls or rolls from the same style, not both');
    END IF;
    IF v_roll.style_material_id IS DISTINCT FROM v_sm THEN
      RETURN public._mm_err('INVALID', 'Select rolls from the same style, color, and fabric');
    END IF;
    IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Select rolls of the same fabric type');
    END IF;
  END LOOP;

  IF v_sm IS NOT NULL AND public._mm_mill_short_closed(v_sm) THEN
    RETURN public._mm_err('CLOSED', 'This fabric is short closed. Cancel short close to dispatch.');
  END IF;

  SELECT COALESCE(
    (
      SELECT NULLIF(trim(u.uom), '')
      FROM public.mm_stock_units u
      WHERE (v_sm IS NOT NULL AND u.style_material_id = v_sm)
         OR (v_sm IS NULL AND u.fabric_type_id = v_ft)
      ORDER BY u.created_at
      LIMIT 1
    ),
    (
      SELECT NULLIF(trim(cm.unit), '')
      FROM public.mm_style_materials sm
      JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sm.id = v_sm
      LIMIT 1
    ),
    'm'
  ) INTO v_uom;

  BEGIN
    INSERT INTO public.mm_in_challans (
      factory_id, challan_no, source, style_material_id, status, sent_at, sent_by,
      remarks, reference_no, to_location, created_by, updated_by
    ) VALUES (
      v_factory, v_no, 'mill', v_sm, 'pending',
      COALESCE(p_sent_at, CURRENT_DATE)::timestamptz,
      auth.uid(),
      NULLIF(btrim(COALESCE(p_remarks, '')), ''),
      v_ref,
      v_to,
      auth.uid(), auth.uid()
    ) RETURNING id INTO v_ch;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That challan number already exists');
  END;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_uid;
    SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = v_roll.mill_batch_id;
    v_snap := jsonb_build_object(
      'length_m', v_roll.length_m,
      'weight_kg', v_roll.weight_kg,
      'shade', v_roll.shade,
      'lot_no', v_roll.lot_no,
      'color_ref', v_roll.color_ref,
      'attributes', v_roll.attributes,
      'mill_batch_id', v_roll.mill_batch_id,
      'batch_no', v_batch.batch_no,
      'mill_ref', v_batch.mill_ref,
      'production_date', v_batch.production_date
    );
    BEGIN
      INSERT INTO public.mm_stock_units (
        factory_id, unit_code, unit_kind, style_material_id, fabric_type_id, mill_batch_id, mill_roll_id,
        in_challan_id, source, uom, length_m, weight_kg, shade, lot_no, color_ref, attributes,
        mill_snapshot, status, current_location_id, created_by, updated_by
      ) VALUES (
        v_factory, v_roll.unit_code, 'roll', v_roll.style_material_id, v_roll.fabric_type_id,
        v_roll.mill_batch_id, v_roll.id,
        v_ch, 'mill', v_uom, v_roll.length_m, v_roll.weight_kg, v_roll.shade, v_roll.lot_no, v_roll.color_ref,
        v_roll.attributes,
        v_snap, 'in_transit', v_mill, auth.uid(), auth.uid()
      ) RETURNING id INTO v_stock;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Roll % already exists in warehouse stock for this mill batch', v_roll.unit_code;
    END;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_ch, v_stock, auth.uid());
    UPDATE public.mm_mill_rolls SET
      status = 'dispatched',
      in_challan_id = v_ch,
      dispatched_at = now(),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_roll.id AND status = 'draft' AND in_challan_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected roll is not waiting at the mill';
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_stock, 'TRANSFER', v_roll.length_m, 'draft', 'in_transit',
      v_mill, v_mill, 'mm_in_challans', v_ch, 'Mill dispatch'
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;;
