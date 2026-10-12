-- Warehouse / mill ops RPCs. jsonb {ok, data|code, message}. Writes only via these.

CREATE OR REPLACE FUNCTION public._mm_require_ops(p_key text DEFAULT 'mm_roll_entry')
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_apps jsonb;
BEGIN
  PERFORM public.assert_module_enabled('material');
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RAISE EXCEPTION 'NO_FACTORY'; END IF;
  IF public.is_factory_admin() THEN RETURN v_factory; END IF;
  SELECT COALESCE(p.assigned_apps, '[]'::jsonb) INTO v_apps
  FROM public.profiles p WHERE p.id = auth.uid();
  IF v_apps IS NULL OR NOT (
    v_apps @> to_jsonb(ARRAY[p_key])
    OR v_apps @> '["mm_inventory"]'::jsonb
    OR v_apps @> '["mm_roll_entry"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'NO_PERMISSION';
  END IF;
  RETURN v_factory;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_loc(p_factory uuid, p_code text)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM public.mm_locations
  WHERE factory_id = p_factory AND code = p_code AND is_active
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._mm_ledger(
  p_factory uuid, p_unit uuid, p_type text, p_len numeric,
  p_status_before text, p_status_after text,
  p_loc_before uuid, p_loc_after uuid,
  p_ref_table text, p_ref uuid, p_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  INSERT INTO public.mm_stock_ledger (
    factory_id, stock_unit_id, entry_type, qty_delta, balance_after,
    status_before, status_after, location_before, location_after,
    ref_table, ref_id, note, actor_id, created_by
  ) VALUES (
    p_factory, p_unit, p_type, COALESCE(p_len, 0), COALESCE(p_len, 0),
    p_status_before, p_status_after, p_loc_before, p_loc_after,
    p_ref_table, p_ref, p_note, auth.uid(), auth.uid()
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_set_factory_feature(p_key text, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_mill boolean;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RETURN public._mm_err('NO_PERMISSION', 'Admin required');
  END IF;
  PERFORM public.assert_module_enabled('material');
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  IF p_key IS DISTINCT FROM 'in_house_mill' THEN
    RETURN public._mm_err('INVALID', 'Only in_house_mill can be toggled');
  END IF;
  v_mill := COALESCE(p_enabled, false);
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES (v_factory, 'in_house_mill', v_mill)
  ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (v_factory, 'receive_goods', NOT v_mill),
    (v_factory, 'test_rolls', NOT v_mill)
  ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  RETURN public._mm_ok(jsonb_build_object('in_house_mill', v_mill));
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
  RETURN public._mm_err('ERROR', SQLERRM);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_enable_module(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RETURN public._mm_err('NO_PERMISSION', 'Admin required');
  END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  PERFORM public.set_factory_module('material', true, COALESCE(p_config, '{}'::jsonb));
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (v_factory, 'in_house_mill', true),
    (v_factory, 'receive_goods', false),
    (v_factory, 'test_rolls', false)
  ON CONFLICT (factory_id, feature_key) DO NOTHING;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  RETURN public._mm_ok(jsonb_build_object('factory_id', v_factory));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_ops_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_mill boolean;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'Not allowed'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  SELECT COALESCE(bool_or(enabled), true) INTO v_mill
  FROM public.mm_factory_features
  WHERE factory_id = v_factory AND feature_key = 'in_house_mill';
  RETURN public._mm_ok(jsonb_build_object(
    'in_house_mill', COALESCE(v_mill, true),
    'features', COALESCE((
      SELECT jsonb_object_agg(feature_key, enabled)
      FROM public.mm_factory_features WHERE factory_id = v_factory
    ), '{}'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'location_type', location_type) ORDER BY code)
      FROM public.mm_locations WHERE factory_id = v_factory AND is_active
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_resolve_style_material(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_type_name text;
  v_type_id uuid;
  v_cat text;
  v_bom uuid;
  v_out public.mm_style_materials%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    RETURN public._mm_err('NO_PERMISSION', 'Not allowed');
  END;

  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric line are required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders o
    WHERE o.id = p_order_id AND o.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Order not found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.colorways c
    WHERE c.id = p_colorway_id AND c.order_id = p_order_id AND c.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Colorway not found');
  END IF;

  v_bom := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT cm.id, cm.category, NULLIF(trim(cm.type), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_bom, v_cat, v_type_name
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_bom := NULL;
    END;
    IF v_bom IS NOT NULL AND v_cat IS DISTINCT FROM 'Fabric' THEN
      RETURN public._mm_err('INVALID', 'Pick a fabric line, not trim');
    END IF;
  END IF;

  IF v_bom IS NULL THEN
    SELECT id, name INTO v_type_id, v_type_name
    FROM public.mm_fabric_types
    WHERE id = p_colorway_material_id AND factory_id = v_factory AND is_active;
    IF v_type_id IS NULL THEN
      RETURN public._mm_err('NOT_FOUND', 'Fabric line not found');
    END IF;
  ELSE
    IF v_type_name IS NULL OR v_type_name = '' THEN
      RETURN public._mm_err('REQUIRED', 'This fabric line has no fabric type. Set it on the order first');
    END IF;
    SELECT id INTO v_type_id
    FROM public.mm_fabric_types
    WHERE factory_id = v_factory AND is_active AND lower(name) = lower(v_type_name)
    LIMIT 1;
    IF v_type_id IS NULL THEN
      RETURN public._mm_err('NOT_FOUND', 'Fabric type "' || v_type_name || '" is not in Material setup');
    END IF;
  END IF;

  INSERT INTO public.mm_style_materials (
    factory_id, order_id, colorway_id, colorway_material_id, fabric_type_id, created_by, updated_by
  ) VALUES (
    v_factory, p_order_id, p_colorway_id, v_bom, v_type_id, auth.uid(), auth.uid()
  )
  ON CONFLICT (factory_id, order_id, colorway_id, fabric_type_id) DO UPDATE SET
    colorway_material_id = COALESCE(EXCLUDED.colorway_material_id, public.mm_style_materials.colorway_material_id),
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO v_out;
  RETURN public._mm_ok(to_jsonb(v_out));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_order_fabric_lines(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_colorways jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT EXISTS (SELECT 1 FROM public.style_orders WHERE id = p_order_id AND factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND', 'Order not found');
  END IF;

  v_colorways := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT COALESCE(jsonb_agg(jsonb_build_object(
           ''id'', c.id, ''name'', c.name, ''color_code'', c.color_code,
           ''fabrics'', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               ''id'', cm.id,
               ''name'', COALESCE(NULLIF(trim(cm.name), ''''), NULLIF(trim(cm.type), ''''), ''Fabric''),
               ''type'', cm.type,
               ''fabric_category'', cm.fabric_category,
               ''fabric_type_id'', ft.id
             ) ORDER BY cm.seq, cm.name)
             FROM public.colorway_materials cm
             LEFT JOIN public.mm_fabric_types ft
               ON ft.factory_id = $2 AND ft.is_active
              AND lower(ft.name) = lower(NULLIF(trim(cm.type), ''''))
             WHERE cm.colorway_id = c.id AND cm.factory_id = $2 AND cm.category = ''Fabric''
           ), ''[]''::jsonb)
         ) ORDER BY c.name), ''[]''::jsonb)
         FROM public.colorways c
         WHERE c.order_id = $1 AND c.factory_id = $2'
      INTO v_colorways
      USING p_order_id, v_factory;
    EXCEPTION WHEN OTHERS THEN
      v_colorways := NULL;
    END;
  END IF;

  IF v_colorways IS NULL THEN
    SELECT COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'color_code', c.color_code,
        'fabrics', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.name, 'type', t.name, 'fabric_category', '',
            'fabric_type_id', t.id
          ) ORDER BY t.seq, t.name)
          FROM public.mm_fabric_types t
          WHERE t.factory_id = v_factory AND t.is_active
        ), '[]'::jsonb)
      ) ORDER BY c.name)
      FROM public.colorways c
      WHERE c.order_id = p_order_id AND c.factory_id = v_factory
    ), '[]'::jsonb) INTO v_colorways;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('colorways', v_colorways));
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_insert_rolls(
  p_factory uuid, p_sm uuid, p_challan uuid, p_source text,
  p_status text, p_loc uuid, p_rolls jsonb, p_freeze boolean
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row jsonb;
  v_id uuid;
  v_code text;
  v_len numeric;
  v_wt numeric;
  v_shade text;
  v_lot text;
  v_attrs jsonb;
  v_snap jsonb;
  v_n integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    v_code := public.next_doc_no('ROLL');
    IF p_freeze THEN
      v_snap := jsonb_build_object(
        'length_m', v_len, 'weight_kg', v_wt, 'shade', v_shade, 'lot_no', v_lot, 'attributes', v_attrs
      );
    ELSE
      v_snap := NULL;
    END IF;
    INSERT INTO public.mm_stock_units (
      factory_id, unit_code, unit_kind, style_material_id, in_challan_id, source,
      uom, length_m, weight_kg, shade, lot_no, attributes, mill_snapshot, status,
      current_location_id, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, p_challan, p_source, 'm',
      v_len, v_wt, v_shade, v_lot, v_attrs, v_snap, p_status, p_loc, auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (p_factory, p_challan, v_id, auth.uid());
    PERFORM public._mm_ledger(
      p_factory, v_id, CASE WHEN p_source = 'mill' THEN 'INHOUSE_IN' ELSE 'RECEIPT_IN' END,
      v_len, NULL, p_status, NULL, p_loc, 'mm_in_challans', p_challan, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_send_to_warehouse(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid, p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT COALESCE((
    SELECT enabled FROM public.mm_factory_features
    WHERE factory_id = v_factory AND feature_key = 'in_house_mill'
  ), true) THEN
    RETURN public._mm_err('MILL_OFF', 'In-house mill is off');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  v_no := public.next_doc_no('MILL');
  INSERT INTO public.mm_in_challans (
    factory_id, challan_no, source, style_material_id, status, sent_at, sent_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, 'mill', v_sm_id, 'pending', now(), auth.uid(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_ch;
  BEGIN
    v_n := public._mm_insert_rolls(v_factory, v_sm_id, v_ch, 'mill', 'in_transit', v_mill, p_rolls, true);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_vendor_in_challan(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid,
  p_supplier_name text, p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ch uuid;
  v_no text;
  v_n integer;
  v_wh uuid;
  v_sup text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_sup := NULLIF(trim(COALESCE(p_supplier_name, '')), '');
  IF v_sup IS NULL THEN RETURN public._mm_err('REQUIRED', 'Supplier name is required'); END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  v_no := public.next_doc_no('GRN');
  INSERT INTO public.mm_in_challans (
    factory_id, challan_no, source, style_material_id, supplier_name, status,
    received_at, received_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, 'vendor', v_sm_id, v_sup, 'received', now(), auth.uid(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_ch;
  BEGIN
    v_n := public._mm_insert_rolls(v_factory, v_sm_id, v_ch, 'vendor', 'pending_qc', v_wh, p_rolls, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_challan_header(p_ch public.mm_in_challans)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_ch.id,
    'challan_no', p_ch.challan_no,
    'source', p_ch.source,
    'status', p_ch.status,
    'supplier_name', p_ch.supplier_name,
    'sent_at', p_ch.sent_at,
    'received_at', p_ch.received_at,
    'row_version', p_ch.row_version,
    'style_material_id', p_ch.style_material_id,
    'order_id', sm.order_id,
    'colorway_id', sm.colorway_id,
    'style_name', o.style_name,
    'color_name', cw.name,
    'fabric_type', ft.name,
    'fabric_name', ft.name,
    'roll_count', (
      SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = p_ch.id
    ),
    'tested_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result IS NOT NULL
    ),
    'failed_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'fail'
    ),
    'pending_qc_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.status = 'pending_qc'
    )
  )
  FROM public.mm_style_materials sm
  JOIN public.style_orders o ON o.id = sm.order_id
  JOIN public.colorways cw ON cw.id = sm.colorway_id
  JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
  WHERE sm.id = p_ch.style_material_id
$$;

CREATE OR REPLACE FUNCTION public.mm_list_in_challans(p_source text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(public._mm_challan_header(c) ORDER BY
      CASE WHEN c.status = 'pending' THEN 0 ELSE 1 END,
      COALESCE(c.sent_at, c.received_at, c.created_at) DESC)
    FROM public.mm_in_challans c
    WHERE c.factory_id = v_factory
      AND (p_source IS NULL OR p_source = '' OR c.source = p_source)
      AND (
        p_status IS NULL OR p_status IN ('', 'all')
        OR (p_source = 'mill' AND p_status = c.status)
        OR (p_source = 'vendor' AND p_status = 'pending' AND EXISTS (
          SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc'
        ))
        OR (p_source = 'vendor' AND p_status = 'tested' AND NOT EXISTS (
          SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc'
        ))
      )
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_in_challan_rolls(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_type uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  SELECT fabric_type_id INTO v_type FROM public.mm_style_materials WHERE id = v_ch.style_material_id;
  RETURN public._mm_ok(jsonb_build_object(
    'challan', public._mm_challan_header(v_ch),
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type AND f.is_active
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
        'shade', u.shade, 'lot_no', u.lot_no, 'attributes', u.attributes,
        'mill_snapshot', u.mill_snapshot, 'status', u.status, 'qc_result', u.qc_result,
        'row_version', u.row_version, 'source', u.source
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      WHERE u.in_challan_id = v_ch.id
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_wh uuid;
  v_edit jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source <> 'mill' THEN RETURN public._mm_err('INVALID', 'Not a mill challan'); END IF;
  IF v_ch.status = 'received' THEN RETURN public._mm_err('ALREADY', 'Already received'); END IF;
  IF v_ch.row_version IS DISTINCT FROM COALESCE(p_row_version, v_ch.row_version) THEN
    RETURN public._mm_err('STALE_VERSION', 'Reload and try again');
  END IF;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  FOR v_edit IN SELECT * FROM jsonb_array_elements(COALESCE(p_roll_edits, '[]'::jsonb))
  LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = (v_edit->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.mm_stock_units SET
      length_m = COALESCE(NULLIF(v_edit->>'length_m', '')::numeric, length_m),
      weight_kg = COALESCE(NULLIF(v_edit->>'weight_kg', '')::numeric, weight_kg),
      shade = COALESCE(NULLIF(trim(v_edit->>'shade'), ''), shade),
      lot_no = COALESCE(NULLIF(trim(v_edit->>'lot_no'), ''), lot_no),
      attributes = CASE WHEN jsonb_typeof(v_edit->'attributes') = 'object' THEN v_edit->'attributes' ELSE attributes END,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
  END LOOP;
  FOR v_unit IN
    SELECT * FROM public.mm_stock_units
    WHERE in_challan_id = v_ch.id AND factory_id = v_factory AND status = 'in_transit'
  LOOP
    UPDATE public.mm_stock_units SET
      status = 'in_stock', current_location_id = v_wh,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_unit.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, 'in_stock',
      v_unit.current_location_id, v_wh, 'mm_in_challans', v_ch.id, 'Warehouse receive'
    );
  END LOOP;
  UPDATE public.mm_in_challans SET
    status = 'received', received_at = now(), received_by = auth.uid(),
    row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE id = v_ch.id;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'status', 'received'));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_vendor_roll_tests(p_id uuid, p_roll_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_wh uuid;
  v_row jsonb;
  v_pass boolean;
  v_status text;
  v_qc text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source <> 'vendor' THEN RETURN public._mm_err('INVALID', 'Not a vendor challan'); END IF;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_roll_results, '[]'::jsonb))
  LOOP
    v_pass := COALESCE((v_row->>'pass')::boolean, false);
    v_qc := CASE WHEN v_row->>'pass' IS NULL THEN NULL WHEN v_pass THEN 'pass' ELSE 'fail' END;
    v_status := CASE WHEN v_qc IS NULL THEN 'pending_qc' WHEN v_pass THEN 'in_stock' ELSE 'rejected' END;
    UPDATE public.mm_stock_units SET
      length_m = COALESCE(NULLIF(v_row->>'length_m', '')::numeric, length_m),
      weight_kg = COALESCE(NULLIF(v_row->>'weight_kg', '')::numeric, weight_kg),
      shade = COALESCE(NULLIF(trim(v_row->>'shade'), ''), shade),
      lot_no = COALESCE(NULLIF(trim(v_row->>'lot_no'), ''), lot_no),
      attributes = CASE WHEN jsonb_typeof(v_row->'attributes') = 'object' THEN v_row->'attributes' ELSE attributes END,
      qc_result = v_qc,
      status = v_status,
      current_location_id = v_wh,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = (v_row->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_update_roll(p_unit_id uuid, p_patch jsonb, p_row_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = p_unit_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
  IF v_unit.row_version IS DISTINCT FROM COALESCE(p_row_version, v_unit.row_version) THEN
    RETURN public._mm_err('STALE_VERSION', 'Reload and try again');
  END IF;
  UPDATE public.mm_stock_units SET
    length_m = COALESCE(NULLIF(p_patch->>'length_m', '')::numeric, length_m),
    weight_kg = COALESCE(NULLIF(p_patch->>'weight_kg', '')::numeric, weight_kg),
    shade = COALESCE(NULLIF(trim(p_patch->>'shade'), ''), shade),
    lot_no = COALESCE(NULLIF(trim(p_patch->>'lot_no'), ''), lot_no),
    attributes = CASE WHEN jsonb_typeof(p_patch->'attributes') = 'object' THEN p_patch->'attributes' ELSE attributes END,
    mill_snapshot = mill_snapshot,
    row_version = row_version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = v_unit.id;
  PERFORM public._mm_ledger(
    v_factory, v_unit.id, 'ADJUST_PLUS', 0, v_unit.status, v_unit.status,
    v_unit.current_location_id, v_unit.current_location_id, 'mm_stock_units', v_unit.id, 'Correction'
  );
  RETURN public._mm_ok(jsonb_build_object('id', v_unit.id));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_warehouse_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'rolls_in_stock', (
      SELECT count(*) FROM public.mm_stock_units
      WHERE factory_id = v_factory AND status = 'in_stock' AND current_location_id = v_wh
    ),
    'qty_m', (
      SELECT COALESCE(sum(length_m), 0) FROM public.mm_stock_units
      WHERE factory_id = v_factory AND status = 'in_stock' AND current_location_id = v_wh
    ),
    'qty_kg', (
      SELECT COALESCE(sum(weight_kg), 0) FROM public.mm_stock_units
      WHERE factory_id = v_factory AND status = 'in_stock' AND current_location_id = v_wh
    ),
    'by_fabric_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', t.name, 'rolls', t.n) ORDER BY t.n DESC)
      FROM (
        SELECT ft.name, count(*)::int AS n
        FROM public.mm_stock_units u
        JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
        JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
        WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.current_location_id = v_wh
        GROUP BY ft.name
        ORDER BY count(*) DESC
        LIMIT 6
      ) t
    ), '[]'::jsonb),
    'pending', COALESCE((
      SELECT jsonb_agg(s.x ORDER BY s.ts DESC NULLS LAST)
      FROM (
        SELECT q.x, q.ts
        FROM (
          SELECT jsonb_build_object(
            'kind', 'mill', 'id', c.id, 'label',
            'Batch ' || c.challan_no || ' — ' || o.style_name || ' / ' || cw.name || ' — ' ||
            (SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = c.id) || ' rolls — sent ' ||
            CASE WHEN c.sent_at IS NULL THEN 'today'
                 WHEN c.sent_at > now() - interval '1 day' THEN 'today'
                 ELSE (EXTRACT(DAY FROM now() - c.sent_at)::int)::text || ' days ago' END,
            'ts', c.sent_at
          ) AS x, c.sent_at AS ts
          FROM public.mm_in_challans c
          JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          JOIN public.style_orders o ON o.id = sm.order_id
          JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory AND c.source = 'mill' AND c.status = 'pending'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'vendor', 'id', c.id, 'label',
            c.challan_no || ' — ' || o.style_name || ' / ' || cw.name || ' — ' ||
            (SELECT count(*) FILTER (WHERE u.qc_result IS NOT NULL) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' of ' ||
            (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' rolls tested',
            'ts', c.received_at
          ) AS x, c.received_at AS ts
          FROM public.mm_in_challans c
          JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          JOIN public.style_orders o ON o.id = sm.order_id
          JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory AND c.source = 'vendor'
            AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc')
        ) q
        ORDER BY q.ts DESC NULLS LAST
        LIMIT 8
      ) s
    ), '[]'::jsonb),
    'internal_pending', (
      SELECT count(*) FROM public.mm_in_challans
      WHERE factory_id = v_factory AND source = 'mill' AND status = 'pending'
    ),
    'internal_stock', (
      SELECT count(*) FROM public.mm_stock_units
      WHERE factory_id = v_factory AND source = 'mill' AND status = 'in_stock' AND current_location_id = v_wh
    ),
    'external_pending', (
      SELECT count(*) FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory AND c.source = 'vendor'
        AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc')
    ),
    'external_stock', (
      SELECT count(*) FROM public.mm_stock_units
      WHERE factory_id = v_factory AND source = 'vendor' AND status = 'in_stock' AND current_location_id = v_wh
    ),
    'store_pending', (
      SELECT count(*) FROM public.mm_store_challans
      WHERE factory_id = v_factory AND status = 'pending'
    ),
    'store_sent', (
      SELECT count(*) FROM public.mm_store_challans WHERE factory_id = v_factory
    )
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_store_stock(p_style_material_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  RETURN public._mm_ok(jsonb_build_object(
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'style_material_id', sm.id,
        'style_name', o.style_name,
        'color_name', cw.name,
        'fabric_type', ft.name,
        'rolls', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND u.current_location_id = v_wh AND u.store_challan_id IS NULL
        )
      ) ORDER BY o.style_name, cw.name)
      FROM public.mm_style_materials sm
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      WHERE sm.factory_id = v_factory
        AND (p_style_material_id IS NULL OR sm.id = p_style_material_id)
        AND EXISTS (
          SELECT 1 FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND u.current_location_id = v_wh AND u.store_challan_id IS NULL
        )
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.current_location_id = v_wh
        AND u.store_challan_id IS NULL
        AND (p_style_material_id IS NULL OR u.style_material_id = p_style_material_id)
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_create_store_challan(p_style_material_id uuid, p_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_id uuid;
  v_no text;
  v_uid uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_style_material_id IS NULL OR p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to send');
  END IF;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_stock_units u
      WHERE u.id = v_uid AND u.factory_id = v_factory AND u.style_material_id = p_style_material_id
        AND u.status = 'in_stock' AND u.current_location_id = v_wh AND u.store_challan_id IS NULL
    ) THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not available warehouse stock for this style');
    END IF;
  END LOOP;
  v_no := public.next_doc_no('SC');
  INSERT INTO public.mm_store_challans (
    factory_id, challan_no, style_material_id, from_location_id, to_location_id,
    status, sent_at, sent_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, p_style_material_id, v_wh, v_cut, 'pending', now(), auth.uid(), auth.uid(), auth.uid()
  ) RETURNING id INTO v_id;
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    INSERT INTO public.mm_store_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_id, v_uid, auth.uid());
    UPDATE public.mm_stock_units SET
      store_challan_id = v_id, row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_uid;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'challan_no', v_no, 'status', 'pending'));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_store_challans(p_status text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', sc.id, 'challan_no', sc.challan_no, 'status', sc.status,
      'sent_at', sc.sent_at, 'received_at', sc.received_at,
      'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
      'roll_count', (SELECT count(*) FROM public.mm_store_challan_lines l WHERE l.challan_id = sc.id)
    ) ORDER BY CASE WHEN sc.status = 'pending' THEN 0 ELSE 1 END, sc.sent_at DESC)
    FROM public.mm_store_challans sc
    JOIN public.mm_style_materials sm ON sm.id = sc.style_material_id
    JOIN public.style_orders o ON o.id = sm.order_id
    JOIN public.colorways cw ON cw.id = sm.colorway_id
    JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
    WHERE sc.factory_id = v_factory
      AND (p_status IS NULL OR p_status IN ('', 'all') OR sc.status = p_status)
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_store_challan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sc public.mm_store_challans%ROWTYPE;
  v_header jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_sc FROM public.mm_store_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Store challan not found'); END IF;
  SELECT jsonb_build_object(
    'id', v_sc.id, 'challan_no', v_sc.challan_no, 'status', v_sc.status,
    'sent_at', v_sc.sent_at, 'received_at', v_sc.received_at, 'row_version', v_sc.row_version,
    'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name
  ) INTO v_header
  FROM public.mm_style_materials sm
  JOIN public.style_orders o ON o.id = sm.order_id
  JOIN public.colorways cw ON cw.id = sm.colorway_id
  JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
  WHERE sm.id = v_sc.style_material_id;
  RETURN public._mm_ok(jsonb_build_object(
    'challan', v_header,
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'shade', u.shade,
        'lot_no', u.lot_no, 'source', u.source
      ) ORDER BY u.unit_code)
      FROM public.mm_store_challan_lines l
      JOIN public.mm_stock_units u ON u.id = l.stock_unit_id
      WHERE l.challan_id = v_sc.id
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_receive_store_challan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sc public.mm_store_challans%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_sc FROM public.mm_store_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Store challan not found'); END IF;
  IF v_sc.status = 'received' THEN RETURN public._mm_err('ALREADY', 'Already received'); END IF;
  -- Document receive only. Rolls stay in_stock at WAREHOUSE for the later cutting picker.
  UPDATE public.mm_store_challans SET
    status = 'received', received_at = now(), received_by = auth.uid(),
    row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE id = v_sc.id;
  RETURN public._mm_ok(jsonb_build_object('id', v_sc.id, 'status', 'received'));
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_require_ops(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_loc(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_ledger(uuid, uuid, text, numeric, text, text, uuid, uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_insert_rolls(uuid, uuid, uuid, text, text, uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_challan_header(public.mm_in_challans) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mm_set_factory_feature(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_enable_module(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_ops_context() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_resolve_style_material(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_order_fabric_lines(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_send_to_warehouse(uuid, uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_in_challan(uuid, uuid, uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_in_challans(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_in_challan_rolls(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(uuid, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_roll_tests(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_update_roll(uuid, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dashboard() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_store_stock(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_create_store_challan(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_store_challans(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_store_challan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_receive_store_challan(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
