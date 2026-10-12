-- Mill assign/update/dispatch and mill-facing reads target mm_mill_rolls.
-- Warehouse RPCs are unchanged.

CREATE OR REPLACE FUNCTION public._mm_insert_mill_batch_rolls(
  p_factory uuid, p_sm uuid, p_batch uuid, p_loc uuid, p_rolls jsonb
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
  v_n integer := 0;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_code := NULLIF(trim(COALESCE(v_row->>'unit_code', '')), '');
    IF v_code IS NULL THEN RAISE EXCEPTION 'Each roll needs a roll number'; END IF;
    v_key := lower(v_code);
    IF v_key = ANY (v_seen) THEN RAISE EXCEPTION 'Roll % already exists in this batch', v_code; END IF;
    v_seen := array_append(v_seen, v_key);
    IF EXISTS (
      SELECT 1 FROM public.mm_mill_rolls r
      WHERE r.factory_id = p_factory AND r.mill_batch_id = p_batch AND lower(r.unit_code) = v_key
    ) THEN
      RAISE EXCEPTION 'Roll % already exists in this batch', v_code;
    END IF;
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN RAISE EXCEPTION 'Each roll needs length'; END IF;
    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;
    INSERT INTO public.mm_mill_rolls (
      factory_id, mill_batch_id, style_material_id, unit_code,
      length_m, weight_kg, shade, lot_no, attributes, status,
      created_by, updated_by
    ) VALUES (
      p_factory, p_batch, p_sm, v_code,
      v_len, v_wt, v_shade, v_lot, v_attrs, 'draft',
      auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_update_mill_batch(
  p_batch_id uuid,
  p_batch_no text,
  p_mill_ref text,
  p_production_date date,
  p_remarks text,
  p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
  v_attrs jsonb;
  v_new jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_roll public.mm_mill_rolls%ROWTYPE;
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

  v_no := NULLIF(trim(COALESCE(p_batch_no, '')), '');
  IF v_no IS NULL THEN RETURN public._mm_err('REQUIRED', 'Mill batch number is required'); END IF;
  v_date := COALESCE(p_production_date, v_batch.production_date, CURRENT_DATE);

  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Add at least one roll');
  END IF;

  BEGIN
    UPDATE public.mm_mill_batches SET
      batch_no = v_no,
      mill_ref = NULLIF(trim(COALESCE(p_mill_ref, '')), ''),
      production_date = v_date,
      remarks = NULLIF(trim(COALESCE(p_remarks, '')), ''),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_batch.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists for this fabric');
  END;

  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls)
  LOOP
    v_len := NULLIF(v_row->>'length_m', '')::numeric;
    IF v_len IS NULL OR v_len <= 0 THEN
      RETURN public._mm_err('INVALID', 'Each roll needs quantity greater than 0');
    END IF;
    v_code := NULLIF(trim(COALESCE(v_row->>'unit_code', '')), '');
    IF v_code IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'Each roll needs a roll number');
    END IF;
    v_id := NULL;
    BEGIN
      v_id := NULLIF(trim(COALESCE(v_row->>'id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF v_id IS NULL THEN
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

    v_wt := NULLIF(v_row->>'weight_kg', '')::numeric;
    v_shade := NULLIF(trim(COALESCE(v_row->>'shade', '')), '');
    v_lot := NULLIF(trim(COALESCE(v_row->>'lot_no', '')), '');
    v_attrs := COALESCE(v_row->'attributes', '{}'::jsonb);
    IF jsonb_typeof(v_attrs) <> 'object' THEN v_attrs := '{}'::jsonb; END IF;

    BEGIN
      UPDATE public.mm_mill_rolls SET
        unit_code = v_code,
        length_m = v_len,
        weight_kg = v_wt,
        shade = v_shade,
        lot_no = v_lot,
        attributes = v_attrs,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
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

  RETURN public._mm_ok(jsonb_build_object('id', v_batch.id, 'batch_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_dispatch_mill_rolls(
  p_unit_ids uuid[],
  p_challan_no text,
  p_reference_no text DEFAULT NULL,
  p_to_location text DEFAULT 'Warehouse',
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
  v_sm uuid;
  v_ch uuid;
  v_no text;
  v_ref text;
  v_to text;
  v_uid uuid;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_n integer := 0;
  v_batch public.mm_mill_batches%ROWTYPE;
  v_mill uuid;
  v_uom text;
  v_stock uuid;
  v_snap jsonb;
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
  v_no := NULLIF(trim(COALESCE(p_challan_no, '')), '');
  IF v_no IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Enter a challan number');
  END IF;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to dispatch');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_mill := public._mm_loc(v_factory, 'MILL');
  v_ref := NULLIF(trim(COALESCE(p_reference_no, '')), '');
  v_to := COALESCE(NULLIF(trim(COALESCE(p_to_location, '')), ''), 'Warehouse');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_roll.status <> 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting at the mill');
    END IF;
    IF v_sm IS NULL THEN v_sm := v_roll.style_material_id; END IF;
    IF v_roll.style_material_id IS DISTINCT FROM v_sm THEN
      RETURN public._mm_err('INVALID', 'Select rolls from the same style, color, and fabric');
    END IF;
  END LOOP;

  IF public._mm_mill_short_closed(v_sm) THEN
    RETURN public._mm_err('CLOSED', 'This fabric is short closed. Cancel short close to dispatch.');
  END IF;

  SELECT COALESCE(
    (
      SELECT NULLIF(trim(u.uom), '')
      FROM public.mm_stock_units u
      WHERE u.style_material_id = v_sm
      ORDER BY u.created_at
      LIMIT 1
    ),
    (
      SELECT NULLIF(trim(cm.unit), '')
      FROM public.mm_style_materials sm
      JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sm.id = v_sm
      LIMIT 1
    ),
    'm'
  ) INTO v_uom;

  BEGIN
    INSERT INTO public.mm_in_challans (
      factory_id, challan_no, source, style_material_id, status, sent_at, sent_by,
      remarks, reference_no, to_location, created_by, updated_by
    ) VALUES (
      v_factory, v_no, 'mill', v_sm, 'pending',
      COALESCE(p_sent_at, CURRENT_DATE)::timestamptz,
      auth.uid(),
      NULLIF(btrim(COALESCE(p_remarks, '')), ''),
      v_ref,
      v_to,
      auth.uid(), auth.uid()
    ) RETURNING id INTO v_ch;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That challan number already exists');
  END;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_uid;
    SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = v_roll.mill_batch_id;
    v_snap := jsonb_build_object(
      'length_m', v_roll.length_m,
      'weight_kg', v_roll.weight_kg,
      'shade', v_roll.shade,
      'lot_no', v_roll.lot_no,
      'attributes', v_roll.attributes,
      'mill_batch_id', v_roll.mill_batch_id,
      'batch_no', v_batch.batch_no,
      'mill_ref', v_batch.mill_ref,
      'production_date', v_batch.production_date
    );
    BEGIN
      INSERT INTO public.mm_stock_units (
        factory_id, unit_code, unit_kind, style_material_id, mill_batch_id, mill_roll_id,
        in_challan_id, source, uom, length_m, weight_kg, shade, lot_no, attributes,
        mill_snapshot, status, current_location_id, created_by, updated_by
      ) VALUES (
        v_factory, v_roll.unit_code, 'roll', v_roll.style_material_id, v_roll.mill_batch_id, v_roll.id,
        v_ch, 'mill', v_uom, v_roll.length_m, v_roll.weight_kg, v_roll.shade, v_roll.lot_no, v_roll.attributes,
        v_snap, 'in_transit', v_mill, auth.uid(), auth.uid()
      ) RETURNING id INTO v_stock;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Roll % already exists in warehouse stock for this mill batch', v_roll.unit_code;
    END;
    INSERT INTO public.mm_in_challan_lines (factory_id, challan_id, stock_unit_id, created_by)
    VALUES (v_factory, v_ch, v_stock, auth.uid());
    UPDATE public.mm_mill_rolls SET
      status = 'dispatched',
      in_challan_id = v_ch,
      dispatched_at = now(),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_roll.id AND status = 'draft' AND in_challan_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected roll is not waiting at the mill';
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_stock, 'TRANSFER', v_roll.length_m, 'draft', 'in_transit',
      v_mill, v_mill, 'mm_in_challans', v_ch, 'Mill dispatch'
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_mill_line(
  p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
        'SELECT COALESCE(cm.mill_short_closed, false)
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_short_closed
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_short_closed := false;
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

  SELECT sm.id INTO v_sm
  FROM public.mm_style_materials sm
  WHERE sm.factory_id = v_factory AND sm.order_id = p_order_id AND sm.colorway_id = p_colorway_id
    AND (
      sm.colorway_material_id = p_colorway_material_id
      OR (v_type_id IS NOT NULL AND sm.fabric_type_id = v_type_id)
    )
  LIMIT 1;

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
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type_id AND f.is_active
    ), '[]'::jsonb),
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'batch_no', b.batch_no,
        'mill_ref', b.mill_ref,
        'production_date', b.production_date,
        'remarks', b.remarks,
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
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
        'attributes', r.attributes,
        'status', r.status,
        'in_challan_id', r.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'challan_reference_no', c.reference_no,
        'challan_sent_at', c.sent_at,
        'challan_received_at', c.received_at,
        'challan_to_location', c.to_location,
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL)
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      LEFT JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
      WHERE r.factory_id = v_factory AND r.style_material_id = v_sm
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_mill_board(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_orders jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_order_ids IS NULL OR COALESCE(array_length(p_order_ids, 1), 0) = 0 THEN
    RETURN public._mm_ok(jsonb_build_object('orders', '[]'::jsonb));
  END IF;

  v_orders := NULL;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(ord.obj ORDER BY ord.style_name), '[]'::jsonb) INTO v_orders
      FROM (
        SELECT
          cells.order_id,
          max(o.style_name) AS style_name,
          jsonb_build_object(
            'order_id', cells.order_id,
            'fabrics', COALESCE(jsonb_agg(jsonb_build_object(
              'colorway_id', cells.colorway_id,
              'color_name', cells.color_name,
              'fabric_line_id', cells.fabric_line_id,
              'fabric_type_id', cells.fabric_type_id,
              'fabric_name', cells.fabric_name,
              'fabric_type', cells.fabric_type,
              'fabric_category', cells.fabric_category,
              'required_m', cells.required_m,
              'uom', cells.uom,
              'style_material_id', cells.style_material_id,
              'rolls_at_mill', cells.rolls_at_mill,
              'qty_at_mill_m', cells.qty_at_mill_m,
              'rolls_dispatched', cells.rolls_dispatched,
              'qty_dispatched_m', cells.qty_dispatched_m,
              'mill_short_closed', cells.mill_short_closed,
              'status', public._mm_mill_cell_status(cells.rolls_at_mill, cells.rolls_dispatched)
            ) ORDER BY cells.color_name, cells.fabric_name), '[]'::jsonb)
          ) AS obj
        FROM (
          SELECT
            o.id AS order_id,
            c.id AS colorway_id,
            c.name AS color_name,
            cm.id AS fabric_line_id,
            ft.id AS fabric_type_id,
            COALESCE(NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_name,
            COALESCE(ft.name, NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_type,
            CASE
              WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
                THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
              ELSE COALESCE(
                NULLIF(trim(cm.category), ''),
                NULLIF(trim(cm.extras->>'fabricCategory'), '')
              )
            END AS fabric_category,
            cm.total_cons AS required_m,
            COALESCE(
              NULLIF(trim(cm.unit), ''),
              (
                SELECT NULLIF(trim(u.uom), '')
                FROM public.mm_stock_units u
                WHERE u.style_material_id = sm.id
                ORDER BY u.created_at
                LIMIT 1
              )
            ) AS uom,
            sm.id AS style_material_id,
            COALESCE(cm.mill_short_closed, false) AS mill_short_closed,
            COALESCE((
              SELECT count(*)::int FROM public.mm_mill_rolls r
              WHERE r.style_material_id = sm.id AND r.status = 'draft' AND r.in_challan_id IS NULL
            ), 0) AS rolls_at_mill,
            COALESCE((
              SELECT sum(r.length_m) FROM public.mm_mill_rolls r
              WHERE r.style_material_id = sm.id AND r.status = 'draft' AND r.in_challan_id IS NULL
            ), 0) AS qty_at_mill_m,
            COALESCE((
              SELECT count(*)::int FROM public.mm_mill_rolls r
              WHERE r.style_material_id = sm.id AND r.status = 'dispatched'
            ), 0) AS rolls_dispatched,
            COALESCE((
              SELECT sum(r.length_m) FROM public.mm_mill_rolls r
              WHERE r.style_material_id = sm.id AND r.status = 'dispatched'
            ), 0) AS qty_dispatched_m
          FROM public.style_orders o
          JOIN public.colorways c
            ON c.order_id = o.id AND c.factory_id = v_factory
          JOIN public.colorway_materials cm
            ON cm.colorway_id = c.id AND cm.factory_id = v_factory AND cm.kind = 'Fabric'
          LEFT JOIN public.mm_fabric_types ft
            ON ft.factory_id = v_factory AND ft.is_active
           AND lower(ft.name) = lower(NULLIF(trim(cm.type), ''))
          LEFT JOIN public.mm_style_materials sm
            ON sm.factory_id = v_factory
           AND sm.order_id = o.id
           AND sm.colorway_id = c.id
           AND (
             sm.colorway_material_id = cm.id
             OR (sm.colorway_material_id IS NULL AND sm.fabric_type_id IS NOT DISTINCT FROM ft.id)
           )
          WHERE o.factory_id = v_factory AND o.id = ANY (p_order_ids)
        ) cells
        JOIN public.style_orders o ON o.id = cells.order_id
        GROUP BY cells.order_id
      ) ord;
    EXCEPTION WHEN OTHERS THEN
      v_orders := NULL;
    END;
  END IF;

  IF v_orders IS NULL THEN
    SELECT COALESCE(jsonb_agg(ord.obj ORDER BY ord.style_name), '[]'::jsonb) INTO v_orders
    FROM (
      SELECT
        cells.order_id,
        max(o.style_name) AS style_name,
        jsonb_build_object(
          'order_id', cells.order_id,
          'fabrics', COALESCE(jsonb_agg(jsonb_build_object(
            'colorway_id', cells.colorway_id,
            'color_name', cells.color_name,
            'fabric_line_id', cells.fabric_line_id,
            'fabric_type_id', cells.fabric_type_id,
            'fabric_name', cells.fabric_name,
            'fabric_type', cells.fabric_type,
            'fabric_category', cells.fabric_category,
            'required_m', cells.required_m,
            'uom', cells.uom,
            'style_material_id', cells.style_material_id,
            'rolls_at_mill', cells.rolls_at_mill,
            'qty_at_mill_m', cells.qty_at_mill_m,
            'rolls_dispatched', cells.rolls_dispatched,
            'qty_dispatched_m', cells.qty_dispatched_m,
            'mill_short_closed', cells.mill_short_closed,
            'status', public._mm_mill_cell_status(cells.rolls_at_mill, cells.rolls_dispatched)
          ) ORDER BY cells.color_name, cells.fabric_name), '[]'::jsonb)
        ) AS obj
      FROM (
        SELECT
          o.id AS order_id,
          c.id AS colorway_id,
          c.name AS color_name,
          t.id AS fabric_line_id,
          t.id AS fabric_type_id,
          t.name AS fabric_name,
          t.name AS fabric_type,
          NULL::text AS fabric_category,
          NULL::numeric AS required_m,
          NULL::text AS uom,
          sm.id AS style_material_id,
          false AS mill_short_closed,
          COALESCE((
            SELECT count(*)::int FROM public.mm_mill_rolls r
            WHERE r.style_material_id = sm.id AND r.status = 'draft' AND r.in_challan_id IS NULL
          ), 0) AS rolls_at_mill,
          COALESCE((
            SELECT sum(r.length_m) FROM public.mm_mill_rolls r
            WHERE r.style_material_id = sm.id AND r.status = 'draft' AND r.in_challan_id IS NULL
          ), 0) AS qty_at_mill_m,
          COALESCE((
            SELECT count(*)::int FROM public.mm_mill_rolls r
            WHERE r.style_material_id = sm.id AND r.status = 'dispatched'
          ), 0) AS rolls_dispatched,
          COALESCE((
            SELECT sum(r.length_m) FROM public.mm_mill_rolls r
            WHERE r.style_material_id = sm.id AND r.status = 'dispatched'
          ), 0) AS qty_dispatched_m
        FROM public.style_orders o
        JOIN public.colorways c ON c.order_id = o.id AND c.factory_id = v_factory
        JOIN public.mm_fabric_types t ON t.factory_id = v_factory AND t.is_active
        LEFT JOIN public.mm_style_materials sm
          ON sm.factory_id = v_factory AND sm.order_id = o.id
         AND sm.colorway_id = c.id AND sm.fabric_type_id = t.id
        WHERE o.factory_id = v_factory AND o.id = ANY (p_order_ids)
      ) cells
      JOIN public.style_orders o ON o.id = cells.order_id
      GROUP BY cells.order_id
    ) ord;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('orders', COALESCE(v_orders, '[]'::jsonb)));
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_insert_mill_batch_rolls(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_dispatch_mill_rolls(uuid[], text, text, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_mill_board(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_insert_mill_batch_rolls(uuid, uuid, uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_dispatch_mill_rolls(uuid[], text, text, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_board(uuid[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
