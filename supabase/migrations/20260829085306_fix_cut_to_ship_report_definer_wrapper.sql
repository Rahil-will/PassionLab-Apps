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
SECURITY DEFINER
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
GRANT EXECUTE ON FUNCTION public.get_cut_to_ship_report(uuid, date, date, uuid, boolean, uuid[]) TO authenticated;;
