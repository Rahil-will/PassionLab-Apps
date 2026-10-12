-- Passed qty/rolls require qc_result = pass. Challan header exposes passed_count.

CREATE OR REPLACE FUNCTION public._mm_challan_header(p_ch public.mm_in_challans)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_ch.id,
    'challan_no', p_ch.challan_no,
    'reference_no', p_ch.reference_no,
    'source', p_ch.source,
    'status', p_ch.status,
    'supplier_name', p_ch.supplier_name,
    'sent_at', p_ch.sent_at,
    'received_at', p_ch.received_at,
    'row_version', p_ch.row_version,
    'style_material_id', p_ch.style_material_id,
    'order_id', sm.order_id,
    'colorway_id', sm.colorway_id,
    'fabric_line_id', COALESCE(sm.colorway_material_id, cm.id),
    'style_name', o.style_name,
    'style_ref', o.style_ref,
    'buyer_name', o.buyer_name,
    'po_number', o.po_number,
    'image_url', o.image_url,
    'color_name', cw.name,
    'fabric_type', ft.name,
    'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
    'fabric_category', CASE
      WHEN cm.id IS NULL THEN NULL
      WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
        THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
      ELSE COALESCE(
        NULLIF(trim(cm.category), ''),
        NULLIF(trim(cm.extras->>'fabricCategory'), '')
      )
    END,
    'required_m', cm.total_cons,
    'uom', NULLIF(trim(COALESCE(cm.extras->>'unit', '')), ''),
    'roll_count', (
      SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = p_ch.id
    ),
    'qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.in_challan_id = p_ch.id
    ),
    'passed_qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'pass'
    ),
    'passed_count', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'pass'
    ),
    'failed_qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.qc_result = 'fail'
    ),
    'pending_qty', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.in_challan_id = p_ch.id AND u.status = 'pending_qc'
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
  LEFT JOIN public.colorway_materials cm ON cm.id = COALESCE(
    sm.colorway_material_id,
    (
      SELECT c2.id
      FROM public.colorway_materials c2
      WHERE c2.colorway_id = sm.colorway_id
        AND c2.factory_id = sm.factory_id
        AND c2.kind = 'Fabric'
        AND lower(trim(c2.type)) = lower(trim(ft.name))
      ORDER BY c2.seq
      LIMIT 1
    )
  )
  WHERE sm.id = p_ch.style_material_id
$$;

-- Style-wise warehouse board: received (incl. pending_qc) vs 4-point passed.

CREATE OR REPLACE FUNCTION public.mm_get_warehouse_board(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_orders jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_order_ids IS NULL OR COALESCE(array_length(p_order_ids, 1), 0) = 0 THEN
    RETURN public._mm_ok(jsonb_build_object('orders', '[]'::jsonb));
  END IF;

  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

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
              'rolls_received', cells.rolls_received,
              'qty_received_m', cells.qty_received_m,
              'rolls_passed', cells.rolls_passed,
              'qty_passed_m', cells.qty_passed_m,
              'rolls_to_cutting', cells.rolls_to_cutting,
              'qty_to_cutting_m', cells.qty_to_cutting_m
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
            NULLIF(trim(cm.extras->>'fabricCategory'), '') AS fabric_category,
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
              WHERE u.style_material_id = sm.id
                AND (
                  u.status = 'pending_qc'
                  OR (
                    u.status = 'in_stock'
                    AND public._mm_loc_is_under(u.current_location_id, v_wh)
                  )
                  OR public._mm_loc_is_under(u.current_location_id, v_cut)
                )
            ), 0) AS rolls_received,
            COALESCE((
              SELECT sum(u.length_m) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND (
                  u.status = 'pending_qc'
                  OR (
                    u.status = 'in_stock'
                    AND public._mm_loc_is_under(u.current_location_id, v_wh)
                  )
                  OR public._mm_loc_is_under(u.current_location_id, v_cut)
                )
            ), 0) AS qty_received_m,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND u.qc_result = 'pass'
                AND (
                  (
                    u.status = 'in_stock'
                    AND public._mm_loc_is_under(u.current_location_id, v_wh)
                  )
                  OR public._mm_loc_is_under(u.current_location_id, v_cut)
                )
            ), 0) AS rolls_passed,
            COALESCE((
              SELECT sum(u.length_m) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND u.qc_result = 'pass'
                AND (
                  (
                    u.status = 'in_stock'
                    AND public._mm_loc_is_under(u.current_location_id, v_wh)
                  )
                  OR public._mm_loc_is_under(u.current_location_id, v_cut)
                )
            ), 0) AS qty_passed_m,
            COALESCE((
              SELECT count(*)::int FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND public._mm_loc_is_under(u.current_location_id, v_cut)
            ), 0) AS rolls_to_cutting,
            COALESCE((
              SELECT sum(u.length_m) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND public._mm_loc_is_under(u.current_location_id, v_cut)
            ), 0) AS qty_to_cutting_m
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
            'rolls_received', cells.rolls_received,
            'qty_received_m', cells.qty_received_m,
            'rolls_passed', cells.rolls_passed,
            'qty_passed_m', cells.qty_passed_m,
            'rolls_to_cutting', cells.rolls_to_cutting,
            'qty_to_cutting_m', cells.qty_to_cutting_m
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
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND (
                u.status = 'pending_qc'
                OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
                OR public._mm_loc_is_under(u.current_location_id, v_cut)
              )
          ), 0) AS rolls_received,
          COALESCE((
            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND (
                u.status = 'pending_qc'
                OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
                OR public._mm_loc_is_under(u.current_location_id, v_cut)
              )
          ), 0) AS qty_received_m,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND u.qc_result = 'pass'
              AND (
                (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
                OR public._mm_loc_is_under(u.current_location_id, v_cut)
              )
          ), 0) AS rolls_passed,
          COALESCE((
            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND u.qc_result = 'pass'
              AND (
                (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
                OR public._mm_loc_is_under(u.current_location_id, v_cut)
              )
          ), 0) AS qty_passed_m,
          COALESCE((
            SELECT count(*)::int FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND public._mm_loc_is_under(u.current_location_id, v_cut)
          ), 0) AS rolls_to_cutting,
          COALESCE((
            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND public._mm_loc_is_under(u.current_location_id, v_cut)
          ), 0) AS qty_to_cutting_m
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

REVOKE ALL ON FUNCTION public._mm_challan_header(public.mm_in_challans) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_challan_header(public.mm_in_challans) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mm_get_warehouse_board(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_board(uuid[]) TO authenticated, service_role;
