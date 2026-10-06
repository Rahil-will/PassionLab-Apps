-- Desktop (main app) shipment + rejection logging — admin-only, separate from floor capture RPCs.

CREATE OR REPLACE FUNCTION public.log_desktop_shipment(
  p_factory_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_operation_id uuid := NULLIF(p_payload->>'operationId', '')::uuid;
  v_visit_id uuid := NULLIF(p_payload->>'visitId', '')::uuid;
  v_ship_by_size jsonb := COALESCE(p_payload->'shippedQtyBySize', '{}'::jsonb);
  v_size_sum integer;
  v_po text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated', 'code', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT public.is_factory_admin() THEN
    RETURN jsonb_build_object('error', 'Not authorized', 'code', 'NOT_AUTHORIZED');
  END IF;

  IF v_order_id IS NULL OR v_colorway_id IS NULL THEN
    RETURN jsonb_build_object('error', 'orderId and colorwayId are required', 'code', 'MISSING_FIELDS');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = v_order_id AND factory_id = p_factory_id
  ) THEN
    RETURN jsonb_build_object('error', 'Order not found in factory', 'code', 'ORDER_NOT_FOUND');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.colorways
    WHERE id = v_colorway_id AND order_id = v_order_id
  ) THEN
    RETURN jsonb_build_object('error', 'Colorway not found', 'code', 'INVALID_COLORWAY');
  END IF;

  v_operation_id := COALESCE(v_operation_id, public.terminal_route_operation_id(v_order_id));
  IF v_operation_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Order has no routing steps — cannot log shipment',
      'code', 'MISSING_ROUTE'
    );
  END IF;

  IF v_visit_id IS NULL THEN
    SELECT ors.visit_id INTO v_visit_id
    FROM public.order_routing_steps ors
    WHERE ors.id = v_operation_id;
  END IF;

  IF COALESCE((p_payload->>'shippedQty')::integer, 0) <= 0 THEN
    RETURN jsonb_build_object('error', 'shippedQty must be a positive integer', 'code', 'INVALID_QTY');
  END IF;

  IF p_payload->>'shipmentType' IS NULL OR p_payload->>'shipmentType' NOT IN (
    'main', 'partial', 'replacement', 'sample', 'rejection_return'
  ) THEN
    RETURN jsonb_build_object('error', 'Invalid shipment type', 'code', 'INVALID_SHIPMENT_TYPE');
  END IF;

  IF v_ship_by_size <> '{}'::jsonb THEN
    v_size_sum := public.jsonb_sum_int_values(v_ship_by_size);
    IF v_size_sum <> (p_payload->>'shippedQty')::integer THEN
      RETURN jsonb_build_object(
        'error', 'shippedQtyBySize sum must equal shippedQty',
        'code', 'SIZE_TOTAL_MISMATCH',
        'details', jsonb_build_object(
          'shippedQty', (p_payload->>'shippedQty')::integer,
          'sizeSum', v_size_sum
        )
      );
    END IF;
  END IF;

  SELECT po_number INTO v_po
  FROM public.style_orders
  WHERE id = v_order_id AND factory_id = p_factory_id;

  INSERT INTO public.shipments (
    factory_id,
    order_id,
    colorway_id,
    order_route_id,
    visit_id,
    po_number,
    shipped_qty,
    shipped_qty_by_size,
    shipment_date,
    invoice_number,
    awb_number,
    destination,
    shipment_type,
    notes,
    logged_by,
    logged_at
  ) VALUES (
    p_factory_id,
    v_order_id,
    v_colorway_id,
    v_operation_id,
    v_visit_id,
    v_po,
    (p_payload->>'shippedQty')::integer,
    v_ship_by_size,
    COALESCE((p_payload->>'shipmentDate')::date, CURRENT_DATE),
    NULLIF(p_payload->>'invoiceNumber', ''),
    NULLIF(p_payload->>'awbNumber', ''),
    NULLIF(p_payload->>'destination', ''),
    p_payload->>'shipmentType',
    NULLIF(p_payload->>'notes', ''),
    v_user_id,
    COALESCE((p_payload->>'loggedAt')::timestamptz, now())
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'operationId', v_operation_id,
    'visitId', v_visit_id
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.log_desktop_rejection(
  p_factory_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_id uuid;
  v_order_id uuid := NULLIF(p_payload->>'orderId', '')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_operation_id uuid := NULLIF(p_payload->>'operationId', '')::uuid;
  v_payload_size text := NULLIF(p_payload->>'size', '');
  v_qty integer := COALESCE((p_payload->>'qty')::integer, 0);
  v_reason_code text := COALESCE(NULLIF(p_payload->>'reasonCode', ''), 'unknown');
  v_reason_detail text := NULLIF(p_payload->>'reasonDetail', '');
  v_stage text := COALESCE(NULLIF(p_payload->>'stage', ''), 'desktop');
  v_rejected_date date := COALESCE((p_payload->>'rejectedDate')::date, CURRENT_DATE);
  v_notes text := NULLIF(p_payload->>'notes', '');
  v_logged_at timestamptz := COALESCE((p_payload->>'loggedAt')::timestamptz, now());
  v_defect_summary jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated', 'code', 'NOT_AUTHENTICATED');
  END IF;

  IF NOT public.is_factory_admin() THEN
    RETURN jsonb_build_object('error', 'Not authorized', 'code', 'NOT_AUTHORIZED');
  END IF;

  IF v_order_id IS NULL OR v_colorway_id IS NULL THEN
    RETURN jsonb_build_object('error', 'orderId and colorwayId are required', 'code', 'MISSING_FIELDS');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders
    WHERE id = v_order_id AND factory_id = p_factory_id
  ) THEN
    RETURN jsonb_build_object('error', 'Order not found in factory', 'code', 'ORDER_NOT_FOUND');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.colorways
    WHERE id = v_colorway_id AND order_id = v_order_id
  ) THEN
    RETURN jsonb_build_object('error', 'Colorway not found', 'code', 'INVALID_COLORWAY');
  END IF;

  v_operation_id := COALESCE(v_operation_id, public.terminal_route_operation_id(v_order_id));
  IF v_operation_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Order has no routing steps — cannot log rejection',
      'code', 'MISSING_ROUTE'
    );
  END IF;

  IF v_qty <= 0 THEN
    RETURN jsonb_build_object('error', 'qty must be a positive integer', 'code', 'INVALID_QTY');
  END IF;

  v_defect_summary := jsonb_build_object(v_reason_code, v_qty);

  INSERT INTO public.rejections (
    factory_id,
    order_id,
    colorway_id,
    order_route_id,
    size,
    qty,
    reason_code,
    reason_detail,
    defect_summary,
    rejected_qty_by_size,
    image_urls,
    stage,
    rejected_date,
    notes,
    logged_by,
    logged_at
  ) VALUES (
    p_factory_id,
    v_order_id,
    v_colorway_id,
    v_operation_id,
    v_payload_size,
    v_qty,
    v_reason_code,
    v_reason_detail,
    v_defect_summary,
    CASE
      WHEN v_payload_size IS NOT NULL THEN jsonb_build_object(v_payload_size, v_qty)
      ELSE '{}'::jsonb
    END,
    ARRAY[]::text[],
    v_stage,
    v_rejected_date,
    v_notes,
    v_user_id,
    v_logged_at
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'operationId', v_operation_id,
    'inserted', 1
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.log_desktop_shipment(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_desktop_rejection(uuid, jsonb) TO authenticated;
