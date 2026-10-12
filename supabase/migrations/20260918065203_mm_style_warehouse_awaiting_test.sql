CREATE OR REPLACE FUNCTION public.mm_get_style_warehouse(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid; v_wh uuid; v_cut uuid; v_order jsonb; v_fabrics jsonb; v_colors jsonb; v_challans jsonb; v_rolls jsonb; v_test_fields jsonb;
  v_cover numeric; v_putaway numeric; v_colors_total int; v_colors_ready int; v_wh_qty numeric; v_rack_qty numeric; v_transit_qty numeric; v_score int; v_label text; v_has_bom boolean;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF p_order_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Style is required'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.style_orders o WHERE o.id = p_order_id AND o.factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND', 'Style not found');
  END IF;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  SELECT jsonb_build_object('order_id', o.id, 'style_name', o.style_name, 'style_ref', o.style_ref, 'buyer_name', o.buyer_name, 'po_number', o.po_number, 'image_url', o.image_url) INTO v_order FROM public.style_orders o WHERE o.id = p_order_id;
  v_has_bom := false;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.colorway_materials cm WHERE cm.order_id = p_order_id AND cm.factory_id = v_factory) INTO v_has_bom;
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.color_name, x.fabric_name), '[]'::jsonb) INTO v_fabrics FROM (
      SELECT cm.id AS fabric_line_id, cm.colorway_id, cw.name AS color_name, sm.id AS style_material_id,
        COALESCE(NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), ft.name, 'Fabric') AS fabric_name,
        COALESCE(ft.name, NULLIF(trim(cm.type), ''), 'Fabric') AS fabric_type,
        CASE WHEN lower(trim(cm.category)) IN ('fabric', 'trim') THEN NULLIF(trim(cm.extras->>'fabricCategory'), '') ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), '')) END AS fabric_category,
        cm.total_cons AS required_m,
        COALESCE(NULLIF(trim(cm.unit), ''), NULLIF(trim(cm.extras->>'unit'), ''), (SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u WHERE sm.id IS NOT NULL AND u.style_material_id = sm.id ORDER BY u.created_at LIMIT 1)) AS uom,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.source = 'mill' AND u.status = 'draft' AND u.in_challan_id IS NULL), 0) AS rolls_at_mill,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.source = 'mill' AND u.status = 'draft' AND u.in_challan_id IS NULL), 0) AS qty_at_mill,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS rolls_in_transit,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS qty_in_transit,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'), 0) AS rolls_awaiting_test,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'), 0) AS qty_awaiting_test,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), 0) AS rolls_receiving,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), 0) AS qty_receiving,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), 0) AS rolls_racked,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), 0) AS qty_racked,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND public._mm_loc_is_under(u.current_location_id, v_cut)), 0) AS rolls_issued,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND public._mm_loc_is_under(u.current_location_id, v_cut)), 0) AS qty_issued
      FROM public.colorway_materials cm JOIN public.colorways cw ON cw.id = cm.colorway_id
      LEFT JOIN public.mm_style_materials sm ON sm.colorway_material_id = cm.id AND sm.factory_id = v_factory
      LEFT JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      WHERE cm.order_id = p_order_id AND cm.factory_id = v_factory AND cm.kind = 'Fabric'
    ) x;
  ELSE v_fabrics := '[]'::jsonb; END IF;
  IF (v_fabrics IS NULL OR v_fabrics = '[]'::jsonb) AND NOT v_has_bom THEN
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.color_name, x.fabric_name), '[]'::jsonb) INTO v_fabrics FROM (
      SELECT sm.colorway_material_id AS fabric_line_id, sm.colorway_id, cw.name AS color_name, sm.id AS style_material_id,
        COALESCE(NULLIF(trim(cm.name), ''), ft.name) AS fabric_name, ft.name AS fabric_type,
        CASE WHEN cm.id IS NULL THEN NULL WHEN lower(trim(cm.category)) IN ('fabric', 'trim') THEN NULLIF(trim(cm.extras->>'fabricCategory'), '') ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), '')) END AS fabric_category,
        cm.total_cons AS required_m, NULLIF(trim(COALESCE(cm.unit, cm.extras->>'unit', '')), '') AS uom,
        0 AS rolls_at_mill, 0::numeric AS qty_at_mill,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS rolls_in_transit,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS qty_in_transit,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'), 0) AS rolls_awaiting_test,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'), 0) AS qty_awaiting_test,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), 0) AS rolls_receiving,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)), 0) AS qty_receiving,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), 0) AS rolls_racked,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND public._mm_is_pickable_loc(u.current_location_id) AND public._mm_loc_is_under(u.current_location_id, v_wh)), 0) AS qty_racked,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND public._mm_loc_is_under(u.current_location_id, v_cut)), 0) AS rolls_issued,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND public._mm_loc_is_under(u.current_location_id, v_cut)), 0) AS qty_issued
      FROM public.mm_style_materials sm JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sm.factory_id = v_factory AND sm.order_id = p_order_id AND (cm.id IS NULL OR cm.kind = 'Fabric')
    ) x;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('colorway_id', g.colorway_id, 'color_name', g.color_name, 'fabric_count', g.fabric_count, 'required_m', g.required_m, 'qty_in_wh', g.qty_in_wh, 'qty_racked', g.qty_racked, 'ready', g.ready) ORDER BY g.color_name), '[]'::jsonb) INTO v_colors FROM (
    SELECT f->>'colorway_id' AS colorway_id, f->>'color_name' AS color_name, count(*)::int AS fabric_count,
      COALESCE(sum((f->>'required_m')::numeric), 0) AS required_m,
      COALESCE(sum(COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)), 0) AS qty_in_wh,
      COALESCE(sum((f->>'qty_racked')::numeric), 0) AS qty_racked,
      bool_and(CASE WHEN COALESCE((f->>'required_m')::numeric, 0) <= 0 THEN (COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)) > 0 ELSE (COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)) >= (f->>'required_m')::numeric * 0.95 END) AS ready
    FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f GROUP BY f->>'colorway_id', f->>'color_name'
  ) g;
  SELECT COALESCE(jsonb_agg(c.obj ORDER BY c.sort_ts DESC NULLS LAST), '[]'::jsonb) INTO v_challans FROM (
    SELECT jsonb_build_object('kind', 'inbound', 'origin', c.source, 'id', c.id, 'challan_no', c.challan_no, 'status', c.status, 'sent_at', c.sent_at, 'received_at', c.received_at, 'color_name', (public._mm_challan_header(c)->>'color_name'), 'fabric_name', (public._mm_challan_header(c)->>'fabric_name'), 'fabric_category', (public._mm_challan_header(c)->>'fabric_category'), 'roll_count', (public._mm_challan_header(c)->>'roll_count')::int, 'qty', (public._mm_challan_header(c)->>'qty')::numeric, 'uom', public._mm_challan_header(c)->>'uom') AS obj, COALESCE(c.sent_at, c.received_at, c.created_at) AS sort_ts
    FROM public.mm_in_challans c JOIN public.mm_style_materials sm ON sm.id = c.style_material_id WHERE c.factory_id = v_factory AND sm.order_id = p_order_id
    UNION ALL
    SELECT jsonb_build_object('kind', 'store', 'origin', 'store', 'id', sc.id, 'challan_no', sc.challan_no, 'status', sc.status, 'sent_at', sc.sent_at, 'received_at', sc.received_at, 'color_name', cw.name, 'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name), 'fabric_category', CASE WHEN cm.id IS NULL THEN NULL WHEN lower(trim(cm.category)) IN ('fabric', 'trim') THEN NULLIF(trim(cm.extras->>'fabricCategory'), '') ELSE COALESCE(NULLIF(trim(cm.category), ''), NULLIF(trim(cm.extras->>'fabricCategory'), '')) END, 'roll_count', (SELECT count(*)::int FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id), 'qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id), 'uom', (SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id LIMIT 1)) AS obj, COALESCE(sc.sent_at, sc.received_at, sc.created_at) AS sort_ts
    FROM public.mm_store_challans sc JOIN public.mm_style_materials sm ON sm.id = sc.style_material_id JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id WHERE sc.factory_id = v_factory AND sm.order_id = p_order_id
  ) c;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg, 'shade', u.shade, 'lot_no', u.lot_no, 'attributes', u.attributes, 'mill_snapshot', u.mill_snapshot, 'source', u.source, 'status', u.status, 'qc_result', u.qc_result, 'in_challan_id', u.in_challan_id, 'store_challan_id', u.store_challan_id, 'color_name', cw.name, 'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name), 'fabric_type', ft.name, 'fabric_type_id', ft.id, 'location_code', loc.code, 'location_name', loc.name, 'bucket', CASE WHEN u.status = 'draft' THEN 'mill' WHEN u.status = 'in_transit' THEN 'transit' WHEN u.status = 'pending_qc' THEN 'testing' WHEN u.status = 'rejected' OR COALESCE(loc.location_type, '') = 'rejected' THEN 'rejected' WHEN public._mm_loc_is_under(u.current_location_id, v_cut) THEN 'issued' WHEN public._mm_is_pickable_loc(u.current_location_id) THEN 'racked' ELSE 'receiving' END) ORDER BY cw.name, COALESCE(NULLIF(trim(cm.name), ''), ft.name), u.unit_code), '[]'::jsonb) INTO v_rolls
  FROM public.mm_stock_units u JOIN public.mm_style_materials sm ON sm.id = u.style_material_id JOIN public.colorways cw ON cw.id = sm.colorway_id JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id WHERE u.factory_id = v_factory AND sm.order_id = p_order_id;
  SELECT COALESCE(sum(GREATEST(COALESCE((f->>'required_m')::numeric, 0), 0)), 0), COALESCE(sum(COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)), 0), COALESCE(sum(COALESCE((f->>'qty_racked')::numeric, 0)), 0), COALESCE(sum(COALESCE((f->>'qty_in_transit')::numeric, 0)), 0) INTO v_cover, v_wh_qty, v_rack_qty, v_transit_qty FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f;
  IF v_cover > 0 THEN v_cover := LEAST(1, v_wh_qty / v_cover); ELSIF v_wh_qty > 0 THEN v_cover := 1; ELSE v_cover := 0; END IF;
  IF v_wh_qty > 0 THEN v_putaway := LEAST(1, v_rack_qty / v_wh_qty); ELSE v_putaway := 0; END IF;
  SELECT COALESCE(count(*), 0), COALESCE(count(*) FILTER (WHERE (c->>'ready')::boolean), 0) INTO v_colors_total, v_colors_ready FROM jsonb_array_elements(COALESCE(v_colors, '[]'::jsonb)) c;
  v_score := round((v_cover * 70) + (v_putaway * 20) + (CASE WHEN v_colors_total > 0 THEN (v_colors_ready::numeric / v_colors_total) * 10 ELSE 0 END))::int;
  IF v_score = 0 AND COALESCE(v_wh_qty, 0) = 0 AND COALESCE(v_transit_qty, 0) = 0 THEN v_label := 'Not started';
  ELSIF v_cover >= 0.9 AND v_putaway >= 0.8 THEN v_label := 'Ready for cutting';
  ELSIF v_cover < 0.5 THEN v_label := 'Material inbound';
  ELSIF v_putaway < 0.5 THEN v_label := 'Receiving';
  ELSE v_label := 'In warehouse'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type_id', t.type_id, 'fields', t.fields) ORDER BY t.type_id), '[]'::jsonb) INTO v_test_fields FROM (SELECT f.type_id, jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options) ORDER BY f.seq, f.label) AS fields FROM public.mm_type_test_fields f WHERE f.factory_id = v_factory AND f.is_active AND f.type_id IN (SELECT DISTINCT sm.fabric_type_id FROM public.mm_style_materials sm WHERE sm.factory_id = v_factory AND sm.order_id = p_order_id AND sm.fabric_type_id IS NOT NULL) GROUP BY f.type_id) t;
  RETURN public._mm_ok(jsonb_build_object('order', v_order, 'fabrics', COALESCE(v_fabrics, '[]'::jsonb), 'colors', COALESCE(v_colors, '[]'::jsonb), 'challans', COALESCE(v_challans, '[]'::jsonb), 'rolls', COALESCE(v_rolls, '[]'::jsonb), 'test_fields', COALESCE(v_test_fields, '[]'::jsonb), 'readiness', jsonb_build_object('score', v_score, 'label', v_label, 'coverage_pct', round(v_cover * 100), 'putaway_pct', round(v_putaway * 100), 'colors_total', v_colors_total, 'colors_ready', v_colors_ready, 'qty_in_wh', COALESCE(v_wh_qty, 0), 'qty_racked', COALESCE(v_rack_qty, 0), 'qty_in_transit', COALESCE(v_transit_qty, 0), 'qty_awaiting_test', COALESCE((SELECT sum(COALESCE((f->>'qty_awaiting_test')::numeric, 0)) FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f), 0))));
END;
$fn$;
REVOKE ALL ON FUNCTION public.mm_get_style_warehouse(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_style_warehouse(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
;
