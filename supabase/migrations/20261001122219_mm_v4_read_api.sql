-- Fabric v4 · 6/6 · Read API for the UI (lists, details, queues, readiness, reports)

CREATE OR REPLACE FUNCTION public._mm_roll_row(p_roll_id uuid, p_with_passport boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_r public.mm_rolls%ROWTYPE; v_c jsonb; v_pp jsonb; v_m jsonb; v_sm uuid; v_qty numeric; v_kg numeric; v_extra jsonb;
BEGIN
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = p_roll_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_c := public._mm_roll_custody(v_r.id);
  v_sm := NULLIF(v_c->>'style_material_id','')::uuid;
  IF v_c->>'side' = 'processing' THEN
    v_sm := COALESCE((SELECT style_material_id FROM public.mm_stock_units WHERE roll_id = v_r.id),
                     (SELECT style_material_id FROM public.mm_mill_rolls WHERE roll_id = v_r.id));
  END IF;
  SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) INTO v_m FROM public.mm_machines m WHERE m.id = v_r.machine_id;
  SELECT COALESCE(u.length_m, mr.length_m), COALESCE(u.weight_kg, mr.weight_kg),
         jsonb_build_object('shade', COALESCE(u.shade, mr.shade), 'lot_no', COALESCE(u.lot_no, mr.lot_no), 'color_ref', COALESCE(u.color_ref, mr.color_ref),
                            'mill_roll_id', mr.id, 'stock_unit_id', u.id, 'qty_available', u.qty_available, 'uom', COALESCE(u.qty_uom, u.uom, 'm'))
    INTO v_qty, v_kg, v_extra
  FROM public.mm_rolls r LEFT JOIN public.mm_stock_units u ON u.roll_id = r.id LEFT JOIN public.mm_mill_rolls mr ON mr.roll_id = r.id
  WHERE r.id = v_r.id;
  IF p_with_passport THEN v_pp := public._mm_qc_passport(v_r.id); END IF;
  RETURN jsonb_build_object(
    'roll_id', v_r.id, 'roll_code', v_r.roll_code, 'origin', v_r.origin, 'mill_batch_id', v_r.mill_batch_id,
    'batch_no', (SELECT batch_no FROM public.mm_mill_batches WHERE id = v_r.mill_batch_id),
    'fabric_type_id', v_r.fabric_type_id, 'fabric_type_name', (SELECT name FROM public.mm_fabric_types WHERE id = v_r.fabric_type_id),
    'machine', v_m, 'shift', v_r.shift, 'produced_at', v_r.produced_at,
    'stage_code', v_r.stage_code, 'unit_form', v_r.unit_form, 'width_form', v_r.width_form, 'grade', v_r.grade, 'dye_lot', v_r.dye_lot,
    'process_round', v_r.process_round, 'length_m', v_qty, 'weight_kg', v_kg,
    'custody', v_c, 'style', public._mm_style_label(v_sm),
    'test_status', v_pp->'test'->>'status', 'inspection_status', v_pp->'inspection'->>'status',
    'missing_keys', v_pp->'test'->'missing_keys',
    'parent_codes', COALESCE((SELECT jsonb_agg(p.roll_code) FROM public.mm_roll_lineage l JOIN public.mm_rolls p ON p.id = l.parent_roll_id
                              WHERE l.child_roll_id = v_r.id), '[]'::jsonb)
  ) || v_extra;
END $$;

-- ── Roll finder for pickers ──
-- filter: { side?:'mill'|'warehouse', batch_id?, style_material_id?, unallocated?:bool, stage_code?, fabric_type_id?, search?,
--           available_for?:'process'|'dispatch'|'test'|'cut', limit? }
CREATE OR REPLACE FUNCTION public.mm_list_rolls_v4(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_side text; v_for text; v_q text; v_lim int; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_side := NULLIF(p_filter->>'side',''); v_for := NULLIF(p_filter->>'available_for','');
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search',''))), ''); v_lim := LEAST(COALESCE((p_filter->>'limit')::int, 300), 1000);
  SELECT COALESCE(jsonb_agg(public._mm_roll_row(x.id) ORDER BY x.roll_code), '[]'::jsonb) INTO v_rows FROM (
    SELECT r.id, r.roll_code FROM public.mm_rolls r
    LEFT JOIN public.mm_mill_rolls m ON m.roll_id = r.id
    LEFT JOIN public.mm_stock_units u ON u.roll_id = r.id
    WHERE r.factory_id = v_factory
      AND (v_side IS NULL OR (v_side = 'mill' AND m.id IS NOT NULL AND u.id IS NULL) OR (v_side = 'warehouse' AND u.id IS NOT NULL))
      AND (NULLIF(p_filter->>'batch_id','') IS NULL OR r.mill_batch_id = (p_filter->>'batch_id')::uuid)
      AND (NULLIF(p_filter->>'fabric_type_id','') IS NULL OR r.fabric_type_id = (p_filter->>'fabric_type_id')::uuid)
      AND (NULLIF(p_filter->>'stage_code','') IS NULL OR r.stage_code = upper(p_filter->>'stage_code'))
      AND (NULLIF(p_filter->>'style_material_id','') IS NULL OR COALESCE(u.style_material_id, m.style_material_id) = (p_filter->>'style_material_id')::uuid)
      AND (NOT COALESCE((p_filter->>'unallocated')::boolean, false) OR COALESCE(u.style_material_id, m.style_material_id) IS NULL)
      AND (v_q IS NULL OR lower(r.roll_code) LIKE '%' || v_q || '%' OR lower(COALESCE(r.dye_lot,'')) LIKE '%' || v_q || '%')
      AND (v_for IS NULL
        OR (v_for = 'process' AND NOT EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = r.id AND l.line_status = 'out')
            AND ((u.id IS NULL AND m.status = 'draft' AND m.in_challan_id IS NULL) OR (u.status IN ('in_stock','pending_qc') AND NOT COALESCE(u.on_hold,false) AND u.qty_available > 0)))
        OR (v_for = 'dispatch' AND u.id IS NULL AND m.status = 'draft' AND m.in_challan_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = r.id AND l.line_status = 'out'))
        OR (v_for = 'test' AND public._mm_roll_alive(r.id))
        OR (v_for = 'cut' AND u.status = 'in_stock'))
    ORDER BY r.roll_code LIMIT v_lim) x;
  RETURN public._mm_ok(jsonb_build_object('rows', v_rows));
END $$;

-- ── Mill ──
CREATE OR REPLACE FUNCTION public.mm_mill_list_batches_v4(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_q text; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_mill_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search',''))), '');
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'production_date') DESC NULLS LAST, row->>'batch_no'), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', b.id, 'batch_no', b.batch_no, 'batch_kind', b.batch_kind, 'mill_ref', b.mill_ref, 'production_date', b.production_date,
      'facility', (SELECT jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name) FROM public.mm_facilities f WHERE f.id = b.facility_id),
      'fabric_type_id', b.fabric_type_id, 'fabric_type_name', ft.name, 'color_ref', b.color_ref, 'fabric_ref_name', b.fabric_ref_name,
      'initial_stage_code', b.initial_stage_code, 'yarn_lot', b.yarn_lot, 'yarn_count', b.yarn_count,
      'style', public._mm_style_label(b.style_material_id),
      'intents', COALESCE((SELECT jsonb_agg(public._mm_style_label(i.style_material_id)) FROM public.mm_mill_batch_style_intents i WHERE i.batch_id = b.id), '[]'::jsonb),
      'counts', (SELECT jsonb_build_object(
          'total', count(*),
          'at_mill', count(*) FILTER (WHERE mr.status = 'draft' AND NOT EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = mr.roll_id AND l.line_status = 'out')),
          'at_process', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = mr.roll_id AND l.line_status = 'out')),
          'dispatched', count(*) FILTER (WHERE mr.status = 'dispatched'),
          'closed', count(*) FILTER (WHERE mr.status IN ('processed','written_off')),
          'unallocated_at_mill', count(*) FILTER (WHERE mr.status = 'draft' AND mr.style_material_id IS NULL),
          'qty_m', COALESCE(sum(mr.length_m) FILTER (WHERE mr.status = 'draft'), 0),
          'qty_kg', COALESCE(sum(mr.weight_kg) FILTER (WHERE mr.status = 'draft'), 0))
        FROM public.mm_mill_rolls mr WHERE mr.mill_batch_id = b.id),
      'stages', COALESCE((SELECT jsonb_object_agg(s.stage_code, s.n) FROM (SELECT r.stage_code, count(*) n FROM public.mm_rolls r
                  JOIN public.mm_mill_rolls mr ON mr.roll_id = r.id WHERE mr.mill_batch_id = b.id AND mr.status = 'draft' GROUP BY 1) s), '{}'::jsonb),
      'machines', COALESCE((SELECT jsonb_agg(DISTINCT m.code) FROM public.mm_rolls r JOIN public.mm_machines m ON m.id = r.machine_id
                  WHERE r.mill_batch_id = b.id), '[]'::jsonb),
      'created_at', b.created_at) AS row
    FROM public.mm_mill_batches b LEFT JOIN public.mm_fabric_types ft ON ft.id = b.fabric_type_id
    WHERE b.factory_id = v_factory
      AND (NULLIF(p_filter->>'facility_id','') IS NULL OR b.facility_id = (p_filter->>'facility_id')::uuid)
      AND (NULLIF(p_filter->>'batch_kind','') IS NULL OR b.batch_kind = p_filter->>'batch_kind')
      AND (NULLIF(p_filter->>'fabric_type_id','') IS NULL OR b.fabric_type_id = (p_filter->>'fabric_type_id')::uuid)
      AND (v_q IS NULL OR lower(b.batch_no) LIKE '%'||v_q||'%' OR lower(COALESCE(b.mill_ref,'')) LIKE '%'||v_q||'%'
           OR lower(COALESCE(b.color_ref,'')) LIKE '%'||v_q||'%')
  ) z;
  RETURN public._mm_ok(jsonb_build_object('rows', v_rows));
END $$;

CREATE OR REPLACE FUNCTION public.mm_mill_get_batch_v4(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_b public.mm_mill_batches%ROWTYPE;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_mill_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT * INTO v_b FROM public.mm_mill_batches WHERE id = p_batch_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Batch not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object(
    'batch', to_jsonb(v_b) || jsonb_build_object(
      'facility', (SELECT jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name) FROM public.mm_facilities f WHERE f.id = v_b.facility_id),
      'fabric_type_name', (SELECT name FROM public.mm_fabric_types WHERE id = v_b.fabric_type_id),
      'style', public._mm_style_label(v_b.style_material_id)),
    'intents', COALESCE((SELECT jsonb_agg(public._mm_style_label(i.style_material_id)) FROM public.mm_mill_batch_style_intents i WHERE i.batch_id = v_b.id), '[]'::jsonb),
    'rolls', COALESCE((SELECT jsonb_agg(public._mm_roll_row(r.id) ORDER BY r.roll_code) FROM public.mm_rolls r WHERE r.mill_batch_id = v_b.id), '[]'::jsonb),
    'process_challans', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', c.id, 'challan_no', c.challan_no, 'status', c.status,
          'purpose', c.purpose, 'process', t.name, 'unit', f.name, 'sent_at', c.sent_at))
        FROM public.mm_process_out_lines l JOIN public.mm_process_challans c ON c.id = l.challan_id
        JOIN public.mm_rolls r ON r.id = l.roll_id LEFT JOIN public.mm_process_types t ON t.id = c.process_type_id
        LEFT JOIN public.mm_facilities f ON f.id = c.unit_facility_id WHERE r.mill_batch_id = v_b.id), '[]'::jsonb),
    'tests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'result', t.result, 'tested_at', t.tested_at, 'stage_code', t.stage_code,
          'field_values', t.field_values, 'site_side', t.site_side, 'voided', t.voided_at IS NOT NULL,
          'superseded', EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL)) ORDER BY t.tested_at DESC)
        FROM public.mm_qc_tests t WHERE t.scope_kind = 'mill_batch' AND t.scope_id = v_b.id), '[]'::jsonb)
  ));
END $$;

-- ── Processing ──
CREATE OR REPLACE FUNCTION public.mm_proc_list_challans(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_q text; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search',''))), '');
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'sent_at') DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
      'id', c.id, 'challan_no', c.challan_no, 'side', c.origin, 'status', c.status, 'purpose', c.purpose,
      'parent_challan_no', (SELECT p.challan_no FROM public.mm_process_challans p WHERE p.id = c.parent_challan_id),
      'reprocess_reason', c.reprocess_reason, 'sent_at', c.sent_at, 'unit_ref_no', c.unit_ref_no,
      'unit', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'ownership', f.ownership) FROM public.mm_facilities f WHERE f.id = c.unit_facility_id),
      'legacy_vendor', (SELECT v.name FROM public.mm_process_vendors v WHERE v.id = c.vendor_id),
      'process_type', (SELECT jsonb_build_object('id', t.id, 'name', t.name, 'output_stage_code', t.output_stage_code) FROM public.mm_process_types t WHERE t.id = c.process_type_id),
      'counts', (SELECT jsonb_build_object('out', count(*), 'open', count(*) FILTER (WHERE l.line_status = 'out'),
          'returned', count(*) FILTER (WHERE l.line_status = 'returned'), 'replaced', count(*) FILTER (WHERE l.line_status = 'replaced'),
          'written_off', count(*) FILTER (WHERE l.line_status = 'written_off'),
          'qty_out', COALESCE(sum(l.qty) FILTER (WHERE l.line_status <> 'void'),0), 'kg_out', COALESCE(sum(l.qty_kg) FILTER (WHERE l.line_status <> 'void'),0))
        FROM public.mm_process_out_lines l WHERE l.challan_id = c.id),
      'qty_in', (SELECT COALESCE(sum(rl.qty),0) FROM public.mm_process_return_lines rl WHERE rl.challan_id = c.id),
      'kg_in', (SELECT COALESCE(sum(rl.qty_kg),0) FROM public.mm_process_return_lines rl WHERE rl.challan_id = c.id),
      'returns', (SELECT count(*) FROM public.mm_process_returns r WHERE r.challan_id = c.id),
      'tested', EXISTS (SELECT 1 FROM public.mm_qc_tests t WHERE t.scope_kind = 'process_challan' AND t.scope_id = c.id AND t.voided_at IS NULL),
      'age_days', CASE WHEN c.status IN ('open','partial') THEN (CURRENT_DATE - c.sent_at::date) END) AS row
    FROM public.mm_process_challans c
    WHERE c.factory_id = v_factory
      AND (NULLIF(p_filter->>'side','') IS NULL OR c.origin = p_filter->>'side')
      AND (NULLIF(p_filter->>'status','') IS NULL OR c.status = p_filter->>'status'
           OR (p_filter->>'status' = 'pending' AND c.status IN ('open','partial')))
      AND (NULLIF(p_filter->>'unit_facility_id','') IS NULL OR c.unit_facility_id = (p_filter->>'unit_facility_id')::uuid)
      AND (NULLIF(p_filter->>'process_type_id','') IS NULL OR c.process_type_id = (p_filter->>'process_type_id')::uuid)
      AND (NULLIF(p_filter->>'purpose','') IS NULL OR c.purpose = p_filter->>'purpose')
      AND (v_q IS NULL OR lower(c.challan_no) LIKE '%'||v_q||'%' OR lower(COALESCE(c.unit_ref_no,'')) LIKE '%'||v_q||'%')
  ) z;
  RETURN public._mm_ok(jsonb_build_object('rows', v_rows));
END $$;

CREATE OR REPLACE FUNCTION public.mm_proc_get_challan(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_c public.mm_process_challans%ROWTYPE; v_qo numeric; v_qi numeric; v_ko numeric; v_ki numeric;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT * INTO v_c FROM public.mm_process_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Challan not found'); END IF;
  SELECT COALESCE(sum(qty) FILTER (WHERE line_status IN ('returned','replaced')),0), COALESCE(sum(qty_kg) FILTER (WHERE line_status IN ('returned','replaced')),0)
    INTO v_qo, v_ko FROM public.mm_process_out_lines WHERE challan_id = v_c.id;
  SELECT COALESCE(sum(qty),0), COALESCE(sum(qty_kg),0) INTO v_qi, v_ki FROM public.mm_process_return_lines WHERE challan_id = v_c.id;
  RETURN public._mm_ok(jsonb_build_object(
    'challan', to_jsonb(v_c) || jsonb_build_object(
      'unit', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'ownership', f.ownership) FROM public.mm_facilities f WHERE f.id = v_c.unit_facility_id),
      'process_type', (SELECT jsonb_build_object('id', t.id, 'name', t.name, 'output_stage_code', t.output_stage_code,
                         'default_return_mode', t.default_return_mode, 'resets_testing', t.resets_testing, 'resets_inspection', t.resets_inspection)
                       FROM public.mm_process_types t WHERE t.id = v_c.process_type_id),
      'parent_challan_no', (SELECT p.challan_no FROM public.mm_process_challans p WHERE p.id = v_c.parent_challan_id)),
    'out_lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'roll_id', l.roll_id, 'unit_code', l.unit_code, 'qty', l.qty,
          'uom', l.uom, 'qty_kg', l.qty_kg, 'stage_code', l.stage_code, 'shade', l.shade, 'lot_id', l.lot_id, 'line_status', l.line_status,
          'write_off_reason', l.write_off_reason, 'style', public._mm_style_label(COALESCE(u.style_material_id, m.style_material_id)))
          ORDER BY l.unit_code)
        FROM public.mm_process_out_lines l LEFT JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
        LEFT JOIN public.mm_mill_rolls m ON m.id = l.mill_roll_id WHERE l.challan_id = v_c.id), '[]'::jsonb),
    'lots', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', lt.id, 'lot_no', lt.lot_no, 'started_at', lt.started_at, 'ended_at', lt.ended_at,
          'remarks', lt.remarks, 'machine', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) FROM public.mm_machines m WHERE m.id = lt.machine_id),
          'out_line_ids', COALESCE((SELECT jsonb_agg(l.id) FROM public.mm_process_out_lines l WHERE l.lot_id = lt.id), '[]'::jsonb)) ORDER BY lt.lot_no)
        FROM public.mm_process_lots lt WHERE lt.challan_id = v_c.id), '[]'::jsonb),
    'returns', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'return_no', r.return_no, 'returned_at', r.returned_at,
          'deliver_to', r.deliver_to, 'in_challan_id', r.in_challan_id, 'remarks', r.remarks,
          'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rl.id, 'roll_id', rl.roll_id, 'unit_code', rl.unit_code, 'same', rl.same_identity,
              'qty', rl.qty, 'uom', rl.uom, 'qty_kg', rl.qty_kg, 'stage_code', rl.stage_code, 'unit_form', rl.unit_form, 'width_form', rl.width_form,
              'grade', rl.grade, 'dye_lot', rl.dye_lot, 'lot_id', rl.lot_id, 'shade', rl.shade,
              'from_units', (SELECT jsonb_agg(ol.unit_code) FROM public.mm_process_out_lines ol
                             WHERE ol.id = ANY (array_append(COALESCE(rl.parent_out_line_ids,'{}'), rl.out_line_id))))
              ORDER BY rl.unit_code) FROM public.mm_process_return_lines rl WHERE rl.return_id = r.id), '[]'::jsonb))
          ORDER BY r.returned_at) FROM public.mm_process_returns r WHERE r.challan_id = v_c.id), '[]'::jsonb),
    'loss', jsonb_build_object('qty_out_closed', v_qo, 'qty_in', v_qi, 'kg_out_closed', v_ko, 'kg_in', v_ki,
          'loss_pct', CASE WHEN v_qo > 0 THEN round((v_qo - v_qi) * 100 / v_qo, 2) END,
          'loss_pct_kg', CASE WHEN v_ko > 0 AND v_ki > 0 THEN round((v_ko - v_ki) * 100 / v_ko, 2) END),
    'tests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'result', t.result, 'tested_at', t.tested_at, 'field_values', t.field_values,
          'site_side', t.site_side, 'voided', t.voided_at IS NOT NULL,
          'superseded', EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL),
          'roll_count', (SELECT count(*) FROM public.mm_qc_test_rolls tr WHERE tr.test_id = t.id)) ORDER BY t.tested_at DESC)
        FROM public.mm_qc_tests t WHERE t.scope_kind = 'process_challan' AND t.scope_id = v_c.id), '[]'::jsonb),
    'reprocess_challans', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'challan_no', x.challan_no, 'status', x.status, 'reason', x.reprocess_reason))
        FROM public.mm_process_challans x WHERE x.parent_challan_id = v_c.id), '[]'::jsonb)
  ));
END $$;

-- ── Quality ──
CREATE OR REPLACE FUNCTION public.mm_qc_get_scope(p_scope_kind text, p_scope_id uuid, p_roll_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_rolls uuid[]; v_ft uuid; v_stage text;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF p_scope_kind = 'rolls' THEN
    v_rolls := ARRAY(SELECT id FROM public.mm_rolls WHERE factory_id = v_factory AND id = ANY (COALESCE(p_roll_ids,'{}')));
  ELSE
    v_rolls := ARRAY(SELECT public._mm_qc_scope_rolls(v_factory, p_scope_kind, p_scope_id));
    IF p_roll_ids IS NOT NULL THEN v_rolls := ARRAY(SELECT x FROM unnest(v_rolls) x WHERE x = ANY (p_roll_ids)); END IF;
  END IF;
  SELECT min(fabric_type_id::text)::uuid, mode() WITHIN GROUP (ORDER BY stage_code) INTO v_ft, v_stage FROM public.mm_rolls WHERE id = ANY (v_rolls);
  RETURN public._mm_ok(jsonb_build_object(
    'scope_kind', p_scope_kind, 'scope_id', p_scope_id, 'stage_code', v_stage,
    'fabric_type', (SELECT jsonb_build_object('id', id, 'name', name, 'fpt_max_points', fpt_max_points) FROM public.mm_fabric_types WHERE id = v_ft),
    'mixed_fabric_types', (SELECT count(DISTINCT fabric_type_id) > 1 FROM public.mm_rolls WHERE id = ANY (v_rolls)),
    'fields', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options,
          'test_level', f.test_level, 'required', v_stage = ANY (f.required_at_stages), 'required_at_stages', to_jsonb(f.required_at_stages)) ORDER BY f.seq)
        FROM public.mm_type_test_fields f WHERE f.factory_id = v_factory AND f.type_id = v_ft AND f.is_active), '[]'::jsonb),
    'defect_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name)
        FROM public.mm_defect_types d WHERE d.factory_id = v_factory AND d.is_active), '[]'::jsonb),
    'rolls', COALESCE((SELECT jsonb_agg(public._mm_roll_row(x) ORDER BY (SELECT roll_code FROM public.mm_rolls WHERE id = x)) FROM unnest(v_rolls) x), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'result', t.result, 'tested_at', t.tested_at, 'field_values', t.field_values,
          'voided', t.voided_at IS NOT NULL, 'superseded', EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL))
          ORDER BY t.tested_at DESC)
        FROM public.mm_qc_tests t WHERE p_scope_kind <> 'rolls' AND t.scope_kind = p_scope_kind AND t.scope_id = p_scope_id), '[]'::jsonb)
  ));
END $$;

CREATE OR REPLACE FUNCTION public.mm_qc_get_roll(p_roll_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF NOT EXISTS (SELECT 1 FROM public.mm_rolls WHERE id = p_roll_id AND factory_id = v_factory) THEN RETURN public._mm_err('NOT_FOUND','Roll not found'); END IF;
  RETURN public._mm_ok(jsonb_build_object(
    'roll', public._mm_roll_row(p_roll_id),
    'passport', public._mm_qc_passport(p_roll_id),
    'tests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'scope_kind', t.scope_kind, 'scope_id', t.scope_id, 'result', t.result,
          'field_values', t.field_values, 'tested_at', t.tested_at, 'site_side', t.site_side, 'origin', t.origin, 'stage_code', t.stage_code,
          'round_at_test', tr.round_at_test, 'deviation_reason', t.deviation_reason, 'voided', t.voided_at IS NOT NULL, 'void_reason', t.void_reason,
          'superseded', EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL)) ORDER BY t.tested_at DESC)
        FROM public.mm_qc_test_rolls tr JOIN public.mm_qc_tests t ON t.id = tr.test_id WHERE tr.roll_id = p_roll_id), '[]'::jsonb),
    'inspections', COALESCE((SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object('defects', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM public.mm_qc_inspection_defects d WHERE d.inspection_id = i.id), '[]'::jsonb))
          ORDER BY i.inspected_at DESC) FROM public.mm_qc_inspections i WHERE i.roll_id = p_roll_id), '[]'::jsonb),
    'ancestors', COALESCE((WITH RECURSIVE a(id, depth) AS (
          SELECT parent_roll_id, 1 FROM public.mm_roll_lineage WHERE child_roll_id = p_roll_id
          UNION SELECT l.parent_roll_id, a.depth + 1 FROM public.mm_roll_lineage l JOIN a ON l.child_roll_id = a.id WHERE a.depth < 10)
        SELECT jsonb_agg(public._mm_roll_row(a.id, true) || jsonb_build_object('depth', a.depth) ORDER BY a.depth) FROM a), '[]'::jsonb),
    'children', COALESCE((SELECT jsonb_agg(jsonb_build_object('roll_id', c.id, 'roll_code', c.roll_code)) FROM public.mm_roll_lineage l
        JOIN public.mm_rolls c ON c.id = l.child_roll_id WHERE l.parent_roll_id = p_roll_id), '[]'::jsonb),
    'process_history', COALESCE((SELECT jsonb_agg(jsonb_build_object('challan_id', c.id, 'challan_no', c.challan_no, 'process', t.name, 'unit', f.name,
          'purpose', c.purpose, 'sent_at', c.sent_at, 'line_status', l.line_status, 'stage_at_send', l.stage_code) ORDER BY c.sent_at)
        FROM public.mm_process_out_lines l JOIN public.mm_process_challans c ON c.id = l.challan_id
        LEFT JOIN public.mm_process_types t ON t.id = c.process_type_id LEFT JOIN public.mm_facilities f ON f.id = c.unit_facility_id
        WHERE l.roll_id = p_roll_id), '[]'::jsonb),
    'allocations', COALESCE((SELECT jsonb_agg(jsonb_build_object('side', a.side, 'from', public._mm_style_label(a.from_style_material_id),
          'to', public._mm_style_label(a.to_style_material_id), 'reason', a.reason, 'event_at', a.event_at) ORDER BY a.created_at)
        FROM public.mm_roll_allocations a WHERE a.roll_id = p_roll_id), '[]'::jsonb),
    'cut_approvals', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.approved_at DESC) FROM public.mm_qc_cut_approvals x WHERE x.roll_id = p_roll_id), '[]'::jsonb)
  ));
END $$;

-- queue: { side?:'mill'|'warehouse', need?:'test'|'inspection'|'any', style_material_id?, search?, limit? }
CREATE OR REPLACE FUNCTION public.mm_qc_list_queue(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_need text; v_side text; v_q text; v_lim int; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_need := COALESCE(NULLIF(p_filter->>'need',''), 'any'); v_side := NULLIF(p_filter->>'side','');
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search',''))), ''); v_lim := LEAST(COALESCE((p_filter->>'limit')::int, 300), 1000);
  SELECT COALESCE(jsonb_agg(x.row ORDER BY x.row->>'roll_code'), '[]'::jsonb) INTO v_rows FROM (
    SELECT public._mm_roll_row(r.id) AS row FROM public.mm_rolls r
    LEFT JOIN public.mm_stock_units u ON u.roll_id = r.id LEFT JOIN public.mm_mill_rolls m ON m.roll_id = r.id
    WHERE r.factory_id = v_factory AND public._mm_roll_alive(r.id)
      AND (v_side IS NULL OR (v_side = 'warehouse' AND u.id IS NOT NULL) OR (v_side = 'mill' AND u.id IS NULL))
      AND (NULLIF(p_filter->>'style_material_id','') IS NULL OR COALESCE(u.style_material_id, m.style_material_id) = (p_filter->>'style_material_id')::uuid)
      AND (v_q IS NULL OR lower(r.roll_code) LIKE '%'||v_q||'%')
    LIMIT 2000) x
  WHERE (v_need IN ('test','any') AND x.row->>'test_status' <> 'PASS') OR (v_need IN ('inspection','any') AND x.row->>'inspection_status' <> 'PASS');
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v_rows) e LIMIT v_lim) s), '[]'::jsonb)));
END $$;

-- ── Warehouse readiness for cutting ──
-- filter: { style_material_id?, search?, only_blocked?:bool }
CREATE OR REPLACE FUNCTION public.mm_wh_list_readiness(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_q text; v_sm uuid; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search',''))), ''); v_sm := NULLIF(p_filter->>'style_material_id','')::uuid;
  SELECT COALESCE(jsonb_agg(z.row ORDER BY z.row->>'roll_code'), '[]'::jsonb) INTO v_rows FROM (
    SELECT public._mm_roll_row(u.roll_id, false) || jsonb_build_object('gate', g.gate - 'passport',
             'test_status', g.gate->'passport'->'test'->>'status', 'inspection_status', g.gate->'passport'->'inspection'->>'status',
             'missing_keys', g.gate->'passport'->'test'->'missing_keys', 'location_id', u.current_location_id,
             'location', (SELECT name FROM public.mm_locations WHERE id = u.current_location_id)) AS row,
           (g.gate->>'cut_ready')::boolean AS ready
    FROM public.mm_stock_units u
    CROSS JOIN LATERAL (SELECT public._mm_v4_cut_blocks(u.id, v_sm) AS gate) g
    WHERE u.factory_id = v_factory AND u.status IN ('in_stock','pending_qc') AND u.store_challan_id IS NULL
      AND (v_sm IS NULL OR u.style_material_id = v_sm)
      AND (v_q IS NULL OR lower(u.unit_code) LIKE '%'||v_q||'%')) z
  WHERE NOT COALESCE((p_filter->>'only_blocked')::boolean, false) OR NOT z.ready;
  RETURN public._mm_ok(jsonb_build_object('rows', v_rows, 'fabric_v4', public._mm_v4_on(v_factory)));
END $$;

-- ── Reports (capture-only, no costs) ──
-- group_by: 'unit' | 'process' | 'unit_process'
CREATE OR REPLACE FUNCTION public.mm_rpt_process_loss(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_group_by text DEFAULT 'unit_process')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.unit, s.process), '[]'::jsonb) INTO v_rows FROM (
    SELECT CASE WHEN p_group_by IN ('unit','unit_process') THEN f.name END AS unit,
           CASE WHEN p_group_by IN ('process','unit_process') THEN t.name END AS process,
           count(DISTINCT c.id) AS challans,
           count(DISTINCT c.id) FILTER (WHERE c.purpose = 'reprocess') AS reprocess_challans,
           COALESCE(sum(l.qty) FILTER (WHERE l.line_status IN ('returned','replaced')),0) AS qty_out,
           COALESCE((SELECT sum(rl.qty) FROM public.mm_process_return_lines rl WHERE rl.challan_id = ANY (array_agg(DISTINCT c.id))),0) AS qty_in,
           COALESCE(sum(l.qty) FILTER (WHERE l.line_status = 'written_off'),0) AS qty_written_off
    FROM public.mm_process_challans c JOIN public.mm_process_out_lines l ON l.challan_id = c.id
    LEFT JOIN public.mm_facilities f ON f.id = c.unit_facility_id LEFT JOIN public.mm_process_types t ON t.id = c.process_type_id
    WHERE c.factory_id = v_factory AND c.status <> 'void'
      AND (p_from IS NULL OR c.sent_at::date >= p_from) AND (p_to IS NULL OR c.sent_at::date <= p_to)
    GROUP BY 1, 2) s;
  RETURN public._mm_ok(jsonb_build_object('rows', (SELECT COALESCE(jsonb_agg(e || jsonb_build_object('loss_pct',
      CASE WHEN (e->>'qty_out')::numeric > 0 THEN round(((e->>'qty_out')::numeric - (e->>'qty_in')::numeric) * 100 / (e->>'qty_out')::numeric, 2) END)), '[]'::jsonb)
      FROM jsonb_array_elements(v_rows) e)));
END $$;

-- defects / fails per machine that made (or last processed) the roll
CREATE OR REPLACE FUNCTION public.mm_rpt_quality_by_machine(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.facility, s.machine_code), '[]'::jsonb) INTO v_rows FROM (
    SELECT f.name AS facility, m.code AS machine_code, m.machine_kind,
           count(DISTINCT r.id) AS rolls,
           count(i.id) AS inspections,
           count(i.id) FILTER (WHERE i.result = 'fail') AS inspections_failed,
           round(avg(i.points_per_100_sqyd), 2) AS avg_points_per_100_sqyd
    FROM public.mm_rolls r JOIN public.mm_machines m ON m.id = r.machine_id JOIN public.mm_facilities f ON f.id = m.facility_id
    LEFT JOIN public.mm_qc_inspections i ON i.roll_id IN (SELECT r.id UNION SELECT l.child_roll_id FROM public.mm_roll_lineage l WHERE l.parent_roll_id = r.id)
         AND i.voided_at IS NULL AND (p_from IS NULL OR i.inspected_at::date >= p_from) AND (p_to IS NULL OR i.inspected_at::date <= p_to)
    WHERE r.factory_id = v_factory
    GROUP BY 1, 2, 3) s;
  RETURN public._mm_ok(jsonb_build_object('rows', v_rows));
END $$;

DO $$ DECLARE f text; BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public._mm_roll_row(uuid,boolean) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public._mm_roll_row(uuid,boolean) TO service_role';
  FOREACH f IN ARRAY ARRAY['public.mm_list_rolls_v4(jsonb)','public.mm_mill_list_batches_v4(jsonb)','public.mm_mill_get_batch_v4(uuid)',
    'public.mm_proc_list_challans(jsonb)','public.mm_proc_get_challan(uuid)','public.mm_qc_get_scope(text,uuid,uuid[])',
    'public.mm_qc_get_roll(uuid)','public.mm_qc_list_queue(jsonb)','public.mm_wh_list_readiness(jsonb)',
    'public.mm_rpt_process_loss(date,date,text)','public.mm_rpt_quality_by_machine(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;;
