-- 1) mm_set_roll_colour: set colour (+ dye lot) on rolls that already exist (e.g. batch 21 created FINISHED without colour).
-- 2) Process return captures actual GSM / width per roll (same_rolls[] and re_rolled[].outputs[] keys actual_gsm, actual_width_in).
--    The spec check uses them after processing (QC test values still win).

ALTER TABLE public.mm_process_return_lines
  ADD COLUMN IF NOT EXISTS actual_gsm numeric,
  ADD COLUMN IF NOT EXISTS actual_width_in numeric;

CREATE OR REPLACE FUNCTION public.mm_set_roll_colour(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_ids uuid[]; v_colour text; v_lot text; v_n int;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_colour := NULLIF(btrim(COALESCE(p_payload->>'color', '')), '');
  v_lot := NULLIF(btrim(COALESCE(p_payload->>'dye_lot', '')), '');
  IF v_colour IS NULL THEN RETURN public._mm_err('REQUIRED', 'Enter a colour'); END IF;
  BEGIN v_ids := ARRAY(SELECT DISTINCT x::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'roll_ids', '[]'::jsonb)) x);
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid roll id'); END;
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN RETURN public._mm_err('REQUIRED', 'Select rolls'); END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) i WHERE NOT EXISTS (SELECT 1 FROM public.mm_rolls r WHERE r.id = i AND r.factory_id = v_factory)) THEN
    RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.roll_id = ANY (v_ids)
             AND u.status IN ('consumed', 'written_off', 'returned_to_supplier', 'cancelled')) THEN
    RETURN public._mm_err('INVALID', 'A selected roll is already used or gone');
  END IF;
  UPDATE public.mm_mill_rolls SET color_ref = v_colour, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE roll_id = ANY (v_ids) AND factory_id = v_factory;
  UPDATE public.mm_stock_units SET color_ref = v_colour, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE roll_id = ANY (v_ids) AND factory_id = v_factory;
  UPDATE public.mm_rolls SET color_name = v_colour, dye_lot = COALESCE(v_lot, dye_lot), updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = ANY (v_ids) AND factory_id = v_factory;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN public._mm_ok(jsonb_build_object('updated', v_n, 'color', v_colour));
END $function$;
REVOKE EXECUTE ON FUNCTION public.mm_set_roll_colour(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mm_set_roll_colour(jsonb) TO authenticated;

-- Return: store actuals on the return lines (after the lines are written, before refresh)
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_proc_return(jsonb)'::regprocedure);
  IF position('actual_width_in' in d) > 0 THEN RETURN; END IF;
  d := replace(d, $a$  PERFORM public._mm_process_refresh(v_ch.id);$a$, $b$  UPDATE public.mm_process_return_lines rl
  SET actual_gsm = NULLIF(e->>'actual_gsm', '')::numeric, actual_width_in = NULLIF(e->>'actual_width_in', '')::numeric
  FROM jsonb_array_elements(COALESCE(p_payload->'same_rolls', '[]'::jsonb)) e
  WHERE rl.return_id = v_ret AND rl.same_identity AND rl.out_line_id = (e->>'out_line_id')::uuid
    AND (NULLIF(e->>'actual_gsm', '') IS NOT NULL OR NULLIF(e->>'actual_width_in', '') IS NOT NULL);
  UPDATE public.mm_process_return_lines rl
  SET actual_gsm = NULLIF(o->>'actual_gsm', '')::numeric, actual_width_in = NULLIF(o->>'actual_width_in', '')::numeric
  FROM jsonb_array_elements(COALESCE(p_payload->'re_rolled', '[]'::jsonb)) g, jsonb_array_elements(COALESCE(g->'outputs', '[]'::jsonb)) o
  WHERE rl.return_id = v_ret AND NOT rl.same_identity AND lower(rl.unit_code) = lower(btrim(o->>'unit_code'))
    AND (NULLIF(o->>'actual_gsm', '') IS NOT NULL OR NULLIF(o->>'actual_width_in', '') IS NOT NULL);
  PERFORM public._mm_process_refresh(v_ch.id);$b$);
  IF position('actual_width_in' in d) = 0 THEN RAISE EXCEPTION 'mm_proc_return actuals patch failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public._mm_roll_spec(uuid)'::regprocedure);
  IF position('mm_process_return_lines' in d) = 0 THEN
    d := replace(d, $a$  IF COALESCE(v_r.process_round, 0) = 0 THEN$a$, $b$  IF COALESCE(v_r.process_round, 0) > 0 THEN
    SELECT COALESCE(v_ag, rl.actual_gsm), COALESCE(v_aw, rl.actual_width_in) INTO v_ag, v_aw
    FROM (SELECT 1) one LEFT JOIN LATERAL (
      SELECT actual_gsm, actual_width_in FROM public.mm_process_return_lines
      WHERE roll_id = v_r.id AND (actual_gsm IS NOT NULL OR actual_width_in IS NOT NULL)
      ORDER BY created_at DESC LIMIT 1) rl ON true;
  END IF;
  IF COALESCE(v_r.process_round, 0) = 0 THEN$b$);
    IF position('mm_process_return_lines' in d) = 0 THEN RAISE EXCEPTION 'roll_spec patch failed'; END IF;
    EXECUTE d;
  END IF;
END $mig$;
