CREATE INDEX IF NOT EXISTS idx_cutting_sessions_factory_dept_log
  ON public.cutting_sessions (factory_id, department_id, log_date);

CREATE OR REPLACE FUNCTION public.get_day_cutting_sessions(
  p_factory_id uuid,
  p_department_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  id uuid,
  log_date date,
  started_at timestamptz,
  ended_at timestamptz,
  order_id uuid,
  colorway_id uuid,
  resource_id uuid,
  order_route_id uuid,
  session_no text,
  ref_no text,
  fabric_type text,
  fabric_code text,
  fabric_component_id uuid,
  is_primary_fabric boolean,
  lay_no text,
  headcount_by_category jsonb,
  output_qty integer,
  style_name text,
  style_ref text,
  buyer_name text,
  po_number text,
  color_name text,
  resource_name text,
  operation_name text,
  is_primary_output boolean,
  operation_def_id uuid
)
LANGUAGE sql
STABLE
SET search_path TO public
AS $function$
  SELECT
    cs.id,
    cs.log_date,
    cs.start_time AS started_at,
    cs.end_time AS ended_at,
    cs.order_id,
    cs.colorway_id,
    cs.resource_id,
    cs.order_route_id,
    cs.session_no,
    cs.ref_no,
    COALESCE(NULLIF(fc.fabric_type, ''), NULLIF(cs.fabric_type, '')) AS fabric_type,
    fc.code AS fabric_code,
    cs.fabric_component_id,
    COALESCE(fc.is_primary, false) AS is_primary_fabric,
    lays.lay_no,
    COALESCE(cs.headcount_by_category, '{}'::jsonb) AS headcount_by_category,
    COALESCE(bundles.bundle_qty, 0) AS output_qty,
    COALESCE(so.style_name, '') AS style_name,
    COALESCE(so.style_ref, '') AS style_ref,
    COALESCE(so.buyer_name, '') AS buyer_name,
    COALESCE(so.po_number, '') AS po_number,
    CASE
      WHEN cs.colorway_id IS NULL THEN 'Order (legacy)'
      WHEN cw.id IS NULL THEN LEFT(cs.colorway_id::text, 8)
      WHEN NULLIF(BTRIM(COALESCE(cw.color_code, '')), '') IS NOT NULL
        THEN CONCAT(COALESCE(cw.name, ''), ' (', BTRIM(cw.color_code), ')')
      ELSE COALESCE(NULLIF(BTRIM(cw.name), ''), LEFT(cs.colorway_id::text, 8))
    END AS color_name,
    COALESCE(ar.resource_name, '—') AS resource_name,
    COALESCE(ors.operation_name, ors.dept_name, 'Cutting') AS operation_name,
    COALESCE(ors.is_primary_output, false) AS is_primary_output,
    ors.operation_def_id
  FROM public.cutting_sessions cs
  LEFT JOIN public.style_orders so
    ON so.id = cs.order_id AND so.factory_id = cs.factory_id
  LEFT JOIN public.colorways cw
    ON cw.id = cs.colorway_id AND cw.factory_id = cs.factory_id
  LEFT JOIN public.assigned_resources ar
    ON ar.id = cs.resource_id AND ar.factory_id = cs.factory_id
  LEFT JOIN public.order_routing_steps ors
    ON ors.id = cs.order_route_id AND ors.factory_id = cs.factory_id
  LEFT JOIN public.fabric_components fc
    ON fc.id = cs.fabric_component_id AND fc.factory_id = cs.factory_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(cb.qty), 0)::integer AS bundle_qty
    FROM public.cutting_bundles cb
    WHERE cb.session_id = cs.id
      AND cb.factory_id = cs.factory_id
  ) bundles ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(l.lay_no::text, '·' ORDER BY l.lay_no) AS lay_no
    FROM (
      SELECT DISTINCT cl.lay_no
      FROM public.cutting_lays cl
      WHERE cl.session_id = cs.id
        AND cl.factory_id = cs.factory_id
        AND cl.lay_no IS NOT NULL
    ) l
  ) lays ON true
  WHERE cs.factory_id = p_factory_id
    AND cs.department_id = p_department_id
    AND cs.log_date >= p_date_from
    AND cs.log_date <= p_date_to
  ORDER BY cs.log_date, cs.start_time, cs.id;
$function$;

REVOKE ALL ON FUNCTION public.get_day_cutting_sessions(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_day_cutting_sessions(uuid, uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.get_day_cutting_sessions(uuid, uuid, date, date) IS
  'Day Report native cutting sessions for a department date range. SECURITY INVOKER; RLS applies.';;
