-- B7 + B8 (2026-10-09)
-- B7: process types get output_unit_form ('roll' | 'lap' | NULL = keep). A return line's form = line value, else the
--     process type's output form, else the piece's current form (laps stay laps). Seed "Rolling" (output roll) per factory.
-- B8: process challans get target_color / target_shade, set from mm_proc_send payload; returned by get_challan.
ALTER TABLE public.mm_process_types ADD COLUMN IF NOT EXISTS output_unit_form text;
ALTER TABLE public.mm_process_types DROP CONSTRAINT IF EXISTS mm_process_types_output_unit_form_chk;
ALTER TABLE public.mm_process_types ADD CONSTRAINT mm_process_types_output_unit_form_chk CHECK (output_unit_form IS NULL OR output_unit_form IN ('roll', 'lap'));
ALTER TABLE public.mm_process_challans ADD COLUMN IF NOT EXISTS target_color text, ADD COLUMN IF NOT EXISTS target_shade text;

DO $mig$
DECLARE d text; n int;
BEGIN
  -- return line applies output form
  d := pg_get_functiondef('public._mm_proc_apply_return_line'::regproc);
  n := (length(d) - length(replace(d, 'unit_form  = COALESCE(NEW.unit_form, unit_form),', ''))) / length('unit_form  = COALESCE(NEW.unit_form, unit_form),');
  IF n <> 2 THEN RAISE EXCEPTION 'apply_return_line: expected 2 unit_form lines, found %', n; END IF;
  d := replace(d, 'unit_form  = COALESCE(NEW.unit_form, unit_form),', 'unit_form  = COALESCE(NEW.unit_form, v_t.output_unit_form, unit_form),');
  EXECUTE d;

  -- rules save accepts output_unit_form ('' / 'keep' = NULL)
  d := pg_get_functiondef('public.mm_save_process_type_rules(jsonb)'::regprocedure);
  d := replace(d, $a$  RETURN public._mm_ok(jsonb_build_object('id', v_id));$a$,
    $b$  IF p_row ? 'output_unit_form' THEN
    IF NULLIF(p_row->>'output_unit_form', '') IS NOT NULL AND p_row->>'output_unit_form' NOT IN ('roll', 'lap', 'keep') THEN
      RETURN public._mm_err('INVALID', 'Output form must be roll, lap or keep');
    END IF;
    UPDATE public.mm_process_types
    SET output_unit_form = CASE WHEN p_row->>'output_unit_form' IN ('roll', 'lap') THEN p_row->>'output_unit_form' ELSE NULL END
    WHERE id = v_id AND factory_id = v_factory;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));$b$);
  IF position('Output form must be roll' in d) = 0 THEN RAISE EXCEPTION 'rules replace failed'; END IF;
  EXECUTE d;

  -- config + challan detail expose output_unit_form
  d := pg_get_functiondef('public.mm_get_v4_config()'::regprocedure);
  d := replace(d, $a$'default_return_mode', t.default_return_mode,$a$, $b$'default_return_mode', t.default_return_mode, 'output_unit_form', t.output_unit_form,$b$);
  IF position('''output_unit_form'', t.output_unit_form' in d) = 0 THEN RAISE EXCEPTION 'config replace failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.mm_proc_get_challan(uuid)'::regprocedure);
  d := replace(d, $a$'default_return_mode', t.default_return_mode,$a$, $b$'default_return_mode', t.default_return_mode, 'output_unit_form', t.output_unit_form,$b$);
  d := replace(d, $a$'process_type', (SELECT jsonb_build_object($a$, $b$'target_color', v_c.target_color, 'target_shade', v_c.target_shade,
      'process_type', (SELECT jsonb_build_object($b$);
  IF position('''target_color'', v_c.target_color' in d) = 0 OR position('''output_unit_form'', t.output_unit_form' in d) = 0 THEN RAISE EXCEPTION 'get_challan replace failed'; END IF;
  EXECUTE d;

  -- send stores target colour / shade
  d := pg_get_functiondef('public.mm_proc_send(jsonb)'::regprocedure);
  d := replace(d, $a$  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', array_length(v_ids,1)));$a$,
    $b$  UPDATE public.mm_process_challans
  SET target_color = NULLIF(btrim(COALESCE(p_payload->>'target_color', '')), ''),
      target_shade = NULLIF(btrim(COALESCE(p_payload->>'target_shade', '')), '')
  WHERE id = v_ch;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', array_length(v_ids,1)));$b$);
  IF position('SET target_color' in d) = 0 THEN RAISE EXCEPTION 'send replace failed'; END IF;
  EXECUTE d;
END $mig$;

-- seed Rolling per factory that has process types
INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code, default_return_mode, resets_testing, resets_inspection, output_unit_form)
SELECT DISTINCT t.factory_id, 'Rolling', 90, true, NULL, 'same_rolls', false, false, 'roll'
FROM public.mm_process_types t
WHERE NOT EXISTS (SELECT 1 FROM public.mm_process_types x WHERE x.factory_id = t.factory_id AND lower(x.name) IN ('rolling', 're-rolling'));
