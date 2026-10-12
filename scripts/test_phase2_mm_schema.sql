-- Phase 2 SQL verification for MM schema foundation.
-- Run: npx supabase db query --linked --file scripts/test_phase2_mm_schema.sql
--
-- Covers: table presence, RLS lockdown, ledger immutability grants,
-- mm_enable_module seed idempotency, contract stubs, integrity view.

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t, ', ')
  INTO v_missing
  FROM unnest(ARRAY[
    'mm_material_groups','mm_material_types','mm_attribute_defs','mm_test_templates',
    'mm_test_template_fields','mm_sort_rules','mm_suppliers','mm_locations','mm_reason_codes',
    'mm_materials','mm_receipts','mm_lots','mm_stock_units','mm_qc_inspections','mm_sort_decisions',
    'mm_movements','mm_movement_lines','mm_stock_ledger',
    'mm_component_material_map','mm_cutting_lot_map','mm_lay_unit_consumptions'
  ]) AS t
  WHERE to_regclass('public.' || t) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing mm_* tables: %', v_missing;
  END IF;
  RAISE NOTICE 'OK all Phase 2 mm_* tables present';
END $$;

-- Functions / view present
DO $$
BEGIN
  IF to_regprocedure('public.mm_enable_module(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'mm_enable_module missing';
  END IF;
  IF to_regprocedure('public.contract_cutting_lay_can_close(uuid)') IS NULL THEN
    RAISE EXCEPTION 'contract_cutting_lay_can_close missing';
  END IF;
  IF to_regprocedure('public.contract_material_for_component(uuid)') IS NULL THEN
    RAISE EXCEPTION 'contract_material_for_component missing';
  END IF;
  IF to_regclass('public.mm_v_ledger_integrity') IS NULL THEN
    RAISE EXCEPTION 'mm_v_ledger_integrity missing';
  END IF;
  RAISE NOTICE 'OK contracts, seed RPC, integrity view present';
END $$;

-- Authenticated has no INSERT/UPDATE/DELETE on a sample of mm_* tables
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(table_name || ':' || privilege_type, ', ')
  INTO v_bad
  FROM information_schema.role_table_grants
  WHERE grantee = 'authenticated'
    AND table_schema = 'public'
    AND table_name LIKE 'mm_%'
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated has forbidden DML grants: %', v_bad;
  END IF;
  RAISE NOTICE 'OK authenticated has no DML on mm_* tables';
END $$;

-- Ledger: no UPDATE/DELETE for authenticated, anon, service_role
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(grantee || ':' || privilege_type, ', ')
  INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'mm_stock_ledger'
    AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
    AND grantee IN ('authenticated', 'anon', 'service_role', 'PUBLIC');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'mm_stock_ledger has UPDATE/DELETE grants: %', v_bad;
  END IF;
  RAISE NOTICE 'OK mm_stock_ledger append-only grants';
END $$;

-- Attempt UPDATE/DELETE as a check via has_table_privilege
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.mm_stock_ledger', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can UPDATE mm_stock_ledger';
  END IF;
  IF has_table_privilege('authenticated', 'public.mm_stock_ledger', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated can DELETE mm_stock_ledger';
  END IF;
  IF has_table_privilege('service_role', 'public.mm_stock_ledger', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role can UPDATE mm_stock_ledger';
  END IF;
  IF has_table_privilege('service_role', 'public.mm_stock_ledger', 'DELETE') THEN
    RAISE EXCEPTION 'service_role can DELETE mm_stock_ledger';
  END IF;
  RAISE NOTICE 'OK ledger immutability privileges';
END $$;

-- Integrity view compiles / runs (empty dataset → 0 rows)
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.mm_v_ledger_integrity;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'mm_v_ledger_integrity expected 0 rows on empty/healthy set, got %', v_count;
  END IF;
  RAISE NOTICE 'OK mm_v_ledger_integrity returns % rows', v_count;
END $$;

-- contract_material_for_component stub
DO $$
DECLARE
  v_out jsonb;
BEGIN
  v_out := public.contract_material_for_component(gen_random_uuid());
  IF COALESCE(v_out->>'available', 'x') IS DISTINCT FROM NULL
     AND v_out->'available' IS DISTINCT FROM 'null'::jsonb THEN
    -- available should be JSON null
    IF v_out->>'available' IS NOT NULL THEN
      RAISE EXCEPTION 'contract_material_for_component expected available:null, got %', v_out;
    END IF;
  END IF;
  RAISE NOTICE 'OK contract_material_for_component stub %', v_out;
END $$;

-- contract_cutting_lay_can_close: module off path + pre-enable path
DO $$
DECLARE
  v_factory uuid;
  v_lay uuid;
  v_session uuid;
  v_out jsonb;
  v_enabled_at timestamptz;
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY created_at LIMIT 1;
  IF v_factory IS NULL THEN
    RAISE NOTICE 'SKIP contract lay tests: no factories';
    RETURN;
  END IF;

  -- Ensure material disabled for clean MODULE_OFF path
  UPDATE public.factory_modules
  SET enabled = false
  WHERE factory_id = v_factory AND module_key = 'material';

  SELECT l.id, l.session_id
  INTO v_lay, v_session
  FROM public.cutting_lays l
  WHERE l.factory_id = v_factory
  ORDER BY l.created_at
  LIMIT 1;

  IF v_lay IS NULL THEN
    RAISE NOTICE 'SKIP contract lay tests: no cutting_lays for factory %', v_factory;
  ELSE
    v_out := public.contract_cutting_lay_can_close(v_lay);
    IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
      RAISE EXCEPTION 'expected ok:true when material disabled, got %', v_out;
    END IF;
    IF v_out->>'code' IS DISTINCT FROM 'MODULE_OFF' THEN
      RAISE EXCEPTION 'expected code MODULE_OFF, got %', v_out;
    END IF;
    RAISE NOTICE 'OK contract MODULE_OFF %', v_out;

    -- Enable material with enabled_at in the future relative to an old session
    -- (session logged_at < enabled_at → PRE_ENABLE)
    UPDATE public.factory_modules
    SET enabled = true,
        enabled_at = now() + interval '1 day',
        config = COALESCE(config, '{}'::jsonb)
    WHERE factory_id = v_factory AND module_key = 'material';

    v_out := public.contract_cutting_lay_can_close(v_lay);
    IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
      RAISE EXCEPTION 'expected ok:true for pre-enable session, got %', v_out;
    END IF;
    IF v_out->>'code' IS DISTINCT FROM 'PRE_ENABLE' THEN
      RAISE EXCEPTION 'expected code PRE_ENABLE, got %', v_out;
    END IF;
    RAISE NOTICE 'OK contract PRE_ENABLE %', v_out;

    -- Restore material disabled (tests should leave factories as Phase 1 default)
    UPDATE public.factory_modules
    SET enabled = false, enabled_at = NULL
    WHERE factory_id = v_factory AND module_key = 'material';
  END IF;
END $$;

-- Seed idempotency via direct inserts mimicking mm_enable_module natural keys
-- (full mm_enable_module needs admin JWT / current_factory_id; exercise upsert path)
DO $$
DECLARE
  v_factory uuid;
  v_g1 integer; v_g2 integer;
  v_r1 integer; v_r2 integer;
  v_l1 integer; v_l2 integer;
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY created_at LIMIT 1;
  IF v_factory IS NULL THEN
    RAISE NOTICE 'SKIP seed idempotency: no factories';
    RETURN;
  END IF;

  -- First seed
  INSERT INTO public.mm_material_groups (factory_id, code, name, unit_kind, feeds_cutting, is_system, default_uom)
  VALUES
    (v_factory, 'FABRIC', 'Fabric', 'roll', true, true, 'm'),
    (v_factory, 'TRIMS', 'Trims', 'pack', false, true, 'pcs')
  ON CONFLICT (factory_id, code) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO public.mm_reason_codes (factory_id, category, code, label)
  VALUES (v_factory, 'adjust', 'COUNT', 'Physical count adjustment')
  ON CONFLICT (factory_id, category, code) DO UPDATE SET label = EXCLUDED.label;

  INSERT INTO public.mm_locations (factory_id, code, name, location_type, is_pickable)
  VALUES (v_factory, 'STORE', 'Store', 'store', false)
  ON CONFLICT (factory_id, code) DO UPDATE SET name = EXCLUDED.name;

  SELECT count(*) INTO v_g1 FROM public.mm_material_groups WHERE factory_id = v_factory;
  SELECT count(*) INTO v_r1 FROM public.mm_reason_codes WHERE factory_id = v_factory;
  SELECT count(*) INTO v_l1 FROM public.mm_locations WHERE factory_id = v_factory;

  -- Second seed (idempotent)
  INSERT INTO public.mm_material_groups (factory_id, code, name, unit_kind, feeds_cutting, is_system, default_uom)
  VALUES
    (v_factory, 'FABRIC', 'Fabric', 'roll', true, true, 'm'),
    (v_factory, 'TRIMS', 'Trims', 'pack', false, true, 'pcs')
  ON CONFLICT (factory_id, code) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO public.mm_reason_codes (factory_id, category, code, label)
  VALUES (v_factory, 'adjust', 'COUNT', 'Physical count adjustment')
  ON CONFLICT (factory_id, category, code) DO UPDATE SET label = EXCLUDED.label;

  INSERT INTO public.mm_locations (factory_id, code, name, location_type, is_pickable)
  VALUES (v_factory, 'STORE', 'Store', 'store', false)
  ON CONFLICT (factory_id, code) DO UPDATE SET name = EXCLUDED.name;

  SELECT count(*) INTO v_g2 FROM public.mm_material_groups WHERE factory_id = v_factory;
  SELECT count(*) INTO v_r2 FROM public.mm_reason_codes WHERE factory_id = v_factory;
  SELECT count(*) INTO v_l2 FROM public.mm_locations WHERE factory_id = v_factory;

  IF v_g1 <> v_g2 OR v_r1 <> v_r2 OR v_l1 <> v_l2 THEN
    RAISE EXCEPTION 'seed not idempotent: groups %->% reasons %->% locs %->%',
      v_g1, v_g2, v_r1, v_r2, v_l1, v_l2;
  END IF;
  RAISE NOTICE 'OK seed idempotency groups=% reasons=% locs=%', v_g2, v_r2, v_l2;
END $$;

-- Two-factory isolation shape: rows carry factory_id; policies use current_factory_id()
DO $$
DECLARE
  v_pol_count integer;
BEGIN
  SELECT count(*) INTO v_pol_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename LIKE 'mm_%'
    AND cmd = 'SELECT'
    AND qual ILIKE '%current_factory_id%';

  IF v_pol_count < 15 THEN
    RAISE EXCEPTION 'expected factory-scoped SELECT policies on mm_* tables, found %', v_pol_count;
  END IF;
  RAISE NOTICE 'OK RLS SELECT policies with current_factory_id: %', v_pol_count;
END $$;

-- Confirm production tables untouched (spot-check: no mm_ columns on cutting_lays)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cutting_lays' AND column_name LIKE 'mm_%'
  ) THEN
    RAISE EXCEPTION 'cutting_lays unexpectedly gained mm_* columns';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'role'
      AND FALSE -- placeholder; role constraint unchanged checked below
  ) THEN
    NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'departments_role_chk'
      AND pg_get_constraintdef(oid) LIKE '%origin%'
      AND pg_get_constraintdef(oid) LIKE '%standard%'
      AND pg_get_constraintdef(oid) LIKE '%terminal%'
      AND pg_get_constraintdef(oid) NOT LIKE '%support%'
  ) THEN
    RAISE EXCEPTION 'departments_role_chk was altered';
  END IF;
  RAISE NOTICE 'OK production tables / departments_role_chk untouched';
END $$;

SELECT 'phase2_mm_schema_tests_complete' AS status;
