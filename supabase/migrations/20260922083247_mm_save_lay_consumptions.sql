CREATE OR REPLACE FUNCTION public.mm_save_lay_consumptions(
  p_lay_id uuid,
  p_rows jsonb,
  p_style_material_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_role text;
  v_status text;
  v_apps jsonb;
  v_floor jsonb := '[]'::jsonb;
  v_lay public.cutting_lays%ROWTYPE;
  v_session public.cutting_sessions%ROWTYPE;
  v_sm_ids uuid[];
  v_cut uuid;
  v_recv uuid;
  v_row jsonb;
  v_unit public.mm_stock_units%ROWTYPE;
  v_old public.mm_lay_unit_consumptions%ROWTYPE;
  v_opening numeric;
  v_used numeric;
  v_short numeric;
  v_end numeric;
  v_action text;
  v_closing numeric;
  v_on numeric;
  v_consumed_ok boolean;
  v_n integer := 0;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_new_status text;
  v_new_loc uuid;
BEGIN
  v_actor := public._mm_actor_id();
  v_factory := public._mm_actor_factory_id();
  IF v_actor IS NULL OR v_factory IS NULL THEN
    RETURN public._mm_err('NO_FACTORY', 'No factory');
  END IF;
  SELECT p.user_role, p.status, COALESCE(p.assigned_apps, '[]'::jsonb)
    INTO v_role, v_status, v_apps
  FROM public.profiles p
  WHERE p.id = v_actor AND p.factory_id = v_factory;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'Active' THEN
    RETURN public._mm_err('FORBIDDEN', 'Floor user is not active');
  END IF;
  BEGIN
    v_floor := public.floor_user_derived_apps(v_actor);
  EXCEPTION WHEN OTHERS THEN
    v_floor := '[]'::jsonb;
  END;
  IF v_role NOT IN ('admin', 'superadmin')
     AND NOT (v_apps @> '["mm_inventory"]'::jsonb)
     AND NOT (COALESCE(v_floor, '[]'::jsonb) @> '["cutting"]'::jsonb)
  THEN
    RETURN public._mm_err('NO_PERMISSION', 'Cutting or inventory access is required');
  END IF;

  SELECT * INTO v_lay FROM public.cutting_lays
  WHERE id = p_lay_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Lay not found'); END IF;
  IF v_lay.bundles_generated THEN
    RETURN public._mm_err('CLOSED', 'This lay is closed');
  END IF;
  SELECT * INTO v_session FROM public.cutting_sessions
  WHERE id = v_lay.session_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Cutting session not found'); END IF;

  IF p_style_material_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_style_materials sm
      WHERE sm.id = p_style_material_id
        AND sm.factory_id = v_factory
        AND sm.order_id = v_session.order_id
        AND (v_session.colorway_id IS NULL OR sm.colorway_id = v_session.colorway_id)
    ) THEN
      RETURN public._mm_err('INVALID', 'Fabric line does not match this cut');
    END IF;
    v_sm_ids := ARRAY[p_style_material_id];
  ELSE
    SELECT COALESCE(array_agg(sm.id), ARRAY[]::uuid[]) INTO v_sm_ids
    FROM public.mm_style_materials sm
    WHERE sm.factory_id = v_factory
      AND sm.order_id = v_session.order_id
      AND (v_session.colorway_id IS NULL OR sm.colorway_id = v_session.colorway_id);
  END IF;

  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');
  v_recv := public._mm_recv_loc(v_factory);
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mm_stock_units_status_chk'
      AND pg_get_constraintdef(oid) LIKE '%consumed%'
  ) INTO v_consumed_ok;

  FOR v_old IN
    SELECT * FROM public.mm_lay_unit_consumptions
    WHERE cutting_lay_id = v_lay.id AND factory_id = v_factory
    FOR UPDATE
  LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_old.stock_unit_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('INVALID', 'Saved roll is missing');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.mm_lay_unit_consumptions later
      WHERE later.stock_unit_id = v_old.stock_unit_id
        AND later.cutting_lay_id <> v_lay.id
        AND later.recorded_at > v_old.recorded_at
    ) THEN
      RETURN public._mm_err('CONFLICT', 'A later cut already used this roll');
    END IF;
    v_on := COALESCE(public._mm_unit_on_hand(v_unit), 0);
    IF abs(v_on - v_old.closing_qty) > 0.05 THEN
      RETURN public._mm_err('CONFLICT', 'Roll balance changed since this lay was saved');
    END IF;
    IF v_old.end_bit_action = 'return'
       AND v_unit.current_location_id IS DISTINCT FROM v_recv
       AND v_unit.current_location_id IS DISTINCT FROM v_cut THEN
      RETURN public._mm_err('CONFLICT', 'This roll was put away. Move it before editing the lay');
    END IF;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'REVERSAL', v_old.opening_qty - v_old.closing_qty,
      v_unit.status, 'in_stock', v_unit.current_location_id, v_cut,
      'cutting_lays', v_lay.id, 'lay edit'
    );
    PERFORM public._mm_set_on_hand(v_unit.id, v_old.opening_qty, false);
    UPDATE public.mm_stock_units
    SET status = 'in_stock',
        current_location_id = v_cut,
        is_remnant = false,
        updated_at = now(),
        updated_by = v_actor
    WHERE id = v_unit.id;
  END LOOP;

  DELETE FROM public.mm_lay_unit_consumptions
  WHERE cutting_lay_id = v_lay.id AND factory_id = v_factory;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RETURN public._mm_err('INVALID', 'Rows are required');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units
    WHERE id = NULLIF(v_row->>'stock_unit_id', '')::uuid
      AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'Roll not found');
    END IF;
    IF v_unit.id = ANY(v_seen) THEN
      RETURN public._mm_err('INVALID', 'A roll can be picked once on a lay');
    END IF;
    v_seen := v_seen || v_unit.id;
    IF v_unit.style_material_id IS NULL OR NOT (v_unit.style_material_id = ANY(v_sm_ids)) THEN
      RETURN public._mm_err('INVALID', 'Roll is not allocated to this style');
    END IF;
    IF public._mm_unit_on_hold(v_unit.id) OR public._mm_store_line_missing(v_unit.id) THEN
      RETURN public._mm_err('INVALID', 'Roll is on hold or missing');
    END IF;
    IF NOT (
      v_unit.status = 'issued'
      OR (v_unit.status = 'in_stock' AND v_unit.current_location_id = v_cut)
    ) THEN
      RETURN public._mm_err('INVALID', 'Roll is not issued to cutting');
    END IF;

    v_opening := COALESCE(public._mm_unit_on_hand(v_unit), 0);
    IF v_opening <= 0 THEN
      RETURN public._mm_err('INVALID', 'Roll has no balance left');
    END IF;
    v_used := COALESCE(NULLIF(v_row->>'used_qty', '')::numeric, 0);
    v_short := COALESCE(NULLIF(v_row->>'shortage_qty', '')::numeric, 0);
    v_end := COALESCE(NULLIF(v_row->>'end_bit', '')::numeric, 0);
    v_action := COALESCE(NULLIF(v_row->>'end_bit_action', ''), 'continue');
    IF v_action NOT IN ('continue', 'waste', 'return') THEN
      RETURN public._mm_err('INVALID', 'End bit action must be continue, waste, or return');
    END IF;
    IF v_used < 0 OR v_short < 0 OR v_end < 0 THEN
      RETURN public._mm_err('INVALID', 'Quantities cannot be negative');
    END IF;
    IF abs((v_used + v_short + v_end) - v_opening) > 0.05 THEN
      RETURN public._mm_err('INVALID', 'Used, shortage, and end bit must equal the opening balance');
    END IF;
    v_closing := CASE WHEN v_action IN ('continue', 'return') THEN v_end ELSE 0 END;
    v_new_status := v_unit.status;
    v_new_loc := v_unit.current_location_id;

    IF v_used <> 0 THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'CONSUME', -v_used,
        v_unit.status, v_unit.status, v_unit.current_location_id, v_unit.current_location_id,
        'cutting_lays', v_lay.id, 'consume'
      );
    END IF;
    IF v_short <> 0 THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'ADJUST_MINUS', -v_short,
        v_unit.status, v_unit.status, v_unit.current_location_id, v_unit.current_location_id,
        'cutting_lays', v_lay.id, 'shortage'
      );
    END IF;
    IF v_action = 'waste' AND v_end <> 0 THEN
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'WASTE', -v_end,
        v_unit.status, v_unit.status, v_unit.current_location_id, v_unit.current_location_id,
        'cutting_lays', v_lay.id, 'waste'
      );
    END IF;
    IF v_action = 'return' THEN
      v_new_status := 'in_stock';
      v_new_loc := v_recv;
      PERFORM public._mm_ledger(
        v_factory, v_unit.id, 'RETURN_FROM_CUTTING', 0,
        v_unit.status, v_new_status, v_unit.current_location_id, v_new_loc,
        'cutting_lays', v_lay.id, 'return from cutting'
      );
    ELSIF v_closing <= 0 AND v_consumed_ok THEN
      v_new_status := 'consumed';
    END IF;

    PERFORM public._mm_set_on_hand(v_unit.id, v_closing, false);
    UPDATE public.mm_stock_units
    SET status = v_new_status,
        current_location_id = v_new_loc,
        is_remnant = (v_action = 'return'),
        updated_at = now(),
        updated_by = v_actor
    WHERE id = v_unit.id;

    v_n := v_n + 1;
    INSERT INTO public.mm_lay_unit_consumptions (
      factory_id, cutting_lay_id, stock_unit_id, seq, plies,
      opening_qty, closing_qty, used_qty, shortage_qty, end_bit_action,
      recorded_by, created_by, updated_by
    ) VALUES (
      v_factory, v_lay.id, v_unit.id, v_n,
      NULLIF(v_row->>'plies', '')::integer,
      v_opening, v_closing, v_used, v_short, v_action,
      v_actor, v_actor, v_actor
    );
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('lay_id', v_lay.id, 'rows', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_save_lay_consumptions(uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_lay_consumptions(uuid, jsonb, uuid) TO authenticated, service_role;;
