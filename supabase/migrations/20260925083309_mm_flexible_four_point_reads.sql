CREATE OR REPLACE FUNCTION public.mm_get_process_challan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_process_challans%ROWTYPE;
  v_vendor text;
  v_process text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'A process challan is required'); END IF;
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Process challan was not found'); END IF;
  SELECT v.name INTO v_vendor FROM public.mm_process_vendors v WHERE v.id = v_ch.vendor_id AND v.factory_id = v_factory;
  SELECT t.name INTO v_process FROM public.mm_process_types t WHERE t.id = v_ch.process_type_id AND t.factory_id = v_factory;
  RETURN public._mm_ok(jsonb_build_object(
    'id', v_ch.id, 'challan_no', v_ch.challan_no, 'origin', v_ch.origin, 'status', v_ch.status,
    'vendor_name', v_vendor, 'process_name', v_process, 'remarks', v_ch.remarks,
    'created_at', v_ch.created_at, 'returned_at', v_ch.returned_at,
    'out', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'unit_code', l.unit_code, 'qty', l.qty, 'uom', l.uom, 'shade', l.shade,
        'lot_no', l.lot_no, 'color_ref', l.color_ref, 'line_status', l.line_status,
        'style_name', NULLIF(btrim(o.style_name), '')
      ) ORDER BY l.unit_code)
      FROM public.mm_process_out_lines l
      LEFT JOIN public.mm_mill_rolls mr ON mr.id = l.mill_roll_id AND mr.factory_id = v_factory
      LEFT JOIN public.mm_stock_units su ON su.id = l.stock_unit_id AND su.factory_id = v_factory
      LEFT JOIN public.mm_style_materials sm ON sm.id = COALESCE(mr.style_material_id, su.style_material_id) AND sm.factory_id = v_factory
      LEFT JOIN public.style_orders o ON o.id = sm.order_id AND o.factory_id = v_factory
      WHERE l.challan_id = v_ch.id AND l.factory_id = v_factory
    ), '[]'::jsonb),
    'back', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'out_line_id', r.out_line_id, 'same_identity', r.same_identity, 'unit_code', r.unit_code,
        'qty', r.qty, 'uom', r.uom, 'shade', r.shade, 'color_ref', r.color_ref, 'lot_no', r.lot_no,
        'mill_roll_id', r.mill_roll_id, 'stock_unit_id', r.stock_unit_id,
        'qc_result', COALESCE(mr.qc_result, su.qc_result)
      ) ORDER BY r.created_at, r.unit_code)
      FROM public.mm_process_return_lines r
      LEFT JOIN public.mm_mill_rolls mr ON mr.id = r.mill_roll_id AND mr.factory_id = v_factory
      LEFT JOIN public.mm_stock_units su ON su.id = r.stock_unit_id AND su.factory_id = v_factory
      WHERE r.challan_id = v_ch.id AND r.factory_id = v_factory
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_in_challan_rolls(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_type uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  SELECT COALESCE(
    (SELECT u.fabric_type_id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id ORDER BY u.created_at LIMIT 1),
    (SELECT sm.fabric_type_id FROM public.mm_style_materials sm WHERE sm.id = v_ch.style_material_id)
  ) INTO v_type;
  RETURN public._mm_ok(jsonb_build_object(
    'challan', public._mm_challan_header(v_ch),
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options,
        'capture_site', f.capture_site
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type AND f.is_active
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
        'shade', u.shade, 'tested_shade', u.tested_shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref,
        'attributes', u.attributes, 'mill_snapshot', u.mill_snapshot, 'status', u.status,
        'qc_result', u.qc_result, 'row_version', u.row_version, 'source', u.source,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'wh_values', COALESCE(i.field_values, '{}'::jsonb),
        'wh_remarks', i.remarks,
        'wh_result', i.result
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN LATERAL (
        SELECT x.field_values, x.remarks, x.result
        FROM public.mm_warehouse_inspections x
        WHERE x.stock_unit_id = u.id AND x.scope_kind = 'in_challan' AND x.scope_id = v_ch.id
        ORDER BY x.inspected_at DESC NULLS LAST
        LIMIT 1
      ) i ON true
      WHERE u.in_challan_id = v_ch.id
    ), '[]'::jsonb)
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_save_inspections(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_inspections(text, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mm_save_warehouse_inspections(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_inspections(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mm_get_process_challan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_get_process_challan(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mm_get_in_challan_rolls(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_get_in_challan_rolls(uuid) TO authenticated, service_role;;
