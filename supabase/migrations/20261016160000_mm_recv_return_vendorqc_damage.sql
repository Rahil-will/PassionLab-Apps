-- =====================================================================
-- Receiving: process returns, QC at source, report damage (2026-10-16)
-- 1. Process return is a third Source on the Receive page. It calls mm_proc_return
--    (same rolls come back, stage / colour / qty updated, QC reset) and records a
--    receipt (receipt_source 'process_return') linked to the challan, so every gate
--    entry is in one receipts list. Roll fields come from the receiving form.
-- 2. Fabric vendors carry qc_at_source (none | tested | tested_inspected). When set,
--    the receive grid carries the vendor's test result + values per roll; they are
--    stored as vendor_certificate tests (and a vendor inspection) and now count.
-- 3. mm_report_damage: a roll in stock that got damaged is rejected (whole roll) or
--    has part of its qty written off. Rejected rolls go on through mm_disposition_rejected.
-- =====================================================================

-- ---------- constraints / columns ----------
ALTER TABLE public.mm_in_challans DROP CONSTRAINT IF EXISTS mm_in_challans_receipt_source_check;
ALTER TABLE public.mm_in_challans ADD CONSTRAINT mm_in_challans_receipt_source_check
  CHECK (receipt_source = ANY (ARRAY['internal', 'external', 'process_return']));
ALTER TABLE public.mm_in_challans ADD COLUMN IF NOT EXISTS process_challan_id uuid REFERENCES public.mm_process_challans(id);

ALTER TABLE public.mm_fabric_vendors ADD COLUMN IF NOT EXISTS qc_at_source text NOT NULL DEFAULT 'none';
ALTER TABLE public.mm_fabric_vendors DROP CONSTRAINT IF EXISTS mm_fabric_vendors_qc_at_source_check;
ALTER TABLE public.mm_fabric_vendors ADD CONSTRAINT mm_fabric_vendors_qc_at_source_check
  CHECK (qc_at_source IN ('none', 'tested', 'tested_inspected'));

ALTER TABLE public.mm_qc_inspections DROP CONSTRAINT IF EXISTS mm_qc_inspections_origin_check;
ALTER TABLE public.mm_qc_inspections ADD CONSTRAINT mm_qc_inspections_origin_check
  CHECK (origin = ANY (ARRAY['own', 'vendor_certificate', 'process_unit_report', 'migrated']));

CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 120); END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;

-- ===================== 1. process return through receiving =====================

-- the stock units on a receipt: rolls it created, or rolls that came back on it
CREATE OR REPLACE FUNCTION public._mm_receipt_units(p_receipt uuid)
 RETURNS TABLE (unit_id uuid, qty numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT u.id, u.qty_received FROM public.mm_stock_units u WHERE u.in_challan_id = p_receipt
  UNION ALL
  SELECT rl.stock_unit_id, rl.qty FROM public.mm_process_return_lines rl
  JOIN public.mm_process_returns pr ON pr.id = rl.return_id
  WHERE pr.in_challan_id = p_receipt AND rl.stock_unit_id IS NOT NULL
$function$;

-- open process challans to pick on the Receive page
CREATE OR REPLACE FUNCTION public.mm_recv_process_challans(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_q text := lower(NULLIF(btrim(COALESCE(p_filter->>'search', '')), ''));
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(x.row ORDER BY x.sent_at DESC) FROM (
      SELECT c.sent_at, jsonb_build_object(
        'id', c.id, 'challan_no', c.challan_no, 'sent_at', c.sent_at, 'unit_ref_no', c.unit_ref_no,
        'unit', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'ownership', v.ownership) FROM public.mm_processing_vendors v WHERE v.id = c.unit_facility_id),
        'process', (SELECT t.name FROM public.mm_process_types t WHERE t.id = c.process_type_id),
        'target_color', c.target_color, 'target_shade', c.target_shade,
        'fabric', (SELECT jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name, 'fabric_type_id', f.fabric_type_id)
                   FROM public.mm_process_out_lines l JOIN public.mm_rolls r ON r.id = l.roll_id JOIN public.mm_fabrics f ON f.id = r.fabric_id
                   WHERE l.challan_id = c.id LIMIT 1),
        'rolls_out', (SELECT count(*) FROM public.mm_process_out_lines l WHERE l.challan_id = c.id AND l.line_status = 'out'),
        'qty_out', (SELECT COALESCE(sum(l.qty), 0) FROM public.mm_process_out_lines l WHERE l.challan_id = c.id AND l.line_status = 'out'),
        'uom', (SELECT max(l.uom) FROM public.mm_process_out_lines l WHERE l.challan_id = c.id)) AS row
      FROM public.mm_process_challans c
      WHERE c.factory_id = v_factory AND c.status NOT IN ('returned', 'void') AND c.voided_at IS NULL
        AND EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.challan_id = c.id AND l.line_status = 'out')
        AND (v_q IS NULL OR lower(c.challan_no) LIKE '%' || v_q || '%' OR lower(COALESCE(c.unit_ref_no, '')) LIKE '%' || v_q || '%'
             OR EXISTS (SELECT 1 FROM public.mm_processing_vendors v WHERE v.id = c.unit_facility_id AND lower(v.name) LIKE '%' || v_q || '%'))
      LIMIT 200) x), '[]'::jsonb)));
END $function$;

-- one open challan: header, the rolls still out, and the receiving form for its fabric type
CREATE OR REPLACE FUNCTION public.mm_recv_get_process_challan(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_c public.mm_process_challans%ROWTYPE; v_ft uuid; v_fab jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT * INTO v_c FROM public.mm_process_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  SELECT f.fabric_type_id, jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name, 'fabric_type_id', f.fabric_type_id, 'uom', f.uom)
    INTO v_ft, v_fab
  FROM public.mm_process_out_lines l JOIN public.mm_rolls r ON r.id = l.roll_id JOIN public.mm_fabrics f ON f.id = r.fabric_id
  WHERE l.challan_id = v_c.id LIMIT 1;
  RETURN public._mm_ok(jsonb_build_object(
    'challan', jsonb_build_object('id', v_c.id, 'challan_no', v_c.challan_no, 'sent_at', v_c.sent_at, 'status', v_c.status,
      'unit_ref_no', v_c.unit_ref_no, 'purpose', v_c.purpose, 'target_color', v_c.target_color, 'target_shade', v_c.target_shade,
      'unit', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'ownership', v.ownership) FROM public.mm_processing_vendors v WHERE v.id = v_c.unit_facility_id),
      'process', (SELECT jsonb_build_object('id', t.id, 'name', t.name, 'output_stage_code', t.output_stage_code) FROM public.mm_process_types t WHERE t.id = v_c.process_type_id),
      'fabric', v_fab),
    'rolls', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'out_line_id', l.id, 'roll_id', l.roll_id, 'stock_unit_id', l.stock_unit_id, 'roll_code', l.unit_code,
        'qty_sent', l.qty, 'uom', l.uom, 'qty_kg_sent', l.qty_kg,
        'color', COALESCE(NULLIF(btrim(v_c.target_color), ''), l.color_ref), 'shade', l.shade,
        'dye_lot', (SELECT r.dye_lot FROM public.mm_rolls r WHERE r.id = l.roll_id)) ORDER BY l.unit_code)
      FROM public.mm_process_out_lines l WHERE l.challan_id = v_c.id AND l.line_status = 'out'), '[]'::jsonb),
    'form', public._mm_receipt_form_json(v_factory, v_ft)));
END $function$;

-- mm_proc_return may be called by the receiving team through mm_wh_receive (warehouse permission)
SELECT pg_temp.fx('mm_proc_return',
  $o$  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');$o$,
  $n$  BEGIN v_factory := public._mm_require_ops(CASE WHEN current_setting('mm.recv_process_return', true) = '1' THEN 'mm_wh_ops' ELSE 'mm_proc_ops' END);$n$);

-- the process-return branch of mm_wh_receive
-- payload: { source:'process_return', process_challan_id, party_challan_no, po_no, received_at, remarks, field_values,
--            rolls: [{ out_line_id, qty | length_m | weight_kg, values: {color, shade, dye_lot, …custom} }] }
-- A roll with no qty is not back yet (stays on the challan).
CREATE OR REPLACE FUNCTION public._mm_wh_receive_process_return(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_actor uuid; v_ch public.mm_process_challans%ROWTYPE; v_unit_name text; v_ft uuid; v_fab uuid;
  v_r jsonb; v_line public.mm_process_out_lines%ROWTYPE; v_vals jsonb; v_err text; v_same jsonb := '[]'::jsonb; v_attr jsonb := '[]'::jsonb;
  v_qty numeric; v_kg boolean; v_res jsonb; v_no text; v_rc uuid; v_on date; v_fv jsonb; v_stage text; v_seen uuid[] := '{}';
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  BEGIN
    SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = NULLIF(p_payload->>'process_challan_id', '')::uuid AND factory_id = v_factory FOR UPDATE;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid challan'); END;
  IF v_ch.id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Pick the process challan'); END IF;
  IF v_ch.status IN ('returned', 'void') OR v_ch.voided_at IS NOT NULL THEN RETURN public._mm_err('CLOSED', v_ch.challan_no || ' is closed'); END IF;
  SELECT v.name INTO v_unit_name FROM public.mm_processing_vendors v WHERE v.id = v_ch.unit_facility_id;
  SELECT r.fabric_id, f.fabric_type_id INTO v_fab, v_ft
  FROM public.mm_process_out_lines l JOIN public.mm_rolls r ON r.id = l.roll_id JOIN public.mm_fabrics f ON f.id = r.fabric_id
  WHERE l.challan_id = v_ch.id LIMIT 1;

  v_fv := CASE WHEN jsonb_typeof(p_payload->'field_values') = 'object' THEN jsonb_strip_nulls(p_payload->'field_values') ELSE '{}'::jsonb END;
  v_err := public._mm_receipt_form_check(v_factory, v_ft, 'receipt', v_fv, NULL);
  IF v_err IS NOT NULL THEN RETURN public._mm_err('INVALID', v_err); END IF;
  IF jsonb_typeof(COALESCE(p_payload->'rolls', 'null'::jsonb)) <> 'array' THEN RETURN public._mm_err('REQUIRED', 'Enter what came back'); END IF;

  FOR v_r IN SELECT * FROM jsonb_array_elements(p_payload->'rolls') LOOP
    v_r := public._mm_receipt_roll_flat(v_r);
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = NULLIF(v_r->>'out_line_id', '')::uuid AND challan_id = v_ch.id;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A roll is not on ' || v_ch.challan_no); END IF;
    IF v_line.line_status <> 'out' THEN RETURN public._mm_err('INVALID', v_line.unit_code || ' is already back'); END IF;
    IF v_line.id = ANY (v_seen) THEN RETURN public._mm_err('INVALID', v_line.unit_code || ' is listed twice'); END IF;
    v_seen := v_seen || v_line.id;
    v_kg := lower(COALESCE(v_line.uom, '')) IN ('kg', 'kgs');
    BEGIN
      v_qty := COALESCE(NULLIF(v_r->>'qty', '')::numeric, CASE WHEN v_kg THEN NULLIF(v_r->>'weight_kg', '')::numeric ELSE NULLIF(v_r->>'length_m', '')::numeric END);
    EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', v_line.unit_code || ': qty is not a number'); END;
    CONTINUE WHEN v_qty IS NULL;
    IF v_qty <= 0 THEN RETURN public._mm_err('INVALID', v_line.unit_code || ': qty back must be greater than zero'); END IF;
    v_vals := CASE WHEN jsonb_typeof(v_r->'values') = 'object' THEN v_r->'values' ELSE '{}'::jsonb END;
    v_err := public._mm_receipt_form_check(v_factory, v_ft, 'roll', v_vals, v_line.unit_code);
    IF v_err IS NOT NULL THEN RETURN public._mm_err('INVALID', v_err); END IF;
    v_same := v_same || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'out_line_id', v_line.id, 'qty', v_qty, 'qty_kg', CASE WHEN v_kg THEN v_qty END,
      'shade', NULLIF(btrim(COALESCE(v_r->>'shade', '')), ''), 'color_ref', NULLIF(btrim(COALESCE(v_r->>'color', '')), ''),
      'dye_lot', NULLIF(btrim(COALESCE(v_r->>'dye_lot', '')), ''))));
    v_attr := v_attr || jsonb_build_array(jsonb_build_object('unit', v_line.stock_unit_id, 'values', jsonb_strip_nulls(v_vals)));
  END LOOP;
  IF jsonb_array_length(v_same) = 0 THEN RETURN public._mm_err('REQUIRED', 'Enter the qty back for at least one roll'); END IF;

  v_on := COALESCE(NULLIF(p_payload->>'received_at', '')::date, CURRENT_DATE);
  PERFORM set_config('mm.recv_process_return', '1', true);
  v_res := public.mm_proc_return(jsonb_build_object('challan_id', v_ch.id,
    'return_no', NULLIF(btrim(COALESCE(p_payload->>'party_challan_no', '')), ''),
    'returned_at', v_on, 'remarks', NULLIF(btrim(COALESCE(p_payload->>'remarks', '')), ''), 'same_rolls', v_same));
  PERFORM set_config('mm.recv_process_return', '', true);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN RETURN v_res; END IF;

  v_stage := (SELECT t.output_stage_code FROM public.mm_process_types t WHERE t.id = v_ch.process_type_id);
  v_no := public._mm_next_grn_no(v_factory, v_on);
  INSERT INTO public.mm_in_challans (factory_id, challan_no, grn_no, source, supplier_name, party_challan_no, po_no,
    status, received_at, received_by, created_by, updated_by, remarks, receipt_source, purpose,
    fabric_id, stage_code, color_ref, field_values, process_challan_id)
  VALUES (v_factory, v_no, v_no, 'vendor', COALESCE(v_unit_name, 'Process unit'),
    NULLIF(btrim(COALESCE(p_payload->>'party_challan_no', '')), ''), NULLIF(btrim(COALESCE(p_payload->>'po_no', '')), ''),
    'received', v_on::timestamptz, v_actor, v_actor, v_actor, NULLIF(btrim(COALESCE(p_payload->>'remarks', '')), ''),
    'process_return', CASE WHEN v_ch.purpose IN ('style', 'stock', 'open_po') THEN v_ch.purpose ELSE 'stock' END,
    v_fab, v_stage, NULLIF(btrim(COALESCE(v_ch.target_color, '')), ''), v_fv, v_ch.id)
  RETURNING id INTO v_rc;
  UPDATE public.mm_process_returns SET in_challan_id = v_rc WHERE id = (v_res->'data'->>'return_id')::uuid;
  UPDATE public.mm_stock_units u SET attributes = COALESCE(u.attributes, '{}'::jsonb) || (a->'values'), updated_at = now()
  FROM jsonb_array_elements(v_attr) a
  WHERE u.id = (a->>'unit')::uuid AND a->'values' <> '{}'::jsonb;

  RETURN public._mm_ok(jsonb_build_object('id', v_rc, 'grn_no', v_no, 'roll_count', jsonb_array_length(v_same),
    'return_id', v_res->'data'->'return_id', 'return_no', v_res->'data'->'return_no', 'process_challan_id', v_ch.id,
    'challan_status', (SELECT status FROM public.mm_process_challans WHERE id = v_ch.id)));
EXCEPTION WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
END $function$;
REVOKE EXECUTE ON FUNCTION public._mm_wh_receive_process_return(jsonb), public._mm_receipt_units(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_recv_process_challans(jsonb), public.mm_recv_get_process_challan(uuid) TO authenticated;

SELECT pg_temp.fx('mm_wh_receive',
  $o$  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');$o$,
  $n$  IF lower(COALESCE(p_payload->>'source', '')) = 'process_return' THEN RETURN public._mm_wh_receive_process_return(p_payload); END IF;
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');$n$);

-- receipts list + detail: rolls of a process-return receipt are the rolls that came back on it
SELECT pg_temp.fx('mm_wh_list_receipts',
  $o$'rolls', (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id),$o$,
  $n$'rolls', (SELECT count(*) FROM public._mm_receipt_units(c.id)),$n$);
SELECT pg_temp.fx('mm_wh_list_receipts',
  $o$'qty', (SELECT COALESCE(sum(u.qty_received), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id),$o$,
  $n$'qty', (SELECT COALESCE(sum(ru.qty), 0) FROM public._mm_receipt_units(c.id) ru),
        'process_challan', (SELECT jsonb_build_object('id', pc.id, 'no', pc.challan_no) FROM public.mm_process_challans pc WHERE pc.id = c.process_challan_id),$n$);
SELECT pg_temp.fx('mm_wh_list_receipts', $o$u.in_challan_id = c.id$o$, $n$u.id IN (SELECT ru.unit_id FROM public._mm_receipt_units(c.id) ru)$n$, 3);
SELECT pg_temp.fx('mm_wh_get_receipt', $o$u.in_challan_id = v_c.id$o$, $n$u.id IN (SELECT ru.unit_id FROM public._mm_receipt_units(v_c.id) ru)$n$);
SELECT pg_temp.fx('mm_wh_get_receipt',
  $o$    'form', public._mm_receipt_form_json($o$,
  $n$    'process_challan', (SELECT jsonb_build_object('id', pc.id, 'no', pc.challan_no, 'status', pc.status,
                          'process', (SELECT t.name FROM public.mm_process_types t WHERE t.id = pc.process_type_id))
                        FROM public.mm_process_challans pc WHERE pc.id = v_c.process_challan_id),
    'form', public._mm_receipt_form_json($n$);

-- ===================== 2. QC at source (vendor-tested rolls) =====================

-- vendor tests and inspections count like your own
SELECT pg_temp.fx('_mm_qc_passport', $o$origin IN ('own','migrated')$o$, $n$origin IN ('own','migrated','vendor_certificate')$n$, 2);

SELECT pg_temp.fx('mm_list_partners',
  $o$      'fabric_type_ids', to_jsonb(v.fabric_type_ids),$o$,
  $n$      'fabric_type_ids', to_jsonb(v.fabric_type_ids), 'qc_at_source', v.qc_at_source,$n$);
SELECT pg_temp.fx('mm_save_partner',
  $o$  IF p_row ? 'fabric_type_ids' THEN$o$,
  $n$  IF p_row ? 'qc_at_source' AND COALESCE(p_row->>'qc_at_source', '') NOT IN ('none', 'tested', 'tested_inspected') THEN
    RETURN public._mm_err('INVALID', 'QC at source must be none, tested or tested_inspected');
  END IF;
  IF p_row ? 'fabric_type_ids' THEN$n$);
SELECT pg_temp.fx('mm_save_partner',
  $o$fabric_type_ids, contact, address, is_active, created_by, updated_by)$o$,
  $n$fabric_type_ids, qc_at_source, contact, address, is_active, created_by, updated_by)$n$);
SELECT pg_temp.fx('mm_save_partner',
  $o$v_name, v_own, COALESCE(v_pts, '{}'), v_contact,$o$,
  $n$v_name, v_own, COALESCE(v_pts, '{}'), COALESCE(NULLIF(p_row->>'qc_at_source', ''), 'none'), v_contact,$n$);
SELECT pg_temp.fx('mm_save_partner',
  $o$fabric_type_ids = COALESCE(v_pts, fabric_type_ids),$o$,
  $n$fabric_type_ids = COALESCE(v_pts, fabric_type_ids), qc_at_source = COALESCE(NULLIF(p_row->>'qc_at_source', ''), qc_at_source),$n$);

-- test values against the testing parameters (unknown keys are refused)
CREATE OR REPLACE FUNCTION public._mm_test_values_check(p_type_id uuid, p_values jsonb, p_roll text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE k text; v jsonb; f public.mm_type_test_fields%ROWTYPE;
BEGIN
  IF jsonb_typeof(COALESCE(p_values, '{}'::jsonb)) <> 'object' THEN RETURN 'Roll ' || p_roll || ': test values must be an object'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(p_values, '{}'::jsonb)) LOOP
    CONTINUE WHEN v = 'null'::jsonb OR (jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '');
    SELECT * INTO f FROM public.mm_type_test_fields WHERE type_id = p_type_id AND key = k AND is_active;
    IF NOT FOUND THEN RETURN 'Roll ' || p_roll || ': unknown test field ' || k; END IF;
    IF f.data_type IN ('number', 'decimal') AND public._mm_safe_numeric(v #>> '{}') IS NULL THEN RETURN 'Roll ' || p_roll || ': ' || f.label || ' must be a number'; END IF;
    IF f.data_type = 'checkbox' AND jsonb_typeof(v) <> 'boolean' THEN RETURN 'Roll ' || p_roll || ': ' || f.label || ' must be ticked or not'; END IF;
  END LOOP;
  RETURN NULL;
END $function$;

-- store the vendor's results for a new receipt (one session); inspection too when the vendor inspects
CREATE OR REPLACE FUNCTION public._mm_receipt_source_qc(p_receipt uuid, p_units uuid[], p_rows jsonb, p_mode text)
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_c public.mm_in_challans%ROWTYPE; v_session uuid := gen_random_uuid(); v_i int; v_u record; v_row jsonb; v_tid uuid; v_n int := 0;
  v_actor uuid := public._mm_actor_id();
BEGIN
  IF COALESCE(p_mode, 'none') = 'none' OR p_units IS NULL THEN RETURN 0; END IF;
  SELECT * INTO v_c FROM public.mm_in_challans WHERE id = p_receipt;
  FOR v_i IN 1 .. array_length(p_units, 1) LOOP
    v_row := p_rows -> (v_i - 1);
    SELECT u.roll_id, u.fabric_type_id, r.stage_code, COALESCE(r.process_round, 0) AS round INTO v_u
    FROM public.mm_stock_units u JOIN public.mm_rolls r ON r.id = u.roll_id WHERE u.id = p_units[v_i];
    CONTINUE WHEN v_u.roll_id IS NULL;
    INSERT INTO public.mm_qc_tests (factory_id, scope_kind, scope_id, site_side, stage_code, fabric_type_id, field_values, result,
      origin, tested_at, remarks, created_by, session_id)
    VALUES (v_c.factory_id, 'in_challan', p_receipt, 'warehouse', v_u.stage_code, v_u.fabric_type_id,
      COALESCE(jsonb_strip_nulls(v_row->'test'->'values'), '{}'::jsonb), lower(v_row->'test'->>'result'),
      'vendor_certificate', COALESCE(v_c.received_at, now()), 'Vendor test report', v_actor, v_session)
    RETURNING id INTO v_tid;
    INSERT INTO public.mm_qc_test_rolls (factory_id, test_id, roll_id, round_at_test) VALUES (v_c.factory_id, v_tid, v_u.roll_id, v_u.round);
    IF p_mode = 'tested_inspected' THEN
      INSERT INTO public.mm_qc_inspections (factory_id, roll_id, round_at_inspection, site_side, stage_code, length_uom, width_uom,
        pts_1, pts_2, pts_3, pts_4, total_points, result, origin, inspected_at, remarks, created_by)
      VALUES (v_c.factory_id, v_u.roll_id, v_u.round, 'warehouse', v_u.stage_code, 'm', 'in', 0, 0, 0, 0, 0, 'pass',
        'vendor_certificate', COALESCE(v_c.received_at, now()), 'Inspected by vendor', v_actor);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE EXECUTE ON FUNCTION public._mm_test_values_check(uuid, jsonb, text), public._mm_receipt_source_qc(uuid, uuid[], jsonb, text) FROM PUBLIC, anon;

-- receive: when the vendor tests at source, each roll needs the vendor's result (+ optional values)
SELECT pg_temp.fx('mm_wh_receive',
  $o$    IF v_err IS NOT NULL THEN RETURN public._mm_err('INVALID', v_err); END IF;
    IF v_code IS NOT NULL THEN$o$,
  $n$    IF v_err IS NOT NULL THEN RETURN public._mm_err('INVALID', v_err); END IF;
    IF v_from.qc_at_source <> 'none' THEN
      IF lower(COALESCE(v_r->'test'->>'result', '')) NOT IN ('pass', 'hold', 'fail') THEN
        RETURN public._mm_err('REQUIRED', 'Roll ' || COALESCE(v_code, '?') || ': set the vendor test result');
      END IF;
      v_err := public._mm_test_values_check(f.fabric_type_id, COALESCE(v_r->'test'->'values', '{}'::jsonb), COALESCE(v_code, '?'));
      IF v_err IS NOT NULL THEN RETURN public._mm_err('INVALID', v_err); END IF;
    END IF;
    IF v_code IS NOT NULL THEN$n$);
SELECT pg_temp.fx('mm_wh_receive',
  $o$  v_tests := public._mm_wh_receipt_qc_from_attrs(v_ch);$o$,
  $n$  v_tests := public._mm_receipt_source_qc(v_ch, v_units, p_payload->'rolls', v_from.qc_at_source);
  v_tests := v_tests + public._mm_wh_receipt_qc_from_attrs(v_ch);$n$);

-- ===================== 3. report damage =====================
-- payload: { roll_ids: uuid[] (mm_rolls ids), reason, qty? (only with one roll: part damaged) }
-- whole roll: status rejected + on hold "Damaged: <reason>", then use mm_disposition_rejected
--             (return to supplier / write off / accept deviation).
-- part (qty < on hand): that qty is written off, the roll stays in stock.
CREATE OR REPLACE FUNCTION public.mm_report_damage(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_actor uuid; v_reason text; v_qty numeric; v_ids uuid[]; v_id uuid; v_u public.mm_stock_units%ROWTYPE;
  v_code text; v_n int := 0; v_units jsonb := '[]'::jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  v_reason := NULLIF(btrim(COALESCE(p_payload->>'reason', '')), '');
  IF v_reason IS NULL THEN RETURN public._mm_err('REQUIRED', 'Say what is damaged'); END IF;
  BEGIN
    v_ids := ARRAY(SELECT DISTINCT (x)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'roll_ids', '[]'::jsonb)) x);
    v_qty := NULLIF(p_payload->>'qty', '')::numeric;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid roll or qty'); END;
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN RETURN public._mm_err('REQUIRED', 'Select the damaged rolls'); END IF;
  IF v_qty IS NOT NULL AND array_length(v_ids, 1) > 1 THEN RETURN public._mm_err('INVALID', 'A damaged qty is for one roll at a time'); END IF;
  IF v_qty IS NOT NULL AND v_qty <= 0 THEN RETURN public._mm_err('INVALID', 'Damaged qty must be greater than zero'); END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT u.* INTO v_u FROM public.mm_stock_units u WHERE u.roll_id = v_id AND u.factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    v_code := v_u.unit_code;
    IF v_u.status NOT IN ('in_stock', 'pending_qc') THEN RETURN public._mm_err('INVALID', v_code || ' is not in the warehouse'); END IF;
    IF v_qty IS NOT NULL AND v_qty < COALESCE(v_u.qty_available, 0) - 0.001 THEN
      PERFORM public._mm_ledger(v_factory, v_u.id, 'ADJUST_MINUS', v_qty, v_u.status, v_u.status, v_u.current_location_id, v_u.current_location_id,
        'mm_stock_units', v_u.id, 'Damaged: ' || v_reason);
      v_units := v_units || jsonb_build_object('roll_id', v_id, 'stock_unit_id', v_u.id, 'roll_code', v_code, 'written_off', v_qty, 'rejected', false);
    ELSE
      UPDATE public.mm_stock_units SET status = 'rejected', on_hold = true, hold_reason = 'Damaged: ' || v_reason,
        hold_by = v_actor, hold_at = now(), row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_u.id;
      PERFORM public._mm_ledger(v_factory, v_u.id, 'QC_REJECT', 0, v_u.status, 'rejected', v_u.current_location_id, v_u.current_location_id,
        'mm_stock_units', v_u.id, 'Damaged: ' || v_reason);
      v_units := v_units || jsonb_build_object('roll_id', v_id, 'stock_unit_id', v_u.id, 'roll_code', v_code, 'written_off', 0, 'rejected', true);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('count', v_n, 'rolls', v_units));
EXCEPTION WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
END $function$;
GRANT EXECUTE ON FUNCTION public.mm_report_damage(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------- follow-ups applied live (2026-10-16) ----------
-- mm_fix_supplier_return_doc_no: mm_disposition_rejected used next_doc_no('SR'), which only knows
--   GRN / MV / ROLL / PACK / SC, so every "return to supplier" failed. Now _mm_next_doc(v_factory, 'SR').
-- mm_report_damage_red_label: a rejected roll must sit at a 'rejected' location (state guard), so
--   mm_report_damage moves the whole damaged roll to the red label location (WAREHOUSE_REDLABEL).
-- mm_floor_call_receiving: mm_floor_call allowlist + mm_get_receipt_form, mm_wh_receive, mm_recv_process_challans,
--   mm_recv_get_process_challan, mm_list_partners, mm_list_fabrics, mm_get_v4_config, mm_wh_list_receipts,
--   mm_wh_get_receipt, mm_report_damage (mobile receiving team).
