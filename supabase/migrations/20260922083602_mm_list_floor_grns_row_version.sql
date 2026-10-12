CREATE OR REPLACE FUNCTION public.mm_list_floor_grns(p_source text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
    FROM (
      SELECT c.id, c.challan_no, c.grn_no, c.invoice_ref, c.reference_no, c.source,
             c.status, c.supplier_name, c.style_material_id, c.row_version, c.created_at, c.received_at,
             (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) AS roll_count,
             (SELECT count(*) FROM public.mm_stock_units u
               WHERE u.in_challan_id = c.id
                 AND COALESCE((public._mm_unit_clearance(u.id)->>'cleared')::boolean, false)
             ) AS cleared_count
      FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory
        AND (p_source IS NULL OR c.source = p_source)
      ORDER BY c.created_at DESC
      LIMIT 40
    ) x
  ), '[]'::jsonb));
END;
$fn$;;
