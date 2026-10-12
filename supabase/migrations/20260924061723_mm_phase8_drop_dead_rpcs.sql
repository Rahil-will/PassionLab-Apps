-- Phase 8: drop revoked page RPCs.
ALTER FUNCTION public.mm_resolve_style_material(uuid, uuid, uuid)
  RENAME TO _mm_resolve_style_material;

DO $patch$
DECLARE
  v_src text;
  v_next text;
  v_needle text;
  v_hits integer;
BEGIN
  v_src := pg_get_functiondef('public.mm_save_mill_batch(uuid,uuid,uuid,text,text,date,text,jsonb)'::regprocedure);
  v_needle := 'public.mm_resolve_style_material';
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'mill resolve hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, 'public._mm_resolve_style_material');

  v_src := pg_get_functiondef('public.mm_allocate_rolls_to_style(uuid[],uuid,uuid,uuid)'::regprocedure);
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'alloc resolve hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, 'public._mm_resolve_style_material');

  v_src := pg_get_functiondef('public.mm_save_vendor_grn(jsonb,uuid,text,text,date,text,text,text,jsonb)'::regprocedure);
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'grn resolve hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, 'public._mm_resolve_style_material');

  v_src := pg_get_functiondef('public.mm_floor_call(uuid,uuid,text,jsonb)'::regprocedure);
  v_needle := $n$  ELSIF p_fn = 'mm_list_warehouse_locations' THEN
    RETURN public.mm_list_warehouse_locations();
  ELSIF p_fn = 'mm_list_putaway_queue' THEN
    RETURN public.mm_list_putaway_queue();
  ELSIF p_fn = 'mm_list_rack_master' THEN$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'floor dead rpc hits %', v_hits; END IF;
  v_next := replace(v_src, v_needle, $n$  ELSIF p_fn = 'mm_list_rack_master' THEN$n$);
  IF position('mm_list_warehouse_locations' in v_next) > 0
     OR position('mm_list_putaway_queue' in v_next) > 0 THEN
    RAISE EXCEPTION 'floor still dispatches dropped rpcs';
  END IF;
  EXECUTE v_next;
END;
$patch$;

DROP FUNCTION public.mm_save_vendor_in_challan(uuid, uuid, uuid, text, jsonb);
DROP FUNCTION public.mm_send_to_warehouse(uuid, uuid, uuid, jsonb);
DROP FUNCTION public.mm_list_putaway_queue();
DROP FUNCTION public.mm_list_warehouse_locations();
DROP FUNCTION public.mm_save_warehouse_location(jsonb);
DROP FUNCTION public.mm_deactivate_warehouse_location(uuid);

REVOKE ALL ON FUNCTION public._mm_resolve_style_material(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._mm_resolve_style_material(uuid, uuid, uuid) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';;
