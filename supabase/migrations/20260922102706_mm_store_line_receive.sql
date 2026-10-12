ALTER TABLE public.mm_store_challan_lines
  ADD COLUMN IF NOT EXISTS line_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.profiles (id);

ALTER TABLE public.mm_store_challan_lines
  DROP CONSTRAINT IF EXISTS mm_store_challan_lines_status_chk;

ALTER TABLE public.mm_store_challan_lines
  ADD CONSTRAINT mm_store_challan_lines_status_chk
  CHECK (line_status = ANY (ARRAY['pending'::text, 'received'::text, 'missing'::text]));

ALTER TABLE public.mm_store_challans
  DROP CONSTRAINT IF EXISTS mm_store_challans_status_chk;

ALTER TABLE public.mm_store_challans
  ADD CONSTRAINT mm_store_challans_status_chk
  CHECK (status = ANY (ARRAY['pending'::text, 'received'::text, 'partial'::text]));

UPDATE public.mm_store_challan_lines l
SET line_status = 'received',
    received_at = COALESCE(l.received_at, c.received_at, now()),
    received_by = COALESCE(l.received_by, c.received_by)
FROM public.mm_store_challans c
WHERE c.id = l.challan_id
  AND c.status = 'received'
  AND l.line_status = 'pending';

CREATE OR REPLACE FUNCTION public.mm_receive_store_challan(p_id uuid, p_missing_unit_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_sc public.mm_store_challans%ROWTYPE;
  v_id uuid;
  v_unit public.mm_stock_units%ROWTYPE;
  v_missing int := 0;
  v_received int := 0;
  v_status text;
  v_missing_ids uuid[];
BEGIN
  v_missing_ids := ARRAY(
    SELECT DISTINCT x
    FROM unnest(COALESCE(p_missing_unit_ids, ARRAY[]::uuid[])) AS x
  );
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  SELECT * INTO v_sc
  FROM public.mm_store_challans
  WHERE id = p_id AND factory_id = v_factory
  FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Store challan not found'); END IF;
  IF v_sc.status IN ('received', 'partial') THEN
    RETURN public._mm_err('ALREADY', 'Already received');
  END IF;

  FOREACH v_id IN ARRAY v_missing_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.mm_store_challan_lines l
      WHERE l.challan_id = v_sc.id AND l.stock_unit_id = v_id
    ) THEN
      RETURN public._mm_err('INVALID', 'A missing roll is not on this challan');
    END IF;
    SELECT * INTO v_unit
    FROM public.mm_stock_units
    WHERE id = v_id AND factory_id = v_factory
    FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    IF v_unit.status IS DISTINCT FROM 'issued' THEN
      RETURN public._mm_err('INVALID', v_unit.unit_code || ' is not still at cutting');
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_missing_ids LOOP
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id FOR UPDATE;
    PERFORM public._mm_ledger(
      v_factory, v_id, 'WRITE_OFF', v_unit.qty_available,
      v_unit.status, 'missing',
      v_unit.current_location_id, NULL,
      'mm_store_challans', v_sc.id, 'missing at cutting receive'
    );
    UPDATE public.mm_stock_units
    SET status = 'missing',
        current_location_id = NULL,
        updated_at = now(),
        updated_by = public._mm_actor_id()
    WHERE id = v_id;
    UPDATE public.mm_store_challan_lines
    SET line_status = 'missing',
        received_at = now(),
        received_by = public._mm_actor_id()
    WHERE challan_id = v_sc.id AND stock_unit_id = v_id;
    v_missing := v_missing + 1;
  END LOOP;

  UPDATE public.mm_store_challan_lines
  SET line_status = 'received',
      received_at = now(),
      received_by = public._mm_actor_id()
  WHERE challan_id = v_sc.id
    AND line_status = 'pending'
    AND NOT (stock_unit_id = ANY (v_missing_ids));
  GET DIAGNOSTICS v_received = ROW_COUNT;

  v_status := CASE WHEN v_missing > 0 THEN 'partial' ELSE 'received' END;
  UPDATE public.mm_store_challans
  SET status = v_status,
      received_at = now(),
      received_by = public._mm_actor_id(),
      row_version = row_version + 1,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = v_sc.id;

  RETURN public._mm_ok(jsonb_build_object(
    'id', v_sc.id,
    'status', v_status,
    'received_rolls', v_received,
    'missing_rolls', v_missing
  ));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_receive_store_challan(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN public.mm_receive_store_challan(p_id, NULL::uuid[]);
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_receive_store_challan(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_receive_store_challan(uuid, uuid[]) TO authenticated, service_role;
;
