CREATE OR REPLACE FUNCTION public.mm_create_store_challan(
  p_style_material_id uuid,
  p_unit_ids uuid[],
  p_challan_no text DEFAULT NULL,
  p_reference_no text DEFAULT NULL,
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
  v_wh uuid;
  v_cut uuid;
  v_id uuid;
  v_no text;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_ref text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_style_material_id IS NULL OR p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to send');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_stock_units u
      WHERE u.id = v_uid AND u.factory_id = v_factory AND u.style_material_id = p_style_material_id
        AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ) THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not on a warehouse rack');
    END IF;
  END LOOP;
  v_no := NULLIF(btrim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN v_no := public.next_doc_no('SC'); END IF;
  v_ref := NULLIF(btrim(COALESCE(p_reference_no, '')), '');
  BEGIN
    INSERT INTO public.mm_store_challans (
      factory_id, challan_no, style_material_id, from_location_id, to_location_id,
      status, sent_at, sent_by, remarks, reference_no, created_by, updated_by
    ) VALUES (
      v_factory, v_no, p_style_material_id, v_wh, v_cut, 'pending',
      COALESCE(p_sent_at, CURRENT_DATE)::timestamptz,
      auth.uid(),
      NULLIF(btrim(COALESCE(p_remarks, '')), ''),
      v_ref,
      auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That challan number already exists');
  END;
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    INSERT INTO public.mm_store_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_id, v_uid, auth.uid());
    UPDATE public.mm_stock_units SET
      store_challan_id = v_id, current_location_id = v_cut,
      row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_uid;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_cut, 'mm_store_challans', v_id, 'Dispatched to cutting'
    );
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'challan_no', v_no, 'status', 'pending'));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_create_store_challan(uuid, uuid[], text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_create_store_challan(uuid, uuid[], text, text, date, text) TO authenticated, service_role;;
