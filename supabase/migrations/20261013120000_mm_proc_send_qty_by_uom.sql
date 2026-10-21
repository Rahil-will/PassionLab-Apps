-- Process send writes the roll quantity into mm_process_out_lines.qty.
-- The fabric UOM says what that number is: kg uses weight_kg, metres use length_m.
-- qty_kg stays the weight so kg reports still add up.

DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_proc_send(jsonb)'::regprocedure);
  IF position('v_roll public.mm_mill_rolls%ROWTYPE; v_unit public.mm_stock_units%ROWTYPE; v_rr public.mm_rolls%ROWTYPE;' in d) = 0 THEN
    RAISE EXCEPTION 'proc send declare not found';
  END IF;
  d := replace(d,
    'v_roll public.mm_mill_rolls%ROWTYPE; v_unit public.mm_stock_units%ROWTYPE; v_rr public.mm_rolls%ROWTYPE;',
    'v_roll public.mm_mill_rolls%ROWTYPE; v_unit public.mm_stock_units%ROWTYPE; v_rr public.mm_rolls%ROWTYPE; v_uom text; v_qty numeric; v_kg numeric;');

  IF position($a$VALUES (v_factory, v_ch, v_roll.id, v_id, v_roll.unit_code, v_roll.length_m, 'm', v_roll.weight_kg,$a$ in d) = 0 THEN
    RAISE EXCEPTION 'proc send mill qty pattern not found';
  END IF;
  d := replace(d,
    $a$      SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE roll_id = v_id;
      INSERT INTO public.mm_process_out_lines (factory_id, challan_id, mill_roll_id, roll_id, unit_code, qty, uom, qty_kg,
        shade, lot_no, color_ref)
      VALUES (v_factory, v_ch, v_roll.id, v_id, v_roll.unit_code, v_roll.length_m, 'm', v_roll.weight_kg,
        v_roll.shade, v_roll.lot_no, v_roll.color_ref);$a$,
    $b$      SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE roll_id = v_id;
      v_uom := public._mm_mill_batch_uom(v_roll.mill_batch_id);
      IF lower(COALESCE(v_uom, 'm')) IN ('kg', 'kgs') THEN
        v_qty := COALESCE(v_roll.weight_kg, v_roll.length_m);
        v_kg := v_qty;
      ELSE
        v_qty := COALESCE(v_roll.length_m, v_roll.weight_kg);
        v_kg := v_roll.weight_kg;
        v_uom := COALESCE(NULLIF(v_uom, ''), 'm');
      END IF;
      IF v_qty IS NULL OR v_qty <= 0 THEN
        RETURN public._mm_err('INVALID', COALESCE(v_roll.unit_code, 'A roll') || ' has no quantity');
      END IF;
      INSERT INTO public.mm_process_out_lines (factory_id, challan_id, mill_roll_id, roll_id, unit_code, qty, uom, qty_kg,
        shade, lot_no, color_ref)
      VALUES (v_factory, v_ch, v_roll.id, v_id, v_roll.unit_code, v_qty, v_uom, v_kg,
        v_roll.shade, v_roll.lot_no, v_roll.color_ref);$b$);
  IF position('v_qty := COALESCE(v_roll.weight_kg, v_roll.length_m)' in d) = 0 THEN
    RAISE EXCEPTION 'proc send qty replace failed';
  END IF;
  EXECUTE d;
END $mig$;
