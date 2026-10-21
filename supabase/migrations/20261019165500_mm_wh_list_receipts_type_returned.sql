-- Receipts list carries fabric type and qty that later came back from processing.
-- One read: mm_wh_list_receipts. No follow-up lookup for the type.

CREATE OR REPLACE FUNCTION public.mm_wh_list_receipts(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_q text;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_wh_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search', ''))), '');
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(row ORDER BY (row->>'received_at') DESC, row->>'grn_no' DESC) FROM (
      SELECT jsonb_build_object(
        'id', c.id, 'grn_no', COALESCE(c.grn_no, c.challan_no), 'received_at', c.received_at,
        'source', COALESCE(c.receipt_source, CASE WHEN c.source = 'inhouse' THEN 'internal' ELSE 'external' END),
        'from', COALESCE((SELECT jsonb_build_object('id', x.id, 'name', x.name) FROM public.mm_fabric_vendors x WHERE x.id = c.from_facility_id),
                         jsonb_build_object('id', NULL, 'name', c.supplier_name)),
        'party_challan_no', c.party_challan_no, 'invoice_ref', c.invoice_ref, 'lr_no', c.lr_no, 'container_no', c.container_no, 'po_no', c.po_no,
        'purpose', c.purpose, 'customer_name', c.customer_name, 'po_ref', c.po_ref,
        'style', public._mm_style_label(c.style_material_id), 'style_material_id', c.style_material_id,
        'fabric', (SELECT jsonb_build_object(
                     'id', fb.id, 'code', fb.code, 'name', fb.name,
                     'type_id', ft.id, 'type_name', ft.name)
                   FROM public.mm_fabrics fb
                   LEFT JOIN public.mm_fabric_types ft ON ft.id = fb.fabric_type_id
                   WHERE fb.id = COALESCE(c.fabric_id, (SELECT r.fabric_id FROM public.mm_stock_units u JOIN public.mm_rolls r ON r.id = u.roll_id WHERE u.id IN (SELECT ru.unit_id FROM public._mm_receipt_units(c.id) ru) LIMIT 1))),
        'stage_code', c.stage_code,
        'stage_label', (SELECT s.label FROM public.mm_fabric_stages s WHERE s.factory_id = c.factory_id AND s.code = c.stage_code),
        'color', c.color_ref,
        'rolls', (SELECT count(*) FROM public._mm_receipt_units(c.id)),
        'qty', (SELECT COALESCE(sum(ru.qty), 0) FROM public._mm_receipt_units(c.id) ru),
        'returned_qty', (
          SELECT COALESCE(sum(rl.qty), 0)
          FROM public.mm_process_return_lines rl
          JOIN public.mm_process_returns pr ON pr.id = rl.return_id
          WHERE pr.factory_id = c.factory_id
            AND pr.in_challan_id IS DISTINCT FROM c.id
            AND rl.stock_unit_id IN (SELECT ru.unit_id FROM public._mm_receipt_units(c.id) ru)),
        'returned_rolls', (
          SELECT count(DISTINCT rl.stock_unit_id)
          FROM public.mm_process_return_lines rl
          JOIN public.mm_process_returns pr ON pr.id = rl.return_id
          WHERE pr.factory_id = c.factory_id
            AND pr.in_challan_id IS DISTINCT FROM c.id
            AND rl.stock_unit_id IN (SELECT ru.unit_id FROM public._mm_receipt_units(c.id) ru)),
        'process_challan', (SELECT jsonb_build_object('id', pc.id, 'no', pc.challan_no) FROM public.mm_process_challans pc WHERE pc.id = c.process_challan_id),
        'uom', (SELECT max(COALESCE(u.qty_uom, u.uom)) FROM public.mm_stock_units u WHERE u.id IN (SELECT ru.unit_id FROM public._mm_receipt_units(c.id) ru)),
        'qc_pending', (SELECT count(*) FROM public.mm_stock_units u WHERE u.id IN (SELECT ru.unit_id FROM public._mm_receipt_units(c.id) ru)
                       AND (public._mm_qc_passport(u.roll_id)->'test'->>'status' <> 'PASS'
                            OR public._mm_qc_passport(u.roll_id)->'inspection'->>'status' <> 'PASS'))
      ) AS row
      FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory AND c.status <> 'pending'
        AND (NULLIF(p_filter->>'source', '') IS NULL OR COALESCE(c.receipt_source, CASE WHEN c.source = 'inhouse' THEN 'internal' ELSE 'external' END) = p_filter->>'source')
        AND (NULLIF(p_filter->>'purpose', '') IS NULL OR c.purpose = p_filter->>'purpose')
        AND (v_q IS NULL OR lower(COALESCE(c.grn_no, c.challan_no)) LIKE '%' || v_q || '%' OR lower(COALESCE(c.supplier_name, '')) LIKE '%' || v_q || '%'
             OR lower(COALESCE(c.invoice_ref, '')) LIKE '%' || v_q || '%' OR lower(COALESCE(c.party_challan_no, '')) LIKE '%' || v_q || '%'
             OR lower(COALESCE(c.po_no, '')) LIKE '%' || v_q || '%')
      ORDER BY c.received_at DESC NULLS LAST LIMIT COALESCE(NULLIF(p_filter->>'limit', '')::int, 200)
    ) z), '[]'::jsonb)));
END $function$;
