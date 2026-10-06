CREATE OR REPLACE FUNCTION public.mm_list_receive_catalog()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_factory uuid;
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
  p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_has boolean; v_out jsonb;
BEGIN
  IF COALESCE(cardinality(p_missing_unit_ids), 0) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'mm_receive_mill_in_challan'
        AND pg_get_function_identity_arguments(p.oid) LIKE '%p_missing_unit_ids%'
    ) INTO v_has;
    IF NOT v_has THEN
      RETURN public._mm_err('WAITING_P4', 'Partial receive is not available yet');
    END IF;
    EXECUTE 'SELECT public.mm_receive_mill_in_challan($1, $2, $3, $4)'
      INTO v_out USING p_id, p_roll_edits, p_row_version, p_missing_unit_ids;
    RETURN v_out;
  END IF;
  RETURN public.mm_receive_mill_in_challan(p_id, p_roll_edits, p_row_version);
END;
$fn$;

CREATE OR REPLACE FUNCTION public._mm_store_line_missing(p_unit_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_missing boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_store_challan_lines' AND column_name = 'line_status'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.mm_store_challan_lines WHERE stock_unit_id = $1 AND line_status = ''missing'')'
      INTO v_missing USING p_unit_id;
  END IF;
  RETURN COALESCE(v_missing, false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_exclude_roll(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_factory uuid; v_has boolean;
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
  IF NOT EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.id = p_unit_id AND u.factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND', 'Roll not found');
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'hold_reason'
  ) THEN
    EXECUTE 'UPDATE public.mm_stock_units SET on_hold = true, hold_reason = $2, updated_at = now(), updated_by = public._mm_actor_id() WHERE id = $1 AND factory_id = $3'
      USING p_unit_id, 'excluded at inspection', v_factory;
  ELSE
    EXECUTE 'UPDATE public.mm_stock_units SET on_hold = true, updated_at = now(), updated_by = public._mm_actor_id() WHERE id = $1 AND factory_id = $2'
      USING p_unit_id, v_factory;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', p_unit_id, 'on_hold', true));
END;
$fn$;;
