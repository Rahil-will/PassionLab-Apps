-- Replace colorways.materials jsonb with a real colorway_materials table.
-- save_style_order writes these rows (with style, colorways, and shipment lines).

CREATE TABLE IF NOT EXISTS public.colorway_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.style_orders (id) ON DELETE CASCADE,
  colorway_id uuid NOT NULL REFERENCES public.colorways (id) ON DELETE CASCADE,
  seq integer NOT NULL DEFAULT 0,
  category text NOT NULL CHECK (category = ANY (ARRAY['Fabric'::text, 'Trim'::text])),
  name text NOT NULL DEFAULT '',
  placement text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT '',
  trim_type text NOT NULL DEFAULT '',
  trim_category text NOT NULL DEFAULT '',
  fabric_category text NOT NULL DEFAULT '',
  composition text,
  unit text NOT NULL DEFAULT '',
  avg_cons numeric,
  per_pc numeric,
  wastage numeric,
  req_qty numeric,
  rcvd_qty numeric,
  balance_qty numeric,
  total_rolls integer,
  status text,
  supplier text,
  supplier_ref text,
  color_code text,
  remarks text,
  param_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS colorway_materials_colorway_idx
  ON public.colorway_materials (colorway_id, seq);
CREATE INDEX IF NOT EXISTS colorway_materials_order_idx
  ON public.colorway_materials (order_id);
CREATE INDEX IF NOT EXISTS colorway_materials_factory_idx
  ON public.colorway_materials (factory_id);

COMMENT ON TABLE public.colorway_materials IS
  'Per-color fabric/trim requirement lines for a style order. One row per material line.';
COMMENT ON COLUMN public.colorway_materials.placement IS
  'Where the trim sits on the garment. Empty on fabric lines.';

ALTER TABLE public.colorway_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS colorway_materials_select ON public.colorway_materials;
CREATE POLICY colorway_materials_select ON public.colorway_materials
  FOR SELECT TO authenticated
  USING (factory_id = public.current_factory_id());

DROP POLICY IF EXISTS colorway_materials_insert ON public.colorway_materials;
CREATE POLICY colorway_materials_insert ON public.colorway_materials
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_factory_id() AND public.is_factory_admin());

DROP POLICY IF EXISTS colorway_materials_update ON public.colorway_materials;
CREATE POLICY colorway_materials_update ON public.colorway_materials
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

DROP POLICY IF EXISTS colorway_materials_delete ON public.colorway_materials;
CREATE POLICY colorway_materials_delete ON public.colorway_materials
  FOR DELETE TO authenticated
  USING (factory_id = public.current_factory_id() AND public.is_factory_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.colorway_materials TO authenticated;

DO $trg$
BEGIN
  IF to_regprocedure('public.set_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS colorway_materials_updated_at ON public.colorway_materials;
    CREATE TRIGGER colorway_materials_updated_at
      BEFORE UPDATE ON public.colorway_materials
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$trg$;

DO $migrate$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'colorways' AND column_name = 'materials'
  ) THEN
    EXECUTE $sql$
      INSERT INTO public.colorway_materials (
        id, factory_id, order_id, colorway_id, seq, category, name, placement, type,
        trim_type, trim_category, fabric_category, composition, unit,
        avg_cons, per_pc, wastage, req_qty, rcvd_qty, balance_qty, total_rolls,
        status, supplier, supplier_ref, color_code, remarks, param_values
      )
      SELECT
        CASE
          WHEN (elem->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (elem->>'id')::uuid
          ELSE gen_random_uuid()
        END,
        cw.factory_id,
        cw.order_id,
        cw.id,
        x.ord::integer,
        CASE WHEN elem->>'category' = 'Trim' THEN 'Trim' ELSE 'Fabric' END,
        COALESCE(elem->>'name', ''),
        COALESCE(elem->>'placement', ''),
        COALESCE(elem->>'type', ''),
        COALESCE(elem->>'trimType', ''),
        COALESCE(elem->>'trimCategory', ''),
        COALESCE(elem->>'fabricCategory', ''),
        NULLIF(elem->>'composition', ''),
        COALESCE(NULLIF(elem->>'unit', ''), CASE WHEN elem->>'category' = 'Trim' THEN 'pc' ELSE 'mtr' END),
        CASE WHEN (elem->>'avgCons') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'avgCons')::numeric ELSE NULL END,
        CASE WHEN (elem->>'perPc') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'perPc')::numeric ELSE NULL END,
        CASE WHEN (elem->>'wastage') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'wastage')::numeric ELSE NULL END,
        CASE WHEN (elem->>'reqQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'reqQty')::numeric ELSE NULL END,
        CASE WHEN (elem->>'rcvdQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'rcvdQty')::numeric ELSE NULL END,
        CASE WHEN (elem->>'balanceQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (elem->>'balanceQty')::numeric ELSE NULL END,
        CASE WHEN (elem->>'totalRolls') ~ '^-?[0-9]+$' THEN (elem->>'totalRolls')::integer ELSE NULL END,
        NULLIF(elem->>'status', ''),
        NULLIF(elem->>'supplier', ''),
        NULLIF(elem->>'supplierRef', ''),
        NULLIF(elem->>'colorCode', ''),
        NULLIF(elem->>'remarks', ''),
        CASE
          WHEN jsonb_typeof(elem->'paramValues') = 'object' THEN elem->'paramValues'
          ELSE '{}'::jsonb
        END
      FROM public.colorways cw
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cw.materials, '[]'::jsonb)) WITH ORDINALITY AS x(elem, ord)
      WHERE jsonb_typeof(COALESCE(cw.materials, '[]'::jsonb)) = 'array'
        AND cw.materials <> '[]'::jsonb
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END;
$migrate$;

CREATE OR REPLACE FUNCTION public._upsert_colorway_material(
  p_factory_id uuid,
  p_order_id uuid,
  p_colorway_id uuid,
  p_mat jsonb,
  p_seq integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_cat text;
BEGIN
  BEGIN
    v_id := NULLIF(trim(p_mat->>'id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_id := NULL;
  END;
  IF v_id IS NULL THEN v_id := gen_random_uuid(); END IF;

  IF EXISTS (
    SELECT 1 FROM public.colorway_materials
    WHERE id = v_id
      AND (factory_id IS DISTINCT FROM p_factory_id OR order_id IS DISTINCT FROM p_order_id)
  ) THEN
    v_id := gen_random_uuid();
  END IF;

  v_cat := CASE WHEN trim(COALESCE(p_mat->>'category', '')) = 'Trim' THEN 'Trim' ELSE 'Fabric' END;

  INSERT INTO public.colorway_materials (
    id, factory_id, order_id, colorway_id, seq, category, name, placement, type,
    trim_type, trim_category, fabric_category, composition, unit,
    avg_cons, per_pc, wastage, req_qty, rcvd_qty, balance_qty, total_rolls,
    status, supplier, supplier_ref, color_code, remarks, param_values, updated_at
  ) VALUES (
    v_id, p_factory_id, p_order_id, p_colorway_id, COALESCE(p_seq, 0), v_cat,
    COALESCE(p_mat->>'name', ''),
    COALESCE(p_mat->>'placement', ''),
    COALESCE(p_mat->>'type', ''),
    COALESCE(p_mat->>'trimType', ''),
    COALESCE(p_mat->>'trimCategory', ''),
    COALESCE(p_mat->>'fabricCategory', ''),
    NULLIF(p_mat->>'composition', ''),
    COALESCE(NULLIF(p_mat->>'unit', ''), CASE WHEN v_cat = 'Trim' THEN 'pc' ELSE 'mtr' END),
    CASE WHEN (p_mat->>'avgCons') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'avgCons')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'perPc') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'perPc')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'wastage') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'wastage')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'reqQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'reqQty')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'rcvdQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'rcvdQty')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'balanceQty') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p_mat->>'balanceQty')::numeric ELSE NULL END,
    CASE WHEN (p_mat->>'totalRolls') ~ '^-?[0-9]+$' THEN (p_mat->>'totalRolls')::integer ELSE NULL END,
    NULLIF(p_mat->>'status', ''),
    NULLIF(p_mat->>'supplier', ''),
    NULLIF(p_mat->>'supplierRef', ''),
    NULLIF(p_mat->>'colorCode', ''),
    NULLIF(p_mat->>'remarks', ''),
    CASE
      WHEN jsonb_typeof(p_mat->'paramValues') = 'object' THEN p_mat->'paramValues'
      ELSE '{}'::jsonb
    END,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    factory_id = EXCLUDED.factory_id,
    order_id = EXCLUDED.order_id,
    colorway_id = EXCLUDED.colorway_id,
    seq = EXCLUDED.seq,
    category = EXCLUDED.category,
    name = EXCLUDED.name,
    placement = EXCLUDED.placement,
    type = EXCLUDED.type,
    trim_type = EXCLUDED.trim_type,
    trim_category = EXCLUDED.trim_category,
    fabric_category = EXCLUDED.fabric_category,
    composition = EXCLUDED.composition,
    unit = EXCLUDED.unit,
    avg_cons = EXCLUDED.avg_cons,
    per_pc = EXCLUDED.per_pc,
    wastage = EXCLUDED.wastage,
    req_qty = EXCLUDED.req_qty,
    rcvd_qty = EXCLUDED.rcvd_qty,
    balance_qty = EXCLUDED.balance_qty,
    total_rolls = EXCLUDED.total_rolls,
    status = EXCLUDED.status,
    supplier = EXCLUDED.supplier,
    supplier_ref = EXCLUDED.supplier_ref,
    color_code = EXCLUDED.color_code,
    remarks = EXCLUDED.remarks,
    param_values = EXCLUDED.param_values,
    updated_at = now();

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public._upsert_colorway_material(uuid, uuid, uuid, jsonb, integer) FROM PUBLIC;

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

NOTIFY pgrst, 'reload schema';
