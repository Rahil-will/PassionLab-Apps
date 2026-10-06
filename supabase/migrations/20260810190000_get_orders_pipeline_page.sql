-- Server-side pipeline status filter for Status Tracker (Active / Completed / Delayed).
-- Applies pipeline classification before pagination so totals and pages span the full factory.

CREATE OR REPLACE FUNCTION public.get_orders_pipeline_page(
  p_factory_id uuid,
  p_pipeline_status text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_search text DEFAULT NULL,
  p_buyer_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  style_name text,
  style_ref text,
  po_number text,
  buyer_name text,
  buyer_id uuid,
  status text,
  order_qty integer,
  adj_qty integer,
  created_at timestamptz,
  image_url text,
  season text,
  priority text,
  total_count bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH order_adj AS (
    SELECT
      so.id AS order_id,
      COALESCE((
        SELECT SUM(sz.adj)::integer
        FROM public.colorways cw
        CROSS JOIN LATERAL (
          SELECT (COALESCE(NULLIF(elem->>'adj_qty', ''), elem->>'order_qty', '0'))::integer AS adj
          FROM jsonb_array_elements(COALESCE(cw.sizes, '[]'::jsonb)) elem
          WHERE COALESCE(elem->>'size', '') <> ''
        ) sz
        WHERE cw.order_id = so.id
          AND cw.factory_id = so.factory_id
      ), COALESCE(so.adj_qty, so.order_qty, 0)) AS total_adj
    FROM public.style_orders so
    WHERE so.factory_id = p_factory_id
  ),
  visit_routes AS (
    SELECT
      ors.order_id,
      ors.visit_id,
      MIN(ors.seq) AS visit_seq,
      (array_agg(
        ors.step_type
        ORDER BY
          CASE WHEN ors.is_primary_output THEN 0 ELSE 1 END,
          CASE WHEN ors.step_type = 'produce' THEN 0 ELSE 1 END,
          ors.seq DESC
      ))[1] AS step_type
    FROM public.order_routing_steps ors
    WHERE ors.factory_id = p_factory_id
      AND ors.visit_id IS NOT NULL
    GROUP BY ors.order_id, ors.visit_id
  ),
  pipeline_visits AS (
    SELECT vr.order_id, vr.visit_id, vr.visit_seq
    FROM visit_routes vr
    WHERE vr.step_type IS DISTINCT FROM 'store'
  ),
  terminal_visits AS (
    SELECT DISTINCT ON (pv.order_id)
      pv.order_id,
      pv.visit_id AS terminal_visit_id
    FROM pipeline_visits pv
    ORDER BY pv.order_id, pv.visit_seq DESC
  ),
  visit_produced AS (
    SELECT
      odp.order_id,
      odp.visit_id,
      SUM(odp.qty_produced)::integer AS qty_produced
    FROM public.order_dept_progress_rows(p_factory_id) odp
    WHERE odp.visit_id IS NOT NULL
    GROUP BY odp.order_id, odp.visit_id
  ),
  order_progress AS (
    SELECT
      pv.order_id,
      COUNT(DISTINCT pv.visit_id)::integer AS visit_count,
      BOOL_OR(COALESCE(vp.qty_produced, 0) > 0) AS any_active
    FROM pipeline_visits pv
    LEFT JOIN visit_produced vp
      ON vp.order_id = pv.order_id
     AND vp.visit_id = pv.visit_id
    GROUP BY pv.order_id
  ),
  terminal_produced AS (
    SELECT
      tv.order_id,
      COALESCE(vp.qty_produced, 0)::integer AS terminal_produced
    FROM terminal_visits tv
    LEFT JOIN visit_produced vp
      ON vp.order_id = tv.order_id
     AND vp.visit_id = tv.terminal_visit_id
  ),
  order_delivery AS (
    SELECT
      odt.order_id,
      MIN(odt.target_date) AS earliest_delivery
    FROM public.order_delivery_targets odt
    WHERE odt.factory_id = p_factory_id
      AND odt.status IS DISTINCT FROM 'rescheduled'
    GROUP BY odt.order_id
  ),
  order_pipeline AS (
    SELECT
      oa.order_id,
      oa.total_adj,
      COALESCE(op.visit_count, 0) AS visit_count,
      COALESCE(op.any_active, false) AS any_active,
      COALESCE(tp.terminal_produced, 0) AS terminal_produced,
      od.earliest_delivery,
      CASE
        WHEN COALESCE(op.visit_count, 0) > 0
         AND COALESCE(tp.terminal_produced, 0) >= oa.total_adj
        THEN 'Completed'
        WHEN od.earliest_delivery IS NOT NULL
         AND od.earliest_delivery < CURRENT_DATE
         AND NOT (
           COALESCE(op.visit_count, 0) > 0
           AND COALESCE(tp.terminal_produced, 0) >= oa.total_adj
         )
        THEN 'Delayed'
        WHEN COALESCE(op.any_active, false)
         AND NOT (
           COALESCE(op.visit_count, 0) > 0
           AND COALESCE(tp.terminal_produced, 0) >= oa.total_adj
         )
        THEN 'Active'
        ELSE NULL
      END AS pipeline_status
    FROM order_adj oa
    LEFT JOIN order_progress op ON op.order_id = oa.order_id
    LEFT JOIN terminal_produced tp ON tp.order_id = oa.order_id
    LEFT JOIN order_delivery od ON od.order_id = oa.order_id
  ),
  filtered_orders AS (
    SELECT
      so.id,
      so.style_name,
      so.style_ref,
      so.po_number,
      so.buyer_name,
      so.buyer_id,
      so.status,
      so.order_qty,
      so.adj_qty,
      so.created_at,
      so.image_url,
      so.season,
      so.priority,
      op.earliest_delivery
    FROM public.style_orders so
    JOIN order_pipeline op ON op.order_id = so.id
    WHERE so.factory_id = p_factory_id
      AND (
        p_pipeline_status IS NULL
        OR btrim(p_pipeline_status) = ''
        OR op.pipeline_status = p_pipeline_status
      )
      AND (p_buyer_id IS NULL OR so.buyer_id = p_buyer_id)
      AND (
        p_search IS NULL
        OR btrim(p_search) = ''
        OR so.style_name ILIKE '%' || btrim(p_search) || '%'
        OR so.po_number ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(so.style_ref, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(so.buyer_name, '') ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  numbered AS (
    SELECT
      f.*,
      COUNT(*) OVER () AS total_count,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(f.earliest_delivery, '9999-12-31'::date), f.created_at DESC
      ) AS rn
    FROM filtered_orders f
  )
  SELECT
    n.id,
    n.style_name,
    n.style_ref,
    n.po_number,
    n.buyer_name,
    n.buyer_id,
    n.status,
    n.order_qty,
    n.adj_qty,
    n.created_at,
    n.image_url,
    n.season,
    n.priority,
    n.total_count
  FROM numbered n
  WHERE n.rn > (GREATEST(p_page, 1) - 1) * GREATEST(p_page_size, 1)
    AND n.rn <= GREATEST(p_page, 1) * GREATEST(p_page_size, 1)
  ORDER BY n.rn;
$function$;
REVOKE ALL ON FUNCTION public.get_orders_pipeline_page(uuid, text, integer, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_orders_pipeline_page(uuid, text, integer, integer, text, uuid) TO authenticated;
