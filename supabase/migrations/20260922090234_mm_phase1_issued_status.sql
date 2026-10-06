-- Phase 1: issued status is the cutting-store state.
-- Live mm_create_store_challan already sets status = 'issued' and writes ISSUE_TO_CUTTING.
-- This migration keeps that function. It allows in_transit on the mill virtual location
-- (mill dispatch is frozen and writes MILL), points received/issued readers at the helpers,
-- and stops lay rewind from putting in_stock on CUTTING_STORE.

CREATE OR REPLACE FUNCTION public._mm_counts_as_received(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT p_status IN ('pending_qc', 'in_stock', 'rejected', 'issued', 'consumed');
$$;

CREATE OR REPLACE FUNCTION public._mm_is_on_hand(p_status text, p_loc_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT p_status IN ('pending_qc', 'in_stock', 'rejected')
     AND p_loc_type IN ('receiving', 'rack', 'bin', 'rejected');
$$;

REVOKE ALL ON FUNCTION public._mm_counts_as_received(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_is_on_hand(text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._mm_counts_as_received(text) IS
  'Received for a style: pending_qc, in_stock, rejected, issued, consumed. returned_to_supplier, missing, and written_off do not count.';

COMMENT ON FUNCTION public._mm_is_on_hand(text, text) IS
  'Warehouse on-hand pair: pending_qc, in_stock, or rejected at receiving, rack, bin, or rejected. Callers still scope the location under WAREHOUSE.';

ALTER TABLE public.mm_stock_units DROP CONSTRAINT IF EXISTS mm_stock_units_status_chk;
ALTER TABLE public.mm_stock_units ADD CONSTRAINT mm_stock_units_status_chk CHECK (
  status = ANY (ARRAY[
    'draft'::text,
    'in_transit'::text,
    'pending_qc'::text,
    'in_stock'::text,
    'rejected'::text,
    'issued'::text,
    'consumed'::text,
    'returned_to_supplier'::text,
    'missing'::text,
    'written_off'::text
  ])
);

CREATE OR REPLACE FUNCTION public.mm_stock_unit_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_type text;
BEGIN
  IF NEW.current_location_id IS NULL THEN
    v_type := NULL;
  ELSE
    SELECT location_type INTO v_type
    FROM public.mm_locations
    WHERE id = NEW.current_location_id;
  END IF;

  IF NEW.status IN ('draft', 'in_transit')
     AND NOT (NEW.current_location_id IS NULL OR v_type = 'virtual') THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'pending_qc' AND v_type IS DISTINCT FROM 'receiving' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'in_stock' AND COALESCE(v_type, '') NOT IN ('receiving', 'rack', 'bin') THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'rejected' AND v_type IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status = 'issued' AND v_type IS DISTINCT FROM 'cutting' THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  ELSIF NEW.status IN ('consumed', 'returned_to_supplier', 'missing', 'written_off')
        AND NEW.current_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'MM_STATE: status % not allowed at location type %', NEW.status, COALESCE(v_type, 'null');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.mm_stock_unit_state_guard() IS
  'Status and location matrix. draft and in_transit may be at no location or at a virtual location, because mill dispatch writes MILL.';

REVOKE ALL ON FUNCTION public.mm_stock_unit_state_guard() FROM PUBLIC, anon, authenticated;

UPDATE public.mm_stock_units u
SET status = 'issued',
    row_version = row_version + 1,
    updated_at = now()
WHERE u.status = 'in_stock'
  AND u.current_location_id IN (
    SELECT id FROM public.mm_locations WHERE code = 'CUTTING_STORE'
  );

DO $mm$
DECLARE
  r record;
  v_oid oid;
  v_sql text;
  v_n integer;
  v_cnt integer;
  v_bad integer;
  v_id uuid;
  v_mill uuid;
  v_rack uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mm_stock_units u
    JOIN public.mm_locations l ON l.id = u.current_location_id
    WHERE l.code = 'CUTTING_STORE' AND u.status IS DISTINCT FROM 'issued'
  ) THEN
    RAISE EXCEPTION 'mm_phase1: a cutting-store roll is not issued';
  END IF;

  IF EXISTS (
    WITH oldf AS (
      SELECT u.style_material_id,
             count(*)::int AS rolls,
             COALESCE(sum(u.length_m), 0)::numeric AS meters
      FROM public.mm_stock_units u
      JOIN public.mm_locations wh ON wh.factory_id = u.factory_id AND wh.code = 'WAREHOUSE'
      JOIN public.mm_locations cut ON cut.factory_id = u.factory_id AND cut.code = 'CUTTING_STORE'
      WHERE u.status = 'pending_qc'
         OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, wh.id))
         OR public._mm_loc_is_under(u.current_location_id, cut.id)
      GROUP BY u.style_material_id
    ),
    neu AS (
      SELECT u.style_material_id,
             count(*)::int AS rolls,
             COALESCE(sum(u.length_m), 0)::numeric AS meters
      FROM public.mm_stock_units u
      WHERE public._mm_counts_as_received(u.status)
      GROUP BY u.style_material_id
    ),
    rej AS (
      SELECT u.style_material_id,
             count(*)::int AS rolls,
             COALESCE(sum(u.length_m), 0)::numeric AS meters
      FROM public.mm_stock_units u
      WHERE u.status = 'rejected'
      GROUP BY u.style_material_id
    ),
    keys AS (
      SELECT style_material_id FROM oldf
      UNION
      SELECT style_material_id FROM neu
      UNION
      SELECT style_material_id FROM rej
    )
    SELECT 1
    FROM keys k
    LEFT JOIN oldf ON oldf.style_material_id IS NOT DISTINCT FROM k.style_material_id
    LEFT JOIN neu ON neu.style_material_id IS NOT DISTINCT FROM k.style_material_id
    LEFT JOIN rej ON rej.style_material_id IS NOT DISTINCT FROM k.style_material_id
    WHERE COALESCE(neu.rolls, 0) <> COALESCE(oldf.rolls, 0) + COALESCE(rej.rolls, 0)
       OR abs(COALESCE(neu.meters, 0) - COALESCE(oldf.meters, 0) - COALESCE(rej.meters, 0)) > 0.001
  ) THEN
    RAISE EXCEPTION 'mm_phase1: received helper delta is not the rejected rolls';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.mm_stock_units u
  LEFT JOIN public.mm_locations l ON l.id = u.current_location_id
  WHERE NOT (
    (u.status IN ('draft', 'in_transit') AND (u.current_location_id IS NULL OR l.location_type = 'virtual'))
    OR (u.status = 'pending_qc' AND l.location_type = 'receiving')
    OR (u.status = 'in_stock' AND l.location_type IN ('receiving', 'rack', 'bin'))
    OR (u.status = 'rejected' AND l.location_type = 'rejected')
    OR (u.status = 'issued' AND l.location_type = 'cutting')
    OR (u.status IN ('consumed', 'returned_to_supplier', 'missing', 'written_off') AND u.current_location_id IS NULL)
  );
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'mm_phase1: % illegal status/location rows', v_bad;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      (
        'mm_get_expected_board',
        $old$            AND (
              u.status = 'pending_qc'
              OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
              OR public._mm_loc_is_under(u.current_location_id, v_cut)
            )$old$,
        $new$            AND public._mm_counts_as_received(u.status)$new$,
        2::int
      ),
      (
        'mm_get_warehouse_board',
        $old$                AND (
                  u.status = 'pending_qc'
                  OR (
                    u.status = 'in_stock'
                    AND public._mm_loc_is_under(u.current_location_id, v_wh)
                  )
                  OR public._mm_loc_is_under(u.current_location_id, v_cut)
                )$old$,
        $new$                AND public._mm_counts_as_received(u.status)$new$,
        2::int
      ),
      (
        'mm_get_warehouse_board',
        $old$              AND (
                u.status = 'pending_qc'
                OR (u.status = 'in_stock' AND public._mm_loc_is_under(u.current_location_id, v_wh))
                OR public._mm_loc_is_under(u.current_location_id, v_cut)
              )$old$,
        $new$              AND public._mm_counts_as_received(u.status)$new$,
        2::int
      ),
      (
        'mm_get_style_warehouse',
        $old$AND public._mm_loc_is_under(u.current_location_id, v_cut)), 0) AS rolls_issued$old$,
        $new$AND u.status = 'issued'), 0) AS rolls_issued$new$,
        2::int
      ),
      (
        'mm_get_style_warehouse',
        $old$AND public._mm_loc_is_under(u.current_location_id, v_cut)), 0) AS qty_issued$old$,
        $new$AND u.status = 'issued'), 0) AS qty_issued$new$,
        2::int
      ),
      (
        'mm_get_warehouse_dashboard',
        $old$AND public._mm_loc_is_under(u.current_location_id, v_wh)$old$,
        $new$AND public._mm_is_on_hand(u.status, (SELECT l.location_type FROM public.mm_locations l WHERE l.id = u.current_location_id))
        AND public._mm_loc_is_under(u.current_location_id, v_wh)$new$,
        10::int
      ),
      (
        'mm_list_rack_master',
        $old$WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'$old$,
        $new$WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND public._mm_is_on_hand(u.status, loc.location_type)$new$,
        1::int
      ),
      (
        'mm_get_rack_ops_board',
        $old$WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND u.status = 'in_stock'$old$,
        $new$WHERE u.factory_id = v_factory AND u.current_location_id = loc.id AND public._mm_is_on_hand(u.status, loc.location_type)$new$,
        1::int
      ),
      (
        'mm_get_store_challan',
        $old$        'unit_code', u.unit_code,
        'length_m', u.length_m,$old$,
        $new$        'unit_code', u.unit_code,
        'status', u.status,
        'length_m', u.length_m,$new$,
        1::int
      ),
      (
        'mm_save_lay_consumptions',
        $old$v_unit.status, 'in_stock', v_unit.current_location_id, v_cut,$old$,
        $new$v_unit.status, 'issued', v_unit.current_location_id, v_cut,$new$,
        1::int
      ),
      (
        'mm_save_lay_consumptions',
        $old$    SET status = 'in_stock',
        current_location_id = v_cut,$old$,
        $new$    SET status = 'issued',
        current_location_id = v_cut,$new$,
        1::int
      ),
      (
        'mm_save_lay_consumptions',
        $old$    ELSIF v_closing <= 0 AND v_consumed_ok THEN
      v_new_status := 'consumed';
    END IF;$old$,
        $new$    ELSIF v_closing <= 0 AND v_consumed_ok THEN
      v_new_status := 'consumed';
      v_new_loc := NULL;
    END IF;$new$,
        1::int
      )
    ) AS t(fname, old_s, new_s, expect)
  LOOP
    SELECT count(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fname;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'mm_phase1: expected one %, found %', r.fname, v_cnt;
    END IF;

    SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fname;

    v_sql := pg_get_functiondef(v_oid);
    v_n := (length(v_sql) - length(replace(v_sql, r.old_s, ''))) / length(r.old_s);
    IF v_n <> r.expect THEN
      RAISE EXCEPTION 'mm_phase1: % expected % marker hits, found %', r.fname, r.expect, v_n;
    END IF;
    EXECUTE replace(v_sql, r.old_s, r.new_s);
  END LOOP;

  IF strpos((SELECT prosrc FROM pg_proc WHERE proname = 'mm_dispatch_mill_rolls' AND pronamespace = 'public'::regnamespace), 'v_snap, ''in_transit'', v_mill') = 0 THEN
    RAISE EXCEPTION 'mm_phase1: mill dispatch body changed';
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE proname = 'mm_create_store_challan' AND pronamespace = 'public'::regnamespace), 'status = ''issued''') = 0 THEN
    RAISE EXCEPTION 'mm_phase1: store challan no longer sets issued';
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE proname = 'mm_save_lay_consumptions' AND pronamespace = 'public'::regnamespace), 'v_new_loc := NULL') = 0 THEN
    RAISE EXCEPTION 'mm_phase1: lay consume did not clear location';
  END IF;

  SELECT u.id, mill.id, rack.id
    INTO v_id, v_mill, v_rack
  FROM public.mm_stock_units u
  JOIN public.mm_locations mill ON mill.factory_id = u.factory_id AND mill.code = 'MILL'
  JOIN public.mm_locations rack ON rack.factory_id = u.factory_id AND rack.location_type = 'rack'
  WHERE u.status = 'issued'
  LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'mm_phase1: no issued roll to probe';
  END IF;

  BEGIN
    UPDATE public.mm_stock_units
    SET status = 'in_transit', current_location_id = v_mill
    WHERE id = v_id;
    RAISE EXCEPTION 'PROBE_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'PROBE_OK' THEN
      RAISE EXCEPTION 'mm_phase1: in_transit at MILL was rejected: %', SQLERRM;
    END IF;
  END;

  BEGIN
    UPDATE public.mm_stock_units
    SET current_location_id = v_rack
    WHERE id = v_id;
    RAISE EXCEPTION 'mm_phase1: issued roll was allowed on a rack';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'MM_STATE:%' THEN
      RAISE;
    END IF;
  END;
END;
$mm$;

NOTIFY pgrst, 'reload schema';
;
