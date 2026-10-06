CREATE OR REPLACE FUNCTION public._mm_ledger(
  p_factory uuid, p_unit uuid, p_type text, p_len numeric,
  p_status_before text, p_status_after text,
  p_loc_before uuid, p_loc_after uuid,
  p_ref_table text, p_ref uuid, p_note text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
      length_m = v_after,
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
$fn$;

CREATE OR REPLACE FUNCTION public.mm_stock_unit_qty_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.qty_available IS NULL THEN
      NEW.qty_uom := COALESCE(NEW.qty_uom, NULLIF(NEW.uom, ''), 'm');
      NEW.qty_declared := COALESCE(NEW.qty_declared, NEW.length_m, 0);
      NEW.qty_received := COALESCE(NEW.qty_received, NEW.length_m, 0);
      NEW.qty_available := COALESCE(NEW.length_m, 0);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.qty_available IS DISTINCT FROM OLD.qty_available
     AND COALESCE(current_setting('mm.ledger_write', true), '') IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'BALANCE: qty_available can only change through the ledger';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS mm_stock_unit_qty_guard ON public.mm_stock_units;
CREATE TRIGGER mm_stock_unit_qty_guard
  BEFORE INSERT OR UPDATE OF qty_available
  ON public.mm_stock_units
  FOR EACH ROW
  EXECUTE FUNCTION public.mm_stock_unit_qty_guard();;
