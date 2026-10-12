-- Warehouse 4-point inspections: mill receive lands pending_qc; pass/fail is a
-- separate table from mill/vendor declared attributes.

CREATE TABLE IF NOT EXISTS public.mm_warehouse_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories (id) ON DELETE CASCADE,
  in_challan_id uuid NOT NULL REFERENCES public.mm_in_challans (id) ON DELETE CASCADE,
  stock_unit_id uuid NOT NULL REFERENCES public.mm_stock_units (id) ON DELETE RESTRICT,
  result text NOT NULL,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  remarks text,
  inspected_at timestamptz NOT NULL DEFAULT now(),
  inspected_by uuid REFERENCES public.profiles (id),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles (id),
  CONSTRAINT mm_warehouse_inspections_result_chk CHECK (result = ANY (ARRAY['pass'::text, 'fail'::text])),
  CONSTRAINT mm_warehouse_inspections_row_version_chk CHECK (row_version >= 1),
  CONSTRAINT mm_warehouse_inspections_unit_uidx UNIQUE (stock_unit_id)
);

CREATE INDEX IF NOT EXISTS mm_warehouse_inspections_factory_idx
  ON public.mm_warehouse_inspections (factory_id);
CREATE INDEX IF NOT EXISTS mm_warehouse_inspections_challan_idx
  ON public.mm_warehouse_inspections (in_challan_id);
SELECT public._mm_lockdown_table('public.mm_warehouse_inspections'::regclass);

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
  v_edit jsonb;
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
  FOR v_edit IN SELECT * FROM jsonb_array_elements(COALESCE(p_roll_edits, '[]'::jsonb))
  LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = (v_edit->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.mm_stock_units SET
      length_m = COALESCE(NULLIF(v_edit->>'length_m', '')::numeric, length_m),
      weight_kg = COALESCE(NULLIF(v_edit->>'weight_kg', '')::numeric, weight_kg),
      shade = COALESCE(NULLIF(trim(v_edit->>'shade'), ''), shade),
      lot_no = COALESCE(NULLIF(trim(v_edit->>'lot_no'), ''), lot_no),
      attributes = CASE WHEN jsonb_typeof(v_edit->'attributes') = 'object' THEN v_edit->'attributes' ELSE attributes END,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
  END LOOP;
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
      v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, 'pending_qc',
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

CREATE OR REPLACE FUNCTION public.mm_save_warehouse_inspections(p_id uuid, p_rolls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_recv uuid;
  v_red uuid;
  v_row jsonb;
  v_result text;
  v_values jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
  v_new_status text;
  v_new_loc uuid;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source = 'mill' AND v_ch.status <> 'received' THEN
    RETURN public._mm_err('INVALID', 'Receive this mill challan before testing');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_recv := public._mm_recv_loc(v_factory);
  v_red := COALESCE(public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL'), v_recv);

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_result := lower(NULLIF(btrim(COALESCE(v_row->>'result', '')), ''));
    IF v_result IS NULL THEN CONTINUE; END IF;
    IF v_result NOT IN ('pass', 'fail') THEN
      RETURN public._mm_err('INVALID', 'Each roll must be pass or fail');
    END IF;
    BEGIN
      SELECT * INTO v_unit FROM public.mm_stock_units
      WHERE id = (v_row->>'id')::uuid AND in_challan_id = v_ch.id AND factory_id = v_factory
      FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this challan'); END IF;
    IF v_unit.store_challan_id IS NOT NULL THEN
      RETURN public._mm_err('LOCKED', 'A roll on a store challan cannot be retested');
    END IF;
    IF public._mm_is_pickable_loc(v_unit.current_location_id) THEN
      RETURN public._mm_err('LOCKED', 'Move the roll off the rack before changing the test');
    END IF;
    IF v_unit.status NOT IN ('pending_qc', 'in_stock', 'rejected') THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting for warehouse test');
    END IF;
    IF v_unit.status = 'in_stock' AND NOT public._mm_is_unassigned_loc(v_unit.current_location_id) THEN
      RETURN public._mm_err('LOCKED', 'Move the roll off the rack before changing the test');
    END IF;

    v_values := CASE WHEN jsonb_typeof(v_row->'values') = 'object' THEN v_row->'values' ELSE '{}'::jsonb END;
    v_new_status := CASE WHEN v_result = 'pass' THEN 'in_stock' ELSE 'rejected' END;
    v_new_loc := CASE WHEN v_result = 'pass' THEN v_recv ELSE v_red END;

    INSERT INTO public.mm_warehouse_inspections (
      factory_id, in_challan_id, stock_unit_id, result, field_values, remarks,
      inspected_at, inspected_by, created_by, updated_by
    ) VALUES (
      v_factory, v_ch.id, v_unit.id, v_result, v_values,
      NULLIF(btrim(COALESCE(v_row->>'remarks', '')), ''),
      now(), auth.uid(), auth.uid(), auth.uid()
    )
    ON CONFLICT (stock_unit_id) DO UPDATE SET
      result = EXCLUDED.result,
      field_values = CASE
        WHEN jsonb_typeof(v_row->'values') = 'object' THEN EXCLUDED.field_values
        ELSE public.mm_warehouse_inspections.field_values
      END,
      remarks = COALESCE(EXCLUDED.remarks, public.mm_warehouse_inspections.remarks),
      inspected_at = now(),
      inspected_by = auth.uid(),
      row_version = public.mm_warehouse_inspections.row_version + 1,
      updated_at = now(),
      updated_by = auth.uid();

    UPDATE public.mm_stock_units SET
      qc_result = v_result,
      status = v_new_status,
      current_location_id = v_new_loc,
      mill_snapshot = mill_snapshot,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;

    IF v_unit.status IS DISTINCT FROM v_new_status OR v_unit.current_location_id IS DISTINCT FROM v_new_loc THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'TRANSFER', v_unit.length_m, v_unit.status, v_new_status,
        v_unit.current_location_id, v_new_loc, 'mm_warehouse_inspections', v_ch.id,
        CASE WHEN v_result = 'pass' THEN 'Warehouse 4-point pass' ELSE 'Warehouse 4-point fail' END
      );
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'saved', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_vendor_roll_tests(p_id uuid, p_roll_results jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_mapped jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r->>'id',
    'result', CASE
      WHEN r->>'pass' IS NULL OR btrim(r->>'pass') = '' THEN NULL
      WHEN COALESCE((r->>'pass')::boolean, false) THEN 'pass'
      ELSE 'fail'
    END,
    'values', '{}'::jsonb
  )), '[]'::jsonb)
  INTO v_mapped
  FROM jsonb_array_elements(COALESCE(p_roll_results, '[]'::jsonb)) r;
  RETURN public.mm_save_warehouse_inspections(p_id, v_mapped);
END;
$fn$;

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
  SELECT fabric_type_id INTO v_type FROM public.mm_style_materials WHERE id = v_ch.style_material_id;
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
        'shade', u.shade, 'lot_no', u.lot_no, 'attributes', u.attributes,
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
        JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
        JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
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
            'Batch ' || c.challan_no || ' — ' || o.style_name || ' / ' || cw.name || ' — ' ||
            (SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = c.id) || ' rolls — sent ' ||
            CASE WHEN c.sent_at IS NULL THEN 'today'
                 WHEN c.sent_at > now() - interval '1 day' THEN 'today'
                 ELSE (EXTRACT(DAY FROM now() - c.sent_at)::int)::text || ' days ago' END,
            'ts', c.sent_at
          ) AS x, c.sent_at AS ts
          FROM public.mm_in_challans c
          JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          JOIN public.style_orders o ON o.id = sm.order_id
          JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory AND c.source = 'mill' AND c.status = 'pending'
          UNION ALL
          SELECT jsonb_build_object(
            'kind', c.source, 'id', c.id, 'label',
            c.challan_no || ' — ' || o.style_name || ' / ' || cw.name || ' — ' ||
            (SELECT count(*) FILTER (WHERE u.qc_result IS NOT NULL) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' of ' ||
            (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) ||
            ' rolls tested',
            'ts', COALESCE(c.received_at, c.sent_at)
          ) AS x, COALESCE(c.received_at, c.sent_at) AS ts
          FROM public.mm_in_challans c
          JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          JOIN public.style_orders o ON o.id = sm.order_id
          JOIN public.colorways cw ON cw.id = sm.colorway_id
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

CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_red uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_red := public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL');
  RETURN public._mm_ok(jsonb_build_object(
    'warehouse_id', v_wh,
    'red_label_id', v_red,
    'rack_targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', loc.id, 'code', loc.code, 'name', loc.name, 'location_type', loc.location_type,
        'capacity_rolls', loc.capacity_rolls,
        'roll_count', (
          SELECT count(*) FROM public.mm_stock_units u
          WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'
        )
      ) ORDER BY loc.code)
      FROM public.mm_locations loc
      WHERE loc.factory_id = v_factory AND loc.is_active
        AND loc.location_type IN ('rack', 'bin') AND loc.is_pickable
        AND public._mm_loc_is_under(loc.id, v_wh)
    ), '[]'::jsonb),
    'unassigned_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY o.style_name, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND public._mm_is_unassigned_loc(u.current_location_id)
    ), '[]'::jsonb),
    'racked_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY loc.code, u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.status = 'in_stock' AND u.store_challan_id IS NULL
        AND public._mm_is_pickable_loc(u.current_location_id)
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
    ), '[]'::jsonb),
    'red_label_rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m,
        'shade', u.shade, 'lot_no', u.lot_no, 'source', u.source,
        'style_name', o.style_name, 'color_name', cw.name, 'fabric_type', ft.name,
        'location_id', loc.id, 'location_code', loc.code, 'location_name', loc.name
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      JOIN public.style_orders o ON o.id = sm.order_id
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      WHERE u.factory_id = v_factory AND u.store_challan_id IS NULL
        AND public._mm_loc_is_under(u.current_location_id, v_wh)
        AND (u.status = 'rejected' OR loc.location_type = 'rejected')
    ), '[]'::jsonb)
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_challan_header(public.mm_in_challans) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_save_warehouse_inspections(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(uuid, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_inspections(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_roll_tests(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_in_challan_rolls(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_warehouse_dashboard() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_rack_ops_board() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mm_get_style_warehouse(p_order_id uuid)
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
  v_order jsonb;
  v_fabrics jsonb;
  v_colors jsonb;
  v_challans jsonb;
  v_rolls jsonb;
  v_test_fields jsonb;
  v_cover numeric;
  v_putaway numeric;
  v_colors_total int;
  v_colors_ready int;
  v_wh_qty numeric;
  v_rack_qty numeric;
  v_transit_qty numeric;
  v_score int;
  v_label text;
  v_has_bom boolean;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_order_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style is required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.style_orders o WHERE o.id = p_order_id AND o.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Style not found');
  END IF;

  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

  SELECT jsonb_build_object(
    'order_id', o.id,
    'style_name', o.style_name,
    'style_ref', o.style_ref,
    'buyer_name', o.buyer_name,
    'po_number', o.po_number,
    'image_url', o.image_url
  ) INTO v_order
  FROM public.style_orders o
  WHERE o.id = p_order_id;

  v_has_bom := false;
  IF to_regclass('public.colorway_materials') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.colorway_materials cm
      WHERE cm.order_id = p_order_id AND cm.factory_id = v_factory
    ) INTO v_has_bom;

    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.color_name, x.fabric_name), '[]'::jsonb)
    INTO v_fabrics
    FROM (
      SELECT
        cm.id AS fabric_line_id,
        cm.colorway_id,
        cw.name AS color_name,
        sm.id AS style_material_id,
        COALESCE(NULLIF(trim(cm.name), ''), NULLIF(trim(cm.type), ''), ft.name, 'Fabric') AS fabric_name,
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
          NULLIF(trim(cm.extras->>'unit'), ''),
          (
            SELECT NULLIF(trim(u.uom), '')
            FROM public.mm_stock_units u
            WHERE sm.id IS NOT NULL AND u.style_material_id = sm.id
            ORDER BY u.created_at
            LIMIT 1
          )
        ) AS uom,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.source = 'mill'
            AND u.status = 'draft' AND u.in_challan_id IS NULL
        ), 0) AS rolls_at_mill,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.source = 'mill'
            AND u.status = 'draft' AND u.in_challan_id IS NULL
        ), 0) AS qty_at_mill,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'
        ), 0) AS rolls_in_transit,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'
        ), 0) AS qty_in_transit,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'
        ), 0) AS rolls_awaiting_test,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'
        ), 0) AS qty_awaiting_test,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND u.status = 'in_stock'
            AND public._mm_loc_is_under(u.current_location_id, v_wh)
            AND public._mm_is_unassigned_loc(u.current_location_id)
        ), 0) AS rolls_receiving,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND u.status = 'in_stock'
            AND public._mm_loc_is_under(u.current_location_id, v_wh)
            AND public._mm_is_unassigned_loc(u.current_location_id)
        ), 0) AS qty_receiving,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND u.status = 'in_stock'
            AND public._mm_is_pickable_loc(u.current_location_id)
            AND public._mm_loc_is_under(u.current_location_id, v_wh)
        ), 0) AS rolls_racked,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND u.status = 'in_stock'
            AND public._mm_is_pickable_loc(u.current_location_id)
            AND public._mm_loc_is_under(u.current_location_id, v_wh)
        ), 0) AS qty_racked,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND public._mm_loc_is_under(u.current_location_id, v_cut)
        ), 0) AS rolls_issued,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id
            AND public._mm_loc_is_under(u.current_location_id, v_cut)
        ), 0) AS qty_issued
      FROM public.colorway_materials cm
      JOIN public.colorways cw ON cw.id = cm.colorway_id
      LEFT JOIN public.mm_style_materials sm
        ON sm.colorway_material_id = cm.id AND sm.factory_id = v_factory
      LEFT JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      WHERE cm.order_id = p_order_id AND cm.factory_id = v_factory
        AND cm.kind = 'Fabric'
    ) x;
  ELSE
    v_fabrics := '[]'::jsonb;
  END IF;

  IF (v_fabrics IS NULL OR v_fabrics = '[]'::jsonb) AND NOT v_has_bom THEN
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.color_name, x.fabric_name), '[]'::jsonb)
    INTO v_fabrics
    FROM (
      SELECT
        sm.colorway_material_id AS fabric_line_id,
        sm.colorway_id,
        cw.name AS color_name,
        sm.id AS style_material_id,
        COALESCE(NULLIF(trim(cm.name), ''), ft.name) AS fabric_name,
        ft.name AS fabric_type,
        CASE
          WHEN cm.id IS NULL THEN NULL
          WHEN lower(trim(cm.category)) IN ('fabric', 'trim')
            THEN NULLIF(trim(cm.extras->>'fabricCategory'), '')
          ELSE COALESCE(
            NULLIF(trim(cm.category), ''),
            NULLIF(trim(cm.extras->>'fabricCategory'), '')
          )
        END AS fabric_category,
        cm.total_cons AS required_m,
        NULLIF(trim(COALESCE(cm.unit, cm.extras->>'unit', '')), '') AS uom,
        0 AS rolls_at_mill,
        0::numeric AS qty_at_mill,
        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS rolls_in_transit,
        COALESCE((SELECT sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.status = 'in_transit'), 0) AS qty_in_transit,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'
        ), 0) AS rolls_awaiting_test,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'pending_qc'
        ), 0) AS qty_awaiting_test,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)
        ), 0) AS rolls_receiving,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND public._mm_loc_is_under(u.current_location_id, v_wh) AND public._mm_is_unassigned_loc(u.current_location_id)
        ), 0) AS qty_receiving,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND public._mm_is_pickable_loc(u.current_location_id)
            AND public._mm_loc_is_under(u.current_location_id, v_wh)
        ), 0) AS rolls_racked,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_stock'
            AND public._mm_is_pickable_loc(u.current_location_id)
            AND public._mm_loc_is_under(u.current_location_id, v_wh)
        ), 0) AS qty_racked,
        COALESCE((
          SELECT count(*)::int FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND public._mm_loc_is_under(u.current_location_id, v_cut)
        ), 0) AS rolls_issued,
        COALESCE((
          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND public._mm_loc_is_under(u.current_location_id, v_cut)
        ), 0) AS qty_issued
      FROM public.mm_style_materials sm
      JOIN public.colorways cw ON cw.id = sm.colorway_id
      JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
      LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      WHERE sm.factory_id = v_factory AND sm.order_id = p_order_id
        AND (cm.id IS NULL OR cm.kind = 'Fabric')
    ) x;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'colorway_id', g.colorway_id,
    'color_name', g.color_name,
    'fabric_count', g.fabric_count,
    'required_m', g.required_m,
    'qty_in_wh', g.qty_in_wh,
    'qty_racked', g.qty_racked,
    'ready', g.ready
  ) ORDER BY g.color_name), '[]'::jsonb)
  INTO v_colors
  FROM (
    SELECT
      f->>'colorway_id' AS colorway_id,
      f->>'color_name' AS color_name,
      count(*)::int AS fabric_count,
      COALESCE(sum((f->>'required_m')::numeric), 0) AS required_m,
      COALESCE(sum(COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)), 0) AS qty_in_wh,
      COALESCE(sum((f->>'qty_racked')::numeric), 0) AS qty_racked,
      bool_and(
        CASE
          WHEN COALESCE((f->>'required_m')::numeric, 0) <= 0 THEN
            (COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)) > 0
          ELSE
            (COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0))
              >= (f->>'required_m')::numeric * 0.95
        END
      ) AS ready
    FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f
    GROUP BY f->>'colorway_id', f->>'color_name'
  ) g;

  SELECT COALESCE(jsonb_agg(c.obj ORDER BY c.sort_ts DESC NULLS LAST), '[]'::jsonb)
  INTO v_challans
  FROM (
    SELECT
      jsonb_build_object(
        'kind', 'inbound',
        'origin', c.source,
        'id', c.id,
        'challan_no', c.challan_no,
        'status', c.status,
        'sent_at', c.sent_at,
        'received_at', c.received_at,
        'color_name', (public._mm_challan_header(c)->>'color_name'),
        'fabric_name', (public._mm_challan_header(c)->>'fabric_name'),
        'fabric_category', (public._mm_challan_header(c)->>'fabric_category'),
        'roll_count', (public._mm_challan_header(c)->>'roll_count')::int,
        'qty', (public._mm_challan_header(c)->>'qty')::numeric,
        'uom', public._mm_challan_header(c)->>'uom'
      ) AS obj,
      COALESCE(c.sent_at, c.received_at, c.created_at) AS sort_ts
    FROM public.mm_in_challans c
    JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
    WHERE c.factory_id = v_factory AND sm.order_id = p_order_id
    UNION ALL
    SELECT
      jsonb_build_object(
        'kind', 'store',
        'origin', 'store',
        'id', sc.id,
        'challan_no', sc.challan_no,
        'status', sc.status,
        'sent_at', sc.sent_at,
        'received_at', sc.received_at,
        'color_name', cw.name,
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
        'roll_count', (SELECT count(*)::int FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id),
        'qty', (SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u WHERE u.store_challan_id = sc.id),
        'uom', (
          SELECT NULLIF(trim(u.uom), '') FROM public.mm_stock_units u
          WHERE u.store_challan_id = sc.id LIMIT 1
        )
      ) AS obj,
      COALESCE(sc.sent_at, sc.received_at, sc.created_at) AS sort_ts
    FROM public.mm_store_challans sc
    JOIN public.mm_style_materials sm ON sm.id = sc.style_material_id
    JOIN public.colorways cw ON cw.id = sm.colorway_id
    JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
    LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
    WHERE sc.factory_id = v_factory AND sm.order_id = p_order_id
  ) c;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', u.id,
    'unit_code', u.unit_code,
    'length_m', u.length_m,
    'weight_kg', u.weight_kg,
    'shade', u.shade,
    'lot_no', u.lot_no,
    'attributes', u.attributes,
    'mill_snapshot', u.mill_snapshot,
    'source', u.source,
    'status', u.status,
    'qc_result', u.qc_result,
    'in_challan_id', u.in_challan_id,
    'store_challan_id', u.store_challan_id,
    'color_name', cw.name,
    'fabric_name', COALESCE(NULLIF(trim(cm.name), ''), ft.name),
    'fabric_type', ft.name,
    'fabric_type_id', ft.id,
    'location_code', loc.code,
    'location_name', loc.name,
    'bucket', CASE
      WHEN u.status = 'draft' THEN 'mill'
      WHEN u.status = 'in_transit' THEN 'transit'
      WHEN u.status = 'pending_qc' THEN 'testing'
      WHEN u.status = 'rejected' OR COALESCE(loc.location_type, '') = 'rejected' THEN 'rejected'
      WHEN public._mm_loc_is_under(u.current_location_id, v_cut) THEN 'issued'
      WHEN public._mm_is_pickable_loc(u.current_location_id) THEN 'racked'
      ELSE 'receiving'
    END
  ) ORDER BY cw.name, COALESCE(NULLIF(trim(cm.name), ''), ft.name), u.unit_code), '[]'::jsonb)
  INTO v_rolls
  FROM public.mm_stock_units u
  JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
  JOIN public.colorways cw ON cw.id = sm.colorway_id
  JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
  LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
  LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
  WHERE u.factory_id = v_factory AND sm.order_id = p_order_id;

  SELECT
    COALESCE(sum(GREATEST(COALESCE((f->>'required_m')::numeric, 0), 0)), 0),
    COALESCE(sum(COALESCE((f->>'qty_receiving')::numeric, 0) + COALESCE((f->>'qty_racked')::numeric, 0)), 0),
    COALESCE(sum(COALESCE((f->>'qty_racked')::numeric, 0)), 0),
    COALESCE(sum(COALESCE((f->>'qty_in_transit')::numeric, 0)), 0)
  INTO v_cover, v_wh_qty, v_rack_qty, v_transit_qty
  FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f;
  IF v_cover > 0 THEN
    v_cover := LEAST(1, v_wh_qty / v_cover);
  ELSIF v_wh_qty > 0 THEN
    v_cover := 1;
  ELSE
    v_cover := 0;
  END IF;

  IF v_wh_qty > 0 THEN
    v_putaway := LEAST(1, v_rack_qty / v_wh_qty);
  ELSE
    v_putaway := 0;
  END IF;

  SELECT COALESCE(count(*), 0), COALESCE(count(*) FILTER (WHERE (c->>'ready')::boolean), 0)
  INTO v_colors_total, v_colors_ready
  FROM jsonb_array_elements(COALESCE(v_colors, '[]'::jsonb)) c;

  v_score := round(
    (v_cover * 70)
    + (v_putaway * 20)
    + (CASE WHEN v_colors_total > 0 THEN (v_colors_ready::numeric / v_colors_total) * 10 ELSE 0 END)
  )::int;

  IF v_score = 0 AND COALESCE(v_wh_qty, 0) = 0 AND COALESCE(v_transit_qty, 0) = 0 THEN
    v_label := 'Not started';
  ELSIF v_cover >= 0.9 AND v_putaway >= 0.8 THEN
    v_label := 'Ready for cutting';
  ELSIF v_cover < 0.5 THEN
    v_label := 'Material inbound';
  ELSIF v_putaway < 0.5 THEN
    v_label := 'Receiving';
  ELSE
    v_label := 'In warehouse';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type_id', t.type_id,
    'fields', t.fields
  ) ORDER BY t.type_id), '[]'::jsonb)
  INTO v_test_fields
  FROM (
    SELECT
      f.type_id,
      jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options
      ) ORDER BY f.seq, f.label) AS fields
    FROM public.mm_type_test_fields f
    WHERE f.factory_id = v_factory AND f.is_active
      AND f.type_id IN (
        SELECT DISTINCT sm.fabric_type_id
        FROM public.mm_style_materials sm
        WHERE sm.factory_id = v_factory AND sm.order_id = p_order_id AND sm.fabric_type_id IS NOT NULL
      )
    GROUP BY f.type_id
  ) t;

  RETURN public._mm_ok(jsonb_build_object(
    'order', v_order,
    'fabrics', COALESCE(v_fabrics, '[]'::jsonb),
    'colors', COALESCE(v_colors, '[]'::jsonb),
    'challans', COALESCE(v_challans, '[]'::jsonb),
    'rolls', COALESCE(v_rolls, '[]'::jsonb),
    'test_fields', COALESCE(v_test_fields, '[]'::jsonb),
    'readiness', jsonb_build_object(
      'score', v_score,
      'label', v_label,
      'coverage_pct', round(v_cover * 100),
      'putaway_pct', round(v_putaway * 100),
      'colors_total', v_colors_total,
      'colors_ready', v_colors_ready,
      'qty_in_wh', COALESCE(v_wh_qty, 0),
      'qty_racked', COALESCE(v_rack_qty, 0),
      'qty_in_transit', COALESCE(v_transit_qty, 0),
      'qty_awaiting_test', COALESCE((
        SELECT sum(COALESCE((f->>'qty_awaiting_test')::numeric, 0))
        FROM jsonb_array_elements(COALESCE(v_fabrics, '[]'::jsonb)) f
      ), 0)
    )
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_get_style_warehouse(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_style_warehouse(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
