-- Mill fabric short-close needs a reason. Mill-side allocate binds draft
-- General PO mill rolls to a style before warehouse stock exists.
-- Mill stock shade was missing from the list RPC. Process-out rolls
-- must not count as waiting at mill.

ALTER TABLE public.colorway_materials
  ADD COLUMN IF NOT EXISTS mill_short_closed_reason text;

COMMENT ON COLUMN public.colorway_materials.mill_short_closed_reason IS
  'Why mill dispatch was short-closed. Cleared when short close is cancelled.';

DROP FUNCTION IF EXISTS public.mm_set_mill_short_close(uuid, uuid, uuid, boolean);

CREATE OR REPLACE FUNCTION public.mm_set_mill_short_close(
  p_order_id uuid,
  p_colorway_id uuid,
  p_colorway_material_id uuid,
  p_closed boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_closed boolean;
  v_reason text;
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
  IF p_order_id IS NULL OR p_colorway_id IS NULL OR p_colorway_material_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Style, color, and fabric are required');
  END IF;
  v_closed := COALESCE(p_closed, false);
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_closed AND v_reason IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A short close needs a reason');
  END IF;
  UPDATE public.colorway_materials cm SET
    mill_short_closed = v_closed,
    mill_short_closed_at = CASE WHEN v_closed THEN now() ELSE NULL END,
    mill_short_closed_by = CASE WHEN v_closed THEN public._mm_actor_id() ELSE NULL END,
    mill_short_closed_reason = CASE WHEN v_closed THEN left(v_reason, 400) ELSE NULL END,
    updated_at = now()
  WHERE cm.id = p_colorway_material_id
    AND cm.factory_id = v_factory
    AND cm.order_id = p_order_id
    AND cm.colorway_id = p_colorway_id;
  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric line not found');
  END IF;
  RETURN public._mm_ok(jsonb_build_object(
    'mill_short_closed', v_closed,
    'mill_short_closed_reason', CASE WHEN v_closed THEN left(v_reason, 400) ELSE NULL END
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_set_mill_short_close(uuid, uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_set_mill_short_close(uuid, uuid, uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mm_allocate_mill_rolls_to_style(
  p_unit_ids uuid[],
  p_order_id uuid,
  p_colorway_id uuid,
  p_colorway_material_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_sm jsonb;
  v_sm_id uuid;
  v_ft uuid;
  v_uid uuid;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_n integer := 0;
  v_qty numeric := 0;
  v_have numeric := 0;
  v_required numeric := 0;
  v_style text;
  v_batch uuid;
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
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to assign');
  END IF;
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm_id;
  SELECT style_name INTO v_style FROM public.style_orders WHERE id = p_order_id;
  SELECT COALESCE(cm.total_cons, 0) INTO v_required
  FROM public.colorway_materials cm WHERE cm.id = p_colorway_material_id;

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_roll FROM public.mm_mill_rolls
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_roll.style_material_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'Select only General PO rolls');
    END IF;
    IF v_roll.status IS DISTINCT FROM 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'Assign only rolls still at the mill');
    END IF;
    IF public._mm_mill_at_process(v_roll.id) THEN
      RETURN public._mm_err('AT_PROCESS', 'A selected roll is at a process vendor');
    END IF;
    IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Fabric type must match the style fabric');
    END IF;
    UPDATE public.mm_mill_rolls SET
      style_material_id = v_sm_id,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    WHERE id = v_roll.id;
    v_n := v_n + 1;
    v_qty := v_qty + COALESCE(v_roll.length_m, 0);
  END LOOP;

  FOR v_batch IN
    SELECT DISTINCT mill_batch_id
    FROM public.mm_mill_rolls
    WHERE factory_id = v_factory AND id = ANY (p_unit_ids)
  LOOP
    UPDATE public.mm_mill_batches b SET
      style_material_id = v_sm_id,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
    WHERE b.id = v_batch
      AND b.factory_id = v_factory
      AND b.style_material_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.mm_mill_rolls r
        WHERE r.mill_batch_id = b.id AND r.style_material_id IS NULL
      );
  END LOOP;

  SELECT COALESCE(sum(r.length_m), 0) INTO v_have
  FROM public.mm_mill_rolls r
  WHERE r.style_material_id = v_sm_id;

  RETURN public._mm_ok(jsonb_build_object(
    'count', v_n,
    'qty', v_qty,
    'style_material_id', v_sm_id,
    'over_allocated', (v_required > 0 AND v_have > v_required),
    'warnings', CASE
      WHEN v_required > 0 AND v_have > v_required THEN jsonb_build_array('over_required')
      ELSE '[]'::jsonb
    END
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_allocate_mill_rolls_to_style(uuid[], uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_allocate_mill_rolls_to_style(uuid[], uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mm_get_mill_line(p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_short_reason text;
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
        'SELECT COALESCE(cm.mill_short_closed, false), NULLIF(btrim(cm.mill_short_closed_reason), '''')
         FROM public.colorway_materials cm
         WHERE cm.id = $1 AND cm.factory_id = $2 AND cm.order_id = $3 AND cm.colorway_id = $4'
      INTO v_short_closed, v_short_reason
      USING p_colorway_material_id, v_factory, p_order_id, p_colorway_id;
    EXCEPTION WHEN OTHERS THEN
      v_short_closed := false;
      v_short_reason := NULL;
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

  v_sm := public._mm_lookup_style_material_id(
    v_factory, p_order_id, p_colorway_id, p_colorway_material_id, v_type_id
  );

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
    'mill_short_closed_reason', v_short_reason,
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
        'remarks', b.remarks, 'row_version', b.row_version,
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
            AND NOT public._mm_mill_at_process(r.id)
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
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id))
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      LEFT JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
      WHERE r.factory_id = v_factory AND r.style_material_id = v_sm
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_unallocated_mill()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object(
    'batches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'batch_no', b.batch_no,
        'mill_ref', b.mill_ref,
        'production_date', b.production_date,
        'remarks', b.remarks, 'row_version', b.row_version,
        'fabric_type_id', b.fabric_type_id,
        'fabric_type', ft.name,
        'roll_count', (SELECT count(*) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'qty_m', (SELECT COALESCE(sum(r.length_m), 0) FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id),
        'at_mill_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'draft' AND r.in_challan_id IS NULL
            AND NOT public._mm_mill_at_process(r.id)
        ),
        'dispatched_count', (
          SELECT count(*) FROM public.mm_mill_rolls r
          WHERE r.mill_batch_id = b.id AND r.status = 'dispatched'
        )
      ) ORDER BY b.production_date DESC, b.created_at DESC)
      FROM public.mm_mill_batches b
      JOIN public.mm_fabric_types ft ON ft.id = b.fabric_type_id
      WHERE b.factory_id = v_factory AND b.style_material_id IS NULL
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
        'color_ref', r.color_ref,
        'attributes', r.attributes,
        'status', r.status,
        'fabric_type_id', r.fabric_type_id,
        'fabric_type', ft.name,
        'in_challan_id', r.in_challan_id,
        'challan_no', c.challan_no,
        'challan_status', c.status,
        'challan_reference_no', c.reference_no,
        'challan_sent_at', c.sent_at,
        'challan_received_at', c.received_at,
        'challan_to_location', c.to_location,
        'at_mill', (r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id))
      ) ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) DESC, r.created_at, r.unit_code)
      FROM public.mm_mill_rolls r
      JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
      JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
      LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
      WHERE r.factory_id = v_factory AND r.style_material_id IS NULL
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_mill_stock(p_search text DEFAULT NULL::text, p_alloc text DEFAULT NULL::text, p_place text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_search text;
  v_alloc text;
  v_place text;
  v_page integer;
  v_size integer;
  v_total integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_search := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_alloc := COALESCE(NULLIF(btrim(COALESCE(p_alloc, '')), ''), '');
  v_place := COALESCE(NULLIF(btrim(COALESCE(p_place, '')), ''), '');
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);

  SELECT count(*) INTO v_total
  FROM public.mm_mill_rolls r
  JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
  JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
  WHERE r.factory_id = v_factory
    AND (
      (r.status = 'draft' AND r.in_challan_id IS NULL)
      OR (c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
      OR EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      )
    )
    AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
    AND (
      v_place = ''
      OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) OR (v_place = 'at_process' AND public._mm_mill_at_process(r.id))
      OR (v_place = 'in_transit' AND c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
      OR (v_place = 'missing_wh' AND EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      ))
    )
    AND (
      v_search IS NULL
      OR lower(concat_ws(' ', r.unit_code, b.batch_no, ft.name, o.style_name, r.color_ref, r.lot_no, r.shade)) LIKE '%' || v_search || '%'
    );

  RETURN public._mm_ok(jsonb_build_object(
    'total', v_total,
    'rows', COALESCE((
      SELECT jsonb_agg(x.obj)
      FROM (
        SELECT jsonb_build_object(
          'id', r.id,
          'unit_code', r.unit_code,
          'mill_batch_id', r.mill_batch_id,
          'batch_no', b.batch_no,
          'fabric_type', ft.name,
          'color_ref', r.color_ref,
          'shade', r.shade,
          'lot_no', r.lot_no,
          'length_m', r.length_m,
          'style_material_id', r.style_material_id,
          'style_name', o.style_name,
          'order_id', sm.order_id,
          'colorway_id', sm.colorway_id,
          'fabric_line_id', sm.colorway_material_id,
          'process_challan_id', (
            SELECT l.challan_id FROM public.mm_process_out_lines l
            WHERE l.mill_roll_id = r.id AND l.line_status = 'out'
            LIMIT 1
          ), 'place', CASE
            WHEN EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      ) THEN 'missing_wh'
            WHEN public._mm_mill_at_process(r.id) THEN 'at_process' WHEN r.status = 'draft' AND r.in_challan_id IS NULL THEN 'at_mill'
            ELSE 'in_transit'
          END
        ) AS obj
        FROM public.mm_mill_rolls r
        JOIN public.mm_mill_batches b ON b.id = r.mill_batch_id
        JOIN public.mm_fabric_types ft ON ft.id = r.fabric_type_id
        LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
        LEFT JOIN public.style_orders o ON o.id = sm.order_id
        LEFT JOIN public.mm_in_challans c ON c.id = r.in_challan_id
        WHERE r.factory_id = v_factory
          AND (
            (r.status = 'draft' AND r.in_challan_id IS NULL)
            OR (c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
            OR EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      )
          )
          AND (v_alloc = '' OR (v_alloc = 'allocated' AND r.style_material_id IS NOT NULL) OR (v_alloc = 'general' AND r.style_material_id IS NULL))
          AND (
            v_place = ''
            OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) OR (v_place = 'at_process' AND public._mm_mill_at_process(r.id))
            OR (v_place = 'in_transit' AND c.id IS NOT NULL AND c.status IN ('pending', 'in_transit'))
      OR (v_place = 'missing_wh' AND EXISTS (
        SELECT 1 FROM public.mm_stock_units u
        WHERE u.mill_roll_id = r.id AND u.factory_id = v_factory AND u.status = 'missing'
      ))
          )
          AND (
            v_search IS NULL
            OR lower(concat_ws(' ', r.unit_code, b.batch_no, ft.name, o.style_name, r.color_ref, r.lot_no, r.shade)) LIKE '%' || v_search || '%'
          )
        ORDER BY (r.status = 'draft' AND r.in_challan_id IS NULL) DESC, b.batch_no, r.unit_code
        OFFSET (v_page - 1) * v_size
        LIMIT v_size
      ) x
    ), '[]'::jsonb)
  ));
END;
$function$;

