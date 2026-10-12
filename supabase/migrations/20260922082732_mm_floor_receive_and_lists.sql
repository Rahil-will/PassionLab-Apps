CREATE OR REPLACE FUNCTION public.mm_confirm_received_lengths(p_challan_id uuid, p_lengths jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_row jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
  v_measured numeric;
  v_current numeric;
  v_delta numeric;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans
  WHERE id = p_challan_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_lengths, '[]'::jsonb)) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = NULLIF(v_row->>'unit_id', '')::uuid
      AND factory_id = v_factory
      AND in_challan_id = v_ch.id
    FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('INVALID', 'Roll is not on this challan'); END IF;
    v_measured := COALESCE(NULLIF(v_row->>'length', '')::numeric, NULLIF(v_row->>'length_m', '')::numeric);
    IF v_measured IS NULL OR v_measured < 0 THEN
      RETURN public._mm_err('REQUIRED', 'Measured length is required');
    END IF;
    v_current := COALESCE(public._mm_unit_on_hand(v_unit), 0);
    v_delta := v_measured - v_current;
    IF abs(v_delta) > 0.0001 THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id,
        CASE WHEN v_delta < 0 THEN 'QC_DEDUCT' ELSE 'ADJUST_PLUS' END,
        v_delta,
        v_unit.status, v_unit.status,
        v_unit.current_location_id, v_unit.current_location_id,
        'mm_in_challans', v_ch.id, 'length confirmed at receive'
      );
      PERFORM public._mm_set_on_hand(v_unit.id, v_measured, true);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  PERFORM public._mm_apply_clearance(ARRAY(
    SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id
  ));
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'adjusted', v_n));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_floor(
  p_id uuid,
  p_roll_edits jsonb,
  p_row_version integer,
  p_missing_unit_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_has boolean;
BEGIN
  IF COALESCE(cardinality(p_missing_unit_ids), 0) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'mm_receive_mill_in_challan'
        AND pg_get_function_identity_arguments(p.oid) LIKE '%p_missing_unit_ids%'
    ) INTO v_has;
    IF NOT v_has THEN
      RETURN public._mm_err('WAITING_P4', 'Partial receive is not available yet');
    END IF;
    RETURN public.mm_receive_mill_in_challan(p_id, p_roll_edits, p_row_version, p_missing_unit_ids);
  END IF;
  RETURN public.mm_receive_mill_in_challan(p_id, p_roll_edits, p_row_version);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_floor_grns(p_source text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
    FROM (
      SELECT c.id, c.challan_no, c.grn_no, c.invoice_ref, c.reference_no, c.source,
             c.status, c.supplier_name, c.style_material_id, c.created_at, c.received_at,
             (SELECT count(*) FROM public.mm_stock_units u WHERE u.in_challan_id = c.id) AS roll_count,
             (SELECT count(*) FROM public.mm_stock_units u
               WHERE u.in_challan_id = c.id
                 AND COALESCE((public._mm_unit_clearance(u.id)->>'cleared')::boolean, false)
             ) AS cleared_count
      FROM public.mm_in_challans c
      WHERE c.factory_id = v_factory
        AND (p_source IS NULL OR c.source = p_source)
      ORDER BY c.created_at DESC
      LIMIT 40
    ) x
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_receive_catalog()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object(
    'fabric_types', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'code', t.code) ORDER BY t.name)
      FROM public.mm_fabric_types t
      WHERE t.factory_id = v_factory AND t.is_active
    ), '[]'::jsonb)
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_inspection_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb)
    FROM (
      SELECT u.id, u.unit_code, u.source, u.status, u.length_m, u.declared_width_in,
             u.color_ref, u.lot_no, u.attributes, u.style_material_id, u.in_challan_id,
             c.challan_no, c.grn_no, c.invoice_ref, c.supplier_name,
             public._mm_unit_clearance(u.id) AS clearance,
             public._mm_unit_on_hold(u.id) AS on_hold
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      WHERE u.factory_id = v_factory
        AND u.status IN ('pending_qc', 'in_stock')
        AND NOT public._mm_unit_on_hold(u.id)
        AND COALESCE((public._mm_unit_clearance(u.id)->>'cleared')::boolean, false) = false
      ORDER BY u.created_at DESC
      LIMIT 200
    ) x
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_floor_gaps()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_on boolean := false;
BEGIN
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR public._mm_actor_id() IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  BEGIN
    PERFORM public.assert_module_enabled('material');
    v_on := true;
  EXCEPTION WHEN OTHERS THEN
    v_on := false;
  END;
  RETURN public._mm_ok(jsonb_build_object(
    'module_on', v_on,
    'p1_on_hand', EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_mm_is_on_hand'),
    'p2_qty', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_stock_units' AND column_name='qty_available'),
    'p3_defects', EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mm_inspection_defects'),
    'p4_lines', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_in_challan_lines' AND column_name='line_status'),
    'p5_hold', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mm_stock_units' AND column_name='on_hold'),
    'issued_status', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'mm_stock_units_status_chk'
        AND pg_get_constraintdef(oid) LIKE '%issued%'
    )
  ));
END;
$fn$;;
