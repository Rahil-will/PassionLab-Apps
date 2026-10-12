-- B2: Mill production orders (MPO). Purpose: style (for a style fabric line) | open_po (forecast for a customer) | stock.
-- Batches link to an order (mm_mill_batches.mill_order_id). Progress is computed from the linked batches' rolls.
-- Stored status: open | closed | cancelled. Shown status (display_status): not_started | in_progress | completed | closed | cancelled.

CREATE TABLE IF NOT EXISTS public.mm_mill_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  purpose text NOT NULL CHECK (purpose IN ('style', 'open_po', 'stock')),
  fabric_id uuid NOT NULL REFERENCES public.mm_fabrics(id),
  colour text,
  planned_qty numeric NOT NULL CHECK (planned_qty > 0),
  uom text NOT NULL CHECK (uom IN ('kg', 'm')),
  customer_name text,
  po_ref text,
  order_id uuid REFERENCES public.style_orders(id) ON DELETE SET NULL,
  colorway_id uuid REFERENCES public.colorways(id) ON DELETE SET NULL,
  colorway_material_id uuid REFERENCES public.colorway_materials(id) ON DELETE SET NULL,
  style_material_id uuid REFERENCES public.mm_style_materials(id) ON DELETE SET NULL,
  due_date date,
  facility_id uuid REFERENCES public.mm_facilities(id),
  remarks text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  closed_at timestamptz, closed_by uuid, close_reason text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  UNIQUE (factory_id, order_no)
);
CREATE INDEX IF NOT EXISTS mm_mill_orders_factory_idx ON public.mm_mill_orders (factory_id, status, order_date DESC);
CREATE INDEX IF NOT EXISTS mm_mill_orders_fabric_idx ON public.mm_mill_orders (fabric_id);
ALTER TABLE public.mm_mill_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY mm_mill_orders_read ON public.mm_mill_orders FOR SELECT TO authenticated USING (factory_id = public.current_factory_id());

ALTER TABLE public.mm_mill_batches ADD COLUMN IF NOT EXISTS mill_order_id uuid REFERENCES public.mm_mill_orders(id) ON DELETE SET NULL;
-- Batch purpose (set at creation; Rahil 2026-10-09: every batch is made in New mill batch as Style / Open PO / Stock)
ALTER TABLE public.mm_mill_batches ADD COLUMN IF NOT EXISTS purpose text, ADD COLUMN IF NOT EXISTS customer_name text, ADD COLUMN IF NOT EXISTS po_ref text;
UPDATE public.mm_mill_batches SET purpose = CASE WHEN style_material_id IS NOT NULL THEN 'style' ELSE 'stock' END WHERE purpose IS NULL;
ALTER TABLE public.mm_mill_batches ALTER COLUMN purpose SET DEFAULT 'stock';
ALTER TABLE public.mm_mill_batches ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE public.mm_mill_batches ADD CONSTRAINT mm_mill_batches_purpose_chk CHECK (purpose IN ('style', 'open_po', 'stock'));
CREATE INDEX IF NOT EXISTS mm_mill_batches_order_idx ON public.mm_mill_batches (mill_order_id);

-- Small label used on batch rows / detail
CREATE OR REPLACE FUNCTION public._mm_mill_order_label(p_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_id IS NULL THEN NULL ELSE (
    SELECT jsonb_build_object('id', o.id, 'order_no', o.order_no, 'purpose', o.purpose, 'status', o.status,
                              'customer_name', o.customer_name, 'po_ref', o.po_ref, 'style', public._mm_style_label(o.style_material_id))
    FROM public.mm_mill_orders o WHERE o.id = p_id) END
$function$;

-- Progress in the order UOM
CREATE OR REPLACE FUNCTION public._mm_mill_order_progress(p_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH o AS (SELECT * FROM public.mm_mill_orders WHERE id = p_id),
  rr AS (
    SELECT r.id, r.process_round, COALESCE(r.unit_form, 'roll') AS unit_form, mr.status AS mr_status, u.id AS su_id,
           COALESCE(u.style_material_id, mr.style_material_id) AS sm_id,
           EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = r.id AND l.line_status = 'out') AS at_proc,
           CASE WHEN (SELECT uom FROM o) = 'kg' THEN COALESCE(mr.weight_kg, u.weight_kg, CASE WHEN lower(COALESCE(u.qty_uom, u.uom, '')) = 'kg' THEN u.qty_received END)
                ELSE COALESCE(mr.length_m, u.length_m, CASE WHEN lower(COALESCE(u.qty_uom, u.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN u.qty_received END) END AS q
    FROM public.mm_rolls r
    JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id AND b.mill_order_id = p_id
    LEFT JOIN LATERAL (SELECT m.* FROM public.mm_mill_rolls m WHERE m.roll_id = r.id LIMIT 1) mr ON true
    LEFT JOIN LATERAL (SELECT s.* FROM public.mm_stock_units s WHERE s.roll_id = r.id LIMIT 1) u ON true
  )
  SELECT jsonb_build_object(
    'batches', (SELECT count(*) FROM public.mm_mill_batches b WHERE b.mill_order_id = p_id),
    'rolls', (SELECT count(*) FROM rr WHERE mr_status IS NOT NULL),
    'produced', COALESCE((SELECT sum(q) FROM rr WHERE mr_status IS NOT NULL), 0),
    'processed', COALESCE((SELECT sum(q) FROM rr WHERE COALESCE(process_round, 0) > 0), 0),
    'at_mill', COALESCE((SELECT sum(q) FROM rr WHERE mr_status = 'draft' AND su_id IS NULL AND NOT at_proc), 0),
    'at_processing', COALESCE((SELECT sum(q) FROM rr WHERE at_proc), 0),
    'dispatched', COALESCE((SELECT sum(q) FROM rr WHERE (mr_status = 'dispatched' OR su_id IS NOT NULL) AND NOT at_proc), 0),
    'allocated', COALESCE((SELECT sum(q) FROM rr WHERE sm_id IS NOT NULL), 0),
    'laps', (SELECT count(*) FROM rr WHERE unit_form = 'lap'),
    'pct', CASE WHEN (SELECT planned_qty FROM o) > 0
                THEN round(100 * COALESCE((SELECT sum(q) FROM rr WHERE mr_status IS NOT NULL), 0) / (SELECT planned_qty FROM o), 1) ELSE 0 END)
$function$;

CREATE OR REPLACE FUNCTION public._mm_mill_order_row(p_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(o) || jsonb_build_object(
    'fabric', jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name, 'uom', f.uom),
    'facility', (SELECT jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name) FROM public.mm_facilities x WHERE x.id = o.facility_id),
    'style', public._mm_style_label(o.style_material_id),
    'progress', p.progress,
    'display_status', CASE WHEN o.status IN ('closed', 'cancelled') THEN o.status
                           WHEN (p.progress->>'batches')::int = 0 THEN 'not_started'
                           WHEN (p.progress->>'produced')::numeric >= o.planned_qty THEN 'completed'
                           ELSE 'in_progress' END,
    'overdue', o.status = 'open' AND o.due_date IS NOT NULL AND o.due_date < CURRENT_DATE
               AND (p.progress->>'produced')::numeric < o.planned_qty)
  FROM public.mm_mill_orders o
  JOIN public.mm_fabrics f ON f.id = o.fabric_id
  CROSS JOIN LATERAL (SELECT public._mm_mill_order_progress(o.id) AS progress) p
  WHERE o.id = p_id
$function$;

-- List ------------------------------------------------------------------------------------------------------
-- Filter: { purpose?, status? (open|closed|cancelled|not_started|in_progress|completed|active = not closed/cancelled), fabric_id?, search?, customer? }
CREATE OR REPLACE FUNCTION public.mm_mill_orders_list(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_q text := NULLIF(lower(btrim(COALESCE(p_filter->>'search', ''))), '');
  v_cust text := NULLIF(lower(btrim(COALESCE(p_filter->>'customer', ''))), ''); v_status text := NULLIF(p_filter->>'status', '');
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_mill_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(x.r ORDER BY (x.r->>'order_date') DESC, x.r->>'order_no' DESC)
    FROM (
      SELECT public._mm_mill_order_row(o.id) AS r
      FROM public.mm_mill_orders o
      JOIN public.mm_fabrics f ON f.id = o.fabric_id
      WHERE o.factory_id = v_factory
        AND (NULLIF(p_filter->>'purpose', '') IS NULL OR o.purpose = p_filter->>'purpose')
        AND (NULLIF(p_filter->>'fabric_id', '') IS NULL OR o.fabric_id = (p_filter->>'fabric_id')::uuid)
        AND (v_cust IS NULL OR lower(COALESCE(o.customer_name, '')) LIKE '%' || v_cust || '%')
        AND (v_q IS NULL OR lower(o.order_no) LIKE '%' || v_q || '%' OR lower(f.code) LIKE '%' || v_q || '%'
             OR lower(f.name) LIKE '%' || v_q || '%' OR lower(COALESCE(o.colour, '')) LIKE '%' || v_q || '%'
             OR lower(COALESCE(o.po_ref, '')) LIKE '%' || v_q || '%' OR lower(COALESCE(o.customer_name, '')) LIKE '%' || v_q || '%')
    ) x
    WHERE v_status IS NULL
       OR (v_status = 'active' AND x.r->>'status' = 'open')
       OR (v_status IN ('open', 'closed', 'cancelled') AND x.r->>'status' = v_status)
       OR (v_status IN ('not_started', 'in_progress', 'completed') AND x.r->>'display_status' = v_status)
  ), '[]'::jsonb)));
END $function$;

-- Get -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_mill_order_get(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_row jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_mill_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF NOT EXISTS (SELECT 1 FROM public.mm_mill_orders WHERE id = p_id AND factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND', 'Production order not found');
  END IF;
  v_row := public._mm_mill_order_row(p_id);
  RETURN public._mm_ok(v_row || jsonb_build_object(
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'batch_no', b.batch_no, 'production_date', b.production_date, 'mill_ref', b.mill_ref,
                                          'color_ref', b.color_ref, 'style', public._mm_style_label(b.style_material_id),
                                          'rolls', (SELECT count(*) FROM public.mm_mill_rolls m WHERE m.mill_batch_id = b.id),
                                          'qty', (SELECT COALESCE(sum(CASE WHEN v_row->>'uom' = 'kg' THEN COALESCE(m.weight_kg, m.length_m) ELSE COALESCE(m.length_m, m.weight_kg) END), 0)
                                                  FROM public.mm_mill_rolls m WHERE m.mill_batch_id = b.id))
                       ORDER BY b.production_date DESC NULLS LAST, b.batch_no)
      FROM public.mm_mill_batches b WHERE b.mill_order_id = p_id), '[]'::jsonb),
    'linkable_batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'batch_no', b.batch_no, 'production_date', b.production_date, 'color_ref', b.color_ref)
                       ORDER BY b.production_date DESC NULLS LAST, b.batch_no)
      FROM public.mm_mill_batches b
      WHERE b.factory_id = v_factory AND b.mill_order_id IS NULL AND b.fabric_id = (v_row->>'fabric_id')::uuid), '[]'::jsonb)));
END $function$;

-- Save (create / edit) -------------------------------------------------------------------------------------
-- Payload: { id?, row_version?, order_date?, purpose*, fabric_id*, colour?, planned_qty*, customer_name?, po_ref?,
--            order_id? colorway_id? colorway_material_id? (purpose style), due_date?, facility_id? (a mill), remarks? }
CREATE OR REPLACE FUNCTION public.mm_mill_order_save(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_id uuid; v_o public.mm_mill_orders%ROWTYPE; v_f public.mm_fabrics%ROWTYPE; v_purpose text; v_qty numeric;
  v_sm uuid; v_r jsonb; v_line_fabric uuid; v_fac uuid; v_date date; v_due date; v_colour text;
  v_order uuid; v_cw uuid; v_cm uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF NOT public._mm_feature(v_factory, 'fabric_mill') THEN RETURN public._mm_err('MODULE_DISABLED', 'Fabric mill is off'); END IF;
  BEGIN
    v_id := NULLIF(p_payload->>'id', '')::uuid;
    v_f.id := NULLIF(p_payload->>'fabric_id', '')::uuid;
    v_fac := NULLIF(p_payload->>'facility_id', '')::uuid;
    v_order := NULLIF(p_payload->>'order_id', '')::uuid;
    v_cw := NULLIF(p_payload->>'colorway_id', '')::uuid;
    v_cm := NULLIF(p_payload->>'colorway_material_id', '')::uuid;
    v_qty := NULLIF(p_payload->>'planned_qty', '')::numeric;
    v_date := COALESCE(NULLIF(p_payload->>'order_date', '')::date, CURRENT_DATE);
    v_due := NULLIF(p_payload->>'due_date', '')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RETURN public._mm_err('INVALID', 'Check the ids, quantity and dates');
  END;
  v_purpose := NULLIF(p_payload->>'purpose', '');
  IF v_purpose IS NULL OR v_purpose NOT IN ('style', 'open_po', 'stock') THEN
    RETURN public._mm_err('REQUIRED', 'Pick a purpose: Style, Open PO or Stock');
  END IF;
  SELECT * INTO v_f FROM public.mm_fabrics WHERE id = v_f.id AND factory_id = v_factory;
  IF v_f.id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Pick a fabric'); END IF;
  IF v_qty IS NULL OR v_qty <= 0 THEN RETURN public._mm_err('REQUIRED', 'Planned quantity must be more than 0'); END IF;
  IF v_due IS NOT NULL AND v_due < v_date THEN RETURN public._mm_err('INVALID', 'Due date is before the order date'); END IF;
  IF v_fac IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_facilities WHERE id = v_fac AND factory_id = v_factory AND kind = 'mill') THEN
    RETURN public._mm_err('INVALID', 'Pick a mill');
  END IF;
  v_colour := NULLIF(btrim(COALESCE(p_payload->>'colour', '')), '');

  IF v_purpose = 'style' THEN
    v_r := public._mm_resolve_style_material(v_order, v_cw, v_cm);
    IF COALESCE(v_r->>'ok', 'false') <> 'true' THEN RETURN v_r; END IF;
    v_sm := (v_r->'data'->>'id')::uuid;
    SELECT COALESCE(cm.fabric_id, sm.fabric_id), COALESCE(v_colour, NULLIF(btrim(cm.fabric_color), ''), cw.name)
      INTO v_line_fabric, v_colour
    FROM public.mm_style_materials sm
    LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
    LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
    WHERE sm.id = v_sm;
    IF v_line_fabric IS NOT NULL AND v_line_fabric <> v_f.id THEN
      RETURN public._mm_err('FABRIC_MISMATCH', 'This style line uses ' || public._mm_fabric_code(v_line_fabric) || ', not ' || v_f.code);
    END IF;
  ELSIF v_purpose = 'open_po' THEN
    IF NULLIF(btrim(COALESCE(p_payload->>'customer_name', '')), '') IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Open PO needs a customer');
    END IF;
    v_order := NULL; v_cw := NULL; v_cm := NULL;
  ELSE
    v_order := NULL; v_cw := NULL; v_cm := NULL;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.mm_mill_orders (factory_id, order_no, order_date, purpose, fabric_id, colour, planned_qty, uom,
      customer_name, po_ref, order_id, colorway_id, colorway_material_id, style_material_id, due_date, facility_id, remarks,
      created_by, updated_by)
    VALUES (v_factory, public._mm_next_doc(v_factory, 'MPO', v_date), v_date, v_purpose, v_f.id, v_colour, v_qty,
      CASE WHEN v_f.uom = 'kg' THEN 'kg' ELSE 'm' END,
      CASE WHEN v_purpose = 'stock' THEN NULL ELSE NULLIF(btrim(COALESCE(p_payload->>'customer_name', '')), '') END,
      CASE WHEN v_purpose = 'stock' THEN NULL ELSE NULLIF(btrim(COALESCE(p_payload->>'po_ref', '')), '') END,
      v_order, v_cw, v_cm, v_sm, v_due, v_fac, NULLIF(btrim(COALESCE(p_payload->>'remarks', '')), ''),
      public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_o FROM public.mm_mill_orders WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Production order not found'); END IF;
    IF p_payload ? 'row_version' AND NULLIF(p_payload->>'row_version', '')::int IS DISTINCT FROM v_o.row_version THEN
      RETURN public._mm_err('STALE', 'This order was changed elsewhere. Reload and try again');
    END IF;
    IF v_o.status <> 'open' THEN RETURN public._mm_err('INVALID', 'Reopen the order to edit it'); END IF;
    IF v_o.fabric_id <> v_f.id AND EXISTS (SELECT 1 FROM public.mm_mill_batches WHERE mill_order_id = v_id) THEN
      RETURN public._mm_err('INVALID', 'Fabric can''t change once batches are linked');
    END IF;
    UPDATE public.mm_mill_orders SET
      order_date = v_date, purpose = v_purpose, fabric_id = v_f.id, colour = v_colour, planned_qty = v_qty,
      uom = CASE WHEN v_f.uom = 'kg' THEN 'kg' ELSE 'm' END,
      customer_name = CASE WHEN v_purpose = 'stock' THEN NULL ELSE NULLIF(btrim(COALESCE(p_payload->>'customer_name', '')), '') END,
      po_ref = CASE WHEN v_purpose = 'stock' THEN NULL ELSE NULLIF(btrim(COALESCE(p_payload->>'po_ref', '')), '') END,
      order_id = v_order, colorway_id = v_cw, colorway_material_id = v_cm, style_material_id = v_sm,
      due_date = v_due, facility_id = v_fac, remarks = NULLIF(btrim(COALESCE(p_payload->>'remarks', '')), ''),
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;
  END IF;
  RETURN public._mm_ok(public._mm_mill_order_row(v_id));
END $function$;

-- Close / cancel / reopen -----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_mill_order_set_status(p_id uuid, p_status text, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_o public.mm_mill_orders%ROWTYPE;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF p_status NOT IN ('open', 'closed', 'cancelled') THEN RETURN public._mm_err('INVALID', 'Status must be open, closed or cancelled'); END IF;
  SELECT * INTO v_o FROM public.mm_mill_orders WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Production order not found'); END IF;
  IF p_status = 'cancelled' AND EXISTS (SELECT 1 FROM public.mm_mill_batches WHERE mill_order_id = p_id) THEN
    RETURN public._mm_err('INVALID', 'Batches are linked — close the order instead, or unlink them first');
  END IF;
  IF p_status IN ('closed', 'cancelled') AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL
     AND (p_status = 'cancelled' OR (public._mm_mill_order_progress(p_id)->>'produced')::numeric < v_o.planned_qty) THEN
    RETURN public._mm_err('REQUIRED', 'Give a reason (order is not fully produced)');
  END IF;
  UPDATE public.mm_mill_orders SET status = p_status,
    closed_at = CASE WHEN p_status = 'open' THEN NULL ELSE now() END,
    closed_by = CASE WHEN p_status = 'open' THEN NULL ELSE public._mm_actor_id() END,
    close_reason = CASE WHEN p_status = 'open' THEN NULL ELSE NULLIF(btrim(COALESCE(p_reason, '')), '') END,
    row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = p_id;
  RETURN public._mm_ok(public._mm_mill_order_row(p_id));
END $function$;

-- Link / unlink batches -------------------------------------------------------------------------------------
-- p_order_id NULL = unlink. Batch fabric must match the order fabric; order must be open.
CREATE OR REPLACE FUNCTION public.mm_mill_order_link_batches(p_order_id uuid, p_batch_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_o public.mm_mill_orders%ROWTYPE; v_b public.mm_mill_batches%ROWTYPE; v_id uuid; v_n int := 0;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF COALESCE(array_length(p_batch_ids, 1), 0) = 0 THEN RETURN public._mm_err('REQUIRED', 'Select batches'); END IF;
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_o FROM public.mm_mill_orders WHERE id = p_order_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Production order not found'); END IF;
    IF v_o.status <> 'open' THEN RETURN public._mm_err('INVALID', 'Order ' || v_o.order_no || ' is ' || v_o.status); END IF;
  END IF;
  FOREACH v_id IN ARRAY p_batch_ids LOOP
    SELECT * INTO v_b FROM public.mm_mill_batches WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected batch was not found'); END IF;
    IF p_order_id IS NOT NULL AND v_b.fabric_id IS DISTINCT FROM v_o.fabric_id THEN
      RETURN public._mm_err('FABRIC_MISMATCH', 'Batch ' || v_b.batch_no || ' is ' || COALESCE(public._mm_fabric_code(v_b.fabric_id), 'not linked to a fabric')
                            || ', order is ' || public._mm_fabric_code(v_o.fabric_id));
    END IF;
    UPDATE public.mm_mill_batches SET mill_order_id = p_order_id,
      purpose = CASE WHEN p_order_id IS NULL THEN purpose WHEN v_o.purpose = 'style' AND v_b.style_material_id IS NULL THEN purpose ELSE v_o.purpose END,
      customer_name = CASE WHEN p_order_id IS NULL THEN customer_name ELSE COALESCE(v_o.customer_name, customer_name) END,
      po_ref = CASE WHEN p_order_id IS NULL THEN po_ref ELSE COALESCE(v_o.po_ref, po_ref) END,
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_b.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('count', v_n, 'order', CASE WHEN p_order_id IS NULL THEN NULL ELSE public._mm_mill_order_row(p_order_id) END));
END $function$;

-- Batch save (v5) / edit (v4): accept mill_order_id; batch list + detail show the order -----------------
DO $mig$
DECLARE d text;
BEGIN
  -- v5 save: link after the batch is created
  d := pg_get_functiondef('public.mm_mill_save_batch_v5(jsonb)'::regprocedure);
  d := replace(d, $a$  IF v_fid IS NULL THEN RETURN public.mm_mill_save_batch_v4(p_payload); END IF;$a$,
    $b$  IF v_fid IS NULL AND NULLIF(p_payload->>'mill_order_id', '') IS NOT NULL THEN
    SELECT fabric_id INTO v_fid FROM public.mm_mill_orders WHERE id = (p_payload->>'mill_order_id')::uuid;
  END IF;
  IF NULLIF(p_payload->>'mill_order_id', '') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.mm_mill_orders o WHERE o.id = (p_payload->>'mill_order_id')::uuid
                   AND o.factory_id = public._mm_actor_factory_id() AND o.status = 'open') THEN
      RETURN public._mm_err('INVALID', 'Production order not found or not open');
    END IF;
    IF v_fid IS DISTINCT FROM (SELECT fabric_id FROM public.mm_mill_orders WHERE id = (p_payload->>'mill_order_id')::uuid) THEN
      RETURN public._mm_err('FABRIC_MISMATCH', 'Batch fabric must match the production order fabric');
    END IF;
  END IF;
  IF v_fid IS NULL THEN RETURN public.mm_mill_save_batch_v4(p_payload - 'mill_order_id'); END IF;$b$);
  d := replace(d, $a$    v_res := public.mm_mill_save_batch_v4(
      (p_payload - 'fabric_id') || jsonb_build_object($a$,
    $b$    v_res := public.mm_mill_save_batch_v4(
      (p_payload - 'fabric_id' - 'mill_order_id') || jsonb_build_object($b$);
  d := replace(d, $a$    v_res := jsonb_set(v_res, '{data,fabric_id}', to_jsonb(f.id));
  END IF;$a$,
    $b$    v_res := jsonb_set(v_res, '{data,fabric_id}', to_jsonb(f.id));
    IF NULLIF(p_payload->>'mill_order_id', '') IS NOT NULL THEN
      UPDATE public.mm_mill_batches SET mill_order_id = (p_payload->>'mill_order_id')::uuid WHERE id = (v_res->'data'->>'id')::uuid;
      v_res := jsonb_set(v_res, '{data,mill_order_id}', to_jsonb(p_payload->>'mill_order_id'));
    END IF;
  END IF;$b$);
  IF position('Batch fabric must match the production order' in d) = 0 OR position($x$p_payload - 'fabric_id' - 'mill_order_id'$x$ in d) = 0
     OR position('SET mill_order_id = (p_payload' in d) = 0 THEN
    RAISE EXCEPTION 'save v5 replace failed';
  END IF;
  EXECUTE d;

  -- v4 edit: mill_order_id key (null = unlink)
  d := pg_get_functiondef('public.mm_mill_update_batch_v4(uuid,jsonb)'::regprocedure);
  d := replace(d, $a$  BEGIN
    UPDATE public.mm_mill_batches SET
      batch_no$a$,
    $b$  IF p_payload ? 'mill_order_id' AND NULLIF(p_payload->>'mill_order_id', '')::uuid IS DISTINCT FROM v_b.mill_order_id THEN
    DECLARE v_link jsonb;
    BEGIN
      v_link := public.mm_mill_order_link_batches(NULLIF(p_payload->>'mill_order_id', '')::uuid, ARRAY[v_b.id]);
      IF COALESCE(v_link->>'ok', 'false') <> 'true' THEN RETURN v_link; END IF;
    END;
  END IF;
  BEGIN
    UPDATE public.mm_mill_batches SET
      batch_no$b$);
  d := replace(d, $a$  IF p_payload ? 'batch_no' AND NULLIF(btrim(p_payload->>'batch_no'), '') IS NULL THEN$a$,
    $b$  IF p_payload ? 'purpose' AND COALESCE(p_payload->>'purpose', '') NOT IN ('style', 'open_po', 'stock') THEN
    RETURN public._mm_err('INVALID', 'Purpose must be style, open_po or stock');
  END IF;
  IF p_payload->>'purpose' = 'style' AND v_b.style_material_id IS NULL THEN
    RETURN public._mm_err('INVALID', 'Allocate the batch to a style line first (Allocate rolls)');
  END IF;
  IF p_payload->>'purpose' = 'open_po' AND NULLIF(btrim(COALESCE(p_payload->>'customer_name', v_b.customer_name, '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Open PO needs a customer');
  END IF;
  IF p_payload ? 'batch_no' AND NULLIF(btrim(p_payload->>'batch_no'), '') IS NULL THEN$b$);
  d := replace(d, $a$      facility_id     = COALESCE(v_fac, facility_id),$a$,
    $b$      facility_id     = COALESCE(v_fac, facility_id),
      purpose         = CASE WHEN p_payload ? 'purpose' THEN p_payload->>'purpose' ELSE purpose END,
      customer_name   = CASE WHEN p_payload ? 'customer_name' THEN NULLIF(btrim(p_payload->>'customer_name'), '') ELSE customer_name END,
      po_ref          = CASE WHEN p_payload ? 'po_ref' THEN NULLIF(btrim(p_payload->>'po_ref'), '') ELSE po_ref END,$b$);
  IF position('mm_mill_order_link_batches(NULLIF' in d) = 0 OR position('Open PO needs a customer' in d) = 0
     OR position('purpose         = CASE' in d) = 0 THEN RAISE EXCEPTION 'update v4 replace failed'; END IF;
  EXECUTE d;

  -- detail: mill_order
  d := pg_get_functiondef('public.mm_mill_get_batch_v4(uuid)'::regprocedure);
  IF position($a$    'rolls', COALESCE((SELECT jsonb_agg(public._mm_roll_row(r.id) ORDER BY r.roll_code)$a$ in d) = 0 THEN RAISE EXCEPTION 'get batch pattern'; END IF;
  d := replace(d, $a$    'rolls', COALESCE((SELECT jsonb_agg(public._mm_roll_row(r.id) ORDER BY r.roll_code)$a$,
    $b$    'mill_order', public._mm_mill_order_label(v_b.mill_order_id),
    'purpose', v_b.purpose, 'customer_name', v_b.customer_name, 'po_ref', v_b.po_ref,
    'rolls', COALESCE((SELECT jsonb_agg(public._mm_roll_row(r.id) ORDER BY r.roll_code)$b$);
  EXECUTE d;

  -- list: mill_order on each row + filters mill_order_id / purpose ('style' | 'open_po' | 'stock' | 'none')
  d := pg_get_functiondef('public.mm_mill_list_batches_v4(jsonb)'::regprocedure);
  d := replace(d, $a$        'fabric_uom', fab.uom,$a$, $b$        'fabric_uom', fab.uom,
        'mill_order', public._mm_mill_order_label(mb.mill_order_id),
        'purpose', mb.purpose, 'customer_name', mb.customer_name, 'po_ref', mb.po_ref,$b$);
  d := replace(d, $a$    ) bk ON true
  ), '[]'::jsonb));$a$, $b$    ) bk ON true
    LEFT JOIN public.mm_mill_orders mo ON mo.id = mb.mill_order_id
    WHERE (NULLIF(p_filter->>'mill_order_id', '') IS NULL OR mb.mill_order_id = (p_filter->>'mill_order_id')::uuid)
      AND (NULLIF(p_filter->>'purpose', '') IS NULL OR mb.purpose = p_filter->>'purpose')
      AND (NULLIF(p_filter->>'has_order', '') IS NULL OR (mb.mill_order_id IS NOT NULL) = (p_filter->>'has_order')::boolean)
  ), '[]'::jsonb));$b$);
  IF position('_mm_mill_order_label(mb.mill_order_id)' in d) = 0 OR position('mb.purpose = p_filter' in d) = 0 THEN
    RAISE EXCEPTION 'list replace failed';
  END IF;
  EXECUTE d;
END $mig$;

-- New mill batch (v6): the one place rolls are made. Purpose required.
-- Payload = v5 payload + { purpose*: 'style'|'open_po'|'stock', customer_name? (open_po required), po_ref?, mill_order_id? }
-- Style: give order_id + colorway_id + colorway_material_id (as v5) or a style mill_order_id (fills them).
-- Rolls need only qty (kg or m by fabric UOM); test values are NOT required here (use QC Test / Inspect after save).
CREATE OR REPLACE FUNCTION public.mm_mill_save_batch_v6(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_p jsonb := COALESCE(p_payload, '{}'::jsonb); v_purpose text; v_o public.mm_mill_orders%ROWTYPE; v_res jsonb; v_id uuid;
BEGIN
  IF NULLIF(v_p->>'mill_order_id', '') IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_o FROM public.mm_mill_orders WHERE id = (v_p->>'mill_order_id')::uuid AND factory_id = public._mm_actor_factory_id();
    EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid production order'); END;
    IF v_o.id IS NULL THEN RETURN public._mm_err('NOT_FOUND', 'Production order not found'); END IF;
    v_p := v_p || jsonb_strip_nulls(jsonb_build_object(
      'purpose', v_o.purpose, 'fabric_id', COALESCE(NULLIF(v_p->>'fabric_id', ''), v_o.fabric_id::text),
      'customer_name', COALESCE(NULLIF(v_p->>'customer_name', ''), v_o.customer_name),
      'po_ref', COALESCE(NULLIF(v_p->>'po_ref', ''), v_o.po_ref),
      'color_ref', COALESCE(NULLIF(v_p->>'color_ref', ''), v_o.colour)));
    IF v_o.purpose = 'style' AND NULLIF(v_p->>'colorway_material_id', '') IS NULL THEN
      v_p := v_p || jsonb_build_object('order_id', v_o.order_id, 'colorway_id', v_o.colorway_id, 'colorway_material_id', v_o.colorway_material_id);
    END IF;
  END IF;
  v_purpose := NULLIF(v_p->>'purpose', '');
  IF v_purpose IS NULL OR v_purpose NOT IN ('style', 'open_po', 'stock') THEN
    RETURN public._mm_err('REQUIRED', 'Pick a purpose: Style, Open PO or Stock');
  END IF;
  IF v_purpose = 'style' AND (NULLIF(v_p->>'order_id', '') IS NULL OR NULLIF(v_p->>'colorway_id', '') IS NULL OR NULLIF(v_p->>'colorway_material_id', '') IS NULL) THEN
    RETURN public._mm_err('REQUIRED', 'Style batch needs the style, colour and fabric line');
  END IF;
  IF v_purpose <> 'style' AND (NULLIF(v_p->>'colorway_material_id', '') IS NOT NULL OR NULLIF(v_p->>'order_id', '') IS NOT NULL) THEN
    v_p := v_p - 'order_id' - 'colorway_id' - 'colorway_material_id';
  END IF;
  IF v_purpose = 'open_po' AND NULLIF(btrim(COALESCE(v_p->>'customer_name', '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Open PO needs a customer');
  END IF;

  v_res := public.mm_mill_save_batch_v5(v_p - 'purpose' - 'customer_name' - 'po_ref');
  IF COALESCE(v_res->>'ok', 'false') <> 'true' THEN RETURN v_res; END IF;
  v_id := NULLIF(v_res->'data'->>'id', '')::uuid;
  IF v_id IS NOT NULL THEN
    UPDATE public.mm_mill_batches SET purpose = v_purpose,
      customer_name = CASE WHEN v_purpose = 'stock' THEN NULL ELSE NULLIF(btrim(COALESCE(v_p->>'customer_name', '')), '') END,
      po_ref = CASE WHEN v_purpose = 'stock' THEN NULL ELSE NULLIF(btrim(COALESCE(v_p->>'po_ref', '')), '') END
    WHERE id = v_id;
    v_res := jsonb_set(v_res, '{data,purpose}', to_jsonb(v_purpose));
  END IF;
  RETURN v_res;
END $function$;
GRANT EXECUTE ON FUNCTION public.mm_mill_save_batch_v6(jsonb) TO authenticated;

GRANT EXECUTE ON FUNCTION public.mm_mill_orders_list(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_mill_order_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_mill_order_save(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_mill_order_set_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_mill_order_link_batches(uuid, uuid[]) TO authenticated;
