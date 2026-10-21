-- mm_proc_return: custody colour + return-line colour default to the challan target colour (typed value wins).
-- _mm_roll_row: adds stage_label, color (mm_rolls.color_name), finished {finished, missing[], needs_colour}.
DO $mig$
DECLARE d text; n int;
BEGIN
  d := pg_get_functiondef('public.mm_proc_return(jsonb)'::regprocedure);
  IF position('v_ch.target_color' in d) > 0 THEN RETURN; END IF;
  d := replace(d, $a$color_ref = COALESCE(NULLIF(v_e->>'color_ref',''), color_ref),$a$,
                  $b$color_ref = COALESCE(NULLIF(v_e->>'color_ref',''), NULLIF(btrim(v_ch.target_color),''), color_ref),$b$);
  d := replace(d, $a$NULLIF(v_e->>'qty_kg','')::numeric, NULLIF(v_e->>'shade',''), NULLIF(v_e->>'color_ref',''), NULL,$a$,
                  $b$NULLIF(v_e->>'qty_kg','')::numeric, NULLIF(v_e->>'shade',''), COALESCE(NULLIF(v_e->>'color_ref',''), NULLIF(btrim(v_ch.target_color),'')), NULL,$b$);
  d := replace(d, $a$COALESCE(NULLIF(v_o->>'color_ref',''), v_roll.color_ref)$a$,
                  $b$COALESCE(NULLIF(v_o->>'color_ref',''), NULLIF(btrim(v_ch.target_color),''), v_roll.color_ref)$b$);
  d := replace(d, $a$COALESCE(NULLIF(v_o->>'color_ref',''), v_unit.color_ref)$a$,
                  $b$COALESCE(NULLIF(v_o->>'color_ref',''), NULLIF(btrim(v_ch.target_color),''), v_unit.color_ref)$b$);
  d := replace(d, $a$NULLIF(v_o->>'shade',''), NULLIF(v_o->>'color_ref',''),
        CASE WHEN$a$, $b$NULLIF(v_o->>'shade',''), COALESCE(NULLIF(v_o->>'color_ref',''), NULLIF(btrim(v_ch.target_color),'')),
        CASE WHEN$b$);
  n := (length(d) - length(replace(d, 'v_ch.target_color', ''))) / length('v_ch.target_color');
  IF n <> 6 THEN RAISE EXCEPTION 'mm_proc_return colour patch: expected 6 replacements, got %', n; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public._mm_roll_row(uuid,boolean)'::regprocedure);
  IF position('_mm_roll_finished' in d) = 0 THEN
    d := replace(d, $a$'stage_code', v_r.stage_code, 'unit_form', v_r.unit_form,$a$,
      $b$'stage_code', v_r.stage_code, 'stage_label', (SELECT s.label FROM public.mm_fabric_stages s WHERE s.factory_id = v_r.factory_id AND s.code = v_r.stage_code),
    'color', v_r.color_name, 'finished', public._mm_roll_finished(v_r.id), 'unit_form', v_r.unit_form,$b$);
    IF position('_mm_roll_finished' in d) = 0 THEN RAISE EXCEPTION 'roll_row patch failed'; END IF;
    EXECUTE d;
  END IF;
END $mig$;
