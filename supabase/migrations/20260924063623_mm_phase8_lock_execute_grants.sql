-- Phase 8 leftover: no anon execute on material functions.
-- Page RPCs stay on authenticated + service_role.
-- Helpers, floor dispatcher, and trigger functions stay off authenticated.

DO $lock$
DECLARE
  r record;
  v_sig text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'mm_%' OR p.proname LIKE '_mm_%')
      AND p.prokind = 'f'
  LOOP
    v_sig := format('%I.%I(%s)', 'public', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    IF r.proname LIKE '_mm_%'
       OR r.proname IN (
         'mm_floor_call',
         'mm_fabric_type_matches_style',
         'mm_stock_unit_state_guard',
         'mm_stock_unit_qty_guard',
         'mm_stock_unit_qty_open'
       )
    THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
    END IF;
  END LOOP;
END;
$lock$;

NOTIFY pgrst, 'reload schema';;
