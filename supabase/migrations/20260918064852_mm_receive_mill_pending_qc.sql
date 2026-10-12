CREATE OR REPLACE FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_recv uuid;
  v_edit jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source <> 'mill' THEN RETURN public._mm_err('INVALID', 'Not a mill challan'); END IF;
  IF v_ch.status = 'received' THEN RETURN public._mm_err('ALREADY', 'Already received'); END IF;
  IF v_ch.row_version IS DISTINCT FROM COALESCE(p_row_version, v_ch.row_version) THEN
    RETURN public._mm_err('STALE_VERSION', 'Reload and try again');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  FOR v_edit IN SELECT * FROM jsonb_array_elements(COALESCE(p_roll_edits, '[]'::jsonb))
  LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = (v_edit->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.mm_stock_units SET
      length_m = COALESCE(NULLIF(v_edit->>'length_m', '')::numeric, length_m),
      weight_kg = COALESCE(NULLIF(v_edit->>'weight_kg', '')::numeric, weight_kg),
      shade = COALESCE(NULLIF(trim(v_edit->>'shade'), ''), shade),
      lot_no = COALESCE(NULLIF(trim(v_edit->>'lot_no'), ''), lot_no),
      attributes = CASE WHEN jsonb_typeof(v_edit->'attributes') = 'object' THEN v_edit->'attributes' ELSE attributes END,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
  END LOOP;
  FOR v_unit IN
    SELECT * FROM public.mm_stock_units
    WHERE in_challan_id = v_ch.id AND factory_id = v_factory AND status = 'in_transit'
  LOOP
    UPDATE public.mm_stock_units SET
      status = 'pending_qc', current_location_id = v_recv,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_unit.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, 'pending_qc',
      v_unit.current_location_id, v_recv, 'mm_in_challans', v_ch.id, 'Warehouse receive'
    );
  END LOOP;
  UPDATE public.mm_in_challans SET
    status = 'received', received_at = now(), received_by = auth.uid(),
    row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE id = v_ch.id;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'status', 'received'));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(uuid, jsonb, integer) TO authenticated, service_role;
;
