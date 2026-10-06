CREATE OR REPLACE FUNCTION public.mm_get_unallocated_mill()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object(
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'batch_no', b.batch_no,
        'mill_ref', b.mill_ref,
        'production_date', b.production_date,
        'remarks', b.remarks,
        'fabric_type_id', b.fabric_type_id,
        'fabric_type', ft.name,
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      JOIN public.mm_fabric_types ft ON ft.id = b.fabric_type_id
      WHERE b.factory_id = v_factory AND b.style_material_id IS NULL
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'unit_code', r.unit_code,
        'mill_batch_id', r.mill_batch_id,
        'batch_no', b.batch_no,
        'length_m', r.length_m,
        'weight_kg', r.weight_kg,
        'shade', r.shade,
        'lot_no', r.lot_no,
        'color_ref', r.color_ref,
        'attributes', r.attributes,
        'status', r.status,
        'fabric_type_id', r.fabric_type_id,
        'fabric_type', ft.name,
        'in_challan_id', r.in_challan_id,
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL)
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
      WHERE r.factory_id = v_factory AND r.style_material_id IS NULL
    ), '[]'::jsonb)
  ));
END;
$fn$;;
