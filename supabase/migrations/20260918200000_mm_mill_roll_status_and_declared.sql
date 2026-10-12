-- Mill screens keep mill-declared roll values (mill_snapshot).
-- Warehouse receive no longer overwrites mill qty / test fields.

CREATE OR REPLACE FUNCTION public._mm_mill_length(p_unit public.mm_stock_units)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(p_unit.mill_snapshot->>'length_m', '')), '')::numeric,
    p_unit.length_m
  );
$fn$;

REVOKE ALL ON FUNCTION public._mm_mill_length(public.mm_stock_units) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_mill_length(public.mm_stock_units) TO authenticated, service_role;

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
        'roll_count', (SELECT count(*) FROM public.mm_stock_units u WHERE u.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(public._mm_mill_length(u)), 0) FROM public.mm_stock_units u WHERE u.mill_batch_id = b.id),
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
        'length_m', public._mm_mill_length(u),
        'weight_kg', COALESCE(NULLIF(btrim(COALESCE(u.mill_snapshot->>'weight_kg', '')), '')::numeric, u.weight_kg),
        'shade', COALESCE(NULLIF(btrim(COALESCE(u.mill_snapshot->>'shade', '')), ''), u.shade),
        'lot_no', COALESCE(NULLIF(btrim(COALESCE(u.mill_snapshot->>'lot_no', '')), ''), u.lot_no),
        'attributes', CASE
          WHEN jsonb_typeof(u.mill_snapshot->'attributes') = 'object' THEN u.mill_snapshot->'attributes'
          ELSE u.attributes
        END,
        'mill_snapshot', u.mill_snapshot,
        'status', u.status,
        'in_challan_id', u.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'challan_reference_no', c.reference_no,
        'challan_sent_at', c.sent_at,
        'challan_received_at', c.received_at,
        'challan_to_location', c.to_location,
        'at_mill', (u.status = 'draft' AND u.in_challan_id IS NULL)
      ) ORDER BY (u.status = 'draft' AND u.in_challan_id IS NULL) DESC, u.created_at, u.unit_code)
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      WHERE u.factory_id = v_factory AND u.style_material_id = v_sm AND u.source = 'mill'
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
  v_recv uuid;
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
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  FOR v_unit IN
    SELECT * FROM public.mm_stock_units
    WHERE in_challan_id = v_ch.id AND factory_id = v_factory AND status = 'in_transit'
  LOOP
    UPDATE public.mm_stock_units SET
      status = 'pending_qc', current_location_id = v_recv,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
    WHERE id = v_unit.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', public._mm_mill_length(v_unit), v_unit.status, 'pending_qc',
      v_unit.current_location_id, v_recv, 'mm_in_challans', v_ch.id, 'Warehouse receive'
    );
  END LOOP;
  UPDATE public.mm_in_challans SET
    status = 'received', received_at = now(), received_by = auth.uid(),
    row_version = row_version + 1, updated_at = now(), updated_by = auth.uid()
  WHERE id = v_ch.id;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'status', 'received'));
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
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.status = 'draft' AND u.in_challan_id IS NULL
            ), 0) AS rolls_at_mill,
            COALESCE((
              SELECT sum(public._mm_mill_length(u)) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.status = 'draft' AND u.in_challan_id IS NULL
            ), 0) AS qty_at_mill_m,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id AND u.source = 'mill'
                AND u.in_challan_id IS NOT NULL
            ), 0) AS rolls_dispatched,
            COALESCE((
              SELECT sum(public._mm_mill_length(u)) FROM public.mm_stock_units u
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
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.status = 'draft' AND u.in_challan_id IS NULL
          ), 0) AS rolls_at_mill,
          COALESCE((
            SELECT sum(public._mm_mill_length(u)) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.status = 'draft' AND u.in_challan_id IS NULL
          ), 0) AS qty_at_mill_m,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.source = 'mill'
              AND u.in_challan_id IS NOT NULL
          ), 0) AS rolls_dispatched,
          COALESCE((
            SELECT sum(public._mm_mill_length(u)) FROM public.mm_stock_units u
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

GRANT EXECUTE ON FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_board(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(uuid, jsonb, integer) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
