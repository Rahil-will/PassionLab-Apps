-- Cutting can only use rolls that the warehouse sent on a store challan.
CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := pg_get_functiondef(v_oid);
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 120); END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;

CREATE OR REPLACE FUNCTION public._mm_cut_usable(p_unit public.mm_stock_units, p_cut uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p_unit.store_challan_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.mm_store_challan_lines l
                 WHERE l.challan_id = p_unit.store_challan_id AND l.stock_unit_id = p_unit.id
                   AND COALESCE(l.line_status, 'pending') <> 'missing')
     AND NOT public._mm_unit_on_hold(p_unit.id)
     AND (p_unit.status = 'issued' OR (p_unit.status = 'in_stock' AND p_unit.current_location_id = p_cut));
$function$;
REVOKE ALL ON FUNCTION public._mm_cut_usable(public.mm_stock_units, uuid) FROM PUBLIC, anon, authenticated;

SELECT pg_temp.fx('mm_list_cutting_rolls', $o$      AND NOT public._mm_unit_on_hold(u.id)
      AND NOT public._mm_store_line_missing(u.id)
      AND (u.status = 'issued' OR (u.status = 'in_stock' AND u.current_location_id = v_cut))$o$,
$n$      AND public._mm_cut_usable(u, v_cut)$n$);
SELECT pg_temp.fx('mm_list_cutting_rolls', $o$'in_cutting_store', (u.status = 'in_stock' AND u.current_location_id = v_cut)$o$,
$n$'in_cutting_store', (u.status = 'in_stock' AND u.current_location_id = v_cut),
      'store_challan_id', u.store_challan_id,
      'store_challan_no', (SELECT sc.challan_no FROM public.mm_store_challans sc WHERE sc.id = u.store_challan_id)$n$);

SELECT pg_temp.fx('mm_save_lay_consumptions', $o$    IF NOT (
      v_unit.status = 'issued'
      OR (v_unit.status = 'in_stock' AND v_unit.current_location_id = v_cut)
    ) THEN
      RETURN public._mm_err('INVALID', 'Roll is not issued to cutting');
    END IF;$o$,
$n$    IF NOT public._mm_cut_usable(v_unit, v_cut) THEN
      RETURN public._mm_err('INVALID', v_unit.unit_code || ' was not sent to cutting on a store challan');
    END IF;$n$);

ALTER TABLE public.mm_stock_units ADD CONSTRAINT mm_stock_units_issued_needs_challan_chk
  CHECK (status <> 'issued' OR store_challan_id IS NOT NULL);
