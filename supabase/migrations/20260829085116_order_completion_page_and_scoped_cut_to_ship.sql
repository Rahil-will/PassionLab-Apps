-- Guard helper referenced by the desktop report RPCs.
CREATE OR REPLACE FUNCTION public._assert_desktop_factory_scope(p_factory_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_factory_id IS NULL OR p_factory_id IS DISTINCT FROM public.current_factory_id() THEN
    RAISE EXCEPTION 'Factory mismatch' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_desktop_factory_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_desktop_factory_scope(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.get_cut_to_ship_report(uuid, date, date, uuid, boolean);
DROP FUNCTION IF EXISTS public.get_cut_to_ship_report_inner(uuid, date, date, uuid, boolean);

CREATE OR REPLACE FUNCTION public.get_cut_to_ship_report_inner(
  p_factory_id uuid,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_buyer_id uuid DEFAULT NULL::uuid,
  p_balanced_only boolean DEFAULT NULL::boolean,
  p_order_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  factory_id uuid, order_id uuid, colorway_id uuid, style_name text, buyer_name text,
  po_number text, order_qty integer, cut_qty integer, cut_qty_source text, shipped_qty integer,
  rejected_qty integer, wip_qty integer, reconciliation_gap integer, is_balanced boolean,
  completion_pct numeric, order_status text, last_shipment_date date, cut_qty_by_size jsonb,
  cut_qty_by_component jsonb, shipped_qty_by_size jsonb, rejected_qty_by_size jsonb,
  wip_qty_by_size jsonb
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH cw_base AS (
    SELECT
      so.factory_id,
      so.id AS order_id,
      cw.id AS colorway_id,
      so.style_name,
      so.buyer_name,
      so.po_number,
      so.status AS order_status,
      COALESCE(so.adj_qty, so.order_qty, 0) AS order_qty,
      public.aggregate_order_cut_qty(so.factory_id, so.id, cw.id) AS cut_agg
    FROM public.style_orders so
    JOIN public.colorways cw ON cw.order_id = so.id
    WHERE so.factory_id = p_factory_id
      AND (p_buyer_id IS NULL OR so.buyer_id = p_buyer_id)
      AND (
        p_order_ids IS NULL
        OR cardinality(p_order_ids) = 0
        OR so.id = ANY(p_order_ids)
      )
  ),
  ship_agg AS (
    SELECT
      s.order_id,
      s.colorway_id,
      SUM(s.shipped_qty)::integer AS shipped_qty,
      MAX(s.shipment_date) AS last_shipment_date,
      public.jsonb_merge_sum_maps(array_agg(COALESCE(s.shipped_qty_by_size, '{}'::jsonb))) AS shipped_qty_by_size
    FROM public.shipments s
    WHERE s.factory_id = p_factory_id
      AND (p_date_from IS NULL OR s.shipment_date >= p_date_from)
      AND (p_date_to IS NULL OR s.shipment_date <= p_date_to)
      AND (
        p_order_ids IS NULL
        OR cardinality(p_order_ids) = 0
        OR s.order_id = ANY(p_order_ids)
      )
    GROUP BY s.order_id, s.colorway_id
  ),
  rej_size AS (
    SELECT
      r.order_id,
      r.colorway_id,
      COALESCE(NULLIF(r.size, ''), 'TOTAL') AS size_key,
      SUM(r.qty)::integer AS qty
    FROM public.rejections r
    WHERE r.factory_id = p_factory_id
      AND (
        p_order_ids IS NULL
        OR cardinality(p_order_ids) = 0
        OR r.order_id = ANY(p_order_ids)
      )
    GROUP BY r.order_id, r.colorway_id, COALESCE(NULLIF(r.size, ''), 'TOTAL')
  ),
  rej_agg AS (
    SELECT
      order_id,
      colorway_id,
      SUM(qty)::integer AS rejected_qty,
      jsonb_object_agg(size_key, qty) AS rejected_qty_by_size
    FROM rej_size
    GROUP BY order_id, colorway_id
  ),
  combined AS (
    SELECT
      cb.factory_id,
      cb.order_id,
      cb.colorway_id,
      cb.style_name,
      cb.buyer_name,
      cb.po_number,
      cb.order_qty,
      cb.order_status,
      COALESCE((cb.cut_agg->>'cut_qty')::integer, cb.order_qty) AS cut_qty,
      COALESCE(cb.cut_agg->>'cut_qty_source', 'planned') AS cut_qty_source,
      COALESCE(cb.cut_agg->'cut_qty_by_size', '{}'::jsonb) AS cut_qty_by_size,
      COALESCE(cb.cut_agg->'cut_qty_by_component', '[]'::jsonb) AS cut_qty_by_component,
      COALESCE(sa.shipped_qty, 0) AS shipped_qty,
      COALESCE(sa.shipped_qty_by_size, '{}'::jsonb) AS shipped_qty_by_size,
      sa.last_shipment_date,
      COALESCE(ra.rejected_qty, 0) AS rejected_qty,
      COALESCE(ra.rejected_qty_by_size, '{}'::jsonb) AS rejected_qty_by_size
    FROM cw_base cb
    LEFT JOIN ship_agg sa ON sa.order_id = cb.order_id AND sa.colorway_id = cb.colorway_id
    LEFT JOIN rej_agg ra ON ra.order_id = cb.order_id AND ra.colorway_id = cb.colorway_id
  )
  SELECT
    c.factory_id,
    c.order_id,
    c.colorway_id,
    c.style_name,
    c.buyer_name,
    c.po_number,
    c.order_qty,
    c.cut_qty,
    c.cut_qty_source,
    c.shipped_qty,
    c.rejected_qty,
    GREATEST(c.cut_qty - c.shipped_qty - c.rejected_qty, 0) AS wip_qty,
    GREATEST(c.cut_qty - c.shipped_qty - c.rejected_qty, 0) AS reconciliation_gap,
    (c.cut_qty - c.shipped_qty - c.rejected_qty) <= 0 AS is_balanced,
    CASE WHEN c.cut_qty > 0 THEN ROUND(100.0 * (c.shipped_qty + c.rejected_qty) / c.cut_qty, 1) ELSE NULL END AS completion_pct,
    c.order_status,
    c.last_shipment_date,
    c.cut_qty_by_size,
    c.cut_qty_by_component,
    c.shipped_qty_by_size,
    c.rejected_qty_by_size,
    '{}'::jsonb AS wip_qty_by_size
  FROM combined c
  WHERE p_balanced_only IS NULL
     OR ((c.cut_qty - c.shipped_qty - c.rejected_qty) <= 0) = p_balanced_only
  ORDER BY c.po_number, c.style_name;
$function$;

REVOKE ALL ON FUNCTION public.get_cut_to_ship_report_inner(uuid, date, date, uuid, boolean, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_cut_to_ship_report(
  p_factory_id uuid,
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_buyer_id uuid DEFAULT NULL::uuid,
  p_balanced_only boolean DEFAULT NULL::boolean,
  p_order_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  factory_id uuid, order_id uuid, colorway_id uuid, style_name text, buyer_name text,
  po_number text, order_qty integer, cut_qty integer, cut_qty_source text, shipped_qty integer,
  rejected_qty integer, wip_qty integer, reconciliation_gap integer, is_balanced boolean,
  completion_pct numeric, order_status text, last_shipment_date date, cut_qty_by_size jsonb,
  cut_qty_by_component jsonb, shipped_qty_by_size jsonb, rejected_qty_by_size jsonb,
  wip_qty_by_size jsonb
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);
  RETURN QUERY SELECT * FROM public.get_cut_to_ship_report_inner(
    p_factory_id, p_date_from, p_date_to, p_buyer_id, p_balanced_only, p_order_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_cut_to_ship_report(uuid, date, date, uuid, boolean, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cut_to_ship_report(uuid, date, date, uuid, boolean, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_order_completion_page(
  p_factory_id uuid,
  p_completion_filter text DEFAULT 'ongoing',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 8,
  p_search text DEFAULT NULL,
  p_buyer_id uuid DEFAULT NULL,
  p_include_order_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  style_name text,
  po_number text,
  buyer_name text,
  earliest_delivery date,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
BEGIN
  PERFORM public._assert_desktop_factory_scope(p_factory_id);

  RETURN QUERY
  WITH order_delivery AS (
    SELECT
      odt.order_id,
      MIN(odt.target_date) AS earliest_delivery
    FROM public.order_delivery_targets odt
    WHERE odt.factory_id = p_factory_id
      AND odt.status IS DISTINCT FROM 'rescheduled'
    GROUP BY odt.order_id
  ),
  matching_colorways AS (
    SELECT
      so.id AS order_id,
      so.style_name,
      so.po_number,
      so.buyer_name,
      so.created_at,
      cw.id AS colorway_id,
      COALESCE(cw.completion_status, 'ongoing') AS completion_status
    FROM public.style_orders so
    JOIN public.colorways cw
      ON cw.order_id = so.id
     AND cw.factory_id = so.factory_id
    WHERE so.factory_id = p_factory_id
      AND (p_buyer_id IS NULL OR so.buyer_id = p_buyer_id)
      AND (
        p_search IS NULL
        OR btrim(p_search) = ''
        OR so.style_name ILIKE '%' || btrim(p_search) || '%'
        OR so.po_number ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(so.style_ref, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(so.buyer_name, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(cw.name, '') ILIKE '%' || btrim(p_search) || '%'
      )
      AND (
        COALESCE(p_completion_filter, 'all') = 'all'
        OR (
          COALESCE(p_completion_filter, 'ongoing') = 'ongoing'
          AND COALESCE(cw.completion_status, 'ongoing') NOT IN ('complete', 'short_closed')
        )
        OR (
          p_completion_filter = 'completed'
          AND COALESCE(cw.completion_status, 'ongoing') IN ('complete', 'short_closed')
        )
      )
  ),
  eligible_orders AS (
    SELECT DISTINCT
      mc.order_id AS id,
      mc.style_name,
      mc.po_number,
      mc.buyer_name,
      mc.created_at,
      od.earliest_delivery
    FROM matching_colorways mc
    LEFT JOIN order_delivery od ON od.order_id = mc.order_id
  ),
  numbered AS (
    SELECT
      e.*,
      COUNT(*) OVER () AS total_count,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(e.earliest_delivery, '9999-12-31'::date), e.po_number, e.style_name
      ) AS rn
    FROM eligible_orders e
  ),
  page_rows AS (
    SELECT n.*
    FROM numbered n
    WHERE n.rn > GREATEST(COALESCE(p_page, 1) - 1, 0) * GREATEST(COALESCE(p_page_size, 8), 1)
      AND n.rn <= GREATEST(COALESCE(p_page, 1), 1) * GREATEST(COALESCE(p_page_size, 8), 1)
  ),
  include_row AS (
    SELECT n.*
    FROM numbered n
    WHERE p_include_order_id IS NOT NULL
      AND n.id = p_include_order_id
      AND NOT EXISTS (SELECT 1 FROM page_rows pr WHERE pr.id = n.id)
    LIMIT 1
  ),
  merged AS (
    SELECT * FROM page_rows
    UNION ALL
    SELECT * FROM include_row
  )
  SELECT
    m.id,
    m.style_name,
    m.po_number,
    m.buyer_name,
    m.earliest_delivery,
    m.total_count
  FROM merged m
  ORDER BY COALESCE(m.earliest_delivery, '9999-12-31'::date), m.po_number, m.style_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_completion_page(uuid, text, integer, integer, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_order_completion_page(uuid, text, integer, integer, text, uuid, uuid) TO authenticated;;
