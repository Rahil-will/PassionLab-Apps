-- B6 (2026-10-09): mill dispatch to a warehouse facility with auto challan no; edit batch header; roll rows expose attributes.
ALTER TABLE public.mm_in_challans ADD COLUMN IF NOT EXISTS to_facility_id uuid REFERENCES public.mm_facilities(id);

-- 1. Roll row: add attributes (actual gsm / width / shrinkage etc. from the test fields)
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._mm_roll_row(uuid,boolean)'::regprocedure);
  d := replace(d, $a$'mill_roll_id', mr.id, 'stock_unit_id', u.id,$a$,
                  $b$'mill_roll_id', mr.id, 'stock_unit_id', u.id, 'attributes', COALESCE(u.attributes, mr.attributes, '{}'::jsonb),$b$);
  IF position($x$'attributes', COALESCE(u.attributes, mr.attributes$x$ in d) = 0 THEN RAISE EXCEPTION 'roll row replace failed'; END IF;
  EXECUTE d;
END $mig$;

-- 2. Dispatch v2: payload { mill_roll_ids? | roll_ids?, to_facility_id*, challan_no?, reference_no?, sent_at?, remarks? }
CREATE OR REPLACE FUNCTION public.mm_mill_dispatch_v2(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_ids uuid[]; v_fac public.mm_facilities%ROWTYPE; v_no text; v_res jsonb; v_on date;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('NO_PERMISSION', 'Not allowed');
  END;
  IF NOT public._mm_feature(v_factory, 'fabric_mill') THEN RETURN public._mm_err('MODULE_DISABLED', 'Fabric mill is off'); END IF;
  BEGIN
    IF jsonb_typeof(p_payload->'mill_roll_ids') = 'array' THEN
      SELECT array_agg(x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_payload->'mill_roll_ids') x;
    ELSIF jsonb_typeof(p_payload->'roll_ids') = 'array' THEN
      SELECT array_agg(m.id) INTO v_ids FROM public.mm_mill_rolls m
      WHERE m.factory_id = v_factory AND m.roll_id IN (SELECT x::uuid FROM jsonb_array_elements_text(p_payload->'roll_ids') x);
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'A roll id is not valid');
  END;
  IF v_ids IS NULL OR COALESCE(array_length(v_ids, 1), 0) = 0 THEN RETURN public._mm_err('REQUIRED', 'Select rolls to dispatch'); END IF;
  SELECT * INTO v_fac FROM public.mm_facilities
  WHERE id = NULLIF(p_payload->>'to_facility_id', '')::uuid AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('REQUIRED', 'Pick the warehouse to send to'); END IF;
  IF v_fac.kind IS DISTINCT FROM 'warehouse' OR v_fac.is_active IS FALSE THEN RETURN public._mm_err('INVALID', 'Pick an active warehouse'); END IF;
  v_on := COALESCE(NULLIF(p_payload->>'sent_at', '')::date, CURRENT_DATE);
  v_no := NULLIF(btrim(COALESCE(p_payload->>'challan_no', '')), '');
  IF v_no IS NULL THEN v_no := public._mm_next_doc(v_factory, 'MDC', v_on); END IF;
  v_res := public.mm_dispatch_mill_rolls(v_ids, v_no, NULLIF(p_payload->>'reference_no', ''),
                                         COALESCE(v_fac.name, v_fac.code), v_on, NULLIF(p_payload->>'remarks', ''));
  IF COALESCE((v_res->>'ok')::boolean, false) THEN
    UPDATE public.mm_in_challans SET to_facility_id = v_fac.id WHERE id = (v_res->'data'->>'id')::uuid;
    v_res := jsonb_set(v_res, '{data,to_facility}', jsonb_build_object('id', v_fac.id, 'code', v_fac.code, 'name', v_fac.name));
  END IF;
  RETURN v_res;
END $function$;

-- 3. Edit batch header: { batch_no?, mill_ref?, production_date?, yarn_lot?, yarn_count?, color_ref?, remarks?, facility_id?, row_version? }
CREATE OR REPLACE FUNCTION public.mm_mill_update_batch_v4(p_batch_id uuid, p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_b public.mm_mill_batches%ROWTYPE; v_fac uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('NO_PERMISSION', 'Not allowed');
  END;
  SELECT * INTO v_b FROM public.mm_mill_batches WHERE id = p_batch_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Mill batch not found'); END IF;
  IF p_payload ? 'row_version' AND NULLIF(p_payload->>'row_version', '')::int IS DISTINCT FROM v_b.row_version THEN
    RETURN public._mm_err('STALE', 'This batch was changed elsewhere. Reload and try again');
  END IF;
  IF p_payload ? 'facility_id' THEN
    SELECT id INTO v_fac FROM public.mm_facilities
    WHERE id = NULLIF(p_payload->>'facility_id', '')::uuid AND factory_id = v_factory AND kind = 'mill';
    IF v_fac IS NULL THEN RETURN public._mm_err('INVALID', 'Pick a mill'); END IF;
  END IF;
  IF p_payload ? 'batch_no' AND NULLIF(btrim(p_payload->>'batch_no'), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Mill batch number is required');
  END IF;
  BEGIN
    UPDATE public.mm_mill_batches SET
      batch_no        = CASE WHEN p_payload ? 'batch_no' THEN btrim(p_payload->>'batch_no') ELSE batch_no END,
      mill_ref        = CASE WHEN p_payload ? 'mill_ref' THEN NULLIF(btrim(p_payload->>'mill_ref'), '') ELSE mill_ref END,
      production_date = CASE WHEN p_payload ? 'production_date' THEN COALESCE(NULLIF(p_payload->>'production_date', '')::date, production_date) ELSE production_date END,
      yarn_lot        = CASE WHEN p_payload ? 'yarn_lot' THEN NULLIF(btrim(p_payload->>'yarn_lot'), '') ELSE yarn_lot END,
      yarn_count      = CASE WHEN p_payload ? 'yarn_count' THEN NULLIF(btrim(p_payload->>'yarn_count'), '') ELSE yarn_count END,
      color_ref       = CASE WHEN p_payload ? 'color_ref' THEN NULLIF(btrim(p_payload->>'color_ref'), '') ELSE color_ref END,
      remarks         = CASE WHEN p_payload ? 'remarks' THEN NULLIF(btrim(p_payload->>'remarks'), '') ELSE remarks END,
      facility_id     = COALESCE(v_fac, facility_id),
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_b.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'That mill batch number already exists');
  END;
  RETURN public.mm_mill_get_batch_v4(v_b.id);
END $function$;

GRANT EXECUTE ON FUNCTION public.mm_mill_dispatch_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_mill_update_batch_v4(uuid, jsonb) TO authenticated;
