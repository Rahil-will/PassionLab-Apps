CREATE OR REPLACE FUNCTION public._mm_unit_on_hand(p_unit public.mm_stock_units)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'qty_available'
  ) THEN
    RETURN NULLIF(to_jsonb(p_unit)->>'qty_available', '')::numeric;
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

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'qty_available'
  ) THEN
    EXECUTE 'UPDATE public.mm_stock_units SET qty_available = $1 WHERE id = $2'
      USING p_qty, p_unit_id;
  END IF;
  IF p_received AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'qty_received'
  ) THEN
    EXECUTE 'UPDATE public.mm_stock_units SET qty_received = $1, qty_declared = COALESCE(qty_declared, $1) WHERE id = $2'
      USING p_qty, p_unit_id;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_unit_on_hold(p_unit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hold boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'on_hold'
  ) THEN
    EXECUTE 'SELECT COALESCE(on_hold, false) FROM public.mm_stock_units WHERE id = $1'
      INTO v_hold USING p_unit_id;
  END IF;
  RETURN COALESCE(v_hold, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_unit_clearance(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_unit public.mm_stock_units%ROWTYPE;
  v_block text;
  v_tested boolean;
  v_inspected boolean := false;
  v_result text;
  v_hold boolean;
  v_cleared boolean := false;
  v_reason text;
BEGIN
  SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = p_unit_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tested', false, 'inspected', false, 'inspection_result', NULL,
      'cleared', false, 'blocking_reason', 'Roll not found'
    );
  END IF;
  v_block := public._mm_cutting_param_block(v_unit);
  v_tested := v_block IS NULL;
  SELECT (i.result IS NOT NULL), i.result
    INTO v_inspected, v_result
  FROM public.mm_warehouse_inspections i
  WHERE i.stock_unit_id = v_unit.id
  ORDER BY i.inspected_at DESC NULLS LAST
  LIMIT 1;
  v_inspected := COALESCE(v_inspected, false);
  v_hold := public._mm_unit_on_hold(v_unit.id);
  IF v_hold THEN
    v_reason := 'On hold';
  ELSIF v_result = 'fail' THEN
    v_reason := 'Inspection failed';
  ELSIF v_unit.source = 'vendor' THEN
    v_cleared := v_tested AND v_inspected AND v_result = 'pass';
    IF NOT v_cleared THEN
      v_reason := 'Vendor roll needs testing and a passing inspection';
    END IF;
  ELSE
    v_cleared := v_tested;
    IF NOT v_tested THEN
      v_reason := COALESCE(v_block, 'Testing required');
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'tested', v_tested,
    'inspected', v_inspected,
    'inspection_result', v_result,
    'cleared', v_cleared,
    'blocking_reason', v_reason
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_apply_clearance(p_unit_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_clear jsonb;
BEGIN
  IF p_unit_ids IS NULL THEN
    RETURN;
  END IF;
  FOREACH v_id IN ARRAY p_unit_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id FOR UPDATE;
    IF NOT FOUND OR v_unit.status IS DISTINCT FROM 'pending_qc' THEN
      CONTINUE;
    END IF;
    v_clear := public._mm_unit_clearance(v_id);
    IF COALESCE(v_clear->>'cleared', 'false') = 'true' THEN
      UPDATE public.mm_stock_units
      SET status = 'in_stock',
          updated_at = now(),
          updated_by = public._mm_actor_id()
      WHERE id = v_id;
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_unit_clearance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_apply_clearance(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_unit_clearance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._mm_apply_clearance(uuid[]) TO authenticated, service_role;

DO $patch$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_save_warehouse_inspections';
  IF def IS NOT NULL AND position('_mm_apply_clearance' in def) = 0 THEN
    def := replace(def,
      'v_new_status := CASE WHEN v_result = ''pass'' THEN ''in_stock'' ELSE ''rejected'' END;',
      'v_new_status := CASE WHEN v_result = ''fail'' THEN ''rejected'' ELSE v_unit.status END;');
    def := replace(def,
      'v_new_loc := CASE WHEN v_result = ''pass'' THEN v_recv ELSE v_red END;',
      'v_new_loc := CASE WHEN v_result = ''fail'' THEN v_red ELSE v_unit.current_location_id END;');
    def := replace(def,
      'RETURN public._mm_ok(jsonb_build_object(''id'', v_ch.id, ''saved'', v_n));',
      'PERFORM public._mm_apply_clearance(ARRAY(SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id)); RETURN public._mm_ok(jsonb_build_object(''id'', v_ch.id, ''saved'', v_n));');
    EXECUTE def;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_receive_mill_in_challan';
  IF def IS NOT NULL AND position('_mm_apply_clearance' in def) = 0 THEN
    def := replace(def,
      'RETURN public._mm_ok(jsonb_build_object(''id'', v_ch.id, ''status'', ''received''));',
      'PERFORM public._mm_apply_clearance(ARRAY(SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id)); RETURN public._mm_ok(jsonb_build_object(''id'', v_ch.id, ''status'', ''received''));');
    EXECUTE def;
  END IF;
END;
$patch$;;
