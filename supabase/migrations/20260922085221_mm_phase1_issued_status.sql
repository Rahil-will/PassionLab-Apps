ALTER TABLE public.mm_stock_units DROP CONSTRAINT IF EXISTS mm_stock_units_status_chk;
ALTER TABLE public.mm_stock_units ADD CONSTRAINT mm_stock_units_status_chk CHECK (
  status = ANY (ARRAY[
    'draft','in_transit','pending_qc','in_stock','rejected',
    'issued','consumed','returned_to_supplier','missing','written_off'
  ])
);

UPDATE public.mm_stock_units u
SET status = 'issued',
    updated_at = now()
FROM public.mm_locations l
WHERE u.current_location_id = l.id
  AND u.status = 'in_stock'
  AND l.location_type = 'cutting';

CREATE OR REPLACE FUNCTION public._mm_is_on_hand(p_status text, p_loc_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p_status IN ('pending_qc', 'in_stock', 'rejected')
     AND p_loc_type IN ('receiving', 'rack', 'bin', 'rejected');
$fn$;

CREATE OR REPLACE FUNCTION public._mm_counts_as_received(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p_status IN ('pending_qc', 'in_stock', 'rejected', 'issued', 'consumed');
$fn$;

CREATE OR REPLACE FUNCTION public.mm_stock_unit_state_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_type text;
BEGIN
  IF NEW.current_location_id IS NULL THEN
    v_type := NULL;
  ELSE
    SELECT location_type INTO v_type FROM public.mm_locations WHERE id = NEW.current_location_id;
  END IF;
  IF NEW.status IN ('draft', 'in_transit') AND NEW.current_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'pending_qc' AND v_type IS DISTINCT FROM 'receiving' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'in_stock' AND COALESCE(v_type, '') NOT IN ('receiving', 'rack', 'bin') THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'rejected' AND v_type IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'issued' AND v_type IS DISTINCT FROM 'cutting' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status IN ('consumed', 'returned_to_supplier', 'missing', 'written_off') AND NEW.current_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS mm_stock_unit_state_guard ON public.mm_stock_units;
CREATE TRIGGER mm_stock_unit_state_guard
  BEFORE INSERT OR UPDATE OF status, current_location_id
  ON public.mm_stock_units
  FOR EACH ROW
  EXECUTE FUNCTION public.mm_stock_unit_state_guard();

DO $patch$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_create_store_challan';
  IF def IS NOT NULL AND position('status = ''issued''' in def) = 0 THEN
    def := replace(def,
      'store_challan_id = v_id, current_location_id = v_cut,',
      'store_challan_id = v_id, current_location_id = v_cut, status = ''issued'',');
    def := replace(def,
      '''TRANSFER'', v_unit.length_m, v_unit.status, v_unit.status,',
      '''ISSUE_TO_CUTTING'', v_unit.length_m, v_unit.status, ''issued'',');
    EXECUTE def;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_save_lay_consumptions';
  IF def IS NOT NULL AND position('status = ''issued''' in def) = 0 THEN
    def := replace(def,
      'SET status = ''in_stock'',
        current_location_id = v_cut,',
      'SET status = ''issued'',
        current_location_id = v_cut,');
    def := replace(def,
      'v_unit.status, ''in_stock'', v_unit.current_location_id, v_cut,',
      'v_unit.status, ''issued'', v_unit.current_location_id, v_cut,');
    def := replace(def,
      'ELSIF v_closing <= 0 AND v_consumed_ok THEN
      v_new_status := ''consumed'';',
      'ELSIF v_closing <= 0 AND v_consumed_ok THEN
      v_new_status := ''consumed'';
      v_new_loc := NULL;');
    EXECUTE def;
  END IF;
END;
$patch$;;
