-- Phase 0: revoke dead material RPCs. Do not drop (Phase 8).
-- Edited from live pg_get_functiondef on 22 Sep 2026. _mm_actor_id() was not present, so auth.uid() is unchanged.
-- mm_save_vendor_in_challan stays revoked; floor vendor receive is a separate RPC (mm_save_vendor_grn), not this one.

REVOKE EXECUTE ON FUNCTION public.mm_save_vendor_in_challan(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mm_send_to_warehouse(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mm_resolve_style_material(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mm_list_warehouse_locations() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mm_save_warehouse_location(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mm_deactivate_warehouse_location(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mm_list_putaway_queue() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.mm_save_vendor_in_challan(uuid, uuid, uuid, text, jsonb) IS
  'Phase 0: execute revoked from anon, authenticated, and PUBLIC. Not used by the SPA. Drop in phase 8.';
COMMENT ON FUNCTION public.mm_send_to_warehouse(uuid, uuid, uuid, jsonb) IS
  'Phase 0: execute revoked from anon, authenticated, and PUBLIC. Not used by the SPA. Drop in phase 8.';
COMMENT ON FUNCTION public.mm_resolve_style_material(uuid, uuid, uuid) IS
  'Phase 0: execute revoked from anon, authenticated, and PUBLIC. Still called inside security-definer mm_save_mill_batch and mm_allocate_rolls_to_style. Drop in phase 8.';
COMMENT ON FUNCTION public.mm_list_warehouse_locations() IS
  'Phase 0: execute revoked from anon, authenticated, and PUBLIC. Replaced by rack master. Drop in phase 8.';
COMMENT ON FUNCTION public.mm_save_warehouse_location(jsonb) IS
  'Phase 0: execute revoked from anon, authenticated, and PUBLIC. Replaced by rack master. Drop in phase 8.';
COMMENT ON FUNCTION public.mm_deactivate_warehouse_location(uuid) IS
  'Phase 0: execute revoked from anon, authenticated, and PUBLIC. Replaced by rack master. Drop in phase 8.';
COMMENT ON FUNCTION public.mm_list_putaway_queue() IS
  'Phase 0: execute revoked from anon, authenticated, and PUBLIC. Not used by the SPA. Drop in phase 8.';

CREATE OR REPLACE FUNCTION public.mm_allocate_rolls_to_style(p_unit_ids uuid[], p_order_id uuid, p_colorway_id uuid, p_colorway_material_id uuid)
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
  v_wh uuid;
  v_cut uuid;
  v_uid uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
  v_qty numeric := 0;
  v_have numeric := 0;
  v_required numeric := 0;
  v_style text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_unit_ids IS NULL OR COALESCE(array_length(p_unit_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls to allocate');
  END IF;
  v_sm := public.mm_resolve_style_material(p_order_id, p_colorway_id, p_colorway_material_id);
  IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
  v_sm_id := (v_sm->'data'->>'id')::uuid;
  SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm_id;
  SELECT style_name INTO v_style FROM public.style_orders WHERE id = p_order_id;
  SELECT COALESCE(cm.total_cons, 0) INTO v_required
  FROM public.colorway_materials cm WHERE cm.id = p_colorway_material_id;
  PERFORM public._mm_seed_ops_locations(v_factory, auth.uid());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

  FOREACH v_uid IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = v_uid AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    IF v_unit.style_material_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'Select only unallocated rolls');
    END IF;
    IF v_unit.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Fabric type must match the style fabric');
    END IF;
    IF NOT public._mm_unit_alloc_ok(v_unit.status, v_unit.current_location_id, v_unit.store_challan_id, v_wh, v_cut) THEN
      RETURN public._mm_err('INVALID', 'Allocate only rolls in warehouse receiving, rack, test, or red label');
    END IF;
    UPDATE public.mm_stock_units SET
      style_material_id = v_sm_id,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_unit.id;
    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = v_sm_id,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = auth.uid()
      WHERE id = v_unit.mill_roll_id AND factory_id = v_factory;
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'ALLOCATE', 0, v_unit.status, v_unit.status,
      v_unit.current_location_id, v_unit.current_location_id,
      'mm_style_materials', v_sm_id, 'Allocated to ' || COALESCE(v_style, 'style')
    );
    v_n := v_n + 1;
    v_qty := v_qty + COALESCE(v_unit.length_m, 0);
  END LOOP;

  SELECT COALESCE(sum(u.length_m), 0) INTO v_have
  FROM public.mm_stock_units u
  WHERE u.style_material_id = v_sm_id
    AND (
      u.status = 'pending_qc'
      OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
      OR public._mm_loc_is_under(u.current_location_id, v_cut)
    );

  RETURN public._mm_ok(jsonb_build_object(
    'count', v_n,
    'style_material_id', v_sm_id,
    'over_allocated', (v_have > v_required),
    'warnings', CASE
      WHEN v_have > v_required THEN jsonb_build_array('over_required')
      ELSE '[]'::jsonb
    END
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_list_warehouse_stock(p_search text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_buyer text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_wh uuid;
  v_cut uuid;
  v_q text;
  v_loc text;
  v_buyer text;
  v_page integer;
  v_size integer;
  v_off integer;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  v_q := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_loc := COALESCE(NULLIF(btrim(COALESCE(p_location, '')), ''), 'warehouse');
  v_buyer := NULLIF(btrim(COALESCE(p_buyer, '')), '');
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
  v_off := (v_page - 1) * v_size;

  RETURN public._mm_ok((
    WITH units AS (
      SELECT
        u.id,
        u.unit_code,
        u.length_m,
        u.uom,
        u.status,
        u.in_challan_id,
        u.store_challan_id,
        u.style_material_id,
        u.fabric_type_id,
        u.color_ref,
        u.shade,
        u.lot_no,
        public._mm_stock_location_bucket(u.status, u.current_location_id, v_wh, v_cut) AS bucket,
        loc.code AS location_code,
        loc.name AS location_name,
        o.id AS order_id,
        o.style_name,
        o.style_ref,
        o.buyer_name,
        o.po_number,
        cw.name AS color_name,
        COALESCE(NULLIF(trim(cm.name), ''), ft.name) AS fabric_name,
        ft.name AS fabric_type,
        c.challan_no,
        c.source AS challan_source,
        COALESCE(c.received_at, u.created_at) AS received_at
      FROM public.mm_stock_units u
      JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
      LEFT JOIN public.style_orders o ON o.id = sm.order_id
      LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
      LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
      LEFT JOIN public.mm_locations loc ON loc.id = u.current_location_id
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      WHERE u.factory_id = v_factory
    ),
    scoped AS (
      SELECT *
      FROM units
      WHERE bucket <> 'other'
        AND (
          CASE v_loc
            WHEN 'warehouse' THEN bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
            WHEN 'pending_test' THEN bucket = 'pending_test'
            WHEN 'receiving' THEN bucket = 'receiving'
            WHEN 'rack' THEN bucket = 'rack'
            WHEN 'red_label' THEN bucket = 'red_label'
            WHEN 'cutting' THEN bucket = 'cutting'
            WHEN 'unallocated' THEN
              bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
              AND style_material_id IS NULL
            ELSE bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
          END
        )
        AND (v_buyer IS NULL OR buyer_name = v_buyer)
        AND (
          v_q IS NULL OR concat_ws(' ',
            unit_code, style_name, style_ref, buyer_name, po_number, color_name,
            fabric_name, fabric_type, location_code, location_name, challan_no, color_ref, shade, lot_no
          ) ILIKE '%' || v_q || '%'
        )
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*)::int FROM scoped),
      'counts', jsonb_build_object(
        'pending_test', (SELECT count(*)::int FROM units WHERE bucket = 'pending_test'),
        'receiving', (SELECT count(*)::int FROM units WHERE bucket = 'receiving'),
        'rack', (SELECT count(*)::int FROM units WHERE bucket = 'rack'),
        'red_label', (SELECT count(*)::int FROM units WHERE bucket = 'red_label'),
        'unallocated', (
          SELECT count(*)::int FROM units
          WHERE bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
            AND style_material_id IS NULL
        )
      ),
      'buyers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', b.name) ORDER BY b.name)
        FROM (
          SELECT DISTINCT buyer_name AS name
          FROM units
          WHERE bucket IN ('pending_test', 'receiving', 'rack', 'red_label')
            AND NULLIF(trim(buyer_name), '') IS NOT NULL
        ) b
      ), '[]'::jsonb),
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id,
          'unit_code', s.unit_code,
          'qty', s.length_m,
          'uom', s.uom,
          'status', s.status,
          'bucket', s.bucket,
          'status_label', public._mm_stock_location_label(s.bucket),
          'location_code', s.location_code,
          'location_name', s.location_name,
          'order_id', s.order_id,
          'style_material_id', s.style_material_id,
          'style_name', COALESCE(s.style_name, 'Unallocated'),
          'style_ref', s.style_ref,
          'buyer_name', s.buyer_name,
          'po_number', s.po_number,
          'color_name', s.color_name,
          'color_ref', s.color_ref,
          'shade', s.shade,
          'lot_no', s.lot_no,
          'fabric_name', s.fabric_name,
          'fabric_type', s.fabric_type,
          'fabric_type_id', s.fabric_type_id,
          'in_challan_id', s.in_challan_id,
          'challan_no', s.challan_no,
          'challan_source', s.challan_source,
          'store_challan_id', s.store_challan_id,
          'received_at', s.received_at
        ) ORDER BY s.received_at DESC NULLS LAST, s.unit_code)
        FROM (
          SELECT * FROM scoped
          ORDER BY received_at DESC NULLS LAST, unit_code
          OFFSET v_off LIMIT v_size
        ) s
      ), '[]'::jsonb)
    )
  ));
END;
$function$;

NOTIFY pgrst, 'reload schema';
;
