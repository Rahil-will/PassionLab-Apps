-- When Mark Handover Complete / Reopen runs, stamp handover_slips.handover_status
-- and allow store/ministore (no line_allocations) to succeed if slips update.

CREATE OR REPLACE FUNCTION public.floor_capture_allocation_complete(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_factory_id uuid := (p_payload->>'factoryId')::uuid;
  v_user_id uuid := (p_payload->>'userId')::uuid;
  v_allocation_id uuid := NULLIF(p_payload->>'allocationId', '')::uuid;
  v_line_id uuid := NULLIF(p_payload->>'resourceId', '')::uuid;
  v_order_id uuid := (p_payload->>'orderId')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_department_id uuid := (p_payload->>'departmentId')::uuid;
  v_visit_id uuid := NULLIF(p_payload->>'visitId', '')::uuid;
  v_completion_type text := COALESCE(NULLIF(p_payload->>'completionType', ''), 'production');
  v_updated integer := 0;
  v_slips_updated integer := 0;
BEGIN
  IF v_allocation_id IS NOT NULL THEN
    IF v_completion_type = 'production' THEN
      UPDATE public.line_allocations
      SET
        production_completed_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        production_completed_by = v_user_id,
        production_comments = NULLIF(p_payload->>'comments', ''),
        production_planned_qty = NULLIF(p_payload->>'plannedQty', '')::integer,
        production_produced_qty = NULLIF(p_payload->>'producedQty', '')::integer
      WHERE id = v_allocation_id
        AND factory_id = v_factory_id;
    ELSE
      UPDATE public.line_allocations
      SET
        handover_completed_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        handover_completed_by = v_user_id,
        handover_comments = NULLIF(p_payload->>'comments', ''),
        handover_produced_qty = NULLIF(p_payload->>'producedQty', '')::integer,
        handover_sent_qty = NULLIF(p_payload->>'sentQty', '')::integer,
        handover_available_qty = NULLIF(p_payload->>'availableQty', '')::integer
      WHERE id = v_allocation_id
        AND factory_id = v_factory_id;
    END IF;
  ELSE
    IF v_line_id IS NULL OR v_order_id IS NULL OR v_department_id IS NULL THEN
      RETURN public.floor_capture_fail('allocationId or (resourceId, orderId and departmentId) are required', 'MISSING_FIELDS');
    END IF;

    IF v_completion_type = 'production' THEN
      UPDATE public.line_allocations
      SET
        production_completed_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        production_completed_by = v_user_id,
        production_comments = NULLIF(p_payload->>'comments', ''),
        production_planned_qty = NULLIF(p_payload->>'plannedQty', '')::integer,
        production_produced_qty = NULLIF(p_payload->>'producedQty', '')::integer
      WHERE factory_id = v_factory_id
        AND line_id = v_line_id
        AND order_id = v_order_id
        AND colorway_id IS NOT DISTINCT FROM v_colorway_id
        AND department_id = v_department_id
        AND (v_visit_id IS NULL OR visit_id = v_visit_id);
    ELSE
      UPDATE public.line_allocations
      SET
        handover_completed_at = COALESCE((p_payload->>'loggedAt')::timestamptz, now()),
        handover_completed_by = v_user_id,
        handover_comments = NULLIF(p_payload->>'comments', ''),
        handover_produced_qty = NULLIF(p_payload->>'producedQty', '')::integer,
        handover_sent_qty = NULLIF(p_payload->>'sentQty', '')::integer,
        handover_available_qty = NULLIF(p_payload->>'availableQty', '')::integer
      WHERE factory_id = v_factory_id
        AND line_id = v_line_id
        AND order_id = v_order_id
        AND colorway_id IS NOT DISTINCT FROM v_colorway_id
        AND department_id = v_department_id
        AND (v_visit_id IS NULL OR visit_id = v_visit_id);
    END IF;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_completion_type = 'handover'
     AND v_order_id IS NOT NULL
     AND v_department_id IS NOT NULL THEN
    UPDATE public.handover_slips
    SET handover_status = true
    WHERE factory_id = v_factory_id
      AND order_id = v_order_id
      AND colorway_id IS NOT DISTINCT FROM v_colorway_id
      AND from_department_id = v_department_id
      AND (v_visit_id IS NULL OR from_visit_id = v_visit_id);
    GET DIAGNOSTICS v_slips_updated = ROW_COUNT;
  END IF;

  IF v_updated = 0 THEN
    IF v_completion_type = 'handover' AND v_slips_updated > 0 THEN
      RETURN jsonb_build_object('ok', true, 'slipsUpdated', v_slips_updated);
    END IF;
    RETURN public.floor_capture_fail('No matching line allocation found', 'ALLOCATION_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true, 'slipsUpdated', v_slips_updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_capture_allocation_reopen(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_factory_id uuid := (p_payload->>'factoryId')::uuid;
  v_allocation_id uuid := NULLIF(p_payload->>'allocationId', '')::uuid;
  v_line_id uuid := NULLIF(p_payload->>'resourceId', '')::uuid;
  v_order_id uuid := (p_payload->>'orderId')::uuid;
  v_colorway_id uuid := NULLIF(p_payload->>'colorwayId', '')::uuid;
  v_department_id uuid := NULLIF(p_payload->>'departmentId', '')::uuid;
  v_visit_id uuid := NULLIF(p_payload->>'visitId', '')::uuid;
  v_completion_type text := COALESCE(NULLIF(p_payload->>'completionType', ''), 'production');
BEGIN
  IF v_allocation_id IS NOT NULL THEN
    IF v_completion_type = 'production' THEN
      UPDATE public.line_allocations
      SET
        production_completed_at = NULL,
        production_completed_by = NULL,
        production_comments = NULL,
        production_planned_qty = NULL,
        production_produced_qty = NULL
      WHERE id = v_allocation_id
        AND factory_id = v_factory_id;
    ELSE
      UPDATE public.line_allocations
      SET
        handover_completed_at = NULL,
        handover_completed_by = NULL,
        handover_comments = NULL,
        handover_produced_qty = NULL,
        handover_sent_qty = NULL,
        handover_available_qty = NULL
      WHERE id = v_allocation_id
        AND factory_id = v_factory_id;
    END IF;
  ELSE
    IF v_completion_type = 'production' THEN
      UPDATE public.line_allocations
      SET
        production_completed_at = NULL,
        production_completed_by = NULL,
        production_comments = NULL,
        production_planned_qty = NULL,
        production_produced_qty = NULL
      WHERE factory_id = v_factory_id
        AND line_id = v_line_id
        AND order_id = v_order_id
        AND colorway_id IS NOT DISTINCT FROM v_colorway_id
        AND (v_department_id IS NULL OR department_id = v_department_id)
        AND (v_visit_id IS NULL OR visit_id = v_visit_id);
    ELSE
      UPDATE public.line_allocations
      SET
        handover_completed_at = NULL,
        handover_completed_by = NULL,
        handover_comments = NULL,
        handover_produced_qty = NULL,
        handover_sent_qty = NULL,
        handover_available_qty = NULL
      WHERE factory_id = v_factory_id
        AND line_id = v_line_id
        AND order_id = v_order_id
        AND colorway_id IS NOT DISTINCT FROM v_colorway_id
        AND (v_department_id IS NULL OR department_id = v_department_id)
        AND (v_visit_id IS NULL OR visit_id = v_visit_id);
    END IF;
  END IF;

  IF v_completion_type = 'handover'
     AND v_order_id IS NOT NULL
     AND v_department_id IS NOT NULL THEN
    UPDATE public.handover_slips
    SET handover_status = false
    WHERE factory_id = v_factory_id
      AND order_id = v_order_id
      AND colorway_id IS NOT DISTINCT FROM v_colorway_id
      AND from_department_id = v_department_id
      AND (v_visit_id IS NULL OR from_visit_id = v_visit_id);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;;
