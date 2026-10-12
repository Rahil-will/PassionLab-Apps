CREATE OR REPLACE FUNCTION public.save_style_order(p_factory_id uuid, p_order jsonb, p_colorways jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id          uuid;
  v_cw                jsonb;
  v_cw_id             uuid;
  v_keep_cw_ids       uuid[] := ARRAY[]::uuid[];
  v_keep_mat_ids      uuid[] := ARRAY[]::uuid[];
  v_mat               jsonb;
  v_seq               integer;
  v_is_update         boolean;
  v_internal_no       text;
  v_line              jsonb;
  v_line_id           uuid;
  v_line_cw_id        uuid;
  v_keep_line_ids     uuid[] := ARRAY[]::uuid[];
  v_ship              jsonb;
  v_existing_date     date;
  v_existing_status   text;
  v_new_date          date;
  v_history           jsonb;
  v_reason            text;
  v_line_reason       text;
BEGIN
  IF p_factory_id IS NULL THEN RAISE EXCEPTION 'factory_id is required'; END IF;
  IF p_factory_id IS DISTINCT FROM public.current_factory_id() THEN RAISE EXCEPTION 'Factory mismatch'; END IF;
  IF NOT public.is_factory_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_order IS NULL OR p_order = '{}'::jsonb THEN RAISE EXCEPTION 'order payload required'; END IF;

  v_order_id  := NULLIF(trim(p_order->>'id'), '')::uuid;
  v_is_update := v_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.style_orders WHERE id = v_order_id AND factory_id = p_factory_id
  );

  IF v_is_update THEN
    UPDATE public.style_orders SET
      style_name         = NULLIF(p_order->>'style_name', ''),
      style_ref          = NULLIF(p_order->>'style_ref', ''),
      buyer_id           = NULLIF(p_order->>'buyer_id', '')::uuid,
      buyer_name         = NULLIF(p_order->>'buyer_name', ''),
      po_number          = COALESCE(NULLIF(p_order->>'po_number', ''), po_number),
      order_qty          = COALESCE((p_order->>'order_qty')::integer, 0),
      adj_qty            = COALESCE((p_order->>'adj_qty')::integer, 0),
      order_date         = NULLIF(p_order->>'order_date', '')::date,
      job_card_date      = NULLIF(p_order->>'job_card_date', '')::date,
      season             = NULLIF(p_order->>'season', ''),
      garment_type       = NULLIF(p_order->>'garment_type', ''),
      sewing_sam         = NULLIF(p_order->>'sewing_sam', '')::numeric,
      priority           = COALESCE(NULLIF(p_order->>'priority', ''), priority),
      order_type         = COALESCE(NULLIF(p_order->>'order_type', ''), order_type),
      merchant_name      = NULLIF(p_order->>'merchant_name', ''),
      size_group_name    = NULLIF(p_order->>'size_group_name', ''),
      size_labels        = NULLIF(p_order->>'size_labels', ''),
      current_dept       = COALESCE(NULLIF(p_order->>'current_dept', ''), current_dept),
      status             = COALESCE(NULLIF(p_order->>'status', ''), status),
      image_url          = NULLIF(p_order->>'image_url', ''),
      remarks            = NULLIF(p_order->>'remarks', ''),
      cutting_allowance  = COALESCE((p_order->>'cutting_allowance')::numeric, cutting_allowance),
      shipment_allowance = COALESCE((p_order->>'shipment_allowance')::numeric, shipment_allowance),
      updated_at         = now()
    WHERE id = v_order_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  ELSE
    v_order_id    := COALESCE(v_order_id, gen_random_uuid());
    v_internal_no := public.next_internal_order_no(p_factory_id);
    INSERT INTO public.style_orders (
      id, factory_id, internal_order_no,
      style_name, style_ref, buyer_id, buyer_name, po_number,
      order_qty, adj_qty, order_date, job_card_date,
      season, garment_type, sewing_sam, priority, order_type,
      merchant_name, size_group_name, size_labels,
      current_dept, status, image_url, remarks,
      cutting_allowance, shipment_allowance
    ) VALUES (
      v_order_id, p_factory_id, v_internal_no,
      NULLIF(p_order->>'style_name', ''),
      NULLIF(p_order->>'style_ref', ''),
      NULLIF(p_order->>'buyer_id', '')::uuid,
      NULLIF(p_order->>'buyer_name', ''),
      COALESCE(NULLIF(p_order->>'po_number', ''), ''),
      COALESCE((p_order->>'order_qty')::integer, 0),
      COALESCE((p_order->>'adj_qty')::integer, 0),
      NULLIF(p_order->>'order_date', '')::date,
      NULLIF(p_order->>'job_card_date', '')::date,
      NULLIF(p_order->>'season', ''),
      NULLIF(p_order->>'garment_type', ''),
      NULLIF(p_order->>'sewing_sam', '')::numeric,
      COALESCE(NULLIF(p_order->>'priority', ''), 'normal'),
      COALESCE(NULLIF(p_order->>'order_type', ''), 'new'),
      NULLIF(p_order->>'merchant_name', ''),
      NULLIF(p_order->>'size_group_name', ''),
      NULLIF(p_order->>'size_labels', ''),
      COALESCE(NULLIF(p_order->>'current_dept', ''), 'Planned'),
      COALESCE(NULLIF(p_order->>'status', ''), 'Not Started'),
      NULLIF(p_order->>'image_url', ''),
      NULLIF(p_order->>'remarks', ''),
      COALESCE((p_order->>'cutting_allowance')::numeric, 2),
      COALESCE((p_order->>'shipment_allowance')::numeric, 0)
    );
  END IF;

  IF p_colorways IS NOT NULL AND jsonb_typeof(p_colorways) = 'array' THEN
    FOR v_cw IN SELECT value FROM jsonb_array_elements(p_colorways) LOOP
      v_cw_id := NULLIF(trim(v_cw->>'id'), '')::uuid;
      IF v_cw_id IS NULL THEN v_cw_id := gen_random_uuid(); END IF;
      v_keep_cw_ids := array_append(v_keep_cw_ids, v_cw_id);

      INSERT INTO public.colorways (
        id, order_id, factory_id, name, color_code, qty, adj_qty, sizes, planning_remarks
      ) VALUES (
        v_cw_id, v_order_id, p_factory_id,
        COALESCE(NULLIF(v_cw->>'name', ''), 'Color'),
        COALESCE(NULLIF(v_cw->>'color_code', ''), ''),
        COALESCE((v_cw->>'qty')::integer, 0),
        COALESCE((v_cw->>'adj_qty')::integer, 0),
        COALESCE(v_cw->'sizes', '[]'::jsonb),
        NULLIF(v_cw->>'planning_remarks', '')
      )
      ON CONFLICT (id) DO UPDATE SET
        name             = EXCLUDED.name,
        color_code       = EXCLUDED.color_code,
        qty              = EXCLUDED.qty,
        adj_qty          = EXCLUDED.adj_qty,
        sizes            = EXCLUDED.sizes,
        planning_remarks = EXCLUDED.planning_remarks,
        updated_at       = now();

      IF jsonb_typeof(COALESCE(v_cw->'materials', '[]'::jsonb)) = 'array' THEN
        FOR v_mat, v_seq IN
          SELECT t.elem, t.ord::integer
          FROM jsonb_array_elements(COALESCE(v_cw->'materials', '[]'::jsonb))
            WITH ORDINALITY AS t(elem, ord)
        LOOP
          v_keep_mat_ids := array_append(
            v_keep_mat_ids,
            public._upsert_colorway_material(p_factory_id, v_order_id, v_cw_id, v_mat, v_seq)
          );
        END LOOP;
      END IF;
    END LOOP;

    DELETE FROM public.colorways
    WHERE order_id = v_order_id AND id <> ALL (v_keep_cw_ids);

    DELETE FROM public.colorway_materials
    WHERE order_id = v_order_id
      AND NOT (id = ANY (v_keep_mat_ids));
  END IF;

  v_ship := COALESCE(p_order->'shipment_plan', '{}'::jsonb);

  IF v_ship ? 'lines' AND jsonb_typeof(v_ship->'lines') = 'array' THEN
    v_reason := NULLIF(trim(p_order->>'date_change_reason'), '');

    FOR v_line IN SELECT value FROM jsonb_array_elements(v_ship->'lines') LOOP
      v_line_cw_id := NULLIF(trim(v_line->>'colorwayId'), '')::uuid;
      IF v_line_cw_id IS NULL THEN CONTINUE; END IF;

      v_line_id  := NULLIF(trim(v_line->>'id'), '')::uuid;
      v_new_date := NULLIF(v_line->>'shipmentDate', '')::date;

      IF v_line_id IS NULL THEN
        v_line_id := gen_random_uuid();
        v_keep_line_ids := array_append(v_keep_line_ids, v_line_id);

        INSERT INTO public.order_delivery_targets (
          id, factory_id, order_id, colorway_id,
          target_date, ship_mode, shipment_type,
          qty_by_size, destination_country,
          status, change_history, notes, updated_at
        ) VALUES (
          v_line_id, p_factory_id, v_order_id, v_line_cw_id,
          v_new_date,
          NULLIF(v_line->>'shipMode', ''),
          NULLIF(v_line->>'shipmentType', ''),
          COALESCE(v_line->'sizes', '{}'::jsonb),
          NULLIF(trim(v_line->>'destinationCountry'), ''),
          'planned',
          COALESCE(
            CASE
              WHEN v_line ? 'changeHistory' AND jsonb_typeof(v_line->'changeHistory') = 'array'
              THEN v_line->'changeHistory'
              ELSE NULL
            END,
            '[]'::jsonb
          ),
          NULLIF(trim(v_line->>'notes'), ''),
          now()
        );
      ELSE
        v_keep_line_ids := array_append(v_keep_line_ids, v_line_id);

        SELECT target_date, status, COALESCE(change_history, '[]'::jsonb)
          INTO v_existing_date, v_existing_status, v_history
          FROM public.order_delivery_targets
          WHERE id = v_line_id AND order_id = v_order_id AND factory_id = p_factory_id;

        v_line_reason := NULLIF(trim(v_line->>'dateChangeReason'), '');

        IF v_existing_date IS NOT NULL
           AND v_existing_date IS DISTINCT FROM v_new_date
           AND COALESCE(v_line_reason, v_reason) IS NOT NULL THEN
          v_history := v_history || jsonb_build_object(
            'previous_date', v_existing_date::text,
            'new_date',       v_new_date::text,
            'reason',         COALESCE(v_line_reason, v_reason),
            'changed_at',     now()::text,
            'changed_by',     auth.uid()::text
          );
        END IF;

        IF v_history IS NULL THEN v_history := '[]'::jsonb; END IF;

        INSERT INTO public.order_delivery_targets (
          id, factory_id, order_id, colorway_id,
          target_date, ship_mode, shipment_type,
          qty_by_size, destination_country,
          status, change_history, notes, updated_at
        ) VALUES (
          v_line_id, p_factory_id, v_order_id, v_line_cw_id,
          v_new_date,
          NULLIF(v_line->>'shipMode', ''),
          NULLIF(v_line->>'shipmentType', ''),
          COALESCE(v_line->'sizes', '{}'::jsonb),
          NULLIF(trim(v_line->>'destinationCountry'), ''),
          CASE
            WHEN NULLIF(v_line->>'status', '') = 'rescheduled' THEN 'rescheduled'
            WHEN v_existing_date IS NOT NULL AND v_existing_date IS DISTINCT FROM v_new_date THEN 'replanned'
            WHEN v_existing_status IN ('planned', 'replanned') THEN v_existing_status
            ELSE 'planned'
          END,
          v_history,
          NULLIF(trim(v_line->>'notes'), ''),
          now()
        )
        ON CONFLICT (id) DO UPDATE SET
          target_date         = EXCLUDED.target_date,
          ship_mode           = EXCLUDED.ship_mode,
          shipment_type       = EXCLUDED.shipment_type,
          qty_by_size         = EXCLUDED.qty_by_size,
          destination_country = EXCLUDED.destination_country,
          status              = EXCLUDED.status,
          change_history      = EXCLUDED.change_history,
          notes               = EXCLUDED.notes,
          updated_at          = now();
      END IF;
    END LOOP;

    DELETE FROM public.order_delivery_targets
    WHERE order_id = v_order_id
      AND id <> ALL (v_keep_line_ids)
      AND COALESCE(status, 'planned') IS DISTINCT FROM 'rescheduled';
  END IF;
  PERFORM public.log_audit_event(p_factory_id, CASE WHEN v_is_update THEN 'update' ELSE 'insert' END, 'style_order', v_order_id, '{}'::jsonb);

  RETURN v_order_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_style_order(uuid, jsonb, jsonb) TO authenticated, service_role;

DROP VIEW IF EXISTS public.colorway_material_lines;
DROP TRIGGER IF EXISTS colorways_materials_ensure_placement_trg ON public.colorways;
DROP FUNCTION IF EXISTS public.colorways_materials_ensure_placement();

ALTER TABLE public.colorways DROP COLUMN IF EXISTS materials;

NOTIFY pgrst, 'reload schema';;
