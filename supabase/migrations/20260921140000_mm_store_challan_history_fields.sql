-- Dispatch history: buyer, qty, UOM, order, and style image on store challans.

CREATE OR REPLACE FUNCTION public.mm_list_store_challans(p_status text)
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
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', sc.id,
      'challan_no', sc.challan_no,
      'status', sc.status,
      'sent_at', sc.sent_at,
      'received_at', sc.received_at,
      'reference_no', sc.reference_no,
      'order_id', o.id,
      'style_name', o.style_name,
      'style_ref', o.style_ref,
      'buyer_name', o.buyer_name,
      'po_number', o.po_number,
      'color_name', cw.name,
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
          WHERE u.store_challan_id = sc.id LIMIT 1
        ),
        NULLIF(trim(cm.unit), '')
      ),
      'qty', (
        SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
        WHERE u.store_challan_id = sc.id
      ),
      'roll_count', (SELECT count(*) FROM public.mm_store_challan_lines l WHERE l.challan_id = sc.id)
    ) ORDER BY sc.sent_at DESC NULLS LAST, sc.created_at DESC)
    FROM public.mm_store_challans sc
    JOIN public.mm_style_materials sm ON sm.id = sc.style_material_id
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
    WHERE sc.factory_id = v_factory
      AND (p_status IS NULL OR p_status IN ('', 'all') OR sc.status = p_status)
  ), '[]'::jsonb));
END;
$fn$;

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
  v_header jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_sc FROM public.mm_store_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Dispatch challan not found'); END IF;
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
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'length_m', u.length_m,
        'weight_kg', u.weight_kg,
        'shade', u.shade,
        'lot_no', u.lot_no,
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

REVOKE ALL ON FUNCTION public.mm_list_store_challans(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_store_challan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_list_store_challans(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_store_challan(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
