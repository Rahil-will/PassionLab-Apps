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
              AND (
                (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
                OR public._mm_loc_is_under(u.current_location_id, v_cut)
              )
          ), 0) AS rolls_passed,
          COALESCE((
            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
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
