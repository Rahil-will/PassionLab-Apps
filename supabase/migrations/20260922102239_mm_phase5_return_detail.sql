-- Phase 5 remainder. Applied as mm_phase5_return_detail.
-- Disposition, hold, and the return list already exist. This is the printable detail.

CREATE OR REPLACE FUNCTION public.mm_get_supplier_return(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
  v_row public.mm_supplier_returns%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  IF p_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A return is required');
  END IF;

  SELECT * INTO v_row
  FROM public.mm_supplier_returns
  WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Return was not found');
  END IF;

  RETURN public._mm_ok(jsonb_build_object(
    'id', v_row.id,
    'return_no', v_row.return_no,
    'supplier_name', v_row.supplier_name,
    'reason', v_row.reason,
    'debit_note_ref', v_row.debit_note_ref,
    'created_at', v_row.created_at,
    'roll_count', (SELECT count(*)::int FROM public.mm_supplier_return_lines l WHERE l.return_id = v_row.id AND l.factory_id = v_factory),
    'qty', (SELECT COALESCE(sum(l.qty), 0) FROM public.mm_supplier_return_lines l WHERE l.return_id = v_row.id AND l.factory_id = v_factory),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'qty', l.qty,
        'uom', COALESCE(u.qty_uom, u.uom),
        'shade', u.shade,
        'lot_no', u.lot_no,
        'style_name', NULLIF(btrim(o.style_name), ''),
        'style_ref', NULLIF(btrim(o.style_ref), ''),
        'buyer_name', NULLIF(btrim(o.buyer_name), '')
      ) ORDER BY u.unit_code)
      FROM public.mm_supplier_return_lines l
      JOIN public.mm_stock_units u ON u.id = l.stock_unit_id AND u.factory_id = v_factory
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id AND sm.factory_id = v_factory
      LEFT JOIN public.style_orders o ON o.id = sm.order_id AND o.factory_id = v_factory
      WHERE l.return_id = v_row.id AND l.factory_id = v_factory
    ), '[]'::jsonb)
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_get_supplier_return(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_supplier_return(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mm_get_supplier_return(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
;
