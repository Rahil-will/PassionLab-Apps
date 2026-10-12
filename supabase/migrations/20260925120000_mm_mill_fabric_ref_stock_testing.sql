-- General PO mill batches store mill-side fabric / color refs that survive
-- allocate-to-style. Mill stock lists only rolls still at the mill.
-- Testing updates roll attributes without adding rolls or changing identity.

ALTER TABLE public.mm_mill_batches
  ADD COLUMN IF NOT EXISTS fabric_ref_name text,
  ADD COLUMN IF NOT EXISTS color_ref text;

COMMENT ON COLUMN public.mm_mill_batches.fabric_ref_name IS
  'Mill fabric reference name. Kept after the batch is assigned to a style material.';
COMMENT ON COLUMN public.mm_mill_batches.color_ref IS
  'Mill color reference. Kept after the batch is assigned to a style material.';

DROP FUNCTION IF EXISTS public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_mill_batch(
  p_fabric_type_id uuid,
  p_batch_no text,
  p_mill_ref text,
  p_production_date date,
  p_remarks text,
  p_color_ref text,
  p_lot_no text,
  p_rolls jsonb,
  p_fabric_ref_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ft uuid;
  v_batch uuid;
  v_no text;
  v_n integer;
  v_mill uuid;
  v_date date;
  v_color text;
  v_lot text;
  v_ref_name text;
  v_rolls jsonb;
  v_row jsonb;
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
  SELECT id INTO v_ft FROM public.mm_fabric_types
  WHERE id = p_fabric_type_id AND factory_id = v_factory AND is_active;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  v_color := NULLIF(trim(COALESCE(p_color_ref, '')), '');
  v_lot := NULLIF(trim(COALESCE(p_lot_no, '')), '');
  v_ref_name := NULLIF(trim(COALESCE(p_fabric_ref_name, '')), '');
  v_rolls := '[]'::jsonb;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_rolls := v_rolls || jsonb_build_array(
      v_row || jsonb_build_object(
        'color_ref', COALESCE(NULLIF(trim(COALESCE(v_row->>'color_ref', '')), ''), v_color),
        'lot_no', COALESCE(NULLIF(trim(COALESCE(v_row->>'lot_no', '')), ''), v_lot)
      )
    );
  END LOOP;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_mill := public._mm_loc(v_factory, 'MILL');
  BEGIN
    INSERT INTO public.mm_mill_batches (
      factory_id, style_material_id, fabric_type_id, batch_no, mill_ref, fabric_ref_name, color_ref,
      production_date, remarks, created_by, updated_by
    ) VALUES (
      v_factory, NULL, v_ft, v_no, NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      v_ref_name, v_color, v_date, NULLIF(trim(COALESCE(p_remarks, '')), ''),
      public._mm_actor_id(), public._mm_actor_id()
    ) RETURNING id INTO v_batch;
    v_n := public._mm_insert_mill_batch_rolls(v_factory, NULL, v_batch, v_mill, v_rolls);
  EXCEPTION
    WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
    WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_mill_batch(uuid, text, text, date, text, text, text, jsonb, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.mm_update_mill_batch(uuid, text, text, date, text, jsonb, integer);

CREATE OR REPLACE FUNCTION public.mm_update_mill_batch(
  p_batch_id uuid,
  p_batch_no text,
  p_mill_ref text,
  p_production_date date,
  p_remarks text,
  p_rolls jsonb,
  p_row_version integer DEFAULT NULL,
  p_fabric_ref_name text DEFAULT NULL,
  p_color_ref text DEFAULT NULL,
  p_test_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_batch public.mm_mill_batches%ROWTYPE;
  v_no text;
  v_date date;
  v_mill uuid;
  v_row jsonb;
  v_id uuid;
  v_code text;
  v_len numeric;
  v_wt numeric;
  v_shade text;
  v_lot text;
  v_color text;
  v_attrs jsonb;
  v_new jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_test boolean;
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
  IF p_batch_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Mill batch is required');
  END IF;
  SELECT * INTO v_batch
  FROM public.mm_mill_batches
  WHERE id = p_batch_id AND factory_id = v_factory;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Mill batch not found');
  END IF;

  v_test := COALESCE(p_test_only, false);
  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN v_no := v_batch.batch_no; END IF;
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, v_batch.production_date, CURRENT_DATE);

  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Add at least one roll');
  END IF;

  BEGIN
    IF v_test THEN
      UPDATE public.mm_mill_batches SET
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_batch.id
        AND (p_row_version IS NULL OR row_version = p_row_version);
    ELSE
      UPDATE public.mm_mill_batches SET
        batch_no = v_no,
        mill_ref = NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
        fabric_ref_name = COALESCE(NULLIF(trim(COALESCE(p_fabric_ref_name, '')), ''), fabric_ref_name),
        color_ref = COALESCE(NULLIF(trim(COALESCE(p_color_ref, '')), ''), color_ref),
        production_date = v_date,
        remarks = NULLIF(trim(COALESCE(p_remarks, '')), ''),
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_batch.id
        AND (p_row_version IS NULL OR row_version = p_row_version);
    END IF;
    IF NOT FOUND THEN
      RETURN public._mm_err('STALE', 'This batch was changed elsewhere. Reload and try again');
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
  END;

  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_mill := public._mm_loc(v_factory, 'MILL');

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_id := NULL;
    BEGIN
      v_id := NULLIF(trim(COALESCE(v_row->>'id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF v_id IS NULL THEN
      IF v_test THEN
        RETURN public._mm_err('INVALID', 'Testing cannot add rolls');
      END IF;
      v_new := v_new || jsonb_build_array(v_row);
      CONTINUE;
    END IF;

    SELECT * INTO v_roll
    FROM public.mm_mill_rolls
    WHERE id = v_id AND factory_id = v_factory AND mill_batch_id = v_batch.id;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'A roll on this batch was not found');
    END IF;
    IF v_roll.in_challan_id IS NOT NULL OR v_roll.status IS DISTINCT FROM 'draft' THEN
      CONTINUE;
    END IF;

    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;

    IF v_test THEN
      UPDATE public.mm_mill_rolls SET
        attributes = v_attrs,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_roll.id;
      v_n := v_n + 1;
      CONTINUE;
    END IF;

    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN
      RETURN public._mm_err('INVALID', 'Each roll needs quantity greater than 0');
    END IF;
    v_code := NULLIF(trim(COALESCE(v_row->>'unit_code', '')), '');
    IF v_code IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each roll needs a roll number');
    END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_color := NULLIF(trim(COALESCE(v_row->>'color_ref', '')), '');

    BEGIN
      UPDATE public.mm_mill_rolls SET
        unit_code = v_code,
        length_m = v_len,
        weight_kg = v_wt,
        shade = v_shade,
        lot_no = v_lot,
        color_ref = v_color,
        attributes = v_attrs,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_roll.id;
    EXCEPTION WHEN unique_violation THEN
      RETURN public._mm_err('DUPLICATE', 'Roll ' || v_code || ' already exists in this batch');
    END;
    v_n := v_n + 1;
  END LOOP;

  IF jsonb_array_length(v_new) > 0 THEN
    BEGIN
      v_n := v_n + public._mm_insert_mill_batch_rolls(v_factory, v_batch.style_material_id, v_batch.id, v_mill, v_new);
    EXCEPTION WHEN OTHERS THEN
      RETURN public._mm_err('INVALID', SQLERRM);
    END;
  END IF;

  RETURN public._mm_ok(jsonb_build_object(
    'id', v_batch.id,
    'batch_no', v_no,
    'roll_count', v_n,
    'row_version', (SELECT b.row_version FROM public.mm_mill_batches b WHERE b.id = v_batch.id)
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb, integer, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb, integer, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mm_get_mill_line(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_type_id uuid;
  v_type_name text;
  v_fabric_name text;
  v_fabric_category text;
  v_required numeric;
  v_uom text;
  v_sm uuid;
  v_mill uuid;
  v_short_closed boolean := false;
  v_short_reason text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric are required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders o WHERE o.id = p_order_id AND o.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Order not found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.colorways c
    WHERE c.id = p_colorway_id AND c.order_id = p_order_id AND c.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Colorway not found');
  END IF;

  v_fabric_name := NULL;
  v_required := NULL;
  v_uom := NULL;
  v_fabric_category := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT COALESCE(NULLIF(trim(cm.name), ''''), NULLIF(trim(cm.type), ''''), ''Fabric''),
                cm.total_cons, NULLIF(trim(cm.type), ''''), NULLIF(trim(cm.unit), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_fabric_name, v_required, v_type_name, v_uom
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_fabric_name := NULL;
    END;

    BEGIN
      SELECT CASE
        WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
          THEN NULLIF(trim(cm.extras->>$$fabricCategory$$), '')
        ELSE COALESCE(
          NULLIF(trim(cm.category), ''),
          NULLIF(trim(cm.extras->>$$fabricCategory$$), '')
        )
      END
      INTO v_fabric_category
      FROM public.colorway_materials cm
      WHERE cm.id = p_colorway_material_id
        AND cm.factory_id = v_factory
        AND cm.order_id = p_order_id
        AND cm.colorway_id = p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_fabric_category := NULL;
    END;

    BEGIN
      EXECUTE
        'SELECT COALESCE(cm.mill_short_closed, false), NULLIF(btrim(cm.mill_short_closed_reason), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_short_closed, v_short_reason
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_short_closed := false;
      v_short_reason := NULL;
    END;
  END IF;

  IF v_fabric_name IS NULL THEN
    SELECT name INTO v_type_name FROM public.mm_fabric_types
    WHERE id = p_colorway_material_id AND factory_id = v_factory AND is_active;
    IF v_type_name IS NULL THEN RETURN public._mm_err('NOT_FOUND', 'Fabric line not found'); END IF;
    v_fabric_name := v_type_name;
    v_type_id := p_colorway_material_id;
  ELSE
    SELECT id INTO v_type_id
    FROM public.mm_fabric_types
    WHERE factory_id = v_factory AND is_active AND lower(name) = lower(v_type_name)
    LIMIT 1;
  END IF;

  v_sm := public._mm_lookup_style_material_id(
    v_factory, p_order_id, p_colorway_id, p_colorway_material_id, v_type_id
  );

  IF NULLIF(trim(COALESCE(v_uom, '')), '') IS NULL AND v_sm IS NOT NULL THEN
    SELECT NULLIF(trim(u.uom), '') INTO v_uom
    FROM public.mm_stock_units u
    WHERE u.style_material_id = v_sm
    ORDER BY u.created_at
    LIMIT 1;
  END IF;

  v_mill := public._mm_loc(v_factory, 'MILL');

  RETURN public._mm_ok(jsonb_build_object(
    'order_id', p_order_id,
    'colorway_id', p_colorway_id,
    'fabric_line_id', p_colorway_material_id,
    'fabric_type_id', v_type_id,
    'style_material_id', v_sm,
    'required_m', v_required,
    'mill_short_closed', COALESCE(v_short_closed, false),
    'mill_short_closed_reason', v_short_reason,
    'uom', v_uom,
    'style_name', (SELECT style_name FROM public.style_orders WHERE id = p_order_id),
    'style_ref', (SELECT style_ref FROM public.style_orders WHERE id = p_order_id),
    'po_number', (SELECT po_number FROM public.style_orders WHERE id = p_order_id),
    'buyer_name', (SELECT buyer_name FROM public.style_orders WHERE id = p_order_id),
    'image_url', (SELECT image_url FROM public.style_orders WHERE id = p_order_id),
    'color_name', (SELECT name FROM public.colorways WHERE id = p_colorway_id),
    'fabric_name', v_fabric_name,
    'fabric_type', COALESCE((SELECT name FROM public.mm_fabric_types WHERE id = v_type_id), v_type_name, v_fabric_name),
    'fabric_category', v_fabric_category,
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options,
        'capture_site', f.capture_site
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type_id AND f.is_active
    ), '[]'::jsonb),
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'batch_no', b.batch_no,
        'mill_ref', b.mill_ref,
        'fabric_ref_name', b.fabric_ref_name,
        'color_ref', b.color_ref,
        'production_date', b.production_date,
        'remarks', b.remarks, 'row_version', b.row_version,
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
            AND NOT public._mm_mill_at_process(r.id)
        ),
        'dispatched_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'dispatched'
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      WHERE b.factory_id = v_factory AND b.style_material_id = v_sm
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'unit_code', r.unit_code,
        'mill_batch_id', r.mill_batch_id,
        'batch_no', b.batch_no,
        'length_m', r.length_m,
        'weight_kg', r.weight_kg,
        'shade', r.shade,
        'lot_no', r.lot_no,
        'color_ref', r.color_ref,
        'fabric_ref_name', b.fabric_ref_name,
        'attributes', r.attributes,
        'status', r.status,
        'in_challan_id', r.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'challan_reference_no', c.reference_no,
        'challan_sent_at', c.sent_at,
        'challan_received_at', c.received_at,
        'challan_to_location', c.to_location,
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id))
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      LEFT JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
      WHERE r.factory_id = v_factory AND r.style_material_id = v_sm
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_unallocated_mill()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object(
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'batch_no', b.batch_no,
        'mill_ref', b.mill_ref,
        'fabric_ref_name', b.fabric_ref_name,
        'color_ref', b.color_ref,
        'production_date', b.production_date,
        'remarks', b.remarks, 'row_version', b.row_version,
        'fabric_type_id', b.fabric_type_id,
        'fabric_type', ft.name,
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
            AND NOT public._mm_mill_at_process(r.id)
        ),
        'dispatched_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'dispatched'
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      JOIN public.mm_fabric_types ft ON ft.id = b.fabric_type_id
      WHERE b.factory_id = v_factory AND b.style_material_id IS NULL
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'unit_code', r.unit_code,
        'mill_batch_id', r.mill_batch_id,
        'batch_no', b.batch_no,
        'length_m', r.length_m,
        'weight_kg', r.weight_kg,
        'shade', r.shade,
        'lot_no', r.lot_no,
        'color_ref', r.color_ref,
        'attributes', r.attributes,
        'status', r.status,
        'fabric_type_id', r.fabric_type_id,
        'fabric_type', ft.name,
        'in_challan_id', r.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'challan_reference_no', c.reference_no,
        'challan_sent_at', c.sent_at,
        'challan_received_at', c.received_at,
        'challan_to_location', c.to_location,
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id))
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
      LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
      WHERE r.factory_id = v_factory AND r.style_material_id IS NULL
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_mill_stock(
  p_search text DEFAULT NULL::text,
  p_alloc text DEFAULT NULL::text,
  p_place text DEFAULT NULL::text,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_search text;
  v_alloc text;
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
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);

  SELECT count(*) INTO v_total
  FROM public.mm_mill_rolls r
  JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
  JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
  WHERE r.factory_id = v_factory
    AND r.status = 'draft'
    AND r.in_challan_id IS NULL
    AND NOT public._mm_mill_at_process(r.id)
    AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
    AND (
      v_search IS NULL
      OR lower(concat_ws(' ', r.unit_code, b.batch_no, b.fabric_ref_name, b.color_ref, ft.name, o.style_name, cm.name, r.color_ref, r.lot_no, r.shade)) LIKE '%' || v_search || '%'
    );

  RETURN public._mm_ok(jsonb_build_object(
    'total', v_total,
    'rows', COALESCE((
      SELECT jsonb_agg(x.obj)
      FROM (
        SELECT jsonb_build_object(
          'id', r.id,
          'unit_code', r.unit_code,
          'mill_batch_id', r.mill_batch_id,
          'batch_no', b.batch_no,
          'fabric_type', ft.name,
          'fabric_ref_name', b.fabric_ref_name,
          'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), b.fabric_ref_name, ft.name),
          'color_ref', COALESCE(r.color_ref, b.color_ref),
          'color_name', cw.name,
          'shade', r.shade,
          'lot_no', r.lot_no,
          'length_m', r.length_m,
          'style_material_id', r.style_material_id,
          'style_name', o.style_name,
          'order_id', sm.order_id,
          'colorway_id', sm.colorway_id,
          'fabric_line_id', sm.colorway_material_id,
          'place', 'at_mill'
        ) AS obj
        FROM public.mm_mill_rolls r
        JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
        JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
        LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
        LEFT JOIN public.style_orders o ON o.id = sm.order_id
        LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
        LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
        WHERE r.factory_id = v_factory
          AND r.status = 'draft'
          AND r.in_challan_id IS NULL
          AND NOT public._mm_mill_at_process(r.id)
          AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
          AND (
            v_search IS NULL
            OR lower(concat_ws(' ', r.unit_code, b.batch_no, b.fabric_ref_name, b.color_ref, ft.name, o.style_name, cm.name, r.color_ref, r.lot_no, r.shade)) LIKE '%' || v_search || '%'
          )
        ORDER BY COALESCE(NULLIF(trim(cm.name), ''), b.fabric_ref_name, ft.name), b.batch_no, r.unit_code
        OFFSET (v_page - 1) * v_size
        LIMIT v_size
      ) x
    ), '[]'::jsonb)
  ));
END;
$function$;
