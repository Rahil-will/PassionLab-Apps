-- Probe desktop read RPCs after 20260810175000 revert.
-- Run: npx supabase db query --linked --file scripts/probe_desktop_read_rpcs.sql
--
-- Pass: no _assert_desktop_factory_scope, no read _inner wrappers, authenticated
-- can EXECUTE report RPCs, and SET ROLE authenticated does not hit permission denied.

DO $$
DECLARE
  v_missing text[];
  v_inner text[];
  v_msg text;
  v_factory uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_assert_desktop_factory_scope'
  ) THEN
    RAISE EXCEPTION 'PROBE FAIL: _assert_desktop_factory_scope still exists — apply 20260810175000';
  END IF;

  SELECT coalesce(array_agg(p.proname ORDER BY p.proname), '{}')
  INTO v_inner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE '%\_inner' ESCAPE '\'
    AND p.proname NOT IN ('log_desktop_shipment_inner', 'log_desktop_rejection_inner');

  IF coalesce(array_length(v_inner, 1), 0) > 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: read _inner wrappers still exist: %', array_to_string(v_inner, ', ');
  END IF;

  SELECT coalesce(array_agg(expected.name ORDER BY expected.name), '{}')
  INTO v_missing
  FROM (
    VALUES
      ('get_factory_production_summary'),
      ('get_cut_to_ship_report'),
      ('get_order_detail_bundle'),
      ('get_orders_pipeline_page'),
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
    WHERE n.nspname = 'public' AND p.proname = expected.name
  );

  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: missing report RPCs: %', array_to_string(v_missing, ', ');
  END IF;

  SELECT coalesce(array_agg(expected.name ORDER BY expected.name), '{}')
  INTO v_missing
  FROM (
    VALUES
      ('get_factory_production_summary'),
      ('get_cut_to_ship_report'),
      ('get_order_detail_bundle'),
      ('get_orders_pipeline_page')
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
    RAISE EXCEPTION 'PROBE FAIL: authenticated lacks EXECUTE on: %', array_to_string(v_missing, ', ');
  END IF;

  SELECT f.id INTO v_factory FROM public.factories f ORDER BY f.created_at LIMIT 1;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.get_factory_production_summary(v_factory);
    PERFORM public.get_cut_to_ship_report(v_factory, NULL, NULL, NULL, NULL);
    PERFORM public.get_order_detail_bundle(v_factory, v_factory);
    RESET ROLE;
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      RESET ROLE;
      RAISE EXCEPTION 'PROBE FAIL: permission denied as authenticated — %', v_msg;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      RESET ROLE;
      IF v_msg LIKE '%permission denied for function _assert_desktop_factory_scope%' THEN
        RAISE EXCEPTION 'PROBE FAIL: still calling _assert_desktop_factory_scope — %', v_msg;
      END IF;
      -- Business/RLS errors (empty result, invalid uuid, etc.) are acceptable here.
  END;

  RAISE NOTICE 'PROBE OK: desktop read RPCs callable by authenticated (no _assert_desktop_factory_scope)';
END $$;
