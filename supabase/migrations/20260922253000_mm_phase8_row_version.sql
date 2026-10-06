-- Phase 8 row version. Applied as mm_phase8_row_version.
-- The seven revoked RPCs stay until a release that no longer calls them has shipped.

DO $patch$
DECLARE
  v_src text;
  v_next text;
  v_needle text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_update_roll(uuid,jsonb,integer)'::regprocedure);
  v_needle := $n$p_row_version integer)$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'roll version signature hits %', v_hits; END IF;
  v_next := replace(v_src, v_needle, $n$p_row_version integer DEFAULT NULL)$n$);
  v_needle := $n$  IF v_unit.row_version IS DISTINCT FROM COALESCE(p_row_version, v_unit.row_version) THEN
    RETURN public._mm_err('STALE_VERSION', 'Reload and try again');
  END IF;$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'roll stale hits %', v_hits; END IF;
  v_next := replace(v_next, v_needle, $n$  IF p_row_version IS NOT NULL AND v_unit.row_version IS DISTINCT FROM p_row_version THEN
    RETURN public._mm_err('STALE', 'Reload and try again');
  END IF;$n$);
  EXECUTE v_next;

  v_src := pg_get_functiondef('public.mm_update_mill_batch(uuid,text,text,date,text,jsonb)'::regprocedure);
  v_needle := $n$p_rolls jsonb)
 RETURNS jsonb$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'mill signature hits %', v_hits; END IF;
  v_next := replace(v_src, v_needle, $n$p_rolls jsonb, p_row_version integer DEFAULT NULL)
 RETURNS jsonb$n$);
  v_needle := $n$  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Mill batch not found');
  END IF;$n$;
  v_hits := (length(v_next) - length(replace(v_next, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'mill not found hits %', v_hits; END IF;
  v_next := replace(v_next, v_needle, $n$  IF NOT FOUND THEN
    RETURN public._mm_err('NOT_FOUND', 'Mill batch not found');
  END IF;
  IF p_row_version IS NOT NULL AND v_batch.row_version IS DISTINCT FROM p_row_version THEN
    RETURN public._mm_err('STALE', 'Reload and try again');
  END IF;$n$);
  EXECUTE v_next;
  DROP FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb);

  v_src := pg_get_functiondef('public.mm_save_rack_location(jsonb)'::regprocedure);
  v_needle := $n$    UPDATE public.mm_locations SET
      parent_id = v_parent, code = v_code, name = v_name, location_type = v_type,
      is_pickable = v_pick, capacity_rolls = v_capacity, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'rack update hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$    IF NULLIF(p_row->>'row_version', '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.mm_locations loc
         WHERE loc.id = v_id AND loc.factory_id = v_factory
           AND loc.row_version = (p_row->>'row_version')::integer
       ) THEN
      RETURN public._mm_err('STALE', 'Reload and try again');
    END IF;
    UPDATE public.mm_locations SET
      parent_id = v_parent, code = v_code, name = v_name, location_type = v_type,
      is_pickable = v_pick, capacity_rolls = v_capacity,
      row_version = row_version + 1,
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;$n$);

  v_src := pg_get_functiondef('public.mm_get_mill_line(uuid,uuid,uuid)'::regprocedure);
  v_needle := $n$'remarks', b.remarks,$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'mill line remarks hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$'remarks', b.remarks, 'row_version', b.row_version,$n$);

  v_src := pg_get_functiondef('public.mm_get_unallocated_mill()'::regprocedure);
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'unallocated remarks hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$'remarks', b.remarks, 'row_version', b.row_version,$n$);

  v_src := pg_get_functiondef('public.mm_list_rack_master()'::regprocedure);
  v_needle := $n$'capacity_rolls', loc.capacity_rolls,$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'rack list hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$'capacity_rolls', loc.capacity_rolls, 'row_version', loc.row_version,$n$);
END;
$patch$;

REVOKE ALL ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_update_mill_batch(uuid, text, text, date, text, jsonb, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
