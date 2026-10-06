CREATE OR REPLACE FUNCTION public.mm_list_end_bit_returns()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.returned_at DESC)
    FROM (
      SELECT
        r.id,
        r.unit_code,
        r.qty,
        r.qty_uom,
        r.mill_shade,
        r.tested_shade,
        r.returned_at,
        u.status,
        loc.name AS location_name,
        o.style_name,
        o.style_ref
      FROM public.mm_end_bit_returns r
      JOIN public.mm_stock_units u ON u.id = r.stock_unit_id AND u.factory_id = v_factory
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id AND sm.factory_id = v_factory
      LEFT JOIN public.style_orders o ON o.id = sm.order_id AND o.factory_id = v_factory
      WHERE r.factory_id = v_factory
      ORDER BY r.returned_at DESC
      LIMIT 300
    ) x
  ), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_list_end_bit_returns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_list_end_bit_returns() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';;
