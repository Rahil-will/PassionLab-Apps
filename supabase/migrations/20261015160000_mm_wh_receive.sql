-- Warehouse-only model (Rahil 2026-10-15): every roll enters at the gate.
-- W1 mm_wh_receive: one receive for Internal / External, any stage, purpose Style / Stock / Open PO, rich roll grid.
-- W2 mm_wh_list_receipts / mm_wh_get_receipt.

ALTER TABLE public.mm_in_challans
  ADD COLUMN IF NOT EXISTS receipt_source text CHECK (receipt_source IN ('internal', 'external')),
  ADD COLUMN IF NOT EXISTS from_facility_id uuid REFERENCES public.mm_facilities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS party_challan_no text,
  ADD COLUMN IF NOT EXISTS lr_no text,
  ADD COLUMN IF NOT EXISTS container_no text,
  ADD COLUMN IF NOT EXISTS po_no text,
  ADD COLUMN IF NOT EXISTS purpose text CHECK (purpose IN ('style', 'stock', 'open_po')),
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS po_ref text,
  ADD COLUMN IF NOT EXISTS fabric_id uuid REFERENCES public.mm_fabrics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage_code text,
  ADD COLUMN IF NOT EXISTS color_ref text,
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.mm_machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shift text;

-- Roll grid values -> one QC test per roll (scope = this receipt, site = warehouse). Same rules as the mill batch form.
CREATE OR REPLACE FUNCTION public._mm_wh_receipt_qc_from_attrs(p_challan uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_c public.mm_in_challans%ROWTYPE; v_u record; v_fv jsonb; v_qc text; v_res text; v_tid uuid; v_n int := 0;
  v_keys text[]; v_k text; v_val text; v_ft uuid;
BEGIN
  SELECT * INTO v_c FROM public.mm_in_challans WHERE id = p_challan;
  IF NOT FOUND THEN RETURN 0; END IF;
  FOR v_u IN
    SELECT u.id, u.roll_id, u.attributes, u.fabric_type_id, r.stage_code, COALESCE(r.process_round, 0) AS round
    FROM public.mm_stock_units u JOIN public.mm_rolls r ON r.id = u.roll_id
    WHERE u.in_challan_id = p_challan
      AND NOT EXISTS (SELECT 1 FROM public.mm_qc_test_rolls tr WHERE tr.roll_id = u.roll_id)
  LOOP
    v_ft := v_u.fabric_type_id;
    v_keys := ARRAY(SELECT f.key FROM public.mm_type_test_fields f WHERE f.factory_id = v_c.factory_id AND f.type_id = v_ft AND f.is_active);
    v_fv := '{}'::jsonb;
    FOREACH v_k IN ARRAY v_keys LOOP
      v_val := NULLIF(btrim(COALESCE(v_u.attributes->>v_k, '')), '');
      IF v_val IS NULL AND v_k ILIKE '%gsm%' THEN v_val := NULLIF(btrim(COALESCE(v_u.attributes->>'actual_gsm', '')), ''); END IF;
      IF v_val IS NULL AND v_k ILIKE 'width%' THEN v_val := NULLIF(btrim(COALESCE(v_u.attributes->>'actual_width_in', '')), ''); END IF;
      IF v_val IS NOT NULL THEN v_fv := v_fv || jsonb_build_object(v_k, v_val); END IF;
    END LOOP;
    IF NOT v_fv ? 'gsm' AND NULLIF(v_u.attributes->>'actual_gsm', '') IS NOT NULL THEN v_fv := v_fv || jsonb_build_object('gsm', v_u.attributes->>'actual_gsm'); END IF;
    IF NOT v_fv ? 'width' AND NULLIF(v_u.attributes->>'actual_width_in', '') IS NOT NULL THEN v_fv := v_fv || jsonb_build_object('width', v_u.attributes->>'actual_width_in'); END IF;
    v_qc := lower(NULLIF(btrim(COALESCE(v_u.attributes->>'qc_status', '')), ''));
    IF v_fv = '{}'::jsonb AND COALESCE(v_qc, 'pass') NOT IN ('hold', 'rework', 'reject', 'downgrade') THEN CONTINUE; END IF;
    v_res := CASE v_qc WHEN 'reject' THEN 'fail' WHEN 'hold' THEN 'hold' WHEN 'rework' THEN 'hold' ELSE 'pass' END;
    INSERT INTO public.mm_qc_tests (factory_id, scope_kind, scope_id, site_side, stage_code, fabric_type_id,
                                    field_values, result, origin, tested_at, remarks, created_by)
    VALUES (v_c.factory_id, 'in_challan', v_c.id, 'warehouse', v_u.stage_code, v_ft, v_fv, v_res,
            CASE WHEN v_c.receipt_source = 'external' THEN 'vendor_certificate' ELSE 'own' END,
            COALESCE(v_c.received_at, now()),
            'Recorded at receipt' || CASE WHEN v_qc IS NOT NULL AND v_qc <> 'pass' THEN ' · ' || v_qc ELSE '' END,
            public._mm_actor_id())
    RETURNING id INTO v_tid;
    INSERT INTO public.mm_qc_test_rolls (factory_id, test_id, roll_id, round_at_test) VALUES (v_c.factory_id, v_tid, v_u.roll_id, v_u.round);
    IF v_qc = 'downgrade' THEN UPDATE public.mm_rolls SET grade = 'B', updated_at = now() WHERE id = v_u.roll_id; END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE EXECUTE ON FUNCTION public._mm_wh_receipt_qc_from_attrs(uuid) FROM anon, public, authenticated;

CREATE OR REPLACE FUNCTION public.mm_wh_receive(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_actor uuid; f public.mm_fabrics%ROWTYPE; v_src text; v_from public.mm_facilities%ROWTYPE;
  v_stage text; v_cut boolean; v_uom text; v_kg boolean; v_purpose text; v_sm uuid; v_sm_fabric uuid; v_colour text; v_lot text;
  v_no text; v_ch uuid; v_recv uuid; v_r jsonb; v_code text; v_qty numeric; v_len numeric; v_wt numeric; v_rcol text;
  v_unit uuid; v_codes text[] := '{}'; v_units uuid[] := '{}'; v_tests int; v_mach uuid; v_on date; v_attrs jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();

  BEGIN
    SELECT * INTO f FROM public.mm_fabrics WHERE id = NULLIF(p_payload->>'fabric_id', '')::uuid AND factory_id = v_factory;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid fabric'); END;
  IF f.id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Pick the fabric'); END IF;
  IF f.status = 'archived' THEN RETURN public._mm_err('INVALID', f.code || ' is archived'); END IF;

  v_src := lower(COALESCE(NULLIF(p_payload->>'source', ''), ''));
  IF v_src NOT IN ('internal', 'external') THEN RETURN public._mm_err('REQUIRED', 'Pick Internal or External'); END IF;
  IF v_src = 'external' THEN
    SELECT * INTO v_from FROM public.mm_facilities WHERE id = NULLIF(p_payload->>'from_facility_id', '')::uuid AND factory_id = v_factory;
    IF v_from.id IS NULL OR v_from.kind <> 'vendor' THEN RETURN public._mm_err('REQUIRED', 'Pick the fabric vendor'); END IF;
  ELSE
    SELECT * INTO v_from FROM public.mm_facilities
    WHERE id = COALESCE(NULLIF(p_payload->>'from_facility_id', '')::uuid, public._mm_inhouse_unit(v_factory)) AND factory_id = v_factory;
    IF v_from.id IS NULL OR v_from.ownership <> 'internal' THEN RETURN public._mm_err('INVALID', 'Pick an internal unit'); END IF;
  END IF;
  IF NOT v_from.is_active THEN RETURN public._mm_err('INACTIVE', v_from.name || ' is inactive'); END IF;

  v_stage := upper(COALESCE(NULLIF(p_payload->>'stage_code', ''), ''));
  SELECT can_cut INTO v_cut FROM public.mm_fabric_stages WHERE factory_id = v_factory AND code = v_stage AND is_active;
  IF v_cut IS NULL THEN RETURN public._mm_err('REQUIRED', 'Pick the stage received'); END IF;

  v_uom := lower(COALESCE(NULLIF(p_payload->>'uom', ''), f.uom, 'm'));
  v_kg := v_uom IN ('kg', 'kgs');
  v_uom := CASE WHEN v_kg THEN 'kg' ELSE 'm' END;

  v_purpose := lower(COALESCE(NULLIF(p_payload->>'purpose', ''), 'stock'));
  IF v_purpose NOT IN ('style', 'stock', 'open_po') THEN RETURN public._mm_err('INVALID', 'Purpose must be style, stock or open_po'); END IF;
  IF v_purpose = 'style' THEN
    BEGIN v_sm := NULLIF(p_payload->>'style_material_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid style line'); END;
    SELECT fabric_id INTO v_sm_fabric FROM public.mm_style_materials WHERE id = v_sm AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('REQUIRED', 'Pick the style line'); END IF;
    IF v_sm_fabric IS NOT NULL AND v_sm_fabric <> f.id THEN
      RETURN public._mm_err('FABRIC_MISMATCH', 'This style line uses ' || (SELECT code FROM public.mm_fabrics WHERE id = v_sm_fabric) || ', not ' || f.code);
    END IF;
  ELSIF v_purpose = 'open_po' AND NULLIF(btrim(COALESCE(p_payload->>'customer_name', '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Open PO needs the customer');
  END IF;

  IF v_src = 'internal' AND NULLIF(p_payload->>'machine_id', '') IS NOT NULL THEN
    v_mach := (p_payload->>'machine_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.mm_machines WHERE id = v_mach AND factory_id = v_factory AND is_active) THEN
      RETURN public._mm_err('INVALID', 'Pick an active machine');
    END IF;
  END IF;

  v_colour := NULLIF(btrim(COALESCE(p_payload->>'color', '')), '');
  v_lot := NULLIF(btrim(COALESCE(p_payload->>'dye_lot', '')), '');
  IF jsonb_typeof(COALESCE(p_payload->'rolls', 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_payload->'rolls') = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Add at least one roll');
  END IF;

  -- validate rolls
  FOR v_r IN SELECT * FROM jsonb_array_elements(p_payload->'rolls') LOOP
    v_code := NULLIF(btrim(COALESCE(v_r->>'roll_no', '')), '');
    IF v_code IS NOT NULL THEN
      IF lower(v_code) = ANY (SELECT lower(x) FROM unnest(v_codes) x) THEN RETURN public._mm_err('DUPLICATE', 'Roll ' || v_code || ' is listed twice'); END IF;
      IF EXISTS (SELECT 1 FROM public.mm_stock_units WHERE factory_id = v_factory AND mill_batch_id IS NULL AND unit_code = v_code) THEN
        RETURN public._mm_err('DUPLICATE', 'Roll ' || v_code || ' already exists');
      END IF;
      v_codes := array_append(v_codes, v_code);
    END IF;
    BEGIN
      v_len := NULLIF(v_r->>'length_m', '')::numeric; v_wt := NULLIF(v_r->>'weight_kg', '')::numeric;
      PERFORM NULLIF(v_r->>'width_in', '')::numeric, NULLIF(v_r->>'actual_gsm', '')::numeric, NULLIF(v_r->>'actual_width_in', '')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'A number on roll ' || COALESCE(v_code, '?') || ' is not valid'); END;
    v_qty := CASE WHEN v_kg THEN v_wt ELSE v_len END;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RETURN public._mm_err('REQUIRED', 'Roll ' || COALESCE(v_code, '?') || ' needs ' || CASE WHEN v_kg THEN 'kg' ELSE 'length' END);
    END IF;
    v_rcol := COALESCE(NULLIF(btrim(COALESCE(v_r->>'color', '')), ''), v_colour);
    IF v_cut AND COALESCE(f.color_method, 'solid_dyed') <> 'greige_only' AND v_rcol IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Colour is required for ' || v_stage || ' fabric (roll ' || COALESCE(v_code, '?') || ')');
    END IF;
    IF lower(COALESCE(NULLIF(v_r->>'qc_status', ''), 'pass')) NOT IN ('pass', 'hold', 'rework', 'reject', 'downgrade') THEN
      RETURN public._mm_err('INVALID', 'QC status must be pass, hold, rework, reject or downgrade');
    END IF;
  END LOOP;

  -- header
  v_on := COALESCE(NULLIF(p_payload->>'received_at', '')::date, CURRENT_DATE);
  v_no := NULLIF(btrim(COALESCE(p_payload->>'grn_no', '')), '');
  IF v_no IS NULL THEN v_no := public._mm_next_grn_no(v_factory, v_on);
  ELSIF EXISTS (SELECT 1 FROM public.mm_in_challans WHERE factory_id = v_factory AND (challan_no = v_no OR grn_no = v_no)) THEN
    RETURN public._mm_err('DUPLICATE', 'GRN number already exists');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
  v_recv := public._mm_recv_loc(v_factory);
  INSERT INTO public.mm_in_challans (factory_id, challan_no, grn_no, source, style_material_id, supplier_name, invoice_ref, reference_no,
    status, received_at, received_by, created_by, updated_by, remarks,
    receipt_source, from_facility_id, party_challan_no, lr_no, container_no, po_no, purpose, customer_name, po_ref,
    fabric_id, stage_code, color_ref, machine_id, shift, to_facility_id)
  VALUES (v_factory, v_no, v_no, 'vendor', v_sm, v_from.name, NULLIF(btrim(COALESCE(p_payload->>'invoice_ref', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'party_challan_no', '')), ''),
    'received', v_on::timestamptz, v_actor, v_actor, v_actor, NULLIF(btrim(COALESCE(p_payload->>'remarks', '')), ''),
    v_src, v_from.id, NULLIF(btrim(COALESCE(p_payload->>'party_challan_no', '')), ''), NULLIF(btrim(COALESCE(p_payload->>'lr_no', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'container_no', '')), ''), NULLIF(btrim(COALESCE(p_payload->>'po_no', '')), ''),
    v_purpose, NULLIF(btrim(COALESCE(p_payload->>'customer_name', '')), ''), NULLIF(btrim(COALESCE(p_payload->>'po_ref', '')), ''),
    f.id, v_stage, v_colour, v_mach, NULLIF(btrim(COALESCE(p_payload->>'shift', '')), ''),
    (SELECT id FROM public.mm_facilities WHERE factory_id = v_factory AND kind = 'warehouse' AND is_active ORDER BY created_at LIMIT 1))
  RETURNING id INTO v_ch;

  PERFORM set_config('mm.v4_receipt_stage', v_stage, true);
  PERFORM set_config('mm.v4_receipt_facility', v_from.id::text, true);
  FOR v_r IN SELECT * FROM jsonb_array_elements(p_payload->'rolls') LOOP
    v_code := COALESCE(NULLIF(btrim(COALESCE(v_r->>'roll_no', '')), ''), public.next_doc_no('ROLL'));
    v_len := NULLIF(v_r->>'length_m', '')::numeric; v_wt := NULLIF(v_r->>'weight_kg', '')::numeric;
    v_qty := CASE WHEN v_kg THEN v_wt ELSE v_len END;
    v_rcol := COALESCE(NULLIF(btrim(COALESCE(v_r->>'color', '')), ''), v_colour);
    v_attrs := jsonb_strip_nulls(jsonb_build_object(
      'roll_no', v_code, 'width_in', NULLIF(v_r->>'width_in', ''),
      'actual_gsm', NULLIF(v_r->>'actual_gsm', ''), 'actual_width_in', NULLIF(v_r->>'actual_width_in', ''),
      'qc_status', lower(NULLIF(v_r->>'qc_status', '')), 'remarks', NULLIF(btrim(COALESCE(v_r->>'remarks', '')), '')))
      || CASE WHEN jsonb_typeof(v_r->'attributes') = 'object' THEN v_r->'attributes' ELSE '{}'::jsonb END;
    INSERT INTO public.mm_stock_units (factory_id, unit_code, unit_kind, style_material_id, fabric_type_id, in_challan_id, source,
      uom, length_m, weight_kg, shade, lot_no, color_ref, attributes, status, current_location_id,
      qty_uom, qty_declared, qty_received, qty_available, declared_width_in, created_by, updated_by)
    VALUES (v_factory, v_code, 'roll', v_sm, f.fabric_type_id, v_ch, 'vendor',
      v_uom, v_len, v_wt, NULLIF(btrim(COALESCE(v_r->>'shade', '')), ''), COALESCE(NULLIF(btrim(COALESCE(v_r->>'dye_lot', '')), ''), v_lot),
      v_rcol, v_attrs, 'pending_qc', v_recv, v_uom, v_qty, v_qty, 0, NULLIF(v_r->>'width_in', '')::numeric, v_actor, v_actor)
    RETURNING id INTO v_unit;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by) VALUES (v_factory, v_ch, v_unit, v_actor);
    PERFORM public._mm_ledger(v_factory, v_unit, 'RECEIPT_IN', v_qty, NULL, 'pending_qc', NULL, v_recv, 'mm_in_challans', v_ch, 'gate receipt');
    UPDATE public.mm_rolls r SET fabric_id = f.id, stage_code = v_stage,
      color_name = COALESCE(v_rcol, r.color_name),
      dye_lot = COALESCE(NULLIF(btrim(COALESCE(v_r->>'dye_lot', '')), ''), v_lot, r.dye_lot),
      unit_form = COALESCE(NULLIF(p_payload->>'unit_form', ''), r.unit_form),
      width_form = COALESCE(NULLIF(p_payload->>'width_form', ''), f.width_form, r.width_form),
      machine_id = COALESCE(v_mach, r.machine_id), shift = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'shift', '')), ''), r.shift),
      origin = CASE WHEN v_src = 'internal' THEN 'mill' ELSE 'vendor' END,
      updated_at = now()
    FROM public.mm_stock_units u WHERE u.id = v_unit AND r.id = u.roll_id;
    v_units := array_append(v_units, v_unit);
  END LOOP;
  PERFORM set_config('mm.v4_receipt_stage', '', true);
  PERFORM set_config('mm.v4_receipt_facility', '', true);

  v_tests := public._mm_wh_receipt_qc_from_attrs(v_ch);
  PERFORM public._mm_apply_clearance(v_units);

  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'grn_no', v_no, 'roll_count', array_length(v_units, 1),
    'qc_tests_created', v_tests,
    'booked', (SELECT count(*) FROM public.mm_rolls r JOIN public.mm_stock_units u ON u.roll_id = r.id
               WHERE u.in_challan_id = v_ch AND r.booked_style_material_id IS NOT NULL),
    'allocated', (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch AND u.style_material_id IS NOT NULL)));
EXCEPTION
  WHEN check_violation THEN RETURN public._mm_err('INVALID', SQLERRM);
  WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE', 'A roll number is already used');
  WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
END $function$;
REVOKE EXECUTE ON FUNCTION public.mm_wh_receive(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mm_wh_receive(jsonb) TO authenticated;

-- Receipts list
CREATE OR REPLACE FUNCTION public.mm_wh_list_receipts(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_q text;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search', ''))), '');
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'received_at') DESC, row->>'grn_no' DESC) FROM (
      SELECT jsonb_build_object(
        'id', c.id, 'grn_no', COALESCE(c.grn_no, c.challan_no), 'received_at', c.received_at,
        'source', COALESCE(c.receipt_source, CASE WHEN c.source = 'mill' THEN 'internal' ELSE 'external' END),
        'from', COALESCE((SELECT jsonb_build_object('id', x.id, 'name', x.name) FROM public.mm_facilities x WHERE x.id = c.from_facility_id),
                         jsonb_build_object('id', NULL, 'name', c.supplier_name)),
        'party_challan_no', c.party_challan_no, 'invoice_ref', c.invoice_ref, 'lr_no', c.lr_no, 'container_no', c.container_no, 'po_no', c.po_no,
        'purpose', c.purpose, 'customer_name', c.customer_name, 'po_ref', c.po_ref,
        'style', public._mm_style_label(c.style_material_id), 'style_material_id', c.style_material_id,
        'fabric', (SELECT jsonb_build_object('id', fb.id, 'code', fb.code, 'name', fb.name) FROM public.mm_fabrics fb
                   WHERE fb.id = COALESCE(c.fabric_id, (SELECT r.fabric_id FROM public.mm_stock_units u JOIN public.mm_rolls r ON r.id = u.roll_id WHERE u.in_challan_id = c.id LIMIT 1))),
        'stage_code', c.stage_code, 'color', c.color_ref,
        'rolls', (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id),
        'qty', (SELECT COALESCE(sum(u.qty_received), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id),
        'uom', (SELECT max(COALESCE(u.qty_uom, u.uom)) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id),
        'qc_pending', (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id
                       AND (public._mm_qc_passport(u.roll_id)->'test'->>'status' <> 'PASS'
                            OR public._mm_qc_passport(u.roll_id)->'inspection'->>'status' <> 'PASS'))
      ) AS row
      FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory AND c.status <> 'pending'
        AND (NULLIF(p_filter->>'source', '') IS NULL OR COALESCE(c.receipt_source, CASE WHEN c.source = 'mill' THEN 'internal' ELSE 'external' END) = p_filter->>'source')
        AND (NULLIF(p_filter->>'purpose', '') IS NULL OR c.purpose = p_filter->>'purpose')
        AND (v_q IS NULL OR lower(COALESCE(c.grn_no, c.challan_no)) LIKE '%' || v_q || '%' OR lower(COALESCE(c.supplier_name, '')) LIKE '%' || v_q || '%'
             OR lower(COALESCE(c.invoice_ref, '')) LIKE '%' || v_q || '%' OR lower(COALESCE(c.party_challan_no, '')) LIKE '%' || v_q || '%')
      ORDER BY c.received_at DESC NULLS LAST LIMIT COALESCE(NULLIF(p_filter->>'limit', '')::int, 200)
    ) z), '[]'::jsonb)));
END $function$;
REVOKE EXECUTE ON FUNCTION public.mm_wh_list_receipts(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mm_wh_list_receipts(jsonb) TO authenticated;

-- Receipt detail: header + every roll as a full roll row (QC, finished, spec, colour, booking, custody)
CREATE OR REPLACE FUNCTION public.mm_wh_get_receipt(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_c public.mm_in_challans%ROWTYPE;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT * INTO v_c FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Receipt not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object(
    'receipt', to_jsonb(v_c) || jsonb_build_object(
      'source', COALESCE(v_c.receipt_source, CASE WHEN v_c.source = 'mill' THEN 'internal' ELSE 'external' END),
      'from', (SELECT jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind) FROM public.mm_facilities x WHERE x.id = v_c.from_facility_id),
      'fabric', (SELECT jsonb_build_object('id', fb.id, 'code', fb.code, 'name', fb.name, 'color_method', fb.color_method) FROM public.mm_fabrics fb WHERE fb.id = v_c.fabric_id),
      'stage_label', (SELECT s.label FROM public.mm_fabric_stages s WHERE s.factory_id = v_c.factory_id AND s.code = v_c.stage_code),
      'style', public._mm_style_label(v_c.style_material_id),
      'machine', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) FROM public.mm_machines m WHERE m.id = v_c.machine_id)),
    'rolls', COALESCE((SELECT jsonb_agg(public._mm_roll_row(u.roll_id, true) ORDER BY u.unit_code)
                       FROM public.mm_stock_units u WHERE u.in_challan_id = v_c.id AND u.roll_id IS NOT NULL), '[]'::jsonb),
    'tests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'result', t.result, 'tested_at', t.tested_at, 'origin', t.origin,
                         'roll_count', (SELECT count(*) FROM public.mm_qc_test_rolls tr WHERE tr.test_id = t.id)) ORDER BY t.tested_at DESC)
                       FROM public.mm_qc_tests t WHERE t.scope_kind = 'in_challan' AND t.scope_id = v_c.id AND t.voided_at IS NULL), '[]'::jsonb)
  ));
END $function$;
REVOKE EXECUTE ON FUNCTION public.mm_wh_get_receipt(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mm_wh_get_receipt(uuid) TO authenticated;
