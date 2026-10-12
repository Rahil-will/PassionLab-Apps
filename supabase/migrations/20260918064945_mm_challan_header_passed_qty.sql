CREATE OR REPLACE FUNCTION public._mm_challan_header(p_ch public.mm_in_challans)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_ch.id,
    'challan_no', p_ch.challan_no,
    'reference_no', p_ch.reference_no,
    'source', p_ch.source,
    'status', p_ch.status,
    'supplier_name', p_ch.supplier_name,
    'sent_at', p_ch.sent_at,
    'received_at', p_ch.received_at,
    'row_version', p_ch.row_version,
    'style_material_id', p_ch.style_material_id,
    'order_id', sm.order_id,
    'colorway_id', sm.colorway_id,
    'fabric_line_id', COALESCE(sm.colorway_material_id, cm.id),
    'style_name', o.style_name,
    'style_ref', o.style_ref,
    'buyer_name', o.buyer_name,
    'po_number', o.po_number,
    'image_url', o.image_url,
    'color_name', cw.name,
    'fabric_type', ft.name,
    'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
    'fabric_category', CASE
      WHEN cm.id IS NULL THEN NULL
      WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
        THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
      ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), ''))
    END,
    'required_m', cm.total_cons,
    'uom', NULLIF(trim(COALESCE(cm.extras->>'unit', '')), ''),
    'roll_count', (SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = p_ch.id),
    'qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id),
    'passed_qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'pass'),
    'failed_qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'fail'),
    'pending_qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id AND u.status = 'pending_qc'),
    'tested_count', (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id AND u.qc_result IS NOT NULL),
    'failed_count', (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'fail'),
    'pending_qc_count', (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id AND u.status = 'pending_qc')
  )
  FROM public.mm_style_materials sm
  JOIN public.style_orders o ON o.id = sm.order_id
  JOIN public.colorways cw ON cw.id = sm.colorway_id
  JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
  LEFT JOIN public.colorway_materials cm ON cm.id = COALESCE(
    sm.colorway_material_id,
    (
      SELECT c2.id FROM public.colorway_materials c2
      WHERE c2.colorway_id = sm.colorway_id AND c2.factory_id = sm.factory_id AND c2.kind = 'Fabric'
        AND lower(trim(c2.type)) = lower(trim(ft.name))
      ORDER BY c2.seq LIMIT 1
    )
  )
  WHERE sm.id = p_ch.style_material_id
$$;
REVOKE ALL ON FUNCTION public._mm_challan_header(public.mm_in_challans) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.mm_get_in_challan_rolls(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
  SELECT fabric_type_id INTO v_type FROM public.mm_style_materials WHERE id = v_ch.style_material_id;
  RETURN public._mm_ok(jsonb_build_object(
    'challan', public._mm_challan_header(v_ch),
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type AND f.is_active
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
        'shade', u.shade, 'lot_no', u.lot_no, 'attributes', u.attributes,
        'mill_snapshot', u.mill_snapshot, 'status', u.status, 'qc_result', u.qc_result,
        'row_version', u.row_version, 'source', u.source,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'wh_values', COALESCE(i.field_values, '{}'::jsonb),
        'wh_remarks', i.remarks, 'wh_result', i.result
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_warehouse_inspections i ON i.stock_unit_id = u.id
      WHERE u.in_challan_id = v_ch.id
    ), '[]'::jsonb)
  ));
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.mm_get_in_challan_rolls(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
;
