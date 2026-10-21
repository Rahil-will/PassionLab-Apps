-- Phase 1D: values captured on New mill batch (actual GSM / width, type test fields, QC status) become real QC tests.
-- One test per roll (values differ per roll), scope = the mill batch, site = mill, stage = roll stage.
-- qc_status: pass/downgrade → pass (downgrade also sets grade B), hold/rework → hold, reject → fail.
-- Also mirrors actual GSM / width onto the roll attributes as gsm / width. Skips rolls that already have a test.
CREATE OR REPLACE FUNCTION public._mm_mill_batch_qc_from_attrs(p_batch uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_b public.mm_mill_batches%ROWTYPE; v_m record; v_fv jsonb; v_qc text; v_res text; v_tid uuid; v_n int := 0;
  v_keys text[]; v_k text; v_val text;
BEGIN
  SELECT * INTO v_b FROM public.mm_mill_batches WHERE id = p_batch;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_keys := ARRAY(SELECT f.key FROM public.mm_type_test_fields f WHERE f.factory_id = v_b.factory_id AND f.type_id = v_b.fabric_type_id AND f.is_active);
  FOR v_m IN
    SELECT mr.id, mr.roll_id, mr.attributes, r.stage_code, COALESCE(r.process_round, 0) AS round
    FROM public.mm_mill_rolls mr JOIN public.mm_rolls r ON r.id = mr.roll_id
    WHERE mr.mill_batch_id = p_batch
      AND NOT EXISTS (SELECT 1 FROM public.mm_qc_test_rolls tr WHERE tr.roll_id = mr.roll_id)
  LOOP
    v_fv := '{}'::jsonb;
    FOREACH v_k IN ARRAY v_keys LOOP
      v_val := NULLIF(btrim(COALESCE(v_m.attributes->>v_k, '')), '');
      IF v_val IS NULL AND v_k ILIKE '%gsm%' THEN v_val := NULLIF(btrim(COALESCE(v_m.attributes->>'actual_gsm', '')), ''); END IF;
      IF v_val IS NULL AND v_k ILIKE 'width%' THEN v_val := NULLIF(btrim(COALESCE(v_m.attributes->>'actual_width_in', '')), ''); END IF;
      IF v_val IS NOT NULL THEN v_fv := v_fv || jsonb_build_object(v_k, v_val); END IF;
    END LOOP;
    v_qc := lower(NULLIF(btrim(COALESCE(v_m.attributes->>'qc_status', '')), ''));
    IF v_fv = '{}'::jsonb AND COALESCE(v_qc, 'pass') NOT IN ('hold', 'rework', 'reject', 'downgrade') THEN CONTINUE; END IF;
    v_res := CASE v_qc WHEN 'reject' THEN 'fail' WHEN 'hold' THEN 'hold' WHEN 'rework' THEN 'hold' ELSE 'pass' END;
    INSERT INTO public.mm_qc_tests (factory_id, scope_kind, scope_id, site_side, site_facility_id, stage_code, fabric_type_id,
                                    field_values, result, origin, tested_at, remarks, created_by)
    VALUES (v_b.factory_id, 'mill_batch', v_b.id, 'mill', v_b.facility_id, v_m.stage_code, v_b.fabric_type_id,
            v_fv, v_res, 'own', COALESCE(v_b.production_date::timestamptz, v_b.created_at, now()),
            'Recorded at batch creation' || CASE WHEN v_qc IS NOT NULL AND v_qc <> 'pass' THEN ' · ' || v_qc ELSE '' END,
            public._mm_actor_id())
    RETURNING id INTO v_tid;
    INSERT INTO public.mm_qc_test_rolls (factory_id, test_id, roll_id, round_at_test) VALUES (v_b.factory_id, v_tid, v_m.roll_id, v_m.round);
    IF v_qc = 'downgrade' THEN UPDATE public.mm_rolls SET grade = 'B', updated_at = now() WHERE id = v_m.roll_id; END IF;
    UPDATE public.mm_mill_rolls SET attributes = attributes
      || CASE WHEN attributes ? 'gsm' OR NULLIF(attributes->>'actual_gsm', '') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('gsm', attributes->>'actual_gsm') END
      || CASE WHEN attributes ? 'width' OR NULLIF(attributes->>'actual_width_in', '') IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('width', attributes->>'actual_width_in') END
    WHERE id = v_m.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $function$;
REVOKE EXECUTE ON FUNCTION public._mm_mill_batch_qc_from_attrs(uuid) FROM anon, public, authenticated;

DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_mill_save_batch_v6(jsonb)'::regprocedure);
  d := replace(d, $a$    v_res := jsonb_set(v_res, '{data,purpose}', to_jsonb(v_purpose));$a$,
    $b$    v_res := jsonb_set(v_res, '{data,purpose}', to_jsonb(v_purpose));
    v_res := jsonb_set(v_res, '{data,qc_tests_created}', to_jsonb(public._mm_mill_batch_qc_from_attrs(v_id)));$b$);
  IF position('_mm_mill_batch_qc_from_attrs(v_id)' in d) = 0 THEN RAISE EXCEPTION 'v6 patch failed'; END IF;
  EXECUTE d;
END $mig$;

-- Backfill: batches made with the new form (L1 etc.)
SELECT b.batch_no, public._mm_mill_batch_qc_from_attrs(b.id) FROM public.mm_mill_batches b
WHERE EXISTS (SELECT 1 FROM public.mm_mill_rolls mr WHERE mr.mill_batch_id = b.id AND (mr.attributes ? 'qc_status' OR mr.attributes ? 'actual_gsm'));
