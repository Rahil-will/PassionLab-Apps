CREATE OR REPLACE FUNCTION public.mm_list_warehouse_stock(
  p_search text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_buyer text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
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
            fabric_name, fabric_type, location_code, location_name, challan_no, color_ref, lot_no
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
$fn$;;
