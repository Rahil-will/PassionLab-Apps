-- Include mill/vendor challan reference_no on inbound challan header.

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
      ELSE COALESCE(
        NULLIF(trim(cm.category), ''),
        NULLIF(trim(cm.extras->>'fabricCategory'), '')
      )
    END,
    'required_m', cm.total_cons,
    'uom', NULLIF(trim(COALESCE(cm.extras->>'unit', '')), ''),
    'roll_count', (
      SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = p_ch.id
    ),
    'qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id
    ),
    'tested_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result IS NOT NULL
    ),
    'failed_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'fail'
    ),
    'pending_qc_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.status = 'pending_qc'
    )
  )
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
  WHERE sm.id = p_ch.style_material_id
$$;

REVOKE ALL ON FUNCTION public._mm_challan_header(public.mm_in_challans) FROM PUBLIC;
NOTIFY pgrst, 'reload schema';;
