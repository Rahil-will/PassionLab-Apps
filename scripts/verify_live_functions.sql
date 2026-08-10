-- Migration sovereignty gate — fails (RAISE EXCEPTION) when repo drifts from expected architecture.
--
-- Live:
--   npx supabase db query --linked --file scripts/verify_live_functions.sql
-- Local (after supabase db reset):
--   npx supabase db query --local --file scripts/verify_live_functions.sql
--
-- Expected: non-zero CLI exit when any check fails.

DO $$
DECLARE
  v_missing text[];
  v_forbidden text[];
  v_admin_missing text[];
  v_sig_missing text[];
  v_count int;
  v_def text;
BEGIN
  -- 1) Edge-function companion RPCs that MUST exist
  SELECT coalesce(array_agg(expected.name ORDER BY expected.name), '{}')
  INTO v_missing
  FROM (
    VALUES
      ('create_factory_floor_user'),
      ('replace_floor_user_access'),
      ('get_my_profile'),
      ('hash_floor_pin'),
      ('verify_floor_pin')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = expected.name
  );

  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Missing required user-admin companion RPCs: %', array_to_string(v_missing, ', ');
  END IF;

  -- 2) User-admin RPCs that must NOT exist (edge-functions-only)
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname), '{}')
  INTO v_forbidden
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('save_factory_user', 'update_factory_user');

  IF coalesce(array_length(v_forbidden, 1), 0) > 0 THEN
    RAISE EXCEPTION
      'Forbidden user-admin RPCs exist (edge-fn-only architecture): %',
      array_to_string(v_forbidden, ', ');
  END IF;

  -- 3) Admin save RPCs used by the desktop app (name existence)
  SELECT coalesce(array_agg(expected.name ORDER BY expected.name), '{}')
  INTO v_admin_missing
  FROM (
    VALUES
      ('save_buyer'),
      ('save_department'),
      ('save_line_plan'),
      ('save_order_routing'),
      ('save_process_flow'),
      ('save_resource'),
      ('save_shift'),
      ('save_size_group'),
      ('save_style_order'),
      ('save_support_dropdown'),
      ('save_factory_settings'),
      ('save_fabric_components'),
      ('save_operation'),
      ('save_colorway_planning_remarks'),
      ('log_desktop_shipment'),
      ('log_desktop_rejection'),
      ('delete_desktop_shipment')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = expected.name
  );

  IF coalesce(array_length(v_admin_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Missing admin save RPCs: %', array_to_string(v_admin_missing, ', ');
  END IF;

  -- 3b) Signature-aware desktop RPC checks
  SELECT coalesce(array_agg(expected.label ORDER BY expected.label), '{}')
  INTO v_sig_missing
  FROM (
    VALUES
      ('delete_desktop_shipment(uuid,uuid)', 'delete_desktop_shipment', 2),
      ('save_fabric_components(uuid,uuid,jsonb,uuid[])', 'save_fabric_components', 4),
      ('log_desktop_shipment(uuid,jsonb)', 'log_desktop_shipment', 2)
  ) AS expected(label, proname, arg_count)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = expected.proname
      AND p.pronargs = expected.arg_count
  );

  IF coalesce(array_length(v_sig_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Desktop RPC signature mismatch (missing or wrong arity): %', array_to_string(v_sig_missing, ', ');
  END IF;

  -- 4) defects write policy must require factory admin
  SELECT count(*)
  INTO v_count
  FROM pg_policy
  WHERE polrelid = 'public.defects'::regclass
    AND polname = 'defects_write'
    AND pg_get_expr(polqual, polrelid) NOT LIKE '%is_factory_admin%';

  IF v_count > 0 THEN
    RAISE EXCEPTION 'defects_write policy does not require is_factory_admin() — apply 20260731160000_defects_write_admin_only.sql';
  END IF;

  -- 5) log_audit_event — owner-only EXECUTE (no client or extra role grants)
  SELECT count(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'log_audit_event'
    AND (
      has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
    );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'log_audit_event is EXECUTE-granted to anon or authenticated — must be internal only';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  JOIN pg_roles grantee ON grantee.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND p.proname = 'log_audit_event'
    AND acl.privilege_type = 'EXECUTE'
    AND grantee.oid <> p.proowner;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'log_audit_event has EXECUTE granted to non-owner roles — apply 20260810140000_desktop_security_finish_fixes.sql';
  END IF;

  -- 6) Claims hygiene — user_metadata must not appear in role/factory helpers
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'current_factory_id'
  LIMIT 1;

  IF v_def LIKE '%user_metadata%' THEN
    RAISE EXCEPTION 'current_factory_id still reads user_metadata — apply 20260810120000_desktop_security_finish.sql';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_factory_admin'
  LIMIT 1;

  IF v_def LIKE '%user_metadata%' THEN
    RAISE EXCEPTION 'is_factory_admin still reads user_metadata — apply 20260810120000_desktop_security_finish.sql';
  END IF;

  -- 7) KPI views must run as invoker (RLS applies)
  SELECT count(*)
  INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'v_department_kpis_by_shift'
    AND NOT (
      'security_invoker=true' = ANY (COALESCE(c.reloptions, ARRAY[]::text[]))
      OR 'security_invoker=on' = ANY (COALESCE(c.reloptions, ARRAY[]::text[]))
    );

  IF v_count > 0 THEN
    RAISE EXCEPTION 'v_department_kpis_by_shift missing security_invoker — apply 20260810160000_desktop_factory_scope_enforcement.sql';
  END IF;

  -- 8) get_department_kpis fallback RPC exists (recreated by 20260810175000 revert)
  SELECT count(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_department_kpis'
    AND p.pronargs = 4;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'get_department_kpis(uuid,uuid,date,date) missing — apply 20260810175000_revert_read_factory_guards.sql';
  END IF;

  -- 9) Desktop save RPCs must not be anon-callable (revoke PUBLIC, not just anon)
  SELECT count(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'save_buyer', 'save_factory_settings', 'delete_desktop_shipment',
      'save_fabric_components', 'save_operation', 'save_support_dropdown'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Desktop save RPC still EXECUTE-granted to anon — apply 20260810175000_revert_read_factory_guards.sql';
  END IF;

  -- 10) 20260810170000 read wrappers must be rolled back
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_assert_desktop_factory_scope'
  ) THEN
    RAISE EXCEPTION '_assert_desktop_factory_scope still exists — apply 20260810175000_revert_read_factory_guards.sql';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE '%\_inner' ESCAPE '\'
    AND p.proname NOT IN ('log_desktop_shipment_inner', 'log_desktop_rejection_inner');

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Read RPC _inner wrappers still exist — apply 20260810175000_revert_read_factory_guards.sql';
  END IF;

  -- 11) Desktop report RPCs must be executable by authenticated
  SELECT coalesce(array_agg(expected.name ORDER BY expected.name), '{}')
  INTO v_missing
  FROM (
    VALUES
      ('get_factory_production_summary'),
      ('get_cut_to_ship_report'),
      ('get_order_detail_bundle'),
      ('get_handover_report'),
      ('get_audit_report'),
      ('get_order_dept_progress'),
      ('get_order_colorway_actuals'),
      ('get_factory_schedule_actuals'),
      ('get_style_kpis'),
      ('order_dept_progress_rows'),
      ('operation_progress_rows'),
      ('cutting_component_progress_rows'),
      ('get_department_kpis')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = expected.name
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  );

  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Desktop report RPC not EXECUTE-granted to authenticated: %', array_to_string(v_missing, ', ');
  END IF;

  -- 12) Desktop write RPCs must be executable by authenticated and not by anon
  SELECT coalesce(array_agg(expected.name ORDER BY expected.name), '{}')
  INTO v_missing
  FROM (
    VALUES
      ('save_buyer'), ('save_department'), ('save_shift'), ('save_process_flow'),
      ('save_size_group'), ('save_resource'), ('save_style_order'), ('delete_style_order'),
      ('save_line_plan'), ('save_order_routing'), ('save_support_dropdown'),
      ('save_factory_settings'), ('save_fabric_components'), ('save_operation'),
      ('save_colorway_planning_remarks'), ('delete_desktop_shipment'),
      ('log_desktop_shipment'), ('log_desktop_rejection')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = expected.name
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  );

  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Desktop write RPC not EXECUTE-granted to authenticated: %', array_to_string(v_missing, ', ');
  END IF;

  -- 13) A SECURITY INVOKER function must not call a helper revoked from authenticated.
  --     This is the shape that caused the 20260810170000 outage.
  SELECT coalesce(array_agg(bad.proname ORDER BY bad.proname), '{}')
  INTO v_forbidden
  FROM (
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT p.prosecdef
      AND (
        pg_get_functiondef(p.oid) ~ '_assert_desktop_factory_scope'
        OR pg_get_functiondef(p.oid) ~ 'public\.[a-z_]+_inner\('
      )
  ) AS bad;

  IF coalesce(array_length(v_forbidden, 1), 0) > 0 THEN
    RAISE EXCEPTION
      'SECURITY INVOKER function calls a revoked helper (wrapper must be SECURITY DEFINER): %',
      array_to_string(v_forbidden, ', ');
  END IF;

  -- 14) Fulfillment wrappers must be SECURITY DEFINER; their inners stay client-revoked
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname), '{}')
  INTO v_forbidden
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('log_desktop_shipment', 'log_desktop_rejection')
    AND NOT p.prosecdef;

  IF coalesce(array_length(v_forbidden, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Fulfillment wrapper is not SECURITY DEFINER: %', array_to_string(v_forbidden, ', ');
  END IF;

  SELECT coalesce(array_agg(p.proname ORDER BY p.proname), '{}')
  INTO v_forbidden
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('log_desktop_shipment_inner', 'log_desktop_rejection_inner')
    AND (
      has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
    );

  IF coalesce(array_length(v_forbidden, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Fulfillment _inner is client-callable (must be internal only): %', array_to_string(v_forbidden, ', ');
  END IF;

  -- 15) Audit coverage (20260810180000): log_audit_event wired into legacy write RPCs
  SELECT coalesce(array_agg(expected.name ORDER BY expected.name), '{}')
  INTO v_missing
  FROM (
    VALUES
      ('save_buyer'), ('save_department'), ('save_shift'), ('save_process_flow'),
      ('save_size_group'), ('save_resource'), ('save_style_order'), ('delete_style_order'),
      ('save_line_plan'), ('save_order_routing'), ('save_support_dropdown'),
      ('ensure_department_defects'), ('log_desktop_shipment_inner'), ('log_desktop_rejection_inner')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = expected.name
      AND pg_get_functiondef(p.oid) LIKE '%log_audit_event%'
  );

  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Write RPC missing log_audit_event — apply 20260810180000: %', array_to_string(v_missing, ', ');
  END IF;

  RAISE NOTICE 'verify_live_functions: all required checks passed';
END $$;
