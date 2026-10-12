-- Roll-level cutting receive, and a per-style fabric balance.
-- End-bit return stays on mm_save_lay_consumptions. Shade band is not in this change.
-- mm_get_store_challan is patched from the live body.

ALTER TABLE public.mm_store_challan_lines
  ADD COLUMN IF NOT EXISTS line_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.profiles (id);

ALTER TABLE public.mm_store_challan_lines
  DROP CONSTRAINT IF EXISTS mm_store_challan_lines_status_chk;

ALTER TABLE public.mm_store_challan_lines
  ADD CONSTRAINT mm_store_challan_lines_status_chk
  CHECK (line_status = ANY (ARRAY['pending'::text, 'received'::text, 'missing'::text]));

ALTER TABLE public.mm_store_challans
  DROP CONSTRAINT IF EXISTS mm_store_challans_status_chk;

ALTER TABLE public.mm_store_challans
  ADD CONSTRAINT mm_store_challans_status_chk
  CHECK (status = ANY (ARRAY['pending'::text, 'received'::text, 'partial'::text]));

UPDATE public.mm_store_challan_lines l
SET line_status = 'received',
    received_at = COALESCE(l.received_at, c.received_at, now()),
    received_by = COALESCE(l.received_by, c.received_by)
FROM public.mm_store_challans c
WHERE c.id = l.challan_id
  AND c.status = 'received'
  AND l.line_status = 'pending';

CREATE OR REPLACE FUNCTION public.mm_receive_store_challan(p_id uuid, p_missing_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sc public.mm_store_challans%ROWTYPE;
  v_id uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_missing int := 0;
  v_received int := 0;
  v_status text;
  v_missing_ids uuid[];
BEGIN
  v_missing_ids := ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(p_missing_unit_ids, ARRAY[]::uuid[])) AS x
  );
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  SELECT * INTO v_sc
  FROM public.mm_store_challans
  WHERE id = p_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Store challan not found'); END IF;
  IF v_sc.status IN ('received', 'partial') THEN
    RETURN public._mm_err('ALREADY', 'Already received');
  END IF;

  FOREACH v_id IN ARRAY v_missing_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_store_challan_lines l
      WHERE l.challan_id = v_sc.id AND l.stock_unit_id = v_id
    ) THEN
      RETURN public._mm_err('INVALID', 'A missing roll is not on this challan');
    END IF;
    SELECT * INTO v_unit
    FROM public.mm_stock_units
    WHERE id = v_id AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    IF v_unit.status IS DISTINCT FROM 'issued' THEN
      RETURN public._mm_err('INVALID', v_unit.unit_code || ' is not still at cutting');
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_missing_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id FOR UPDATE;
    PERFORM public._mm_ledger(
      v_factory, v_id, 'WRITE_OFF', v_unit.qty_available,
      v_unit.status, 'missing',
      v_unit.current_location_id, NULL,
      'mm_store_challans', v_sc.id, 'missing at cutting receive'
    );
    UPDATE public.mm_stock_units
    SET status = 'missing',
        current_location_id = NULL,
        updated_at = now(),
        updated_by = public._mm_actor_id()
    WHERE id = v_id;
    UPDATE public.mm_store_challan_lines
    SET line_status = 'missing',
        received_at = now(),
        received_by = public._mm_actor_id()
    WHERE challan_id = v_sc.id AND stock_unit_id = v_id;
    v_missing := v_missing + 1;
  END LOOP;

  UPDATE public.mm_store_challan_lines
  SET line_status = 'received',
      received_at = now(),
      received_by = public._mm_actor_id()
  WHERE challan_id = v_sc.id
    AND line_status = 'pending'
    AND NOT (stock_unit_id = ANY (v_missing_ids));
  GET DIAGNOSTICS v_received = ROW_COUNT;

  v_status := CASE WHEN v_missing > 0 THEN 'partial' ELSE 'received' END;
  UPDATE public.mm_store_challans
  SET status = v_status,
      received_at = now(),
      received_by = public._mm_actor_id(),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = v_sc.id;

  RETURN public._mm_ok(jsonb_build_object(
    'id', v_sc.id,
    'status', v_status,
    'received_rolls', v_received,
    'missing_rolls', v_missing
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_receive_store_challan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN public.mm_receive_store_challan(p_id, NULL::uuid[]);
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_receive_store_challan(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_receive_store_challan(uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.mm_v_style_fabric_reconciliation
WITH (security_invoker = true) AS
SELECT
  sm.factory_id,
  sm.id AS style_material_id,
  sm.order_id,
  cw.name AS color_name,
  COALESCE(ft.name, 'Fabric') AS fabric_name,
  COALESCE(
    NULLIF(trim(cm.unit), ''),
    (SELECT u.qty_uom FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.qty_uom IS NOT NULL LIMIT 1)
  ) AS uom,
  cm.total_cons AS required,
  COALESCE((
    SELECT sum(COALESCE(u.qty_received, u.length_m))
    FROM public.mm_stock_units u
    WHERE u.style_material_id = sm.id
      AND u.status IN ('pending_qc', 'in_stock', 'rejected', 'issued', 'consumed')
  ), 0) AS received,
  COALESCE((
    SELECT -sum(l.qty_delta)
    FROM public.mm_stock_ledger l
    JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
    WHERE u.style_material_id = sm.id AND l.entry_type = 'QC_DEDUCT'
  ), 0) AS qc_deducted,
  COALESCE((
    SELECT -sum(l.qty_delta)
    FROM public.mm_stock_ledger l
    JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
    WHERE u.style_material_id = sm.id AND l.entry_type = 'RETURN_TO_SUPPLIER'
  ), 0) AS returned_to_supplier,
  COALESCE((
    SELECT -sum(l.qty_delta)
    FROM public.mm_stock_ledger l
    JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
    WHERE u.style_material_id = sm.id AND l.entry_type = 'WRITE_OFF'
  ), 0) AS written_off,
  COALESCE((
    SELECT sum(u.qty_available)
    FROM public.mm_stock_units u
    JOIN public.mm_locations loc ON loc.id = u.current_location_id
    WHERE u.style_material_id = sm.id
      AND u.status IN ('pending_qc', 'in_stock', 'rejected')
      AND loc.location_type IN ('receiving', 'rack', 'bin', 'rejected')
  ), 0) AS on_hand_warehouse,
  COALESCE((
    SELECT sum(u.qty_available)
    FROM public.mm_stock_units u
    WHERE u.style_material_id = sm.id AND u.status = 'issued'
  ), 0) AS at_cutting,
  COALESCE((
    SELECT sum(l.qty)
    FROM public.mm_stock_ledger l
    JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
    WHERE u.style_material_id = sm.id AND l.entry_type = 'ISSUE_TO_CUTTING'
  ), 0) AS issued_to_cutting,
  COALESCE((
    SELECT -sum(l.qty_delta)
    FROM public.mm_stock_ledger l
    JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
    WHERE u.style_material_id = sm.id AND l.entry_type = 'CONSUME'
  ), 0) AS consumed,
  COALESCE((
    SELECT -sum(l.qty_delta)
    FROM public.mm_stock_ledger l
    JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
    WHERE u.style_material_id = sm.id AND l.entry_type = 'WASTE'
  ), 0) AS waste,
  COALESCE((
    SELECT sum(u.qty_available)
    FROM public.mm_stock_units u
    WHERE u.style_material_id = sm.id AND u.is_remnant IS TRUE AND u.status = 'in_stock'
  ), 0) AS returned_from_cutting,
  COALESCE((
    SELECT sum(l.qty_delta)
    FROM public.mm_stock_ledger l
    JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
    WHERE u.style_material_id = sm.id
  ), 0) - COALESCE((
    SELECT sum(u.qty_available)
    FROM public.mm_stock_units u
    WHERE u.style_material_id = sm.id
  ), 0) AS balance_check
FROM public.mm_style_materials sm
LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
LEFT JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id;

REVOKE ALL ON public.mm_v_style_fabric_reconciliation FROM PUBLIC, anon;
GRANT SELECT ON public.mm_v_style_fabric_reconciliation TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mm_get_style_reconciliation(
  p_style_material_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
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

CREATE OR REPLACE FUNCTION public.mm_get_store_challan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sc public.mm_store_challans%ROWTYPE;
  v_type uuid;
  v_header jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_sc FROM public.mm_store_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Dispatch challan not found'); END IF;

  SELECT sm.fabric_type_id INTO v_type
  FROM public.mm_style_materials sm
  WHERE sm.id = v_sc.style_material_id;

  SELECT jsonb_build_object(
    'id', v_sc.id,
    'challan_no', v_sc.challan_no,
    'status', v_sc.status,
    'sent_at', v_sc.sent_at,
    'received_at', v_sc.received_at,
    'reference_no', v_sc.reference_no,
    'remarks', v_sc.remarks,
    'row_version', v_sc.row_version,
    'factory_name', (SELECT f.name FROM public.factories f WHERE f.id = v_factory),
    'factory_code', (SELECT f.code FROM public.factories f WHERE f.id = v_factory),
    'order_id', o.id,
    'image_url', o.image_url,
    'style_name', o.style_name,
    'style_ref', o.style_ref,
    'buyer_name', o.buyer_name,
    'po_number', o.po_number,
    'color_name', cw.name,
    'fabric_type_id', sm.fabric_type_id,
    'fabric_type', ft.name,
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
    'uom', COALESCE(
      (
        SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
        WHERE u.store_challan_id = v_sc.id LIMIT 1
      ),
      NULLIF(trim(cm.unit), '')
    ),
    'qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.store_challan_id = v_sc.id
    ),
    'roll_count', (SELECT count(*) FROM public.mm_store_challan_lines l WHERE l.challan_id = v_sc.id),
    'received_roll_count', (
      SELECT count(*) FROM public.mm_store_challan_lines l
      WHERE l.challan_id = v_sc.id AND l.line_status = 'received'
    )
  ) INTO v_header
  FROM public.mm_style_materials sm
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
  WHERE sm.id = v_sc.style_material_id;

  RETURN public._mm_ok(jsonb_build_object(
    'challan', v_header,
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'key', f.key,
        'label', f.label,
        'data_type', f.data_type,
        'options', f.options
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory
        AND f.type_id = v_type
        AND f.is_active
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'status', u.status,
        'length_m', u.length_m,
        'weight_kg', u.weight_kg,
        'shade', u.shade,
        'lot_no', u.lot_no,
        'attributes', u.attributes,
        'source', u.source,
        'batch_no', COALESCE(b.batch_no, NULLIF(trim(u.mill_snapshot->>'batch_no'), '')),
        'mill_snapshot', u.mill_snapshot,
        'location_code', loc.code,
        'location_name', loc.name,
        'line_status', l.line_status
      ) ORDER BY u.unit_code)
      FROM public.mm_store_challan_lines l
      JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE l.challan_id = v_sc.id
    ), '[]'::jsonb)
  ));
END;
$fn$;

NOTIFY pgrst, 'reload schema';
