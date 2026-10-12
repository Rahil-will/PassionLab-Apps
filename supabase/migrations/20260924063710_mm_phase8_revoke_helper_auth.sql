-- Follow-up: drop leftover authenticated execute on helpers.

DO $lock$
DECLARE
  r record;
  v_sig text;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND (
        p.proname LIKE '_mm_%'
        OR p.proname IN (
          'mm_floor_call',
          'mm_fabric_type_matches_style',
          'mm_stock_unit_state_guard',
          'mm_stock_unit_qty_guard',
          'mm_stock_unit_qty_open'
        )
      )
  LOOP
    v_sig := format('%I.%I(%s)', 'public', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
  END LOOP;
END;
$lock$;

NOTIFY pgrst, 'reload schema';;
