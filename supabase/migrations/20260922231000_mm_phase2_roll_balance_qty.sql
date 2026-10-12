-- Applied as mm_phase2_roll_balance_qty.
-- Phase 2: roll balance is qty_available, and only _mm_ledger changes it.
-- Existing rows already balance (qty_available = sum of ledger deltas = length_m).
-- This stops a second opening receipt from doubling a new roll, and points on-hand reads at the balance.

CREATE OR REPLACE FUNCTION public._mm_ledger(
  p_factory uuid, p_unit uuid, p_type text, p_len numeric,
  p_status_before text, p_status_after text,
  p_loc_before uuid, p_loc_after uuid,
  p_ref_table text, p_ref uuid, p_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delta numeric;
  v_before numeric;
  v_after numeric;
  v_uom text;
BEGIN
  v_delta := CASE
    WHEN p_type IN ('RECEIPT_IN', 'INHOUSE_IN', 'ADJUST_PLUS', 'REVERSAL') THEN COALESCE(p_len, 0)
    WHEN p_type IN ('CONSUME', 'WASTE', 'QC_DEDUCT', 'ADJUST_MINUS', 'RETURN_TO_SUPPLIER', 'WRITE_OFF') THEN
      CASE WHEN COALESCE(p_len, 0) > 0 THEN -p_len ELSE COALESCE(p_len, 0) END
    ELSE 0
  END;
  SELECT qty_available, COALESCE(qty_uom, 'm') INTO v_before, v_uom
  FROM public.mm_stock_units WHERE id = p_unit FOR UPDATE;
  v_before := COALESCE(v_before, 0);
  v_after := v_before + v_delta;
  IF v_after < -0.001 THEN
    RAISE EXCEPTION 'BALANCE: roll balance cannot go below zero';
  END IF;
  IF v_after < 0 THEN v_after := 0; END IF;
  PERFORM set_config('mm.ledger_write', 'on', true);
  UPDATE public.mm_stock_units
  SET qty_available = v_after,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_unit;
  INSERT INTO public.mm_stock_ledger (
    factory_id, stock_unit_id, entry_type, qty, qty_delta, qty_after, qty_uom, balance_after,
    status_before, status_after, location_before, location_after,
    ref_table, ref_id, note, actor_id, created_by
  ) VALUES (
    p_factory, p_unit, p_type, abs(COALESCE(p_len, v_delta)), v_delta, v_after, v_uom, v_after,
    p_status_before, p_status_after, p_loc_before, p_loc_after,
    p_ref_table, p_ref, p_note, public._mm_actor_id(), public._mm_actor_id()
  );
END;
$$;

COMMENT ON FUNCTION public._mm_ledger(uuid, uuid, text, numeric, text, text, uuid, uuid, text, uuid, text) IS
  'Only writer of qty_available. p_len is the quantity; the entry type sets the sign. length_m is left as the roll identity.';

CREATE OR REPLACE FUNCTION public.mm_stock_unit_qty_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.qty_available IS NULL THEN
      NEW.qty_uom := COALESCE(NEW.qty_uom, NULLIF(NEW.uom, ''), 'm');
      NEW.qty_declared := COALESCE(NEW.qty_declared, NEW.length_m, 0);
      NEW.qty_received := COALESCE(NEW.qty_received, NEW.length_m, 0);
      NEW.qty_available := 0;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.qty_available IS DISTINCT FROM OLD.qty_available
     AND COALESCE(current_setting('mm.ledger_write', true), '') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'BALANCE: qty_available can only change through the ledger';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mm_stock_unit_qty_open ON public.mm_stock_units;

ALTER TABLE public.mm_stock_units DROP CONSTRAINT IF EXISTS mm_stock_units_qty_recv_chk;
ALTER TABLE public.mm_stock_units ADD CONSTRAINT mm_stock_units_qty_recv_chk
  CHECK (status = 'draft' OR (qty_received IS NOT NULL AND qty_received > 0));

DO $mm$
DECLARE
  r record;
  v_oid oid;
  v_sql text;
  v_n integer;
  v_cnt integer;
  v_bad integer;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (
        'mm_dispatch_mill_rolls',
        $old$        in_challan_id, source, uom, length_m, weight_kg, shade, lot_no, color_ref, attributes,
        mill_snapshot, status, current_location_id, created_by, updated_by
      ) VALUES (
        v_factory, v_roll.unit_code, 'roll', v_roll.style_material_id, v_roll.fabric_type_id,
        v_roll.mill_batch_id, v_roll.id,
        v_ch, 'mill', v_uom, v_roll.length_m, v_roll.weight_kg, v_roll.shade, v_roll.lot_no, v_roll.color_ref,
        v_roll.attributes,
        v_snap, 'in_transit', v_mill, public._mm_actor_id(), public._mm_actor_id()$old$,
        $new$        in_challan_id, source, uom, length_m, weight_kg, shade, lot_no, color_ref, attributes,
        mill_snapshot, status, current_location_id,
        qty_uom, qty_declared, qty_received, qty_available,
        created_by, updated_by
      ) VALUES (
        v_factory, v_roll.unit_code, 'roll', v_roll.style_material_id, v_roll.fabric_type_id,
        v_roll.mill_batch_id, v_roll.id,
        v_ch, 'mill', v_uom, v_roll.length_m, v_roll.weight_kg, v_roll.shade, v_roll.lot_no, v_roll.color_ref,
        v_roll.attributes,
        v_snap, 'in_transit', v_mill,
        v_uom, v_roll.length_m, v_roll.length_m, 0,
        public._mm_actor_id(), public._mm_actor_id()$new$,
        1::int
      ),
      (
        'mm_dispatch_mill_rolls',
        $old$      v_factory, v_stock, 'TRANSFER', v_roll.length_m, 'draft', 'in_transit',$old$,
        $new$      v_factory, v_stock, 'RECEIPT_IN', v_roll.length_m, 'draft', 'in_transit',$new$,
        1::int
      ),
      (
        '_mm_insert_rolls',
        $old$      uom, length_m, weight_kg, shade, lot_no, color_ref, attributes, mill_snapshot, status,
      current_location_id, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, v_ft, p_challan, p_source,
      COALESCE(NULLIF(trim(COALESCE(v_row->>'uom', '')), ''), 'm'),
      v_len, v_wt, v_shade, v_lot, v_color, v_attrs, v_snap, p_status, p_loc, public._mm_actor_id(), public._mm_actor_id()$old$,
        $new$      uom, length_m, weight_kg, shade, lot_no, color_ref, attributes, mill_snapshot, status,
      current_location_id, qty_uom, qty_declared, qty_received, qty_available, created_by, updated_by
    ) VALUES (
      p_factory, v_code, 'roll', p_sm, v_ft, p_challan, p_source,
      COALESCE(NULLIF(trim(COALESCE(v_row->>'uom', '')), ''), 'm'),
      v_len, v_wt, v_shade, v_lot, v_color, v_attrs, v_snap, p_status, p_loc,
      COALESCE(NULLIF(trim(COALESCE(v_row->>'uom', '')), ''), 'm'), v_len, v_len, 0,
      public._mm_actor_id(), public._mm_actor_id()$new$,
        1::int
      ),
      (
        'mm_get_warehouse_dashboard',
        $old$      SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u$old$,
        $new$      SELECT COALESCE(sum(u.qty_available), 0) FROM public.mm_stock_units u$new$,
        1::int
      ),
      (
        'mm_get_expected_board',
        $old$          SELECT sum(u.length_m) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'$old$,
        $new$          SELECT sum(u.qty_available) FROM public.mm_stock_units u
          WHERE u.style_material_id = sm.id AND u.status = 'in_transit'$new$,
        1::int
      ),
      (
        'mm_get_warehouse_board',
        $old$              SELECT sum(u.length_m) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND public._mm_counts_as_received(u.status)$old$,
        $new$              SELECT sum(u.qty_received) FROM public.mm_stock_units u
              WHERE u.style_material_id = sm.id
                AND public._mm_counts_as_received(u.status)$new$,
        1::int
      ),
      (
        'mm_get_warehouse_board',
        $old$            SELECT sum(u.length_m) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND public._mm_counts_as_received(u.status)$old$,
        $new$            SELECT sum(u.qty_received) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id
              AND public._mm_counts_as_received(u.status)$new$,
        1::int
      ),
      (
        'mm_get_warehouse_board',
        $old$sum(u.length_m)$old$,
        $new$sum(u.qty_available)$new$,
        4::int
      ),
      (
        'mm_get_style_warehouse',
        $old$sum(u.length_m) FROM public.mm_stock_units u WHERE u.style_material_id$old$,
        $new$sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id$new$,
        11::int
      ),
      (
        'mm_get_warehouse_dispatch_board',
        $old$            SELECT COALESCE(sum(u.length_m), 0) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL$old$,
        $new$            SELECT COALESCE(sum(u.qty_available), 0) FROM public.mm_stock_units u
            WHERE u.style_material_id = sm.id AND u.status = 'in_stock' AND u.store_challan_id IS NULL$new$,
        1::int
      ),
      (
        'mm_list_warehouse_stock',
        $old$        u.length_m,
        u.uom,$old$,
        $new$        u.length_m,
        u.qty_available,
        u.qty_received,
        u.qty_declared,
        u.qty_uom,
        u.uom,$new$,
        1::int
      ),
      (
        'mm_list_warehouse_stock',
        $old$          'qty', s.length_m,$old$,
        $new$          'qty', s.qty_available,
          'qty_available', s.qty_available,
          'qty_received', s.qty_received,
          'qty_declared', s.qty_declared,
          'qty_uom', s.qty_uom,$new$,
        1::int
      ),
      (
        'mm_list_stock_movements',
        $old$        sl.qty_delta,
        sl.ref_table,$old$,
        $new$        sl.qty_delta,
        sl.qty_after,
        sl.ref_table,$new$,
        1::int
      ),
      (
        'mm_list_stock_movements',
        $old$          'qty', s.qty_delta,
          'uom', s.uom,$old$,
        $new$          'qty', s.qty_delta,
          'qty_after', s.qty_after,
          'uom', s.uom,$new$,
        1::int
      )
    ) AS t(fname, old_s, new_s, expect)
  LOOP
    SELECT count(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fname;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'mm_phase2: expected one %, found %', r.fname, v_cnt;
    END IF;
    SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fname;
    v_sql := pg_get_functiondef(v_oid);
    v_n := (length(v_sql) - length(replace(v_sql, r.old_s, ''))) / length(r.old_s);
    IF v_n <> r.expect THEN
      RAISE EXCEPTION 'mm_phase2: % expected % marker hits, found %', r.fname, r.expect, v_n;
    END IF;
    EXECUTE replace(v_sql, r.old_s, r.new_s);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'mm_stock_unit_qty_open' AND tgrelid = 'public.mm_stock_units'::regclass
  ) THEN
    RAISE EXCEPTION 'mm_phase2: opening trigger still present';
  END IF;

  IF strpos((SELECT prosrc FROM pg_proc WHERE proname = '_mm_ledger' AND pronamespace = 'public'::regnamespace), 'length_m = v_after') > 0 THEN
    RAISE EXCEPTION 'mm_phase2: ledger still overwrites length_m';
  END IF;

  IF strpos((SELECT prosrc FROM pg_proc WHERE proname = 'mm_dispatch_mill_rolls' AND pronamespace = 'public'::regnamespace), '''RECEIPT_IN'', v_roll.length_m') = 0 THEN
    RAISE EXCEPTION 'mm_phase2: mill dispatch does not post a receipt';
  END IF;

  IF strpos((SELECT prosrc FROM pg_proc WHERE proname = 'mm_dispatch_mill_rolls' AND pronamespace = 'public'::regnamespace), 'v_snap, ''in_transit'', v_mill') = 0 THEN
    RAISE EXCEPTION 'mm_phase2: mill dispatch location write changed';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.mm_stock_units u
  LEFT JOIN (
    SELECT stock_unit_id, sum(qty_delta) AS delta_sum
    FROM public.mm_stock_ledger
    GROUP BY stock_unit_id
  ) l ON l.stock_unit_id = u.id
  WHERE abs(u.qty_available - COALESCE(l.delta_sum, 0)) > 0.001;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'mm_phase2: % rolls whose balance does not match the ledger', v_bad;
  END IF;

  IF (
    SELECT abs(COALESCE(sum(qty_available), 0) - COALESCE(sum(length_m), 0))
    FROM public.mm_stock_units
  ) > 0.001 THEN
    RAISE EXCEPTION 'mm_phase2: balance total drifted from length';
  END IF;
END;
$mm$;

NOTIFY pgrst, 'reload schema';
