DO $patch$
DECLARE
  v_src text;
  v_next text;
  v_needle text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_dispatch_mill_rolls(uuid[],text,text,text,date,text)'::regprocedure);
  v_needle := $n$    IF v_roll.status <> 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
      RETURN public._mm_err('INVALID', 'A selected roll is not waiting at the mill');
    END IF;$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'dispatch guard hits %', v_hits;
  END IF;
  v_next := replace(v_src, v_needle, v_needle || $n$
    IF public._mm_mill_at_process(v_roll.id) THEN
      RETURN public._mm_err('AT_PROCESS', 'A selected roll is at a process vendor');
    END IF;$n$);
  EXECUTE v_next;

  v_src := pg_get_functiondef('public.mm_list_mill_stock(text,text,text,integer,integer)'::regprocedure);
  v_needle := $n$OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL)$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 2 THEN
    RAISE EXCEPTION 'mill place hits %', v_hits;
  END IF;
  v_next := replace(
    v_src,
    v_needle,
    $n$OR (v_place = 'at_mill' AND r.status = 'draft' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id)) OR (v_place = 'at_process' AND public._mm_mill_at_process(r.id))$n$
  );
  v_needle := $n$WHEN r.status = 'draft' AND r.in_challan_id IS NULL THEN 'at_mill'$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'mill case hits %', v_hits;
  END IF;
  v_next := replace(
    v_next,
    v_needle,
    $n$WHEN public._mm_mill_at_process(r.id) THEN 'at_process' WHEN r.status = 'draft' AND r.in_challan_id IS NULL THEN 'at_mill'$n$
  );
  v_needle := $n$'place', CASE$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'mill place field hits %', v_hits;
  END IF;
  v_next := replace(
    v_next,
    v_needle,
    $n$'process_challan_id', (
            SELECT l.challan_id FROM public.mm_process_out_lines l
            WHERE l.mill_roll_id = r.id AND l.line_status = 'out'
            LIMIT 1
          ), 'place', CASE$n$
  );
  EXECUTE v_next;
END;
$patch$;
;
