-- Mill stock list (allocated + general PO, at mill or in transit).
-- Testing parameters are separate from 4-point inspection.
-- capture_site: mill | warehouse | both | either. Either means at least one side.
-- 4-point pass stays the inspection gate (status in_stock). This gate is parameters only.

ALTER TABLE public.mm_type_test_fields
  ADD COLUMN IF NOT EXISTS capture_site text NOT NULL DEFAULT 'either';

ALTER TABLE public.mm_type_test_fields
  DROP CONSTRAINT IF EXISTS mm_type_test_fields_capture_site_chk;

ALTER TABLE public.mm_type_test_fields
  ADD CONSTRAINT mm_type_test_fields_capture_site_chk
  CHECK (capture_site = ANY (ARRAY['mill', 'warehouse', 'both', 'either']));

CREATE OR REPLACE FUNCTION public._mm_param_text(p_bag jsonb, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(COALESCE(p_bag->>p_key, '')), '')
$$;

CREATE OR REPLACE FUNCTION public._mm_cutting_param_block(p_unit public.mm_stock_units)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_field record;
  v_mill text;
  v_wh text;
  v_mill_bag jsonb;
  v_wh_bag jsonb;
  v_site text;
BEGIN
  v_mill_bag := CASE
    WHEN jsonb_typeof(p_unit.mill_snapshot->'attributes') = 'object' THEN p_unit.mill_snapshot->'attributes'
    WHEN jsonb_typeof(p_unit.attributes) = 'object' THEN p_unit.attributes
    ELSE '{}'::jsonb
  END;
  SELECT COALESCE(i.field_values, '{}'::jsonb) INTO v_wh_bag
  FROM public.mm_warehouse_inspections i
  WHERE i.stock_unit_id = p_unit.id;
  IF v_wh_bag IS NULL OR jsonb_typeof(v_wh_bag) <> 'object' THEN
    v_wh_bag := '{}'::jsonb;
  END IF;

  FOR v_field IN
    SELECT f.key, f.label, f.capture_site
    FROM public.mm_type_test_fields f
    WHERE f.factory_id = p_unit.factory_id
      AND f.type_id = p_unit.fabric_type_id
      AND f.is_active
    ORDER BY f.seq, f.label
  LOOP
    v_mill := public._mm_param_text(v_mill_bag, v_field.key);
    v_wh := public._mm_param_text(v_wh_bag, v_field.key);
    v_site := COALESCE(v_field.capture_site, 'either');
    IF p_unit.source IS DISTINCT FROM 'mill' AND v_site = 'mill' THEN
      v_site := 'warehouse';
    ELSIF p_unit.source IS DISTINCT FROM 'mill' AND v_site = 'both' THEN
      v_site := 'warehouse';
    END IF;
    IF v_site = 'mill' AND v_mill IS NULL THEN
      RETURN 'Mill testing parameter missing: ' || v_field.label;
    ELSIF v_site = 'warehouse' AND v_wh IS NULL THEN
      RETURN 'Warehouse testing parameter missing: ' || v_field.label;
    ELSIF v_site = 'both' AND (v_mill IS NULL OR v_wh IS NULL) THEN
      RETURN 'Testing parameter required on mill and warehouse: ' || v_field.label;
    ELSIF v_site = 'either' AND v_mill IS NULL AND v_wh IS NULL THEN
      RETURN 'Testing parameter required on mill or warehouse: ' || v_field.label;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_mill_stock(
  p_search text DEFAULT NULL,
  p_alloc text DEFAULT NULL,
  p_place text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_search text;
  v_alloc text;
  v_place text;
  v_page integer;
  v_size integer;
  v_total integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_search := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_alloc := COALESCE(NULLIF(btrim(COALESCE(p_alloc, '')), ''), '');
  v_place := COALESCE(NULLIF(btrim(COALESCE(p_place, '')), ''), '');
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);

  SELECT count(*) INTO v_total
  FROM public.mm_mill_rolls r
  JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
  JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
  WHERE r.factory_id = v_factory
    AND (
      (r.status = 'draft' AND r.in_challan_id IS NULL)
      OR (c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
    )
    AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
    AND (
      v_place = ''
      OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL)
      OR (v_place = 'in_transit' AND c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
    )
    AND (
      v_search IS NULL
      OR lower(concat_ws(' ', r.unit_code, b.batch_no, ft.name, o.style_name, r.color_ref, r.lot_no)) LIKE '%' || v_search || '%'
    );

  RETURN public._mm_ok(jsonb_build_object(
    'total', v_total,
    'rows', COALESCE((
      SELECT jsonb_agg(x.obj)
      FROM (
        SELECT jsonb_build_object(
          'id', r.id,
          'unit_code', r.unit_code,
          'batch_no', b.batch_no,
          'fabric_type', ft.name,
          'color_ref', r.color_ref,
          'lot_no', r.lot_no,
          'length_m', r.length_m,
          'style_material_id', r.style_material_id,
          'style_name', o.style_name,
          'order_id', sm.order_id,
          'colorway_id', sm.colorway_id,
          'fabric_line_id', sm.colorway_material_id,
          'place', CASE
            WHEN r.status = 'draft' AND r.in_challan_id IS NULL THEN 'at_mill'
            ELSE 'in_transit'
          END
        ) AS obj
        FROM public.mm_mill_rolls r
        JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
        JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
        LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
        LEFT JOIN public.style_orders o ON o.id = sm.order_id
        LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
        WHERE r.factory_id = v_factory
          AND (
            (r.status = 'draft' AND r.in_challan_id IS NULL)
            OR (c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
          )
          AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
          AND (
            v_place = ''
            OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL)
            OR (v_place = 'in_transit' AND c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
          )
          AND (
            v_search IS NULL
            OR lower(concat_ws(' ', r.unit_code, b.batch_no, ft.name, o.style_name, r.color_ref, r.lot_no)) LIKE '%' || v_search || '%'
          )
        ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL) DESC, b.batch_no, r.unit_code
        OFFSET (v_page - 1) * v_size
        LIMIT v_size
      ) x
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_create_store_challan(
  p_style_material_id uuid,
  p_unit_ids uuid[],
  p_challan_no text DEFAULT NULL,
  p_reference_no text DEFAULT NULL,
  p_sent_at date DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
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
  v_unit public.mm_stock_units%ROWTYPE;
  v_ref text;
  v_block text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_style_material_id IS NULL OR p_unit_ids IS NULL OR array_length(p_unit_ids, 1) IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to send');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit
    FROM public.mm_stock_units u
    WHERE u.id = v_uid AND u.factory_id = v_factory AND u.style_material_id = p_style_material_id
      AND u.status = 'in_stock' AND u.store_challan_id IS NULL
      AND public._mm_is_pickable_loc(u.current_location_id)
      AND public._mm_loc_is_under(u.current_location_id, v_wh);
    IF NOT FOUND THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not on a warehouse rack');
    END IF;
    v_block := public._mm_cutting_param_block(v_unit);
    IF v_block IS NOT NULL THEN
      RETURN public._mm_err('PARAMS', v_unit.unit_code || ': ' || v_block);
    END IF;
  END LOOP;
  v_no := NULLIF(btrim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN v_no := public.next_doc_no('SC'); END IF;
  v_ref := NULLIF(btrim(COALESCE(p_reference_no, '')), '');
  BEGIN
    INSERT INTO public.mm_store_challans (
      factory_id, challan_no, style_material_id, from_location_id, to_location_id,
      status, sent_at, sent_by, remarks, reference_no, created_by, updated_by
    ) VALUES (
      v_factory, v_no, p_style_material_id, v_wh, v_cut, 'pending',
      COALESCE(p_sent_at, CURRENT_DATE)::timestamptz,
      auth.uid(),
      NULLIF(btrim(COALESCE(p_remarks, '')), ''),
      v_ref,
      auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That challan number already exists');
  END;
  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    INSERT INTO public.mm_store_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_id, v_uid, auth.uid());
    UPDATE public.mm_stock_units SET
      store_challan_id = v_id, current_location_id = v_cut,
      row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_uid;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_cut, 'mm_store_challans', v_id, 'Dispatched to cutting'
    );
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_id, 'challan_no', v_no, 'status', 'pending'));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_fields jsonb;
  v_field jsonb;
  v_seq integer := 0;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_label text;
  v_key text;
  v_data_type text;
  v_options jsonb;
  v_site text;
BEGIN
  BEGIN
    v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
  END IF;

  v_fields := COALESCE(p_fields, '[]'::jsonb);
  IF jsonb_typeof(v_fields) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;

  FOR v_field IN SELECT * FROM jsonb_array_elements(v_fields)
  LOOP
    v_label := trim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each test field needs a name'); END IF;
    v_seq := v_seq + 1;
    v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
    v_data_type := COALESCE(NULLIF(v_field->>'data_type', ''), 'text');
    v_options := COALESCE(v_field->'options', '[]'::jsonb);
    IF jsonb_typeof(v_options) IS DISTINCT FROM 'array' THEN v_options := '[]'::jsonb; END IF;
    v_site := COALESCE(NULLIF(v_field->>'capture_site', ''), 'either');
    IF v_site NOT IN ('mill', 'warehouse', 'both', 'either') THEN v_site := 'either'; END IF;
    v_id := NULLIF(v_field->>'id', '')::uuid;

    IF v_id IS NOT NULL THEN
      UPDATE public.mm_type_test_fields SET
        key = v_key, label = v_label, data_type = v_data_type, options = v_options,
        capture_site = v_site,
        seq = v_seq, is_active = true, row_version = row_version + 1,
        updated_at = now(), updated_by = auth.uid()
      WHERE id = v_id AND factory_id = v_factory AND type_id = p_type_id
      RETURNING id INTO v_id;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.mm_type_test_fields (
        factory_id, type_id, key, label, data_type, options, capture_site, seq, created_by, updated_by
      ) VALUES (
        v_factory, p_type_id, v_key, v_label, v_data_type, v_options, v_site, v_seq, auth.uid(), auth.uid()
      )
      ON CONFLICT (type_id, key) DO UPDATE SET
        label = EXCLUDED.label, data_type = EXCLUDED.data_type, options = EXCLUDED.options,
        capture_site = EXCLUDED.capture_site,
        seq = EXCLUDED.seq, is_active = true,
        row_version = public.mm_type_test_fields.row_version + 1,
        updated_at = now(), updated_by = auth.uid()
      RETURNING id INTO v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE public.mm_type_test_fields SET
    is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE type_id = p_type_id AND factory_id = v_factory AND is_active AND NOT (id = ANY (v_ids));

  RETURN public._mm_ok(jsonb_build_object('attribute_ids', to_jsonb(v_ids)));
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_param_text(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_cutting_param_block(public.mm_stock_units) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_list_mill_stock(text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_param_text(jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mm_cutting_param_block(public.mm_stock_units) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_mill_stock(text, text, text, integer, integer) TO authenticated, service_role;
