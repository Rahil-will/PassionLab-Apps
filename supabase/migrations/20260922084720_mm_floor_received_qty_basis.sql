CREATE OR REPLACE FUNCTION public._mm_unit_qty_received(p_unit public.mm_stock_units)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'qty_received'
  ) THEN
    RETURN NULLIF(to_jsonb(p_unit)->>'qty_received', '')::numeric;
  END IF;
  RETURN p_unit.length_m;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_set_on_hand(p_unit_id uuid, p_qty numeric, p_received boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  UPDATE public.mm_stock_units
  SET length_m = p_qty,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_unit_id;

  IF p_received AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'qty_received'
  ) THEN
    EXECUTE 'UPDATE public.mm_stock_units SET qty_received = $1 WHERE id = $2'
      USING p_qty, p_unit_id;
  END IF;
END;
$fn$;

DO $patch$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_confirm_received_lengths';
  IF def IS NOT NULL AND position('_mm_unit_qty_received' in def) = 0 THEN
    def := replace(def,
      'v_current := COALESCE(public._mm_unit_on_hand(v_unit), 0);',
      'v_current := COALESCE(public._mm_unit_qty_received(v_unit), 0);');
    IF position('_mm_unit_qty_received' in def) = 0 THEN
      RAISE EXCEPTION 'confirm lengths patch missed';
    END IF;
    EXECUTE def;
  END IF;
END;
$patch$;;
