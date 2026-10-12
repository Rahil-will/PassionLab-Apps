-- Store challan list: fabric name + catalog category (Shell, Lining, …).

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
      'roll_count', (SELECT count(*) FROM public.mm_store_challan_lines l WHERE l.challan_id = sc.id)
    ) ORDER BY CASE WHEN sc.status = 'pending' THEN 0 ELSE 1 END, sc.sent_at DESC)
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

GRANT EXECUTE ON FUNCTION public.mm_list_store_challans(text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
