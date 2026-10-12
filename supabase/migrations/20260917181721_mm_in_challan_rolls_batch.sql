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
  SELECT fabric_type_id INTO v_type FROM public.mm_style_materials WHERE id = v_ch.style_material_id;
  RETURN public._mm_ok(jsonb_build_object(
    'challan', public._mm_challan_header(v_ch),
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type AND f.is_active
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
        'shade', u.shade, 'lot_no', u.lot_no, 'attributes', u.attributes,
        'mill_snapshot', u.mill_snapshot, 'status', u.status, 'qc_result', u.qc_result,
        'row_version', u.row_version, 'source', u.source,
        'mill_batch_id', u.mill_batch_id,
        'batch_no', b.batch_no
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      WHERE u.in_challan_id = v_ch.id
    ), '[]'::jsonb)
  ));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_get_in_challan_rolls(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';;
