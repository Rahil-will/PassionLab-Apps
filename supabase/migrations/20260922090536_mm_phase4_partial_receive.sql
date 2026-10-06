ALTER TABLE public.mm_in_challan_lines
  ADD COLUMN IF NOT EXISTS line_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid,
  ADD COLUMN IF NOT EXISTS remarks text;

ALTER TABLE public.mm_in_challan_lines DROP CONSTRAINT IF EXISTS mm_in_challan_lines_status_chk;
ALTER TABLE public.mm_in_challan_lines
  ADD CONSTRAINT mm_in_challan_lines_status_chk
  CHECK (line_status = ANY (ARRAY['pending','received','missing']));

ALTER TABLE public.mm_in_challans DROP CONSTRAINT IF EXISTS mm_in_challans_status_chk;
ALTER TABLE public.mm_in_challans
  ADD CONSTRAINT mm_in_challans_status_chk
  CHECK (status = ANY (ARRAY['pending','received','partial','short_closed']));

UPDATE public.mm_in_challan_lines l
SET line_status = CASE WHEN u.status = 'missing' THEN 'missing' ELSE 'received' END,
    received_at = COALESCE(l.received_at, c.received_at, now())
FROM public.mm_stock_units u
JOIN public.mm_in_challans c ON c.id = u.in_challan_id
WHERE l.stock_unit_id = u.id
  AND u.status IS DISTINCT FROM 'in_transit'
  AND l.line_status = 'pending';

CREATE OR REPLACE FUNCTION public._mm_refresh_in_challan_status(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_open integer;
  v_got integer;
  v_status text;
BEGIN
  SELECT
    count(*) FILTER (WHERE u.status = 'in_transit'),
    count(*) FILTER (WHERE u.status IS DISTINCT FROM 'in_transit' AND u.status IS DISTINCT FROM 'missing')
  INTO v_open, v_got
  FROM public.mm_stock_units u
  WHERE u.in_challan_id = p_id;
  v_status := CASE
    WHEN COALESCE(v_open, 0) = 0 AND COALESCE(v_got, 0) > 0 THEN 'received'
    WHEN COALESCE(v_got, 0) > 0 AND COALESCE(v_open, 0) > 0 THEN 'partial'
    ELSE 'pending'
  END;
  UPDATE public.mm_in_challans
  SET status = v_status,
      received_at = CASE WHEN v_status = 'received' THEN COALESCE(received_at, now()) ELSE received_at END,
      received_by = CASE WHEN v_status = 'received' THEN COALESCE(received_by, public._mm_actor_id()) ELSE received_by END,
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_id;
  RETURN v_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_in_challan(
  p_id uuid, p_roll_edits jsonb, p_row_version integer, p_missing_unit_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_recv uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_status text;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.source <> 'mill' THEN RETURN public._mm_err('INVALID', 'Not a mill challan'); END IF;
  IF v_ch.status IN ('received', 'short_closed') THEN RETURN public._mm_err('ALREADY', 'Already received'); END IF;
  IF v_ch.status NOT IN ('pending', 'partial') THEN RETURN public._mm_err('INVALID', 'Challan cannot be received'); END IF;
  IF v_ch.row_version IS DISTINCT FROM COALESCE(p_row_version, v_ch.row_version) THEN
    RETURN public._mm_err('STALE_VERSION', 'Reload and try again');
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_missing_unit_ids, ARRAY[]::uuid[])) AS mid(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mm_stock_units u
      WHERE u.id = mid.id AND u.in_challan_id = v_ch.id AND u.factory_id = v_factory AND u.status = 'in_transit'
    )
  ) THEN
    RETURN public._mm_err('INVALID', 'A missing roll is not in transit on this challan');
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_recv := public._mm_recv_loc(v_factory);
  FOR v_unit IN
    SELECT * FROM public.mm_stock_units
    WHERE in_challan_id = v_ch.id AND factory_id = v_factory AND status = 'in_transit'
      AND NOT (id = ANY (COALESCE(p_missing_unit_ids, ARRAY[]::uuid[])))
  LOOP
    UPDATE public.mm_stock_units SET
      status = 'pending_qc', current_location_id = v_recv,
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_unit.id;
    UPDATE public.mm_in_challan_lines
    SET line_status = 'received', received_at = now(), received_by = public._mm_actor_id()
    WHERE stock_unit_id = v_unit.id AND challan_id = v_ch.id;
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'TRANSFER', public._mm_mill_length(v_unit), v_unit.status, 'pending_qc',
      v_unit.current_location_id, v_recv, 'mm_in_challans', v_ch.id, 'Warehouse receive'
    );
    v_n := v_n + 1;
  END LOOP;
  v_status := public._mm_refresh_in_challan_status(v_ch.id);
  PERFORM public._mm_apply_clearance(ARRAY(
    SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id
  ));
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'status', v_status, 'received_rolls', v_n));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_in_challan(p_id uuid, p_roll_edits jsonb, p_row_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.mm_receive_mill_in_challan(p_id, p_roll_edits, p_row_version, NULL::uuid[]);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_receive_in_challan_lines(p_challan_id uuid, p_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_missing uuid[];
  v_version integer;
BEGIN
  IF p_unit_ids IS NULL OR cardinality(p_unit_ids) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Select the rolls that arrived');
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_unit_ids) AS wanted(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mm_stock_units u
      WHERE u.id = wanted.id AND u.in_challan_id = p_challan_id AND u.status = 'in_transit'
    )
  ) THEN
    RETURN public._mm_err('INVALID', 'A selected roll is not still in transit');
  END IF;
  SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[]), c.row_version
    INTO v_missing, v_version
  FROM public.mm_in_challans c
  LEFT JOIN public.mm_stock_units u
    ON u.in_challan_id = c.id AND u.status = 'in_transit' AND NOT (u.id = ANY (p_unit_ids))
  WHERE c.id = p_challan_id
  GROUP BY c.row_version;
  RETURN public.mm_receive_mill_in_challan(p_challan_id, '[]'::jsonb, v_version, v_missing);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_short_close_in_challan(p_challan_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_unit public.mm_stock_units%ROWTYPE;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'A reason is required');
  END IF;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_challan_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  IF v_ch.status NOT IN ('pending', 'partial') THEN
    RETURN public._mm_err('INVALID', 'Only an open challan can be short-closed');
  END IF;
  FOR v_unit IN
    SELECT * FROM public.mm_stock_units
    WHERE in_challan_id = v_ch.id AND factory_id = v_factory AND status = 'in_transit'
    FOR UPDATE
  LOOP
    PERFORM public._mm_ledger(
      v_factory, v_unit.id, 'WRITE_OFF', COALESCE(v_unit.qty_available, v_unit.length_m, 0),
      v_unit.status, 'missing', v_unit.current_location_id, NULL,
      'mm_in_challans', v_ch.id, 'missing in transit'
    );
    UPDATE public.mm_stock_units
    SET status = 'missing', current_location_id = NULL,
        row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_unit.id;
    UPDATE public.mm_in_challan_lines
    SET line_status = 'missing', remarks = btrim(p_reason)
    WHERE stock_unit_id = v_unit.id AND challan_id = v_ch.id;
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    RETURN public._mm_err('INVALID', 'No missing rolls to close');
  END IF;
  UPDATE public.mm_in_challans
  SET status = 'short_closed', row_version = row_version + 1,
      updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = v_ch.id;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id, 'status', 'short_closed', 'written_off', v_n));
END;
$function$;

REVOKE ALL ON FUNCTION public._mm_refresh_in_challan_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_receive_mill_in_challan(uuid, jsonb, integer, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_receive_in_challan_lines(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_short_close_in_challan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_receive_mill_in_challan(uuid, jsonb, integer, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_receive_in_challan_lines(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_short_close_in_challan(uuid, text) TO authenticated, service_role;

DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.oid = 'public.mm_save_warehouse_inspections(uuid,jsonb)'::regprocedure;
  d := replace(d,
    'IF v_ch.source = ''mill'' AND v_ch.status <> ''received'' THEN',
    'IF v_ch.source = ''mill'' AND v_ch.status NOT IN (''received'', ''partial'', ''short_closed'') THEN');
  IF position('short_closed' in d) = 0 THEN
    RAISE EXCEPTION 'inspection receive gate patch missed';
  END IF;
  EXECUTE d;
END
$do$;;
