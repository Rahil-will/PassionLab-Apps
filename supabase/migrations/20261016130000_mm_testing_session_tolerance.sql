-- =====================================================================
-- Testing: checkbox input, tolerance per parameter, document header,
-- test sessions, and a fix for per-roll supersede.
-- Run AFTER 20261016120000_mm_v5_p1a_process_receipts.sql.
--
-- 1. mm_type_test_fields:
--    - data_type adds 'checkbox';
--    - tolerance_on / tolerance_min / tolerance_max (number / decimal only).
-- 2. "Required at stages" leaves the UI. New parameters default to the
--    factory's cuttable stages, so the cutting gate keeps working.
-- 3. mm_qc_tests.session_id: one grid save = one session.
-- 4. mm_qc_get_scope adds:
--    - fields[].tolerance_*;
--    - document (the receipt / challan header for the testing page);
--    - sessions[] (past saves for this document).
-- 5. Fix: a grid save used to supersede the previous roll's test (same
--    scope). Now each roll supersedes only its own last test.
-- =====================================================================

-- ---------- 1. columns ----------
ALTER TABLE public.mm_type_test_fields
  ADD COLUMN IF NOT EXISTS tolerance_on  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tolerance_min numeric,
  ADD COLUMN IF NOT EXISTS tolerance_max numeric;
ALTER TABLE public.mm_type_test_fields DROP CONSTRAINT IF EXISTS mm_type_test_fields_data_type_chk;
ALTER TABLE public.mm_type_test_fields ADD CONSTRAINT mm_type_test_fields_data_type_chk
  CHECK (data_type IN ('text', 'number', 'decimal', 'select', 'checkbox'));
ALTER TABLE public.mm_type_test_fields DROP CONSTRAINT IF EXISTS mm_type_test_fields_tolerance_chk;
ALTER TABLE public.mm_type_test_fields ADD CONSTRAINT mm_type_test_fields_tolerance_chk
  CHECK (NOT tolerance_on OR (data_type IN ('number', 'decimal')
         AND (tolerance_min IS NOT NULL OR tolerance_max IS NOT NULL)
         AND (tolerance_min IS NULL OR tolerance_max IS NULL OR tolerance_min <= tolerance_max)));

ALTER TABLE public.mm_qc_tests ADD COLUMN IF NOT EXISTS session_id uuid;
CREATE INDEX IF NOT EXISTS mm_qc_tests_session_idx ON public.mm_qc_tests (session_id) WHERE session_id IS NOT NULL;

-- ---------- 2. tolerance helper: keys whose value is outside tolerance ----------
CREATE OR REPLACE FUNCTION public._mm_qc_out_of_tolerance(p_type_id uuid, p_values jsonb)
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(f.key ORDER BY f.seq), '{}')
  FROM public.mm_type_test_fields f
  CROSS JOIN LATERAL (SELECT public._mm_safe_numeric(p_values ->> f.key) AS v) n
  WHERE f.type_id = p_type_id AND f.is_active AND f.tolerance_on AND n.v IS NOT NULL
    AND ((f.tolerance_min IS NOT NULL AND n.v < f.tolerance_min) OR (f.tolerance_max IS NOT NULL AND n.v > f.tolerance_max))
$function$;

-- ---------- 3. save parameters: checkbox + tolerance; stages set by default ----------
CREATE OR REPLACE FUNCTION public.mm_save_type_test_fields(p_type_id uuid, p_fields jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_field jsonb; v_seq int := 0; v_id uuid; v_ids uuid[] := '{}';
  v_label text; v_key text; v_dt text; v_options jsonb; v_tol boolean; v_min numeric; v_max numeric;
  v_cut text[]; v_actor uuid := public._mm_actor_id();
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF NOT EXISTS (SELECT 1 FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric type not found');
  END IF;
  IF jsonb_typeof(COALESCE(p_fields, '[]'::jsonb)) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;
  v_cut := ARRAY(SELECT code FROM public.mm_fabric_stages WHERE factory_id = v_factory AND can_cut ORDER BY seq);

  FOR v_field IN SELECT * FROM jsonb_array_elements(COALESCE(p_fields, '[]'::jsonb)) LOOP
    v_label := btrim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each test field needs a name'); END IF;
    v_seq := v_seq + 1;
    v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
    v_dt := COALESCE(NULLIF(v_field->>'data_type', ''), 'text');
    IF v_dt NOT IN ('text', 'number', 'decimal', 'select', 'checkbox') THEN
      RETURN public._mm_err('INVALID', v_label || ': unknown input type');
    END IF;
    v_options := CASE WHEN v_dt = 'select' AND jsonb_typeof(v_field->'options') = 'array' THEN v_field->'options' ELSE '[]'::jsonb END;
    v_tol := COALESCE((v_field->>'tolerance_on')::boolean, false) AND v_dt IN ('number', 'decimal');
    v_min := CASE WHEN v_tol THEN public._mm_safe_numeric(v_field->>'tolerance_min') END;
    v_max := CASE WHEN v_tol THEN public._mm_safe_numeric(v_field->>'tolerance_max') END;
    IF v_tol AND v_min IS NULL AND v_max IS NULL THEN
      RETURN public._mm_err('REQUIRED', v_label || ': enter a min or max for the tolerance');
    END IF;
    IF v_min IS NOT NULL AND v_max IS NOT NULL AND v_min > v_max THEN
      RETURN public._mm_err('INVALID', v_label || ': tolerance min is above max');
    END IF;
    v_id := NULLIF(v_field->>'id', '')::uuid;

    IF v_id IS NOT NULL THEN
      UPDATE public.mm_type_test_fields SET
        key = v_key, label = v_label, data_type = v_dt, options = v_options,
        tolerance_on = v_tol, tolerance_min = v_min, tolerance_max = v_max,
        seq = v_seq, is_active = true, row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_id AND factory_id = v_factory AND type_id = p_type_id
      RETURNING id INTO v_id;
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO public.mm_type_test_fields (factory_id, type_id, key, label, data_type, options,
        tolerance_on, tolerance_min, tolerance_max, required_at_stages, seq, created_by, updated_by)
      VALUES (v_factory, p_type_id, v_key, v_label, v_dt, v_options, v_tol, v_min, v_max, v_cut, v_seq, v_actor, v_actor)
      ON CONFLICT (type_id, key) DO UPDATE SET
        label = EXCLUDED.label, data_type = EXCLUDED.data_type, options = EXCLUDED.options,
        tolerance_on = EXCLUDED.tolerance_on, tolerance_min = EXCLUDED.tolerance_min, tolerance_max = EXCLUDED.tolerance_max,
        seq = EXCLUDED.seq, is_active = true, row_version = public.mm_type_test_fields.row_version + 1,
        updated_at = now(), updated_by = v_actor
      RETURNING id INTO v_id;
    END IF;
    v_ids := array_append(v_ids, v_id);
  END LOOP;

  UPDATE public.mm_type_test_fields SET is_active = false, row_version = row_version + 1, updated_at = now(), updated_by = v_actor
  WHERE type_id = p_type_id AND factory_id = v_factory AND is_active AND NOT (id = ANY (v_ids));
  RETURN public._mm_ok(jsonb_build_object('attribute_ids', to_jsonb(v_ids)));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_list_test_fields(p_fabric_type_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    BEGIN v_factory := public._mm_require_ops('mm_inventory');
    EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options,
      'tolerance_on', f.tolerance_on, 'tolerance_min', f.tolerance_min, 'tolerance_max', f.tolerance_max) ORDER BY f.seq, f.label)
    FROM public.mm_type_test_fields f
    WHERE f.factory_id = v_factory AND f.type_id = p_fabric_type_id AND f.is_active), '[]'::jsonb));
END $function$;

-- ---------- 4. testing page data: fields + tolerance, document header, sessions ----------
CREATE OR REPLACE FUNCTION public.mm_qc_get_scope(p_scope_kind text, p_scope_id uuid, p_roll_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_rolls uuid[]; v_ft uuid; v_stage text; v_doc jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF p_scope_kind = 'rolls' THEN
    v_rolls := ARRAY(SELECT id FROM public.mm_rolls WHERE factory_id = v_factory AND id = ANY (COALESCE(p_roll_ids,'{}')));
  ELSE
    v_rolls := ARRAY(SELECT public._mm_qc_scope_rolls(v_factory, p_scope_kind, p_scope_id));
    IF p_roll_ids IS NOT NULL THEN v_rolls := ARRAY(SELECT x FROM unnest(v_rolls) x WHERE x = ANY (p_roll_ids)); END IF;
  END IF;
  SELECT min(fabric_type_id::text)::uuid, mode() WITHIN GROUP (ORDER BY stage_code) INTO v_ft, v_stage FROM public.mm_rolls WHERE id = ANY (v_rolls);

  IF p_scope_kind = 'in_challan' THEN
    SELECT jsonb_build_object(
      'kind', CASE WHEN c.receipt_source = 'external' THEN 'grn' ELSE 'internal_receipt' END,
      'kind_label', CASE WHEN c.receipt_source = 'external' THEN 'GRN' ELSE 'Internal receipt' END,
      'id', c.id, 'no', COALESCE(c.grn_no, c.challan_no), 'date', COALESCE(c.received_at, c.created_at),
      'party', (SELECT v.name FROM public.mm_fabric_vendors v WHERE v.id = c.from_facility_id),
      'party_ref', NULLIF(concat_ws(' / ', c.party_challan_no, c.invoice_ref), ''),
      'po_no', c.po_no, 'purpose', c.purpose, 'stage_code', c.stage_code,
      'stage_label', (SELECT s.label FROM public.mm_fabric_stages s WHERE s.factory_id = c.factory_id AND s.code = c.stage_code),
      'colour', c.color_ref,
      'fabric', (SELECT jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name, 'uom', f.uom) FROM public.mm_fabrics f WHERE f.id = c.fabric_id),
      'process', NULL, 'returned_at', NULL, 'remarks', c.remarks)
    INTO v_doc FROM public.mm_in_challans c WHERE c.id = p_scope_id AND c.factory_id = v_factory;
  ELSIF p_scope_kind = 'process_challan' THEN
    SELECT jsonb_build_object(
      'kind', 'process_challan', 'kind_label', 'Process challan',
      'id', c.id, 'no', c.challan_no, 'date', c.sent_at,
      'party', (SELECT v.name FROM public.mm_processing_vendors v WHERE v.id = c.unit_facility_id),
      'party_ref', c.unit_ref_no, 'po_no', NULL, 'purpose', c.purpose, 'stage_code', v_stage,
      'stage_label', (SELECT s.label FROM public.mm_fabric_stages s WHERE s.factory_id = c.factory_id AND s.code = v_stage),
      'colour', NULLIF(concat_ws(' / ', c.target_color, c.target_shade), ''),
      'fabric', (SELECT jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name, 'uom', f.uom)
                 FROM public.mm_rolls r JOIN public.mm_fabrics f ON f.id = r.fabric_id WHERE r.id = ANY (v_rolls) LIMIT 1),
      'process', (SELECT t.name FROM public.mm_process_types t WHERE t.id = c.process_type_id),
      'returned_at', c.returned_at, 'remarks', c.remarks)
    INTO v_doc FROM public.mm_process_challans c WHERE c.id = p_scope_id AND c.factory_id = v_factory;
  END IF;
  v_doc := v_doc || jsonb_build_object('roll_count', COALESCE(array_length(v_rolls, 1), 0));

  RETURN public._mm_ok(jsonb_build_object(
    'scope_kind', p_scope_kind, 'scope_id', p_scope_id, 'stage_code', v_stage,
    'document', v_doc,
    'fabric_type', (SELECT jsonb_build_object('id', id, 'name', name, 'fpt_max_points', fpt_max_points) FROM public.mm_fabric_types WHERE id = v_ft),
    'mixed_fabric_types', (SELECT count(DISTINCT fabric_type_id) > 1 FROM public.mm_rolls WHERE id = ANY (v_rolls)),
    'fields', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options,
          'test_level', f.test_level, 'required', v_stage = ANY (f.required_at_stages), 'required_at_stages', to_jsonb(f.required_at_stages),
          'tolerance_on', f.tolerance_on, 'tolerance_min', f.tolerance_min, 'tolerance_max', f.tolerance_max) ORDER BY f.seq)
        FROM public.mm_type_test_fields f WHERE f.factory_id = v_factory AND f.type_id = v_ft AND f.is_active), '[]'::jsonb),
    'defect_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', NULL, 'name', d) ORDER BY d)
        FROM public.factory_modules m, jsonb_array_elements_text(COALESCE(m.config->'defect_types', '[]'::jsonb)) d
        WHERE m.factory_id = v_factory AND m.module_key = 'material'), '[]'::jsonb),
    'rolls', COALESCE((SELECT jsonb_agg(public._mm_roll_row(x) ORDER BY (SELECT roll_code FROM public.mm_rolls WHERE id = x)) FROM unnest(v_rolls) x), '[]'::jsonb),
    'sessions', COALESCE((SELECT jsonb_agg(s ORDER BY s->>'tested_at' DESC) FROM (
        SELECT jsonb_build_object('session_id', t.session_id, 'tested_at', max(t.tested_at),
          'tested_by', (SELECT p.full_name FROM public.profiles p WHERE p.id = min(t.created_by::text)::uuid),
          'rolls', count(*), 'pass', count(*) FILTER (WHERE t.result = 'pass'),
          'hold', count(*) FILTER (WHERE t.result = 'hold'), 'fail', count(*) FILTER (WHERE t.result = 'fail')) AS s
        FROM public.mm_qc_tests t
        WHERE p_scope_kind <> 'rolls' AND t.factory_id = v_factory AND t.scope_kind = p_scope_kind AND t.scope_id = p_scope_id
          AND t.voided_at IS NULL AND t.session_id IS NOT NULL
        GROUP BY t.session_id) q), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'session_id', t.session_id, 'result', t.result, 'tested_at', t.tested_at, 'field_values', t.field_values,
          'voided', t.voided_at IS NOT NULL, 'superseded', EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL))
          ORDER BY t.tested_at DESC)
        FROM public.mm_qc_tests t WHERE p_scope_kind <> 'rolls' AND t.scope_kind = p_scope_kind AND t.scope_id = p_scope_id), '[]'::jsonb)
  ));
END $function$;

-- ---------- 5. single test save: session id, checkbox check, per-roll supersede ----------
CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  p_old := replace(p_old, E'\r', ''); p_new := replace(p_new, E'\r', '');
  v_def := replace(pg_get_functiondef(v_oid), E'\r', '');
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 120); END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;

SELECT pg_temp.fx('mm_qc_save_test',
  $o$      RETURN public._mm_err('INVALID', v_k || ' must be a number');
    END IF;$o$,
  $n$      RETURN public._mm_err('INVALID', v_k || ' must be a number');
    END IF;
    IF v_dt = 'checkbox' AND jsonb_typeof(v_v) NOT IN ('boolean', 'null') THEN
      RETURN public._mm_err('INVALID', v_k || ' must be ticked or not');
    END IF;$n$);
SELECT pg_temp.fx('mm_qc_save_test',
  $o$  IF v_sup IS NULL AND v_kind <> 'rolls' THEN$o$,
  $n$  IF v_sup IS NULL AND v_kind <> 'rolls' AND NOT COALESCE((p_payload->>'per_roll')::boolean, false) THEN$n$);
SELECT pg_temp.fx('mm_qc_save_test',
  $o$    field_values, result, origin, supersedes_id, tested_at, remarks, created_by)$o$,
  $n$    field_values, result, origin, supersedes_id, tested_at, remarks, created_by, session_id)$n$);
SELECT pg_temp.fx('mm_qc_save_test',
  $o$    NULLIF(p_payload->>'remarks',''), v_actor)$o$,
  $n$    NULLIF(p_payload->>'remarks',''), v_actor, NULLIF(p_payload->>'session_id','')::uuid)$n$);

-- ---------- 6. grid save = one session; each roll supersedes only its own last test ----------
CREATE OR REPLACE FUNCTION public.mm_qc_save_test_grid(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
-- One session = one save of the grid against a receipt (in_challan) or a process challan.
-- rows: [{roll_id, result: pass|fail|hold, values: {key: value}, remarks}]. Rows without a result are skipped.
-- All or nothing: the first bad row rolls the whole grid back and is named in the error.
DECLARE v_kind text := p_payload->>'scope_kind'; v_sid uuid; v_row jsonb; v_r jsonb; v_n int := 0; v_code text;
  v_ids jsonb := '[]'::jsonb; v_session uuid := gen_random_uuid(); v_roll uuid; v_sup uuid; v_ft uuid;
  v_oot text[]; v_oot_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_kind IS NULL OR v_kind NOT IN ('in_challan','process_challan') THEN
    RETURN public._mm_err('INVALID','Test against a receipt or a process challan');
  END IF;
  BEGIN v_sid := NULLIF(p_payload->>'scope_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID','Invalid scope'); END;
  IF v_sid IS NULL THEN RETURN public._mm_err('REQUIRED','Pick the receipt or challan'); END IF;
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' THEN RETURN public._mm_err('REQUIRED','Nothing to save'); END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payload->'rows') LOOP
    CONTINUE WHEN NULLIF(v_row->>'result','') IS NULL;
    v_roll := NULLIF(v_row->>'roll_id','')::uuid;
    SELECT roll_code, fabric_type_id INTO v_code, v_ft FROM public.mm_rolls WHERE id = v_roll;
    SELECT t.id INTO v_sup FROM public.mm_qc_tests t JOIN public.mm_qc_test_rolls tr ON tr.test_id = t.id
     WHERE tr.roll_id = v_roll AND t.scope_kind = v_kind AND t.scope_id = v_sid AND t.voided_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.mm_qc_tests s WHERE s.supersedes_id = t.id AND s.voided_at IS NULL)
     ORDER BY t.tested_at DESC, t.created_at DESC LIMIT 1;
    v_r := public.mm_qc_save_test(jsonb_build_object(
      'scope_kind', v_kind, 'scope_id', v_sid,
      'roll_ids', jsonb_build_array(v_roll),
      'site_side', CASE WHEN v_kind = 'process_challan' THEN COALESCE(NULLIF(p_payload->>'site_side',''), 'warehouse') ELSE 'warehouse' END,
      'origin', COALESCE(NULLIF(p_payload->>'origin',''), 'own'),
      'result', v_row->>'result',
      'field_values', COALESCE(v_row->'values', '{}'::jsonb),
      'remarks', v_row->>'remarks',
      'per_roll', true, 'supersedes_test_id', v_sup, 'session_id', v_session));
    IF NOT COALESCE((v_r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '%: %', COALESCE(v_code, 'A roll'), COALESCE(v_r->>'message', 'could not be saved');
    END IF;
    v_ids := v_ids || COALESCE(v_r->'data'->'id', 'null'::jsonb);
    v_oot := public._mm_qc_out_of_tolerance(v_ft, COALESCE(v_row->'values', '{}'::jsonb));
    IF cardinality(v_oot) > 0 THEN
      v_oot_rows := v_oot_rows || jsonb_build_array(jsonb_build_object('roll_id', v_roll, 'roll_code', v_code, 'keys', to_jsonb(v_oot)));
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RETURN public._mm_err('REQUIRED','Set pass, fail or hold on at least one roll'); END IF;
  RETURN public._mm_ok(jsonb_build_object('saved', v_n, 'session_id', v_session, 'test_ids', v_ids, 'out_of_tolerance', v_oot_rows));
EXCEPTION WHEN raise_exception THEN
  RETURN public._mm_err('INVALID', SQLERRM);
END $function$;

GRANT EXECUTE ON FUNCTION public.mm_save_type_test_fields(uuid, jsonb), public.mm_list_test_fields(uuid),
  public.mm_qc_get_scope(text, uuid, uuid[]), public.mm_qc_save_test_grid(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._mm_qc_out_of_tolerance(uuid, jsonb) FROM PUBLIC, anon;

-- ---------- check ----------
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mm_type_test_fields' AND column_name = 'tolerance_on')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mm_qc_tests' AND column_name = 'session_id')
     OR position('per_roll' IN pg_get_functiondef('public.mm_qc_save_test'::regproc)) = 0
     OR position('session_id' IN pg_get_functiondef('public.mm_qc_save_test'::regproc)) = 0 THEN
    RAISE EXCEPTION 'testing upgrade incomplete';
  END IF;
END $chk$;
NOTIFY pgrst, 'reload schema';
