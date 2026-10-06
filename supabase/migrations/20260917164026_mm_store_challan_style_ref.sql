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
      'id', sc.id, 'challan_no', sc.challan_no, 'status', sc.status,
      'sent_at', sc.sent_at, 'received_at', sc.received_at,
      'style_name', o.style_name, 'style_ref', o.style_ref,
      'color_name', cw.name, 'fabric_type', ft.name,
      'roll_count', (SELECT count(*) FROM public.mm_store_challan_lines l WHERE l.challan_id = sc.id)
    ) ORDER BY CASE WHEN sc.status = 'pending' THEN 0 ELSE 1 END, sc.sent_at DESC)
    FROM public.mm_store_challans sc
    JOIN public.mm_style_materials sm ON sm.id = sc.style_material_id
    JOIN public.style_orders o ON o.id = sm.order_id
    JOIN public.colorways cw ON cw.id = sm.colorway_id
    JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
    WHERE sc.factory_id = v_factory
      AND (p_status IS NULL OR p_status IN ('', 'all') OR sc.status = p_status)
  ), '[]'::jsonb));
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mm_list_store_challans(text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';;
