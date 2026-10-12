-- 4-point inspection is written once per roll. No upsert / retest.

CREATE OR REPLACE FUNCTION public.mm_save_warehouse_inspections(p_id uuid, p_rolls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_recv uuid;
  v_red uuid;
  v_row jsonb;
  v_result text;
  v_values jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
  v_new_status text;
  v_new_loc uuid;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source = 'mill' AND v_ch.status <> 'received' THEN
    RETURN public._mm_err('INVALID', 'Receive this mill challan before testing');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  v_red := COALESCE(public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL'), v_recv);

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_result := lower(NULLIF(btrim(COALESCE(v_row->>'result', '')), ''));
    IF v_result IS NULL THEN CONTINUE; END IF;
    IF v_result NOT IN ('pass', 'fail') THEN
      RETURN public._mm_err('INVALID', 'Each roll must be pass or fail');
    END IF;
    BEGIN
      SELECT * INTO v_unit FROM public.mm_stock_units
      WHERE id = (v_row->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory
      FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this challan'); END IF;
    IF v_unit.status IS DISTINCT FROM 'pending_qc' THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting for warehouse test');
    END IF;
    IF v_unit.qc_result IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.mm_warehouse_inspections i WHERE i.stock_unit_id = v_unit.id
      )
    THEN
      RETURN public._mm_err('LOCKED', 'This roll is already inspected');
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_result := lower(NULLIF(btrim(COALESCE(v_row->>'result', '')), ''));
    IF v_result IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = (v_row->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory;
    v_values := CASE WHEN jsonb_typeof(v_row->'values') = 'object' THEN v_row->'values' ELSE '{}'::jsonb END;
    v_new_status := CASE WHEN v_result = 'pass' THEN 'in_stock' ELSE 'rejected' END;
    v_new_loc := CASE WHEN v_result = 'pass' THEN v_recv ELSE v_red END;

    BEGIN
      INSERT INTO public.mm_warehouse_inspections (
        factory_id, in_challan_id, stock_unit_id, result, field_values, remarks,
        inspected_at, inspected_by, created_by, updated_by
      ) VALUES (
        v_factory, v_ch.id, v_unit.id, v_result, v_values,
        NULLIF(btrim(COALESCE(v_row->>'remarks', '')), ''),
        now(), auth.uid(), auth.uid(), auth.uid()
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'This roll is already inspected';
    END;

    UPDATE public.mm_stock_units SET
      qc_result = v_result,
      status = v_new_status,
      current_location_id = v_new_loc,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;

    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, v_new_status,
      v_unit.current_location_id, v_new_loc, 'mm_warehouse_inspections', v_ch.id,
      CASE WHEN v_result = 'pass' THEN 'Warehouse 4-point pass' ELSE 'Warehouse 4-point fail' END
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'saved', v_n));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_inspections(uuid, jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
