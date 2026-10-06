-- LEFT JOIN style for unallocated rolls/challans. Expected board. Allocate / unallocate.
-- Coverage qty always from mm_stock_units.style_material_id.

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
    'to_location', p_ch.to_location,
    'remarks', p_ch.remarks,
    'factory_name', (SELECT f.name FROM public.factories f WHERE f.id = p_ch.factory_id),
    'factory_code', (SELECT f.code FROM public.factories f WHERE f.id = p_ch.factory_id),
    'row_version', p_ch.row_version,
    'style_material_id', p_ch.style_material_id,
    'order_id', sm.order_id,
    'colorway_id', sm.colorway_id,
    'fabric_line_id', COALESCE(sm.colorway_material_id, cm.id),
    'style_name', COALESCE(o.style_name, 'Unallocated'),
    'style_ref', o.style_ref,
    'buyer_name', o.buyer_name,
    'po_number', o.po_number,
    'image_url', o.image_url,
    'color_name', COALESCE(cw.name, 'Unallocated'),
    'fabric_type', COALESCE(ft.name, ft_unit.name),
    'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name, ft_unit.name, 'Fabric'),
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
    'uom', COALESCE(
      (
        SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
        WHERE u.in_challan_id = p_ch.id ORDER BY u.created_at LIMIT 1
      ),
      NULLIF(trim(COALESCE(cm.unit, cm.extras->>'unit', '')), '')
    ),
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
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.mm_style_materials sm ON sm.id = p_ch.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
  LEFT JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
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
  LEFT JOIN public.mm_fabric_types ft_unit ON ft_unit.id = (
    SELECT u.fabric_type_id FROM public.mm_stock_units u
    WHERE u.in_challan_id = p_ch.id ORDER BY u.created_at LIMIT 1
  )
$$;

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
  SELECT COALESCE(
    (SELECT u.fabric_type_id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id ORDER BY u.created_at LIMIT 1),
    (SELECT sm.fabric_type_id FROM public.mm_style_materials sm WHERE sm.id = v_ch.style_material_id)
  ) INTO v_type;
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
        'shade', u.shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref, 'attributes', u.attributes,
        'mill_snapshot', u.mill_snapshot, 'status', u.status, 'qc_result', u.qc_result,
        'row_version', u.row_version, 'source', u.source,
        'mill_batch_id', u.mill_batch_id,
        'batch_no', b.batch_no,
        'wh_values', COALESCE(i.field_values, '{}'::jsonb),
        'wh_remarks', i.remarks,
        'wh_result', i.result
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_warehouse_inspections i ON i.stock_unit_id = u.id
      WHERE u.in_challan_id = v_ch.id
    ), '[]'::jsonb)
  ));
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
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'qty_m', (
      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'qty_kg', (
      SELECT COALESCE(sum(u.weight_kg), 0) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'rolls_pickable', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
    ),
    'pending_putaway', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ),
    'red_label_count', (
      SELECT count(*) FROM public.mm_stock_units u
      JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND (u.status = 'rejected' OR loc.location_type = 'rejected')
    ),
    'by_fabric_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', t.name, 'rolls', t.n) ORDER BY t.n DESC)
      FROM (
        SELECT ft.name, count(*)::int AS n
        FROM public.mm_stock_units u
        JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
        WHERE u.factory_id = v_factory AND u.status = 'in_stock'
          AND public._mm_loc_is_under(u.current_location_id, v_wh)
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
            'Batch ' || c.challan_no || ' — ' || COALESCE(o.style_name, 'Unallocated') ||
            CASE WHEN cw.name IS NULL THEN '' ELSE ' / ' || cw.name END || ' — ' ||
            (SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = c.id) || ' rolls — sent ' ||
            CASE WHEN c.sent_at IS NULL THEN 'today'
                 WHEN c.sent_at > now() - interval '1 day' THEN 'today'
                 ELSE (EXTRACT(DAY FROM now() - c.sent_at)::int)::text || ' days ago' END,
            'ts', c.sent_at
          ) AS x, c.sent_at AS ts
          FROM public.mm_in_challans c
          LEFT JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          LEFT JOIN public.style_orders o ON o.id = sm.order_id
          LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory AND c.source = 'mill' AND c.status = 'pending'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', c.source, 'id', c.id, 'label',
            c.challan_no || ' — ' || COALESCE(o.style_name, 'Unallocated') ||
            CASE WHEN cw.name IS NULL THEN '' ELSE ' / ' || cw.name END || ' — ' ||
            (SELECT count(*) FILTER (WHERE u.qc_result IS NOT NULL) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' of ' ||
            (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' rolls tested',
            'ts', COALESCE(c.received_at, c.sent_at)
          ) AS x, COALESCE(c.received_at, c.sent_at) AS ts
          FROM public.mm_in_challans c
          LEFT JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          LEFT JOIN public.style_orders o ON o.id = sm.order_id
          LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory
            AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc')
          UNION ALL
          SELECT jsonb_build_object(
            'kind', 'putaway', 'id', 'queue', 'label',
            (SELECT count(*) FROM public.mm_stock_units u
             WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
               AND public._mm_loc_is_under(u.current_location_id, v_wh)
               AND public._mm_is_unassigned_loc(u.current_location_id)
            )::text || ' rolls waiting for rack putaway',
            'ts', now()
          ) AS x, now() AS ts
          WHERE EXISTS (
            SELECT 1 FROM public.mm_stock_units u
            WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
              AND public._mm_loc_is_under(u.current_location_id, v_wh)
              AND public._mm_is_unassigned_loc(u.current_location_id)
          )
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
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.source = 'mill' AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'external_pending', (
      SELECT count(*) FROM public.mm_in_challans
      WHERE factory_id = v_factory AND source = 'vendor' AND status = 'received'
    ),
    'testing_pending', (
      SELECT count(*) FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory
        AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.in_challan_id = c.id AND u.status = 'pending_qc')
    ),
    'external_stock', (
      SELECT count(*) FROM public.mm_stock_units u
      WHERE u.factory_id = v_factory AND u.source = 'vendor' AND u.status = 'in_stock'
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ),
    'store_pending', (
      SELECT count(*) FROM public.mm_store_challans
      WHERE factory_id = v_factory AND status = 'pending'
    ),
    'store_sent', (
      SELECT count(*) FROM public.mm_store_challans WHERE factory_id = v_factory
    ),
    'rack_count', (
      SELECT count(*) FROM public.mm_locations
      WHERE factory_id = v_factory AND is_active AND location_type IN ('rack', 'bin')
        AND public._mm_loc_is_under(id, v_wh)
    )
  ));
END;
$fn$;
