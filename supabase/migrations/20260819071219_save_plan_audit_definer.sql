-- save_line_plan / save_order_routing are SECURITY INVOKER but call
-- log_audit_event, which is owner-only EXECUTE. Authenticated users therefore
-- get 42501 on Save Plan. Other desktop write RPCs are already DEFINER with
-- factory + admin guards; these two already have the same guards.

ALTER FUNCTION public.save_line_plan(uuid, uuid, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.save_order_routing(uuid, uuid, jsonb) SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.save_line_plan(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_line_plan(uuid, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.save_order_routing(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_order_routing(uuid, uuid, jsonb) TO authenticated;
;
