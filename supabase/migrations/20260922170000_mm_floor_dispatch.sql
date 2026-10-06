-- Floor dispatch, vendor GRN helpers already applied in 20260922160000 companions,
-- mill confirm, inspection queue, cutting consumption, mm_floor_call.
-- Applied against the live project after pg_get_functiondef of the functions it replaces.

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
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.seq, t.name)
    FROM public.mm_fabric_types t
    WHERE t.factory_id = v_factory AND t.is_active
  ), '[]'::jsonb));
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
  v_out jsonb;
BEGIN
  IF COALESCE(cardinality(p_missing_unit_ids), 0) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'mm_receive_mill_in_challan'
        AND pg_get_function_identity_arguments(p.oid) LIKE '%p_missing_unit_ids%'
    ) INTO v_has;
    IF NOT v_has THEN
      RETURN public._mm_err('WAITING_P4', 'Partial receive is not available yet');
    END IF;
    EXECUTE 'SELECT public.mm_receive_mill_in_challan($1, $2, $3, $4)'
      INTO v_out
      USING p_id, p_roll_edits, p_row_version, p_missing_unit_ids;
    RETURN v_out;
  END IF;
  RETURN public.mm_receive_mill_in_challan(p_id, p_roll_edits, p_row_version);
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_store_line_missing(p_unit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_missing boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mm_store_challan_lines'
      AND column_name = 'line_status'
  ) THEN
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM public.mm_store_challan_lines WHERE stock_unit_id = $1 AND line_status = ''missing'')'
      INTO v_missing
      USING p_unit_id;
  END IF;
  RETURN COALESCE(v_missing, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_exclude_roll(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_has boolean;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'on_hold'
  ) INTO v_has;
  IF NOT v_has THEN
    RETURN public._mm_err('WAITING_P5', 'Hold is not available yet');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mm_stock_units u
    WHERE u.id = p_unit_id AND u.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Roll not found');
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'hold_reason'
  ) THEN
    EXECUTE
      'UPDATE public.mm_stock_units SET on_hold = true, hold_reason = $2, updated_at = now(), updated_by = public._mm_actor_id() WHERE id = $1 AND factory_id = $3'
      USING p_unit_id, 'excluded at inspection', v_factory;
  ELSE
    EXECUTE
      'UPDATE public.mm_stock_units SET on_hold = true, updated_at = now(), updated_by = public._mm_actor_id() WHERE id = $1 AND factory_id = $2'
      USING p_unit_id, v_factory;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_unit_id, 'on_hold', true));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_list_cutting_rolls(
  p_order_id uuid,
  p_colorway_id uuid,
  p_style_material_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_cut uuid;
  v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_actor IS NULL OR v_factory IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', u.id,
      'unit_code', u.unit_code,
      'roll_no', COALESCE(u.attributes->>'roll_no', u.unit_code),
      'lot_no', u.lot_no,
      'width_in', u.declared_width_in,
      'opening_qty', public._mm_unit_on_hand(u),
      'uom', u.uom,
      'status', u.status,
      'style_material_id', u.style_material_id,
      'color_ref', u.color_ref,
      'is_remnant', u.is_remnant
    ) ORDER BY u.unit_code)
    FROM public.mm_stock_units u
    WHERE u.factory_id = v_factory
      AND public._mm_unit_on_hand(u) > 0
      AND NOT public._mm_unit_on_hold(u.id)
      AND NOT public._mm_store_line_missing(u.id)
      AND (
        u.status = 'issued'
        OR (u.status = 'in_stock' AND u.current_location_id = v_cut)
      )
      AND (
        (p_style_material_id IS NOT NULL AND u.style_material_id = p_style_material_id)
        OR (
          p_style_material_id IS NULL
          AND u.style_material_id IN (
            SELECT sm.id FROM public.mm_style_materials sm
            WHERE sm.factory_id = v_factory
              AND sm.order_id = p_order_id
              AND (p_colorway_id IS NULL OR sm.colorway_id = p_colorway_id)
          )
        )
      )
      AND (
        v_q IS NULL
        OR u.unit_code ILIKE '%' || v_q || '%'
        OR COALESCE(u.attributes->>'roll_no', '') ILIKE '%' || v_q || '%'
        OR COALESCE(u.lot_no, '') ILIKE '%' || v_q || '%'
      )
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_get_lay_report(p_lay_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
BEGIN
  v_factory := public._mm_actor_factory_id();
  IF v_factory IS NULL OR public._mm_actor_id() IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'stock_unit_id', c.stock_unit_id,
      'unit_code', u.unit_code,
      'roll_no', COALESCE(u.attributes->>'roll_no', u.unit_code),
      'plies', c.plies,
      'opening_qty', c.opening_qty,
      'used_qty', c.used_qty,
      'shortage_qty', c.shortage_qty,
      'end_bit', c.opening_qty - COALESCE(c.used_qty, 0) - COALESCE(c.shortage_qty, 0),
      'closing_qty', c.closing_qty,
      'end_bit_action', c.end_bit_action
    ) ORDER BY c.seq, u.unit_code)
    FROM public.mm_lay_unit_consumptions c
    JOIN public.mm_stock_units u ON u.id = c.stock_unit_id
    WHERE c.cutting_lay_id = p_lay_id
      AND c.factory_id = v_factory
  ), '[]'::jsonb));
END;
$fn$;
