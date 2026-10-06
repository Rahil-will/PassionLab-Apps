-- Dispatch challan detail: include fabric type fields + roll attributes.
-- Cutting receive is a mobile status update, not a desktop action.

CREATE OR REPLACE FUNCTION public.mm_get_store_challan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sc public.mm_store_challans%ROWTYPE;
  v_type uuid;
  v_header jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_sc FROM public.mm_store_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Dispatch challan not found'); END IF;

  SELECT sm.fabric_type_id INTO v_type
  FROM public.mm_style_materials sm
  WHERE sm.id = v_sc.style_material_id;

  SELECT jsonb_build_object(
    'id', v_sc.id,
    'challan_no', v_sc.challan_no,
    'status', v_sc.status,
    'sent_at', v_sc.sent_at,
    'received_at', v_sc.received_at,
    'reference_no', v_sc.reference_no,
    'remarks', v_sc.remarks,
    'row_version', v_sc.row_version,
    'factory_name', (SELECT f.name FROM public.factories f WHERE f.id = v_factory),
    'factory_code', (SELECT f.code FROM public.factories f WHERE f.id = v_factory),
    'order_id', o.id,
    'image_url', o.image_url,
    'style_name', o.style_name,
    'style_ref', o.style_ref,
    'buyer_name', o.buyer_name,
    'po_number', o.po_number,
    'color_name', cw.name,
    'fabric_type_id', sm.fabric_type_id,
    'fabric_type', ft.name,
    'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
    'fabric_category', CASE
      WHEN cm.id IS NULL THEN NULL
      WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
        THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
      ELSE COALESCE(
        NULLIF(trim(cm.category), ''),
        NULLIF(trim(cm.extras->>'fabricCategory'), '')
      )
    END,
    'uom', COALESCE(
      (
        SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
        WHERE u.store_challan_id = v_sc.id LIMIT 1
      ),
      NULLIF(trim(cm.unit), '')
    ),
    'qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.store_challan_id = v_sc.id
    ),
    'roll_count', (SELECT count(*) FROM public.mm_store_challan_lines l WHERE l.challan_id = v_sc.id)
  ) INTO v_header
  FROM public.mm_style_materials sm
  JOIN public.style_orders o ON o.id = sm.order_id
  JOIN public.colorways cw ON cw.id = sm.colorway_id
  JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
  LEFT JOIN public.colorway_materials cm ON cm.id = COALESCE(
    sm.colorway_material_id,
    (
      SELECT c2.id
      FROM public.colorway_materials c2
      WHERE c2.colorway_id = sm.colorway_id
        AND c2.factory_id = sm.factory_id
        AND c2.kind = 'Fabric'
        AND lower(trim(c2.type)) = lower(trim(ft.name))
      ORDER BY c2.seq
      LIMIT 1
    )
  )
  WHERE sm.id = v_sc.style_material_id;

  RETURN public._mm_ok(jsonb_build_object(
    'challan', v_header,
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'key', f.key,
        'label', f.label,
        'data_type', f.data_type,
        'options', f.options
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory
        AND f.type_id = v_type
        AND f.is_active
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'length_m', u.length_m,
        'weight_kg', u.weight_kg,
        'shade', u.shade,
        'lot_no', u.lot_no,
        'attributes', u.attributes,
        'source', u.source,
        'batch_no', COALESCE(b.batch_no, NULLIF(trim(u.mill_snapshot->>'batch_no'), '')),
        'mill_snapshot', u.mill_snapshot,
        'location_code', loc.code,
        'location_name', loc.name
      ) ORDER BY u.unit_code)
      FROM public.mm_store_challan_lines l
      JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE l.challan_id = v_sc.id
    ), '[]'::jsonb)
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_get_store_challan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_store_challan(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
