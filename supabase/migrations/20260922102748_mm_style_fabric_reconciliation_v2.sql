CREATE OR REPLACE VIEW public.mm_v_style_fabric_reconciliation
WITH (security_invoker = true) AS
SELECT
  sm.factory_id,
  sm.id AS style_material_id,
  sm.order_id,
  cw.name AS color_name,
  COALESCE(ft.name, 'Fabric') AS fabric_name,
  COALESCE(NULLIF(trim(cm.unit), ''), (SELECT u.qty_uom FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.qty_uom IS NOT NULL LIMIT 1)) AS uom,
  cm.total_cons AS required,
  COALESCE((SELECT sum(COALESCE(u.qty_received, u.length_m)) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status IN ('pending_qc', 'in_stock', 'rejected', 'issued', 'consumed')), 0) AS received,
  COALESCE((SELECT -sum(l.qty_delta) FROM public.mm_stock_ledger l JOIN public.mm_stock_units u ON u.id = l.stock_unit_id WHERE u.style_material_id = sm.id AND l.entry_type = 'QC_DEDUCT'), 0) AS qc_deducted,
  COALESCE((SELECT -sum(l.qty_delta) FROM public.mm_stock_ledger l JOIN public.mm_stock_units u ON u.id = l.stock_unit_id WHERE u.style_material_id = sm.id AND l.entry_type = 'RETURN_TO_SUPPLIER'), 0) AS returned_to_supplier,
  COALESCE((SELECT -sum(l.qty_delta) FROM public.mm_stock_ledger l JOIN public.mm_stock_units u ON u.id = l.stock_unit_id WHERE u.style_material_id = sm.id AND l.entry_type = 'WRITE_OFF'), 0) AS written_off,
  COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u JOIN public.mm_locations loc ON loc.id = u.current_location_id WHERE u.style_material_id = sm.id AND u.status IN ('pending_qc', 'in_stock', 'rejected') AND loc.location_type IN ('receiving', 'rack', 'bin', 'rejected')), 0) AS on_hand_warehouse,
  COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'issued'), 0) AS at_cutting,
  COALESCE((SELECT sum(l.qty) FROM public.mm_stock_ledger l JOIN public.mm_stock_units u ON u.id = l.stock_unit_id WHERE u.style_material_id = sm.id AND l.entry_type = 'ISSUE_TO_CUTTING'), 0) AS issued_to_cutting,
  COALESCE((SELECT -sum(l.qty_delta) FROM public.mm_stock_ledger l JOIN public.mm_stock_units u ON u.id = l.stock_unit_id WHERE u.style_material_id = sm.id AND l.entry_type = 'CONSUME'), 0) AS consumed,
  COALESCE((SELECT -sum(l.qty_delta) FROM public.mm_stock_ledger l JOIN public.mm_stock_units u ON u.id = l.stock_unit_id WHERE u.style_material_id = sm.id AND l.entry_type = 'WASTE'), 0) AS waste,
  COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.is_remnant IS TRUE AND u.status = 'in_stock'), 0) AS returned_from_cutting,
  COALESCE((SELECT sum(l.qty_delta) FROM public.mm_stock_ledger l JOIN public.mm_stock_units u ON u.id = l.stock_unit_id WHERE u.style_material_id = sm.id), 0) - COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id), 0) AS balance_check
FROM public.mm_style_materials sm
LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
LEFT JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id;

REVOKE ALL ON public.mm_v_style_fabric_reconciliation FROM PUBLIC, anon;
GRANT SELECT ON public.mm_v_style_fabric_reconciliation TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mm_get_style_reconciliation(p_style_material_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_lines jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_style_material_id IS NULL AND p_order_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style or order is required');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'style_material_id', v.style_material_id,
    'color_name', v.color_name,
    'fabric_name', v.fabric_name,
    'uom', v.uom,
    'required', v.required,
    'received', v.received,
    'qc_deducted', v.qc_deducted,
    'returned_to_supplier', v.returned_to_supplier,
    'written_off', v.written_off,
    'on_hand_warehouse', v.on_hand_warehouse,
    'at_cutting', v.at_cutting,
    'issued_to_cutting', v.issued_to_cutting,
    'consumed', v.consumed,
    'waste', v.waste,
    'returned_from_cutting', v.returned_from_cutting,
    'balance_check', v.balance_check
  ) ORDER BY v.color_name, v.fabric_name), '[]'::jsonb)
  INTO v_lines
  FROM public.mm_v_style_fabric_reconciliation v
  WHERE v.factory_id = v_factory
    AND (p_style_material_id IS NULL OR v.style_material_id = p_style_material_id)
    AND (p_order_id IS NULL OR v.order_id = p_order_id);
  RETURN public._mm_ok(jsonb_build_object('lines', v_lines));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_get_style_reconciliation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_get_style_reconciliation(uuid, uuid) TO authenticated, service_role;
;
