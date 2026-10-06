CREATE OR REPLACE FUNCTION public._mm_set_on_hand(p_unit_id uuid, p_qty numeric, p_received boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(p_received, false) THEN
    RETURN;
  END IF;
  UPDATE public.mm_stock_units
  SET qty_received = p_qty,
      qty_declared = COALESCE(qty_declared, p_qty),
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_unit_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_stock_unit_qty_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.mm_stock_ledger (
    factory_id, stock_unit_id, entry_type, qty, qty_delta, qty_after, qty_uom, balance_after,
    status_after, location_after, note
  ) VALUES (
    NEW.factory_id, NEW.id, 'RECEIPT_IN',
    COALESCE(NEW.qty_available, 0), COALESCE(NEW.qty_available, 0),
    COALESCE(NEW.qty_available, 0), COALESCE(NEW.qty_uom, 'm'), COALESCE(NEW.qty_available, 0),
    NEW.status, NEW.current_location_id, 'opening balance'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mm_stock_unit_qty_open ON public.mm_stock_units;
CREATE TRIGGER mm_stock_unit_qty_open
  AFTER INSERT ON public.mm_stock_units
  FOR EACH ROW
  EXECUTE FUNCTION public.mm_stock_unit_qty_open();;
