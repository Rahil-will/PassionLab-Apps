-- Phase 2 / group 7: ledger integrity view (security_invoker).

CREATE OR REPLACE VIEW public.mm_v_ledger_integrity
WITH (security_invoker = true)
AS
SELECT
  u.id AS stock_unit_id,
  u.factory_id,
  u.unit_code,
  u.current_qty,
  COALESCE(l.ledger_sum, 0)::numeric AS ledger_sum,
  (u.current_qty - COALESCE(l.ledger_sum, 0))::numeric AS drift,
  u.status
FROM public.mm_stock_units u
LEFT JOIN LATERAL (
  SELECT sum(sl.qty_delta) AS ledger_sum
  FROM public.mm_stock_ledger sl
  WHERE sl.stock_unit_id = u.id
) l ON true
WHERE u.current_qty < 0
   OR u.current_qty IS DISTINCT FROM COALESCE(l.ledger_sum, 0);
COMMENT ON VIEW public.mm_v_ledger_integrity IS
  'Units where current_qty cache disagrees with ledger sum, or current_qty < 0. Empty = healthy.';
GRANT SELECT ON public.mm_v_ledger_integrity TO authenticated, service_role;
