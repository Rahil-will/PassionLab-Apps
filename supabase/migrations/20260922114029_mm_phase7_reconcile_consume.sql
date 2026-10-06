DO $patch$
DECLARE
  v_src text;
  v_needle text;
  v_hits integer;
BEGIN
  v_src := pg_get_viewdef('public.mm_v_style_fabric_reconciliation'::regclass, true);
  v_needle := $n$'pending_qc'::text, 'in_stock'::text, 'rejected'::text, 'issued'::text, 'consumed'::text$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'received status hits %', v_hits; END IF;
  v_src := replace(
    v_src,
    v_needle,
    $n$'pending_qc'::text, 'in_stock'::text, 'rejected'::text, 'issued'::text, 'consumed'::text, 'at_process'::text$n$
  );
  v_needle := $n$AS balance_check
   FROM mm_style_materials sm$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'balance from hits %', v_hits; END IF;
  v_src := replace(v_src, v_needle, $n$AS balance_check,
    COALESCE(( SELECT - sum(l.qty_delta)
           FROM mm_stock_ledger l
             JOIN mm_stock_units u ON u.id = l.stock_unit_id
          WHERE u.style_material_id = sm.id AND l.entry_type = 'ADJUST_MINUS'::text AND btrim(COALESCE(l.note, '')) = 'shortage'), 0::numeric) AS shortage
   FROM mm_style_materials sm$n$);
  EXECUTE 'CREATE OR REPLACE VIEW public.mm_v_style_fabric_reconciliation AS ' || v_src;

  v_src := pg_get_functiondef('public.mm_get_style_reconciliation(uuid,uuid)'::regprocedure);
  v_needle := $n$    'waste', v.waste,$n$;
  v_hits := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF v_hits <> 1 THEN RAISE EXCEPTION 'reconcile waste hits %', v_hits; END IF;
  EXECUTE replace(v_src, v_needle, $n$    'waste', v.waste,
    'shortage', v.shortage,$n$);
END;
$patch$;

CREATE OR REPLACE FUNCTION public.mm_mark_rolls_consumed(p_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_id uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_ids uuid[];
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_unit_ids, ARRAY[]::uuid[])) AS x);
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select rolls that were used');
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_unit
    FROM public.mm_stock_units
    WHERE id = v_id AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found');
    END IF;
    IF v_unit.status IS DISTINCT FROM 'issued' THEN
      RETURN public._mm_err('INVALID', COALESCE(v_unit.unit_code, 'Roll') || ' is not at cutting');
    END IF;
    IF COALESCE(v_unit.qty_available, 0) <= 0 THEN
      RETURN public._mm_err('INVALID', COALESCE(v_unit.unit_code, 'Roll') || ' has no qty left');
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_unit
    FROM public.mm_stock_units
    WHERE id = v_id AND factory_id = v_factory
    FOR UPDATE;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'CONSUME', v_unit.qty_available,
      'issued', 'consumed',
      v_unit.current_location_id, NULL,
      'mm_stock_units', v_unit.id, 'used outside a lay'
    );
    UPDATE public.mm_stock_units
    SET status = 'consumed',
        current_location_id = NULL,
        updated_at = now(),
        updated_by = v_actor,
        row_version = row_version + 1
    WHERE id = v_unit.id;
    v_n := v_n + 1;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('rolls', v_n));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_mark_rolls_consumed(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_mark_rolls_consumed(uuid[]) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';;
