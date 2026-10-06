CREATE OR REPLACE FUNCTION public.mm_list_inspection_queue()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb)
    FROM (
      SELECT u.id, u.unit_code, u.source, u.status, u.length_m, u.declared_width_in,
             u.color_ref, u.lot_no, u.attributes, u.style_material_id, u.in_challan_id,
             c.challan_no, c.grn_no, c.invoice_ref, c.supplier_name,
             cl.clearance,
             public._mm_unit_on_hold(u.id) AS on_hold,
             CASE
               WHEN u.source = 'mill'
                 AND COALESCE((cl.clearance->>'tested')::boolean, false)
                 AND NOT COALESCE((cl.clearance->>'inspected')::boolean, false)
                 THEN 'optional'
               ELSE 'blocking'
             END AS queue_kind
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      CROSS JOIN LATERAL (SELECT public._mm_unit_clearance(u.id) AS clearance) cl
      WHERE u.factory_id = v_factory
        AND u.status IN ('pending_qc', 'in_stock')
        AND NOT public._mm_unit_on_hold(u.id)
        AND (
          COALESCE((cl.clearance->>'cleared')::boolean, false) = false
          OR (
            u.source = 'mill'
            AND COALESCE((cl.clearance->>'tested')::boolean, false)
            AND NOT COALESCE((cl.clearance->>'inspected')::boolean, false)
          )
        )
      ORDER BY u.created_at DESC
      LIMIT 200
    ) x
  ), '[]'::jsonb));
END;
$fn$;;
