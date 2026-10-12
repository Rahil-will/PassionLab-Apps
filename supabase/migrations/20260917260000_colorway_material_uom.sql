-- Fixed colorway UOM (Fabric UOM / Trim UOM). Used on mill board, mill stock, and qty labels.

ALTER TABLE public.colorway_materials
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT '';

UPDATE public.colorway_materials
SET
  unit = COALESCE(NULLIF(unit, ''), NULLIF(extras->>'unit', ''), ''),
  extras = COALESCE(extras, '{}'::jsonb) - 'unit';

CREATE OR REPLACE FUNCTION public._upsert_colorway_material(
  p_factory_id uuid,
  p_order_id uuid,
  p_colorway_id uuid,
  p_mat jsonb,
  p_seq integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_kind text;
  v_category text;
  v_type text;
  v_placement text;
  v_unit text;
  v_cons numeric;
  v_total numeric;
  v_extras jsonb;
  v_src jsonb;
  v_factory_id uuid;
  v_order_id uuid;
BEGIN
  SELECT cw.factory_id, cw.order_id
    INTO v_factory_id, v_order_id
    FROM public.colorways cw
    WHERE cw.id = p_colorway_id;

  IF v_factory_id IS NULL THEN
    RAISE EXCEPTION 'colorway % not found', p_colorway_id;
  END IF;
  IF v_factory_id IS DISTINCT FROM p_factory_id THEN
    RAISE EXCEPTION 'colorway factory mismatch';
  END IF;
  IF p_order_id IS NOT NULL AND v_order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'colorway order mismatch';
  END IF;

  BEGIN
    v_id := NULLIF(trim(p_mat->>'id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_id := NULL;
  END;
  IF v_id IS NULL THEN v_id := gen_random_uuid(); END IF;

  IF EXISTS (
    SELECT 1 FROM public.colorway_materials
    WHERE id = v_id
      AND (factory_id IS DISTINCT FROM v_factory_id OR colorway_id IS DISTINCT FROM p_colorway_id)
  ) THEN
    v_id := gen_random_uuid();
  END IF;

  v_src := CASE WHEN jsonb_typeof(p_mat->'extras') = 'object' THEN p_mat->'extras' ELSE '{}'::jsonb END;

  v_kind := CASE
    WHEN trim(COALESCE(p_mat->>'kind', '')) IN ('Fabric', 'Trim') THEN trim(p_mat->>'kind')
    WHEN trim(COALESCE(p_mat->>'category', '')) IN ('Fabric', 'Trim') THEN trim(p_mat->>'category')
    ELSE 'Fabric'
  END;

  v_category := CASE
    WHEN trim(COALESCE(p_mat->>'kind', '')) IN ('Fabric', 'Trim')
      THEN COALESCE(p_mat->>'category', '')
    WHEN v_kind = 'Trim' THEN COALESCE(
      NULLIF(p_mat->>'trimCategory', ''),
      NULLIF(v_src->>'trimCategory', ''),
      ''
    )
    ELSE COALESCE(
      NULLIF(p_mat->>'fabricCategory', ''),
      NULLIF(v_src->>'fabricCategory', ''),
      ''
    )
  END;

  v_type := COALESCE(
    NULLIF(trim(p_mat->>'type'), ''),
    CASE WHEN v_kind = 'Trim' THEN NULLIF(trim(COALESCE(p_mat->>'trimType', v_src->>'trimType')), '') ELSE NULL END,
    ''
  );

  v_placement := CASE
    WHEN v_kind = 'Trim' THEN COALESCE(
      NULLIF(trim(p_mat->>'placement'), ''),
      NULLIF(trim(v_src->>'placement'), ''),
      ''
    )
    ELSE ''
  END;

  v_unit := COALESCE(
    NULLIF(trim(p_mat->>'unit'), ''),
    NULLIF(trim(v_src->>'unit'), ''),
    ''
  );

  v_cons := CASE
    WHEN (COALESCE(p_mat->>'consPerPc', p_mat->>'cons_per_pc')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (COALESCE(p_mat->>'consPerPc', p_mat->>'cons_per_pc'))::numeric
    WHEN v_kind = 'Trim' AND (p_mat->>'perPc') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_mat->>'perPc')::numeric
    WHEN v_kind = 'Fabric' AND (p_mat->>'avgCons') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (p_mat->>'avgCons')::numeric
    ELSE NULL
  END;

  v_total := CASE
    WHEN (COALESCE(p_mat->>'totalCons', p_mat->>'total_cons', p_mat->>'reqQty')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (COALESCE(p_mat->>'totalCons', p_mat->>'total_cons', p_mat->>'reqQty'))::numeric
    ELSE NULL
  END;

  v_extras := jsonb_strip_nulls(jsonb_build_object(
    'paramValues', CASE
      WHEN jsonb_typeof(v_src->'paramValues') = 'object' AND v_src->'paramValues' <> '{}'::jsonb
        THEN v_src->'paramValues'
      WHEN jsonb_typeof(p_mat->'paramValues') = 'object' AND p_mat->'paramValues' <> '{}'::jsonb
        THEN p_mat->'paramValues'
      ELSE NULL
    END
  ));

  INSERT INTO public.colorway_materials (
    id, factory_id, order_id, colorway_id, seq,
    kind, category, name, type, placement, unit, cons_per_pc, total_cons, extras, updated_at
  ) VALUES (
    v_id, v_factory_id, v_order_id, p_colorway_id, COALESCE(p_seq, 0),
    v_kind,
    COALESCE(v_category, ''),
    COALESCE(p_mat->>'name', ''),
    v_type,
    v_placement,
    v_unit,
    v_cons,
    v_total,
    COALESCE(v_extras, '{}'::jsonb),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    factory_id = EXCLUDED.factory_id,
    order_id = EXCLUDED.order_id,
    colorway_id = EXCLUDED.colorway_id,
    seq = EXCLUDED.seq,
    kind = EXCLUDED.kind,
    category = EXCLUDED.category,
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    placement = EXCLUDED.placement,
    unit = EXCLUDED.unit,
    cons_per_pc = EXCLUDED.cons_per_pc,
    total_cons = EXCLUDED.total_cons,
    extras = EXCLUDED.extras,
    updated_at = now();

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public._upsert_colorway_material(uuid, uuid, uuid, jsonb, integer) FROM PUBLIC;

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
              'required_m', cells.required_m,
              'uom', cells.uom,
              'style_material_id', cells.style_material_id,
              'rolls_at_mill', cells.rolls_at_mill,
              'qty_at_mill_m', cells.qty_at_mill_m,
              'rolls_dispatched', cells.rolls_dispatched,
              'qty_dispatched_m', cells.qty_dispatched_m,
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
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.status = 'draft' AND u.in_challan_id IS NULL
            ), 0) AS rolls_at_mill,
            COALESCE((
              SELECT sum(u.length_m) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.status = 'draft' AND u.in_challan_id IS NULL
            ), 0) AS qty_at_mill_m,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.in_challan_id IS NOT NULL
            ), 0) AS rolls_dispatched,
            COALESCE((
              SELECT sum(u.length_m) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.in_challan_id IS NOT NULL
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
            'required_m', cells.required_m,
            'uom', cells.uom,
            'style_material_id', cells.style_material_id,
            'rolls_at_mill', cells.rolls_at_mill,
            'qty_at_mill_m', cells.qty_at_mill_m,
            'rolls_dispatched', cells.rolls_dispatched,
            'qty_dispatched_m', cells.qty_dispatched_m,
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
          NULL::numeric AS required_m,
          NULL::text AS uom,
          sm.id AS style_material_id,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.status = 'draft' AND u.in_challan_id IS NULL
          ), 0) AS rolls_at_mill,
          COALESCE((
            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.status = 'draft' AND u.in_challan_id IS NULL
          ), 0) AS qty_at_mill_m,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.in_challan_id IS NOT NULL
          ), 0) AS rolls_dispatched,
          COALESCE((
            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.in_challan_id IS NOT NULL
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
  v_required numeric;
  v_uom text;
  v_sm uuid;
  v_mill uuid;
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
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    BEGIN
      EXECUTE
        'SELECT COALESCE(NULLIF(trim(cm.name), ''''), NULLIF(trim(cm.type), ''''), ''Fabric''),
                cm.total_cons, NULLIF(trim(cm.type), ''''), NULLIF(trim(cm.unit), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4
           AND cm.kind = ''Fabric'''
      INTO v_fabric_name, v_required, v_type_name, v_uom
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_fabric_name := NULL;
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
    'uom', v_uom,
    'style_name', (SELECT style_name FROM public.style_orders WHERE id = p_order_id),
    'po_number', (SELECT po_number FROM public.style_orders WHERE id = p_order_id),
    'buyer_name', (SELECT buyer_name FROM public.style_orders WHERE id = p_order_id),
    'image_url', (SELECT image_url FROM public.style_orders WHERE id = p_order_id),
    'color_name', (SELECT name FROM public.colorways WHERE id = p_colorway_id),
    'fabric_name', v_fabric_name,
    'fabric_type', COALESCE((SELECT name FROM public.mm_fabric_types WHERE id = v_type_id), v_type_name, v_fabric_name),
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
        'roll_count', (SELECT count(*) FROM public.mm_stock_units u WHERE u.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.mill_batch_id = b.id AND u.status = 'draft' AND u.in_challan_id IS NULL
        ),
        'dispatched_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.mill_batch_id = b.id AND u.in_challan_id IS NOT NULL
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      WHERE b.factory_id = v_factory AND b.style_material_id = v_sm
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'unit_code', u.unit_code,
        'mill_batch_id', u.mill_batch_id,
        'batch_no', b.batch_no,
        'length_m', u.length_m,
        'weight_kg', u.weight_kg,
        'shade', u.shade,
        'lot_no', u.lot_no,
        'attributes', u.attributes,
        'status', u.status,
        'in_challan_id', u.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'at_mill', (u.status = 'draft' AND u.in_challan_id IS NULL)
      ) ORDER BY b.production_date DESC NULLS LAST, u.unit_code)
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.style_material_id = v_sm AND u.source = 'mill'
    ), '[]'::jsonb)
  ));
END;
$fn$;

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
  v_uom text;
  v_n integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RAISE EXCEPTION 'Add at least one roll';
  END IF;

  SELECT COALESCE(
    (
      SELECT NULLIF(trim(u.uom), '')
      FROM public.mm_stock_units u
      WHERE u.style_material_id = p_sm
      ORDER BY u.created_at
      LIMIT 1
    ),
    (
      SELECT NULLIF(trim(cm.unit), '')
      FROM public.mm_style_materials sm
      JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sm.id = p_sm
      LIMIT 1
    ),
    'm'
  ) INTO v_uom;

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
    INSERT INTO public.mm_stock_units (
      factory_id, unit_code, unit_kind, style_material_id, mill_batch_id, source,
      uom, length_m, weight_kg, shade, lot_no, attributes, mill_snapshot, status,
      current_location_id, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, p_batch, 'mill', v_uom,
      v_len, v_wt, v_shade, v_lot, v_attrs, NULL, 'draft', p_loc, auth.uid(), auth.uid()
    ) RETURNING id INTO v_id;
    PERFORM public._mm_ledger(
      p_factory, v_id, 'INHOUSE_IN', v_len, NULL, 'draft', NULL, p_loc,
      'mm_mill_batches', p_batch, NULL
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;

COMMENT ON COLUMN public.colorway_materials.unit IS
  'Stock UOM for this fabric or trim line. From Fabric UOM / Trim UOM support dropdowns.';
COMMENT ON COLUMN public.colorway_materials.extras IS
  'Variable fabric type params only (paramValues).';

NOTIFY pgrst, 'reload schema';
