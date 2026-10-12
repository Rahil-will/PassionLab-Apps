-- Fabric name on inbound challans was the fabric *type* (Knit). Use the
-- colorway material name, and expose qty / uom without assuming metres.

CREATE OR REPLACE FUNCTION public._mm_challan_header(p_ch public.mm_in_challans)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_ch.id,
    'challan_no', p_ch.challan_no,
    'source', p_ch.source,
    'status', p_ch.status,
    'supplier_name', p_ch.supplier_name,
    'sent_at', p_ch.sent_at,
    'received_at', p_ch.received_at,
    'row_version', p_ch.row_version,
    'style_material_id', p_ch.style_material_id,
    'order_id', sm.order_id,
    'colorway_id', sm.colorway_id,
    'style_name', o.style_name,
    'color_name', cw.name,
    'fabric_type', ft.name,
    'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
    'uom', NULLIF(trim(COALESCE(cm.unit, '')), ''),
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
  LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
  WHERE sm.id = p_ch.style_material_id
$$;

REVOKE ALL ON FUNCTION public._mm_challan_header(public.mm_in_challans) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';;
