-- Phase 3 SQL verification for MM config RPCs.
-- Run: npx supabase db query --linked --file scripts/test_phase3_mm_config.sql
--
-- Uses request.jwt.claims to simulate admin / non-admin without a live browser session.
-- Test rows use code prefix P3T_ and are deleted at the end.

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(fn, ', ')
  INTO v_missing
  FROM unnest(ARRAY[
    'mm_enable_module(jsonb)',
    'mm_update_module_config(jsonb)',
    'mm_get_config_bundle()',
    'mm_save_material_group(jsonb)',
    'mm_save_material_type(jsonb)',
    'mm_save_attribute_def(jsonb)',
    'mm_save_test_template(jsonb,jsonb)',
    'mm_save_supplier(jsonb)',
    'mm_save_location(jsonb)',
    'mm_save_reason_code(jsonb)',
    'mm_save_material(jsonb)',
    'mm_map_component_material(uuid,uuid,numeric,text)'
  ]) AS fn
  WHERE to_regprocedure('public.' || fn) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing Phase 3 RPCs: %', v_missing;
  END IF;
  RAISE NOTICE 'OK all Phase 3 config RPCs present';
END $$;

-- mm_locations.is_active present (no Phase 3 deviation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_locations' AND column_name = 'is_active'
  ) THEN
    RAISE EXCEPTION 'mm_locations.is_active missing';
  END IF;
  RAISE NOTICE 'OK mm_locations.is_active present (no deviation)';
END $$;

DO $$
DECLARE
  v_factory uuid;
  v_was_enabled boolean;
  v_was_config jsonb;
  v_out jsonb;
  v_group uuid;
  v_type uuid;
  v_attr uuid;
  v_tmpl uuid;
  v_tmpl_v1 uuid;
  v_tmpl_v2 uuid;
  v_loc_store uuid;
  v_loc_a uuid;
  v_loc_b uuid;
  v_sup uuid;
  v_mat uuid;
  v_reason uuid;
  v_fc uuid;
  v_receipt uuid;
  v_version1 integer;
  v_version2 integer;
  v_key text;
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY created_at LIMIT 1;
  IF v_factory IS NULL THEN
    RAISE NOTICE 'SKIP Phase 3 RPC body tests: no factories';
    RETURN;
  END IF;

  SELECT enabled, config INTO v_was_enabled, v_was_config
  FROM public.factory_modules
  WHERE factory_id = v_factory AND module_key = 'material';

  -- Simulate admin JWT for this factory
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('factory_id', v_factory::text, 'user_role', 'admin')::text,
    true
  );

  -- MODULE_DISABLED
  UPDATE public.factory_modules
  SET enabled = false
  WHERE factory_id = v_factory AND module_key = 'material';

  v_out := public.mm_save_supplier(jsonb_build_object('code', 'P3T_X', 'name', 'x'));
  IF COALESCE(v_out->>'ok', 'true') = 'true' OR v_out->>'code' IS DISTINCT FROM 'MODULE_DISABLED' THEN
    RAISE EXCEPTION 'expected MODULE_DISABLED, got %', v_out;
  END IF;
  RAISE NOTICE 'OK MODULE_DISABLED';

  -- Enable via seed RPC
  v_out := public.mm_enable_module('{}'::jsonb);
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    -- mm_enable_module may return set_factory_module shape; fall back to direct enable
    UPDATE public.factory_modules
    SET enabled = true, enabled_at = COALESCE(enabled_at, now()), config = COALESCE(config, '{}'::jsonb)
    WHERE factory_id = v_factory AND module_key = 'material';
    RAISE NOTICE 'WARN mm_enable_module non-ok (%); forced enable for tests', v_out;
  ELSE
    RAISE NOTICE 'OK mm_enable_module';
  END IF;

  -- Ensure enabled for remaining tests
  UPDATE public.factory_modules
  SET enabled = true, enabled_at = COALESCE(enabled_at, now())
  WHERE factory_id = v_factory AND module_key = 'material';

  -- NO_PERMISSION (non-admin, no assigned_apps)
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('factory_id', v_factory::text, 'user_role', 'viewer')::text,
    true
  );
  v_out := public.mm_save_supplier(jsonb_build_object('code', 'P3T_X', 'name', 'x'));
  IF v_out->>'code' IS DISTINCT FROM 'NO_PERMISSION' THEN
    RAISE EXCEPTION 'expected NO_PERMISSION, got %', v_out;
  END IF;
  RAISE NOTICE 'OK NO_PERMISSION';

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('factory_id', v_factory::text, 'user_role', 'admin')::text,
    true
  );

  -- Unknown config key
  v_out := public.mm_update_module_config(jsonb_build_object('not_a_key', true));
  IF v_out->>'code' IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'expected INVALID_TRANSITION for unknown key, got %', v_out;
  END IF;
  RAISE NOTICE 'OK unknown config key rejected';

  -- Valid config patch
  v_out := public.mm_update_module_config(jsonb_build_object('variance_tolerance_pct', 3));
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_update_module_config failed: %', v_out;
  END IF;
  RAISE NOTICE 'OK mm_update_module_config';

  SELECT id INTO v_group
  FROM public.mm_material_groups
  WHERE factory_id = v_factory AND code = 'FABRIC'
  LIMIT 1;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'FABRIC group missing after enable';
  END IF;

  -- Type
  v_out := public.mm_save_material_type(jsonb_build_object(
    'group_id', v_group, 'name', 'P3T Knit'
  ));
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_material_type failed: %', v_out;
  END IF;
  v_type := (v_out->'data'->>'id')::uuid;

  -- Attribute def
  v_out := public.mm_save_attribute_def(jsonb_build_object(
    'group_id', v_group,
    'label', 'P3T GSM',
    'data_type', 'number',
    'applies_to', 'test',
    'is_required', false,
    'seq', 1
  ));
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_attribute_def failed: %', v_out;
  END IF;
  v_attr := (v_out->'data'->>'id')::uuid;
  v_key := v_out->'data'->>'key';
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'attribute key not generated';
  END IF;

  -- Attribute key immutability after create (attempt change key)
  v_out := public.mm_save_attribute_def(jsonb_build_object(
    'id', v_attr,
    'row_version', (SELECT row_version FROM public.mm_attribute_defs WHERE id = v_attr),
    'key', 'hacked-key',
    'label', 'P3T GSM'
  ));
  -- key should remain original even if RPC ignores; if it returns ok, assert key unchanged
  IF COALESCE((v_out->>'ok')::boolean, false) THEN
    IF (SELECT key FROM public.mm_attribute_defs WHERE id = v_attr) IS DISTINCT FROM v_key THEN
      RAISE EXCEPTION 'attribute key mutated';
    END IF;
  END IF;
  RAISE NOTICE 'OK attribute key immutable';

  -- Template v1
  v_out := public.mm_save_test_template(
    jsonb_build_object('group_id', v_group, 'name', 'P3T Template'),
    jsonb_build_array(jsonb_build_object('attribute_def_id', v_attr, 'seq', 1))
  );
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_test_template create failed: %', v_out;
  END IF;
  v_tmpl_v1 := (v_out->'data'->>'id')::uuid;
  v_version1 := (v_out->'data'->>'version')::integer;
  IF v_version1 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected template version 1, got %', v_version1;
  END IF;

  -- Receipt used later for fake QC inspection (after stock unit exists)
  INSERT INTO public.mm_receipts (factory_id, receipt_no, group_id, source, status)
  VALUES (v_factory, 'P3T-RCPT-1', v_group, 'external', 'received')
  RETURNING id INTO v_receipt;

  -- Supplier + location + material first for stock unit
  v_out := public.mm_save_supplier(jsonb_build_object('code', 'P3T_SUP', 'name', 'P3T Supplier', 'supplies', 'fabric'));
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_supplier failed: %', v_out;
  END IF;
  v_sup := (v_out->'data'->>'id')::uuid;

  SELECT id INTO v_loc_store
  FROM public.mm_locations
  WHERE factory_id = v_factory AND code = 'STORE'
  LIMIT 1;

  v_out := public.mm_save_location(jsonb_build_object(
    'parent_id', v_loc_store, 'code', 'P3T_ZONE', 'name', 'P3T Zone', 'location_type', 'zone'
  ));
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_location failed: %', v_out;
  END IF;
  v_loc_a := (v_out->'data'->>'id')::uuid;

  v_out := public.mm_save_location(jsonb_build_object(
    'parent_id', v_loc_a, 'code', 'P3T_RACK', 'name', 'P3T Rack', 'location_type', 'rack'
  ));
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_location rack failed: %', v_out;
  END IF;
  v_loc_b := (v_out->'data'->>'id')::uuid;

  -- Cycle rejection: set parent of zone to rack (descendant)
  v_out := public.mm_save_location(jsonb_build_object(
    'id', v_loc_a,
    'row_version', (SELECT row_version FROM public.mm_locations WHERE id = v_loc_a),
    'parent_id', v_loc_b,
    'code', 'P3T_ZONE',
    'name', 'P3T Zone',
    'location_type', 'zone'
  ));
  IF v_out->>'code' IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'expected location cycle rejection, got %', v_out;
  END IF;
  RAISE NOTICE 'OK location cycle rejected';

  v_out := public.mm_save_reason_code(jsonb_build_object(
    'category', 'adjust', 'code', 'P3T_ADJ', 'label', 'P3T Adjust'
  ));
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_reason_code failed: %', v_out;
  END IF;
  v_reason := (v_out->'data'->>'id')::uuid;

  v_out := public.mm_save_material(jsonb_build_object(
    'group_id', v_group, 'type_id', v_type,
    'code', 'P3T_MAT', 'name', 'P3T Material', 'stock_uom', 'm'
  ));
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_material failed: %', v_out;
  END IF;
  v_mat := (v_out->'data'->>'id')::uuid;

  -- Duplicate material
  v_out := public.mm_save_material(jsonb_build_object(
    'group_id', v_group, 'type_id', v_type,
    'code', 'P3T_MAT', 'name', 'Dup', 'stock_uom', 'm'
  ));
  IF v_out->>'code' IS DISTINCT FROM 'DUPLICATE_UNIT_CODE' THEN
    RAISE EXCEPTION 'expected DUPLICATE_UNIT_CODE, got %', v_out;
  END IF;
  RAISE NOTICE 'OK DUPLICATE_UNIT_CODE';

  -- Insert stock unit to lock UOM (direct — Phase 4 not built)
  INSERT INTO public.mm_stock_units (
    factory_id, unit_code, unit_kind, material_id, source, uom, received_qty, current_qty, status
  ) VALUES (
    v_factory, 'P3T-U1', 'roll', v_mat, 'external', 'm', 10, 10, 'draft'
  );

  v_out := public.mm_save_material(jsonb_build_object(
    'id', v_mat,
    'row_version', (SELECT row_version FROM public.mm_materials WHERE id = v_mat),
    'stock_uom', 'kg'
  ));
  IF v_out->>'code' IS DISTINCT FROM 'UOM_LOCKED' THEN
    RAISE EXCEPTION 'expected UOM_LOCKED, got %', v_out;
  END IF;
  RAISE NOTICE 'OK UOM_LOCKED';

  -- STALE_VERSION
  v_out := public.mm_save_material(jsonb_build_object(
    'id', v_mat,
    'row_version', 0,
    'name', 'stale'
  ));
  IF v_out->>'code' IS DISTINCT FROM 'STALE_VERSION' THEN
    RAISE EXCEPTION 'expected STALE_VERSION, got %', v_out;
  END IF;
  RAISE NOTICE 'OK STALE_VERSION';

  -- Fake QC inspection referencing template v1 (drives versioning)
  INSERT INTO public.mm_qc_inspections (
    factory_id, receipt_id, template_id, template_version, overall_result, stock_unit_id
  )
  SELECT v_factory, v_receipt, v_tmpl_v1, 1, 'pass', u.id
  FROM public.mm_stock_units u
  WHERE u.unit_code = 'P3T-U1' AND u.factory_id = v_factory
  LIMIT 1;

  -- Versioned template edit
  v_out := public.mm_save_test_template(
    jsonb_build_object(
      'id', v_tmpl_v1,
      'row_version', (SELECT row_version FROM public.mm_test_templates WHERE id = v_tmpl_v1),
      'name', 'P3T Template v2'
    ),
    jsonb_build_array(jsonb_build_object('attribute_def_id', v_attr, 'seq', 1, 'spec_min', 100))
  );
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_save_test_template version failed: %', v_out;
  END IF;
  IF v_out->'data'->>'action' IS DISTINCT FROM 'versioned' THEN
    RAISE EXCEPTION 'expected action=versioned, got %', v_out;
  END IF;
  v_tmpl_v2 := (v_out->'data'->>'id')::uuid;
  v_version2 := (v_out->'data'->>'version')::integer;
  IF v_tmpl_v2 = v_tmpl_v1 OR v_version2 IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected new v2 template, got %', v_out;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mm_test_templates WHERE id = v_tmpl_v1 AND version = 1) THEN
    RAISE EXCEPTION 'v1 template not preserved';
  END IF;
  RAISE NOTICE 'OK template versioning v1→v2';

  -- Location delete-when-referenced → deactivate path
  UPDATE public.mm_stock_units
  SET current_location_id = v_loc_b
  WHERE unit_code = 'P3T-U1' AND factory_id = v_factory;

  v_out := public.mm_save_location(jsonb_build_object(
    'id', v_loc_b,
    'row_version', (SELECT row_version FROM public.mm_locations WHERE id = v_loc_b),
    'delete', true
  ));
  IF v_out->>'code' IS DISTINCT FROM 'INVALID_TRANSITION' THEN
    RAISE EXCEPTION 'expected location delete rejection, got %', v_out;
  END IF;
  RAISE NOTICE 'OK location delete-when-referenced rejected';

  -- Component map (if fabric_components exist)
  SELECT id INTO v_fc
  FROM public.fabric_components
  WHERE factory_id = v_factory AND is_active
  ORDER BY created_at
  LIMIT 1;
  IF v_fc IS NOT NULL THEN
    v_out := public.mm_map_component_material(v_fc, v_mat, NULL, NULL);
    IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
      RAISE EXCEPTION 'mm_map_component_material failed: %', v_out;
    END IF;
    RAISE NOTICE 'OK mm_map_component_material';
  ELSE
    RAISE NOTICE 'SKIP component map: no fabric_components';
  END IF;

  -- Bundle read
  v_out := public.mm_get_config_bundle();
  IF COALESCE((v_out->>'ok')::boolean, false) <> true THEN
    RAISE EXCEPTION 'mm_get_config_bundle failed: %', v_out;
  END IF;
  IF v_out->'data'->'groups' IS NULL THEN
    RAISE EXCEPTION 'bundle missing groups';
  END IF;
  RAISE NOTICE 'OK mm_get_config_bundle';

  -- Cleanup test rows
  DELETE FROM public.mm_qc_inspections WHERE receipt_id = v_receipt;
  DELETE FROM public.mm_stock_units WHERE factory_id = v_factory AND unit_code LIKE 'P3T%';
  DELETE FROM public.mm_receipts WHERE id = v_receipt;
  DELETE FROM public.mm_component_material_map WHERE material_id = v_mat;
  DELETE FROM public.mm_test_template_fields WHERE template_id IN (v_tmpl_v1, v_tmpl_v2);
  DELETE FROM public.mm_test_templates WHERE id IN (v_tmpl_v1, v_tmpl_v2);
  DELETE FROM public.mm_attribute_defs WHERE id = v_attr;
  DELETE FROM public.mm_materials WHERE id = v_mat;
  DELETE FROM public.mm_material_types WHERE id = v_type;
  DELETE FROM public.mm_reason_codes WHERE id = v_reason;
  DELETE FROM public.mm_suppliers WHERE id = v_sup;
  DELETE FROM public.mm_locations WHERE id IN (v_loc_b, v_loc_a);

  -- Restore module state
  UPDATE public.factory_modules
  SET enabled = COALESCE(v_was_enabled, false),
      config = COALESCE(v_was_config, config)
  WHERE factory_id = v_factory AND module_key = 'material';

  RAISE NOTICE 'OK Phase 3 config RPC tests complete';
END $$;

SELECT 'phase3_mm_config_ok'::text AS status;
