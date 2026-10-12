-- Phase 3d: older read RPCs return fabric_id + fabric_code so the UI can show / dim / prefill.
-- Originals renamed to *_base (logic untouched); same-name wrappers enrich the JSON.

CREATE OR REPLACE FUNCTION public._mm_fabric_code(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT code FROM public.mm_fabrics WHERE id = p_id $$;
REVOKE ALL ON FUNCTION public._mm_fabric_code(uuid) FROM PUBLIC, anon, authenticated;

-- uuid from a json text value, NULL when empty / not a uuid
CREATE OR REPLACE FUNCTION public._mm_juuid(p text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT CASE WHEN p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p::uuid END $$;
REVOKE ALL ON FUNCTION public._mm_juuid(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. _mm_roll_row: + fabric_id, fabric_code (used by every v4 roll list)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_roll_row(p_roll_id uuid, p_with_passport boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_r public.mm_rolls%ROWTYPE; v_c jsonb; v_pp jsonb; v_m jsonb; v_sm uuid; v_qty numeric; v_kg numeric; v_extra jsonb;
BEGIN
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = p_roll_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_c := public._mm_roll_custody(v_r.id);
  v_sm := NULLIF(v_c->>'style_material_id','')::uuid;
  IF v_c->>'side' = 'processing' THEN
    v_sm := COALESCE((SELECT style_material_id FROM public.mm_stock_units WHERE roll_id = v_r.id),
                     (SELECT style_material_id FROM public.mm_mill_rolls WHERE roll_id = v_r.id));
  END IF;
  SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) INTO v_m FROM public.mm_machines m WHERE m.id = v_r.machine_id;
  SELECT COALESCE(u.length_m, mr.length_m), COALESCE(u.weight_kg, mr.weight_kg),
         jsonb_build_object('shade', COALESCE(u.shade, mr.shade), 'lot_no', COALESCE(u.lot_no, mr.lot_no), 'color_ref', COALESCE(u.color_ref, mr.color_ref),
                            'mill_roll_id', mr.id, 'stock_unit_id', u.id, 'qty_available', u.qty_available, 'uom', COALESCE(u.qty_uom, u.uom, 'm'))
    INTO v_qty, v_kg, v_extra
  FROM public.mm_rolls r LEFT JOIN public.mm_stock_units u ON u.roll_id = r.id LEFT JOIN public.mm_mill_rolls mr ON mr.roll_id = r.id
  WHERE r.id = v_r.id;
  IF p_with_passport THEN v_pp := public._mm_qc_passport(v_r.id); END IF;
  RETURN jsonb_build_object(
    'roll_id', v_r.id, 'roll_code', v_r.roll_code, 'origin', v_r.origin, 'mill_batch_id', v_r.mill_batch_id,
    'batch_no', (SELECT batch_no FROM public.mm_mill_batches WHERE id = v_r.mill_batch_id),
    'fabric_type_id', v_r.fabric_type_id, 'fabric_type_name', (SELECT name FROM public.mm_fabric_types WHERE id = v_r.fabric_type_id),
    'fabric_id', v_r.fabric_id, 'fabric_code', public._mm_fabric_code(v_r.fabric_id),
    'machine', v_m, 'shift', v_r.shift, 'produced_at', v_r.produced_at,
    'stage_code', v_r.stage_code, 'unit_form', v_r.unit_form, 'width_form', v_r.width_form, 'grade', v_r.grade, 'dye_lot', v_r.dye_lot,
    'process_round', v_r.process_round, 'length_m', v_qty, 'weight_kg', v_kg,
    'custody', v_c, 'style', public._mm_style_label(v_sm),
    'test_status', v_pp->'test'->>'status', 'inspection_status', v_pp->'inspection'->>'status',
    'missing_keys', v_pp->'test'->'missing_keys',
    'parent_codes', COALESCE((SELECT jsonb_agg(p.roll_code) FROM public.mm_roll_lineage l JOIN public.mm_rolls p ON p.id = l.parent_roll_id
                              WHERE l.child_roll_id = v_r.id), '[]'::jsonb)
  ) || v_extra;
END $function$;

-- ---------------------------------------------------------------------------
-- 2. rename originals
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.mm_get_warehouse_board(uuid[]) RENAME TO _mm_get_warehouse_board_base;
ALTER FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) RENAME TO _mm_get_mill_line_base;
ALTER FUNCTION public.mm_get_unallocated_mill() RENAME TO _mm_get_unallocated_mill_base;
ALTER FUNCTION public.mm_mill_list_batches_v4(jsonb) RENAME TO _mm_mill_list_batches_v4_base;
ALTER FUNCTION public.mm_list_warehouse_stock(text, text, text, integer, integer) RENAME TO _mm_list_warehouse_stock_base;

REVOKE ALL ON FUNCTION public._mm_get_warehouse_board_base(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_get_mill_line_base(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_get_unallocated_mill_base() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_mill_list_batches_v4_base(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_list_warehouse_stock_base(text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. wrappers
-- ---------------------------------------------------------------------------
-- board: each fabric cell + fabric_id (order line fabric, else style line fabric)
CREATE OR REPLACE FUNCTION public.mm_get_warehouse_board(p_order_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb := public._mm_get_warehouse_board_base(p_order_ids);
BEGIN
  IF NOT COALESCE((v->>'ok')::boolean, false) OR jsonb_typeof(v->'data'->'orders') <> 'array' THEN RETURN v; END IF;
  RETURN jsonb_set(v, '{data,orders}', COALESCE((
    SELECT jsonb_agg(o || jsonb_build_object('fabrics', COALESCE((
             SELECT jsonb_agg(c || jsonb_build_object('fabric_id', x.fid, 'fabric_code', public._mm_fabric_code(x.fid)) ORDER BY ci)
             FROM jsonb_array_elements(o->'fabrics') WITH ORDINALITY e(c, ci)
             CROSS JOIN LATERAL (SELECT COALESCE(
                 (SELECT cm.fabric_id FROM public.colorway_materials cm WHERE cm.id = public._mm_juuid(c->>'fabric_line_id')),
                 (SELECT sm.fabric_id FROM public.mm_style_materials sm WHERE sm.id = public._mm_juuid(c->>'style_material_id'))) AS fid) x
           ), '[]'::jsonb)) ORDER BY oi)
    FROM jsonb_array_elements(v->'data'->'orders') WITH ORDINALITY q(o, oi)), '[]'::jsonb));
END $$;

-- mill line: line fabric + each roll / batch fabric
CREATE OR REPLACE FUNCTION public.mm_get_mill_line(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb := public._mm_get_mill_line_base(p_order_id, p_colorway_id, p_colorway_material_id); v_fid uuid;
BEGIN
  IF NOT COALESCE((v->>'ok')::boolean, false) THEN RETURN v; END IF;
  v_fid := COALESCE((SELECT cm.fabric_id FROM public.colorway_materials cm WHERE cm.id = p_colorway_material_id),
                    (SELECT sm.fabric_id FROM public.mm_style_materials sm WHERE sm.id = public._mm_juuid(v->'data'->>'style_material_id')));
  RETURN jsonb_set(v, '{data}', (v->'data') || jsonb_build_object(
    'fabric_id', v_fid, 'fabric_code', public._mm_fabric_code(v_fid),
    'rolls', COALESCE((SELECT jsonb_agg(r || jsonb_build_object('fabric_id', rr.fabric_id, 'fabric_code', public._mm_fabric_code(rr.fabric_id)) ORDER BY i)
                       FROM jsonb_array_elements(v->'data'->'rolls') WITH ORDINALITY e(r, i)
                       LEFT JOIN public.mm_mill_rolls m ON m.id = public._mm_juuid(r->>'id')
                       LEFT JOIN public.mm_rolls rr ON rr.id = m.roll_id), '[]'::jsonb),
    'batches', COALESCE((SELECT jsonb_agg(b || jsonb_build_object('fabric_id', mb.fabric_id, 'fabric_code', public._mm_fabric_code(mb.fabric_id)) ORDER BY i)
                         FROM jsonb_array_elements(v->'data'->'batches') WITH ORDINALITY e(b, i)
                         LEFT JOIN public.mm_mill_batches mb ON mb.id = public._mm_juuid(b->>'id')), '[]'::jsonb)));
END $$;

-- unallocated mill: batches + rolls
CREATE OR REPLACE FUNCTION public.mm_get_unallocated_mill()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb := public._mm_get_unallocated_mill_base();
BEGIN
  IF NOT COALESCE((v->>'ok')::boolean, false) THEN RETURN v; END IF;
  RETURN jsonb_set(v, '{data}', (v->'data') || jsonb_build_object(
    'rolls', COALESCE((SELECT jsonb_agg(r || jsonb_build_object('fabric_id', rr.fabric_id, 'fabric_code', public._mm_fabric_code(rr.fabric_id)) ORDER BY i)
                       FROM jsonb_array_elements(v->'data'->'rolls') WITH ORDINALITY e(r, i)
                       LEFT JOIN public.mm_mill_rolls m ON m.id = public._mm_juuid(r->>'id')
                       LEFT JOIN public.mm_rolls rr ON rr.id = m.roll_id), '[]'::jsonb),
    'batches', COALESCE((SELECT jsonb_agg(b || jsonb_build_object('fabric_id', mb.fabric_id, 'fabric_code', public._mm_fabric_code(mb.fabric_id)) ORDER BY i)
                         FROM jsonb_array_elements(v->'data'->'batches') WITH ORDINALITY e(b, i)
                         LEFT JOIN public.mm_mill_batches mb ON mb.id = public._mm_juuid(b->>'id')), '[]'::jsonb)));
END $$;

-- mill batch list v4
CREATE OR REPLACE FUNCTION public.mm_mill_list_batches_v4(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb := public._mm_mill_list_batches_v4_base(p_filter);
BEGIN
  IF NOT COALESCE((v->>'ok')::boolean, false) THEN RETURN v; END IF;
  RETURN jsonb_set(v, '{data,rows}', COALESCE((
    SELECT jsonb_agg(b || jsonb_build_object('fabric_id', mb.fabric_id, 'fabric_code', public._mm_fabric_code(mb.fabric_id)) ORDER BY i)
    FROM jsonb_array_elements(v->'data'->'rows') WITH ORDINALITY e(b, i)
    LEFT JOIN public.mm_mill_batches mb ON mb.id = public._mm_juuid(b->>'id')), '[]'::jsonb));
END $$;

-- warehouse stock list (rows = stock units)
CREATE OR REPLACE FUNCTION public.mm_list_warehouse_stock(p_search text DEFAULT NULL, p_location text DEFAULT NULL,
  p_buyer text DEFAULT NULL, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb := public._mm_list_warehouse_stock_base(p_search, p_location, p_buyer, p_page, p_page_size);
BEGIN
  IF NOT COALESCE((v->>'ok')::boolean, false) OR jsonb_typeof(v->'data'->'rows') <> 'array' THEN RETURN v; END IF;
  RETURN jsonb_set(v, '{data,rows}', COALESCE((
    SELECT jsonb_agg(s || jsonb_build_object('fabric_id', rr.fabric_id, 'fabric_code', public._mm_fabric_code(rr.fabric_id)) ORDER BY i)
    FROM jsonb_array_elements(v->'data'->'rows') WITH ORDINALITY e(s, i)
    LEFT JOIN public.mm_stock_units u ON u.id = public._mm_juuid(s->>'id')
    LEFT JOIN public.mm_rolls rr ON rr.id = u.roll_id), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.mm_get_warehouse_board(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_get_unallocated_mill() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_mill_list_batches_v4(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_list_warehouse_stock(text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_board(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_line(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_unallocated_mill() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_mill_list_batches_v4(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_warehouse_stock(text, text, text, integer, integer) TO authenticated, service_role;
