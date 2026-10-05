-- Fabric v4 · 5/6 · Cutting gate, relaxed receipt clearance (v4 only), vendor GRN with stage/tags

-- ── Gate: returns blocking codes for a stock unit (after cut-at-risk approvals) ──
CREATE OR REPLACE FUNCTION public._mm_v4_cut_blocks(p_stock_unit_id uuid, p_style_material_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_u public.mm_stock_units%ROWTYPE; v_r public.mm_rolls%ROWTYPE; v_pp jsonb; v_codes text[] := '{}'; v_ok_codes text[];
        v_cut boolean; v_ts text; v_is text;
BEGIN
  SELECT * INTO v_u FROM public.mm_stock_units WHERE id = p_stock_unit_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('codes', '["NOT_FOUND"]'::jsonb, 'overridden', '[]'::jsonb, 'cut_ready', false); END IF;
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = v_u.roll_id;
  SELECT can_cut INTO v_cut FROM public.mm_fabric_stages WHERE factory_id = v_r.factory_id AND code = v_r.stage_code;
  IF NOT COALESCE(v_cut, false) THEN v_codes := v_codes || 'STAGE_NOT_CUTTABLE'; END IF;
  v_pp := public._mm_qc_passport(v_r.id);
  v_ts := v_pp->'test'->>'status';
  v_is := v_pp->'inspection'->>'status';
  IF v_ts <> 'PASS' THEN v_codes := v_codes || ('TEST_' || CASE v_ts WHEN 'NONE' THEN 'MISSING' ELSE v_ts END); END IF;
  IF v_is <> 'PASS' THEN v_codes := v_codes || ('INSPECTION_' || CASE v_is WHEN 'NONE' THEN 'MISSING' ELSE v_is END); END IF;
  IF v_u.status <> 'in_stock' OR COALESCE(v_u.qty_available,0) <= 0 THEN v_codes := v_codes || 'NOT_AVAILABLE'; END IF;
  IF COALESCE(v_u.on_hold, false) THEN v_codes := v_codes || 'ON_HOLD'; END IF;
  IF v_u.style_material_id IS NULL OR (p_style_material_id IS NOT NULL AND v_u.style_material_id <> p_style_material_id) THEN
    v_codes := v_codes || 'NOT_ALLOCATED';
  END IF;
  v_ok_codes := ARRAY(SELECT DISTINCT c FROM public.mm_qc_cut_approvals a, unnest(a.codes) c
                      WHERE a.roll_id = v_r.id AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now()));
  RETURN jsonb_build_object(
    'codes', to_jsonb(ARRAY(SELECT c FROM unnest(v_codes) c WHERE NOT (c = ANY (v_ok_codes)))),
    'overridden', to_jsonb(ARRAY(SELECT c FROM unnest(v_codes) c WHERE c = ANY (v_ok_codes))),
    'cut_ready', NOT EXISTS (SELECT 1 FROM unnest(v_codes) c WHERE NOT (c = ANY (v_ok_codes))),
    'passport', v_pp);
END $$;

-- ── Receipt clearance: under v4 quality never blocks putaway (gate is at cutting) ──
CREATE OR REPLACE FUNCTION public._mm_unit_clearance(p_unit_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_unit public.mm_stock_units%ROWTYPE; v_block text; v_tested boolean; v_inspected boolean := false; v_result text;
  v_hold boolean; v_cleared boolean := false; v_reason text; v_pp jsonb;
BEGIN
  SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = p_unit_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('tested', false, 'inspected', false, 'inspection_result', NULL, 'cleared', false, 'blocking_reason', 'Roll not found');
  END IF;
  v_hold := public._mm_unit_on_hold(v_unit.id);

  IF public._mm_v4_on(v_unit.factory_id) THEN
    v_pp := public._mm_qc_passport(v_unit.roll_id);
    RETURN jsonb_build_object(
      'tested', (v_pp->'test'->>'status') = 'PASS',
      'inspected', (v_pp->'inspection'->>'status') <> 'NONE',
      'inspection_result', v_pp->'inspection'->>'result',
      'cleared', NOT v_hold,
      'blocking_reason', CASE WHEN v_hold THEN 'On hold' END,
      'passport', v_pp);
  END IF;

  v_block := public._mm_cutting_param_block(v_unit);
  v_tested := v_block IS NULL;
  SELECT (i.result IS NOT NULL), i.result INTO v_inspected, v_result
  FROM public.mm_warehouse_inspections i WHERE i.stock_unit_id = v_unit.id
  ORDER BY i.inspected_at DESC NULLS LAST LIMIT 1;
  v_inspected := COALESCE(v_inspected, false);
  IF v_hold THEN v_reason := 'On hold';
  ELSIF v_result = 'fail' THEN v_reason := 'Inspection failed';
  ELSIF v_unit.source = 'vendor' THEN
    v_cleared := v_tested AND v_inspected AND v_result = 'pass';
    IF NOT v_cleared THEN v_reason := 'Vendor roll needs testing and a passing inspection'; END IF;
  ELSE
    v_cleared := v_tested;
    IF NOT v_tested THEN v_reason := COALESCE(v_block, 'Testing required'); END IF;
  END IF;
  RETURN jsonb_build_object('tested', v_tested, 'inspected', v_inspected, 'inspection_result', v_result,
                            'cleared', v_cleared, 'blocking_reason', v_reason);
END;
$function$;

-- ── Store challan to cutting: v4 gate when fabric_v4 is on, old checks otherwise ──
CREATE OR REPLACE FUNCTION public.mm_create_store_challan(p_style_material_id uuid, p_unit_ids uuid[], p_challan_no text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_sent_at date DEFAULT NULL::date, p_remarks text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_factory uuid; v_wh uuid; v_cut uuid; v_id uuid; v_no text; v_uid uuid; v_unit public.mm_stock_units%ROWTYPE;
  v_ref text; v_block text; v_v4 boolean; v_gate jsonb; v_fails jsonb := '[]'::jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF p_style_material_id IS NULL OR p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to send');
  END IF;
  v_v4 := public._mm_v4_on(v_factory);
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units u
    WHERE u.id = v_uid AND u.factory_id = v_factory AND u.style_material_id = p_style_material_id
      AND u.status = 'in_stock' AND u.store_challan_id IS NULL
      AND public._mm_is_pickable_loc(u.current_location_id)
      AND public._mm_loc_is_under(u.current_location_id, v_wh);
    IF NOT FOUND THEN RETURN public._mm_err('INVALID', 'A selected roll is not on a warehouse rack'); END IF;
    IF v_v4 THEN
      v_gate := public._mm_v4_cut_blocks(v_unit.id, p_style_material_id);
      IF NOT (v_gate->>'cut_ready')::boolean THEN
        v_fails := v_fails || jsonb_build_object('stock_unit_id', v_unit.id, 'roll_id', v_unit.roll_id,
                                                 'unit_code', v_unit.unit_code, 'codes', v_gate->'codes');
      END IF;
    ELSE
      IF public._mm_unit_on_hold(v_unit.id) THEN RETURN public._mm_err('HOLD', COALESCE(v_unit.unit_code, 'Roll') || ' is on hold'); END IF;
      v_block := public._mm_cutting_param_block(v_unit);
      IF v_block IS NOT NULL THEN RETURN public._mm_err('PARAMS', v_unit.unit_code || ': ' || v_block); END IF;
    END IF;
  END LOOP;
  IF jsonb_array_length(v_fails) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CUT_GATE',
      'message', jsonb_array_length(v_fails) || ' roll(s) are not cut-ready', 'blocked', v_fails);
  END IF;
  v_no := NULLIF(btrim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN v_no := public.next_doc_no('SC'); END IF;
  v_ref := NULLIF(btrim(COALESCE(p_reference_no, '')), '');
  BEGIN
    INSERT INTO public.mm_store_challans (factory_id, challan_no, style_material_id, from_location_id, to_location_id,
      status, sent_at, sent_by, remarks, reference_no, created_by, updated_by)
    VALUES (v_factory, v_no, p_style_material_id, v_wh, v_cut, 'pending', COALESCE(p_sent_at, CURRENT_DATE)::timestamptz,
      public._mm_actor_id(), NULLIF(btrim(COALESCE(p_remarks, '')), ''), v_ref, public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE', 'That challan number already exists');
  END;
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    INSERT INTO public.mm_store_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_id, v_uid, public._mm_actor_id());
    UPDATE public.mm_stock_units SET store_challan_id = v_id, current_location_id = v_cut, status = 'issued',
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_uid;
    PERFORM public._mm_ledger(v_factory, v_unit.id, 'ISSUE_TO_CUTTING', v_unit.length_m, v_unit.status, 'issued',
      v_unit.current_location_id, v_cut, 'mm_store_challans', v_id, 'Dispatched to cutting');
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'challan_no', v_no, 'status', 'pending'));
END;
$function$;

-- ── Vendor GRN v4: vendor facility + stage + roll tags, then clear into stock ──
-- payload: { vendor_facility_id, style?:{order_id,colorway_id,colorway_material_id}, fabric_type_id, invoice_ref?, grn_date?,
--   uom?, color_ref?, lot?, grn_no?, stage_code?(default FINISHED), unit_form?, width_form?,
--   rolls:[{length|length_m, weight_kg?, shade?, lot_no?, color_ref?, roll_no?, width_in?}] }
CREATE OR REPLACE FUNCTION public.mm_wh_save_vendor_grn_v4(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_fac public.mm_facilities%ROWTYPE; v_stage text; v_res jsonb; v_ch uuid; v_units uuid[];
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT * INTO v_fac FROM public.mm_facilities WHERE id = NULLIF(p_payload->>'vendor_facility_id','')::uuid AND factory_id = v_factory;
  IF NOT FOUND OR v_fac.kind NOT IN ('vendor','mill') OR v_fac.ownership <> 'external' THEN
    RETURN public._mm_err('INVALID','Pick a fabric vendor');
  END IF;
  v_stage := COALESCE(NULLIF(upper(p_payload->>'stage_code'),''), 'FINISHED');
  IF NOT EXISTS (SELECT 1 FROM public.mm_fabric_stages WHERE factory_id = v_factory AND code = v_stage) THEN
    RETURN public._mm_err('INVALID','Unknown stage');
  END IF;
  PERFORM set_config('mm.v4_receipt_stage', v_stage, true);
  PERFORM set_config('mm.v4_receipt_facility', v_fac.id::text, true);
  v_res := public.mm_save_vendor_grn(
    CASE WHEN jsonb_typeof(p_payload->'style') = 'object' THEN p_payload->'style' END,
    NULLIF(p_payload->>'fabric_type_id','')::uuid, v_fac.name, NULLIF(p_payload->>'invoice_ref',''),
    NULLIF(p_payload->>'grn_date','')::date, NULLIF(p_payload->>'uom',''), NULLIF(p_payload->>'color_ref',''),
    NULLIF(p_payload->>'lot',''), p_payload->'rolls', NULLIF(p_payload->>'grn_no',''));
  PERFORM set_config('mm.v4_receipt_stage', '', true);
  PERFORM set_config('mm.v4_receipt_facility', '', true);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;
  v_ch := (v_res->'data'->>'id')::uuid;
  UPDATE public.mm_rolls r SET unit_form = COALESCE(NULLIF(p_payload->>'unit_form',''), r.unit_form),
    width_form = COALESCE(NULLIF(p_payload->>'width_form',''), r.width_form), updated_at = now()
  FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch AND u.roll_id = r.id;
  IF public._mm_v4_on(v_factory) THEN
    v_units := ARRAY(SELECT id FROM public.mm_stock_units WHERE in_challan_id = v_ch);
    PERFORM public._mm_apply_clearance(v_units);
  END IF;
  RETURN v_res;
EXCEPTION WHEN check_violation THEN RETURN public._mm_err('INVALID','Invalid form or width form');
END $$;

DO $$ DECLARE f text; BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public._mm_v4_cut_blocks(uuid,uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public._mm_v4_cut_blocks(uuid,uuid) TO service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.mm_wh_save_vendor_grn_v4(jsonb) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.mm_wh_save_vendor_grn_v4(jsonb) TO authenticated, service_role';
END $$;;
