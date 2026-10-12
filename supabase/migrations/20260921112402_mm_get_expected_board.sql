CREATE OR REPLACE FUNCTION public.mm_get_expected_board(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_status text;
  v_q text;
  v_limit integer;
  v_off integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  v_status := lower(NULLIF(btrim(COALESCE(p_status, '')), ''));
  v_q := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_off := GREATEST(COALESCE(p_offset, 0), 0);

  RETURN public._mm_ok((
    WITH cells AS (
      SELECT
        o.id AS order_id,
        o.style_name,
        o.style_ref,
        o.buyer_name,
        o.po_number,
        c.id AS colorway_id,
        c.name AS color_name,
        cm.id AS fabric_line_id,
        ft.id AS fabric_type_id,
        COALESCE(NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), ft.name, 'Fabric') AS fabric_name,
        COALESCE(ft.name, NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_type,
        CASE
          WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
            THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
          ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), ''))
        END AS fabric_category,
        COALESCE(cm.total_cons, 0) AS required_m,
        NULLIF(trim(cm.unit), '') AS uom,
        sm.id AS style_material_id,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'
        ), 0) AS qty_incoming_m,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'
        ), 0) AS rolls_incoming,
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
              u.status = 'pending_qc'
              OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
              OR public._mm_loc_is_under(u.current_location_id, v_cut)
            )
        ), 0) AS rolls_received
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
      WHERE o.factory_id = v_factory
        AND o.status IS DISTINCT FROM 'Completed'
        AND o.status IS DISTINCT FROM 'Cancelled'
    ),
    scored AS (
      SELECT
        cells.*,
        GREATEST(0, cells.required_m - cells.qty_received_m) AS qty_still_due_m,
        GREATEST(0, cells.required_m - cells.qty_received_m - cells.qty_incoming_m) AS qty_uncovered_m,
        CASE
          WHEN cells.qty_received_m >= cells.required_m THEN 'met'
          WHEN cells.qty_incoming_m > 0 THEN 'incoming'
          ELSE 'due'
        END AS row_status
      FROM cells
    ),
    filtered AS (
      SELECT *
      FROM scored
      WHERE (
          CASE
            WHEN v_status IS NULL OR v_status IN ('', 'open') THEN row_status IN ('due', 'incoming')
            WHEN v_status = 'all' THEN true
            ELSE row_status = v_status
          END
        )
        AND (
          v_q IS NULL OR concat_ws(' ',
            style_name, style_ref, buyer_name, po_number, color_name, fabric_name, fabric_type
          ) ILIKE '%' || v_q || '%'
        )
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*)::int FROM filtered),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'order_id', f.order_id,
          'style_name', f.style_name,
          'style_ref', f.style_ref,
          'buyer_name', f.buyer_name,
          'po_number', f.po_number,
          'colorway_id', f.colorway_id,
          'color_name', f.color_name,
          'fabric_line_id', f.fabric_line_id,
          'fabric_type_id', f.fabric_type_id,
          'fabric_name', f.fabric_name,
          'fabric_type', f.fabric_type,
          'fabric_category', f.fabric_category,
          'uom', f.uom,
          'style_material_id', f.style_material_id,
          'required_m', f.required_m,
          'qty_incoming_m', f.qty_incoming_m,
          'rolls_incoming', f.rolls_incoming,
          'qty_received_m', f.qty_received_m,
          'rolls_received', f.rolls_received,
          'qty_still_due_m', f.qty_still_due_m,
          'qty_uncovered_m', f.qty_uncovered_m,
          'status', f.row_status
        ) ORDER BY
          CASE f.row_status WHEN 'due' THEN 0 WHEN 'incoming' THEN 1 ELSE 2 END,
          f.style_name, f.color_name, f.fabric_name)
        FROM (
          SELECT * FROM filtered
          ORDER BY
            CASE row_status WHEN 'due' THEN 0 WHEN 'incoming' THEN 1 ELSE 2 END,
            style_name, color_name, fabric_name
          OFFSET v_off LIMIT v_limit
        ) f
      ), '[]'::jsonb)
    )
  ));
END;
$fn$;;
