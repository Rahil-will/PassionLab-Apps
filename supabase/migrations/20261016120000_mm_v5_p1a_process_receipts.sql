-- =====================================================================
-- v5 Phase 1A part 3 (non-destructive): process types, processing / fabric
-- vendors in challans, receipts and rolls; machines and lots read as empty;
-- defect names from Material settings. RPC output keys unchanged.
-- Parts 1-2 (vendors, constructions, requirement fields, features) are live.
-- =====================================================================
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
SET LOCAL check_function_bodies = off;

-- ---------- 5. process types: trimmed; machines and lots gone ----------
ALTER TABLE public.mm_process_types ADD COLUMN IF NOT EXISTS resets_qc boolean NOT NULL DEFAULT true;
UPDATE public.mm_process_types SET resets_qc = (resets_testing OR resets_inspection);

CREATE OR REPLACE FUNCTION public.mm_get_v4_config()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok(jsonb_build_object(
    'fabric_v4', true,
    'stages', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'factory_id' ORDER BY s.seq)
                        FROM public.mm_fabric_stages s WHERE s.factory_id = v_factory), '[]'::jsonb),
    'facilities', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'kind', x->>'name') FROM (
        SELECT jsonb_build_object('id', v.id, 'kind', CASE WHEN v.ownership = 'internal' THEN 'inhouse' ELSE 'vendor' END,
          'ownership', v.ownership, 'code', v.code, 'name', v.name, 'address', v.address, 'contact', v.contact,
          'remarks', v.remarks, 'is_active', v.is_active, 'process_type_ids', '[]'::jsonb) AS x
        FROM public.mm_fabric_vendors v WHERE v.factory_id = v_factory
        UNION ALL
        SELECT jsonb_build_object('id', v.id, 'kind', 'process_unit', 'ownership', v.ownership, 'code', v.code, 'name', v.name,
          'address', v.address, 'contact', v.contact, 'remarks', v.remarks, 'is_active', v.is_active,
          'process_type_ids', to_jsonb(v.process_type_ids))
        FROM public.mm_processing_vendors v WHERE v.factory_id = v_factory AND v.ownership = 'external') q), '[]'::jsonb),
    'machines', '[]'::jsonb,
    'process_types', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'sort_order', t.sort_order, 'active', t.active,
        'output_stage_code', t.output_stage_code, 'default_return_mode', 'same_rolls', 'output_unit_form', NULL,
        'resets_testing', t.resets_qc, 'resets_inspection', t.resets_qc, 'resets_qc', t.resets_qc,
        'machine_kinds', '[]'::jsonb) ORDER BY t.sort_order, t.name)
        FROM public.mm_process_types t WHERE t.factory_id = v_factory), '[]'::jsonb),
    'unit_forms', '["roll","lap","pieces"]'::jsonb,
    'width_forms', '["tubular","open"]'::jsonb,
    'grades', '["A","B","C","fents","rags"]'::jsonb,
    'machine_kinds', '[]'::jsonb
  ));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_list_processes()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok(jsonb_build_object(
    'inhouse_unit', (SELECT jsonb_build_object('id', v.id, 'name', v.name) FROM public.mm_processing_vendors v
                     WHERE v.factory_id = v_factory AND v.ownership = 'internal' AND v.is_active ORDER BY v.created_at LIMIT 1),
    'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'output_stage_code', t.output_stage_code,
      'output_stage_label', (SELECT s.label FROM public.mm_fabric_stages s WHERE s.factory_id = v_factory AND s.code = t.output_stage_code),
      'output_unit_form', 'keep', 'active', t.active, 'sort_order', t.sort_order,
      'makes_fabric', false, 'done_inhouse', t.done_inhouse, 'done_external', t.done_external,
      'challan_fields', t.challan_fields, 'machine_kinds', '[]'::jsonb, 'resets_qc', t.resets_qc,
      'vendor_ids', COALESCE((SELECT jsonb_agg(v.id ORDER BY v.name) FROM public.mm_processing_vendors v
                              WHERE v.factory_id = v_factory AND v.ownership = 'external' AND t.id = ANY (v.process_type_ids)), '[]'::jsonb),
      'vendors', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'is_active', v.is_active) ORDER BY v.name)
                           FROM public.mm_processing_vendors v
                           WHERE v.factory_id = v_factory AND v.ownership = 'external' AND t.id = ANY (v.process_type_ids)), '[]'::jsonb),
      'vendor_count', (SELECT count(*) FROM public.mm_processing_vendors v
                       WHERE v.factory_id = v_factory AND v.ownership = 'external' AND v.is_active AND t.id = ANY (v.process_type_ids)),
      'machines', '[]'::jsonb,
      'in_use', EXISTS (SELECT 1 FROM public.mm_process_challans c WHERE c.process_type_id = t.id))
      ORDER BY t.active DESC, t.sort_order, t.name)
    FROM public.mm_process_types t WHERE t.factory_id = v_factory
  ), '[]'::jsonb)));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_save_process(p_row jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_id uuid; v_name text; v_stage text; v_t public.mm_process_types%ROWTYPE;
  v_in boolean; v_ext boolean; v_active boolean; v_fields jsonb; v_actor uuid;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  BEGIN v_id := NULLIF(p_row->>'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid id'); END;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_t FROM public.mm_process_types WHERE id = v_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Process not found'); END IF;
  END IF;
  v_name := NULLIF(btrim(COALESCE(p_row->>'name', '')), '');
  IF v_name IS NULL THEN RETURN public._mm_err('REQUIRED', 'Process name is required'); END IF;
  IF EXISTS (SELECT 1 FROM public.mm_process_types t WHERE t.factory_id = v_factory AND lower(btrim(t.name)) = lower(v_name) AND t.id IS DISTINCT FROM v_id) THEN
    RETURN public._mm_err('DUPLICATE', 'A process with that name already exists');
  END IF;
  v_stage := NULLIF(upper(btrim(COALESCE(p_row->>'output_stage_code', ''))), '');
  IF v_stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_fabric_stages s WHERE s.factory_id = v_factory AND s.code = v_stage) THEN
    RETURN public._mm_err('INVALID', 'Unknown stage');
  END IF;
  v_in     := COALESCE((p_row->>'done_inhouse')::boolean, v_t.done_inhouse, false);
  v_ext    := COALESCE((p_row->>'done_external')::boolean, v_t.done_external, true);
  v_active := COALESCE((p_row->>'active')::boolean, v_t.active, true);
  IF v_active AND NOT v_in AND NOT v_ext THEN RETURN public._mm_err('REQUIRED', 'Tick In-house, External or both'); END IF;
  IF p_row ? 'challan_fields' THEN
    BEGIN v_fields := public._mm_clean_challan_fields(p_row->'challan_fields');
    EXCEPTION WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM); END;
  ELSE
    v_fields := COALESCE(v_t.challan_fields, '[]'::jsonb);
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code, resets_qc,
                                         done_inhouse, done_external, challan_fields, created_by, updated_by)
    VALUES (v_factory, v_name, COALESCE(NULLIF(p_row->>'sort_order', '')::int, (SELECT COALESCE(max(sort_order), 0) + 1 FROM public.mm_process_types WHERE factory_id = v_factory)),
            v_active, v_stage, v_stage IS NOT NULL, v_in, v_ext, v_fields, v_actor, v_actor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.mm_process_types SET name = v_name, output_stage_code = v_stage, resets_qc = v_stage IS NOT NULL, active = v_active,
      sort_order = COALESCE(NULLIF(p_row->>'sort_order', '')::int, sort_order),
      done_inhouse = v_in, done_external = v_ext, challan_fields = v_fields,
      updated_at = now(), updated_by = v_actor
    WHERE id = v_id;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_save_process_type_rules(p_row jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_id uuid; v_stage text; v_reset boolean;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_id := NULLIF(p_row->>'id','')::uuid;
  v_stage := NULLIF(upper(btrim(COALESCE(p_row->>'output_stage_code',''))), '');
  v_reset := COALESCE((p_row->>'resets_qc')::boolean, (p_row->>'resets_testing')::boolean, (p_row->>'resets_inspection')::boolean);
  IF v_stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_fabric_stages WHERE factory_id = v_factory AND code = v_stage) THEN
    RETURN public._mm_err('INVALID','Unknown stage');
  END IF;
  IF v_id IS NULL THEN
    IF NULLIF(btrim(COALESCE(p_row->>'name','')), '') IS NULL THEN RETURN public._mm_err('REQUIRED','Name is required'); END IF;
    INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code, resets_qc, created_by, updated_by)
    VALUES (v_factory, btrim(p_row->>'name'), COALESCE((p_row->>'sort_order')::int, 100), COALESCE((p_row->>'active')::boolean, true),
      v_stage, COALESCE(v_reset, true), public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.mm_process_types SET
      name = COALESCE(NULLIF(btrim(COALESCE(p_row->>'name','')), ''), name),
      sort_order = COALESCE((p_row->>'sort_order')::int, sort_order),
      active = COALESCE((p_row->>'active')::boolean, active),
      output_stage_code = v_stage,
      resets_qc = COALESCE(v_reset, resets_qc),
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Process type not found'); END IF;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE','That process name is already used');
END $function$;

CREATE OR REPLACE FUNCTION public._mm_v4_seed_masters(p_factory uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cut_stages text[] := ARRAY['DYED','PRINTED','FINISHED'];
BEGIN
  INSERT INTO public.mm_fabric_stages (factory_id, code, label, seq, can_cut, is_initial) VALUES
    (p_factory, 'GREIGE',   'Greige',                         10, false, true),
    (p_factory, 'RFD',      'RFD (ready for dyeing)',         20, false, false),
    (p_factory, 'PFD',      'PFD (prepared for dyeing)',      30, false, false),
    (p_factory, 'DYED',     'Dyed',                           50, true,  false),
    (p_factory, 'PRINTED',  'Printed',                        60, true,  false),
    (p_factory, 'FINISHED', 'Finished',                       70, true,  false)
  ON CONFLICT (factory_id, code) DO NOTHING;
  UPDATE public.mm_fabric_stages SET is_active = false WHERE factory_id = p_factory AND code = 'PFGD';

  PERFORM public._mm_inhouse_process_vendor(p_factory);

  UPDATE public.mm_process_types SET output_stage_code = 'DYED'
   WHERE factory_id = p_factory AND lower(name) = 'dyeing' AND output_stage_code IS NULL;
  UPDATE public.mm_process_types SET output_stage_code = 'PRINTED'
   WHERE factory_id = p_factory AND lower(name) = 'printing' AND output_stage_code IS NULL;
  INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code, resets_qc)
  SELECT p_factory, v.name, v.so, true, v.stage, v.rq
  FROM (VALUES ('Scouring & Bleaching', 5, 'RFD', true), ('Finishing', 6, 'FINISHED', true), ('Compacting', 7, NULL, true)) AS v(name, so, stage, rq)
  WHERE NOT EXISTS (SELECT 1 FROM public.mm_process_types t WHERE t.factory_id = p_factory AND lower(t.name) = lower(v.name));

  UPDATE public.mm_type_test_fields SET required_at_stages = v_cut_stages
   WHERE factory_id = p_factory AND is_active AND required_at_stages = '{}';
END $function$;

SELECT pg_temp.fx('_mm_proc_apply_return_line', $o$test_valid_from_round = CASE WHEN COALESCE(v_t.resets_testing, true)$o$, $n$test_valid_from_round = CASE WHEN COALESCE(v_t.resets_qc, true)$n$);
SELECT pg_temp.fx('_mm_proc_apply_return_line', $o$insp_valid_from_round = CASE WHEN COALESCE(v_t.resets_inspection, true)$o$, $n$insp_valid_from_round = CASE WHEN COALESCE(v_t.resets_qc, true)$n$);
SELECT pg_temp.fx('_mm_proc_apply_return_line', $o$COALESCE(NEW.unit_form, v_t.output_unit_form, unit_form)$o$, $n$COALESCE(NEW.unit_form, unit_form)$n$, 2);

-- process challans: processing vendor, no machine, no lots
SELECT pg_temp.fx('mm_proc_get_challan', $o$      'unit', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'ownership', f.ownership) FROM public.mm_facilities f WHERE f.id = v_c.unit_facility_id),$o$,
  $n$      'unit', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'ownership', f.ownership) FROM public.mm_processing_vendors f WHERE f.id = v_c.unit_facility_id),$n$);
SELECT pg_temp.fx('mm_proc_get_challan', $o$      'place', (SELECT CASE WHEN f.kind = 'inhouse' AND f.ownership = 'internal' THEN 'inhouse' ELSE 'external' END FROM public.mm_facilities f WHERE f.id = v_c.unit_facility_id),
      'machine', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) FROM public.mm_machines m WHERE m.id = v_c.machine_id),$o$,
  $n$      'place', (SELECT CASE WHEN f.ownership = 'internal' THEN 'inhouse' ELSE 'external' END FROM public.mm_processing_vendors f WHERE f.id = v_c.unit_facility_id),
      'machine', NULL,$n$);
SELECT pg_temp.fx('mm_proc_get_challan', $o$                         'default_return_mode', t.default_return_mode, 'output_unit_form', t.output_unit_form, 'resets_testing', t.resets_testing, 'resets_inspection', t.resets_inspection)$o$,
  $n$                         'default_return_mode', 'same_rolls', 'output_unit_form', NULL, 'resets_testing', t.resets_qc, 'resets_inspection', t.resets_qc)$n$);
SELECT pg_temp.fx('mm_proc_get_challan', $o$    'lots', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', lt.id, 'lot_no', lt.lot_no, 'started_at', lt.started_at, 'ended_at', lt.ended_at,
          'remarks', lt.remarks, 'machine', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) FROM public.mm_machines m WHERE m.id = lt.machine_id),
          'out_line_ids', COALESCE((SELECT jsonb_agg(l.id) FROM public.mm_process_out_lines l WHERE l.lot_id = lt.id), '[]'::jsonb)) ORDER BY lt.lot_no)
        FROM public.mm_process_lots lt WHERE lt.challan_id = v_c.id), '[]'::jsonb),$o$, $n$    'lots', '[]'::jsonb,$n$);

SELECT pg_temp.fx('mm_proc_list_challans', $o$      'place', (SELECT CASE WHEN f.kind = 'inhouse' AND f.ownership = 'internal' THEN 'inhouse' ELSE 'external' END FROM public.mm_facilities f WHERE f.id = c.unit_facility_id),
      'machine', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) FROM public.mm_machines m WHERE m.id = c.machine_id),$o$,
  $n$      'place', (SELECT CASE WHEN f.ownership = 'internal' THEN 'inhouse' ELSE 'external' END FROM public.mm_processing_vendors f WHERE f.id = c.unit_facility_id),
      'machine', NULL,$n$);
SELECT pg_temp.fx('mm_proc_list_challans', $o$      'unit', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'ownership', f.ownership) FROM public.mm_facilities f WHERE f.id = c.unit_facility_id),
      'legacy_vendor', (SELECT v.name FROM public.mm_process_vendors v WHERE v.id = c.vendor_id),$o$,
  $n$      'unit', (SELECT jsonb_build_object('id', f.id, 'name', f.name, 'ownership', f.ownership) FROM public.mm_processing_vendors f WHERE f.id = c.unit_facility_id),
      'legacy_vendor', NULL,$n$);

SELECT pg_temp.fx('mm_proc_send', $o$v_fac public.mm_facilities%ROWTYPE;$o$, $n$v_fac public.mm_processing_vendors%ROWTYPE;$n$);
SELECT pg_temp.fx('mm_proc_send', $o$  SELECT * INTO v_fac FROM public.mm_facilities WHERE factory_id = v_factory AND id = COALESCE(NULLIF(p_payload->>'unit_facility_id','')::uuid,
    CASE WHEN COALESCE((p_payload->>'inhouse')::boolean, false) THEN public._mm_inhouse_unit(v_factory) END);
  v_inhouse := FOUND AND v_fac.kind = 'inhouse' AND v_fac.ownership = 'internal';
  IF NOT FOUND OR NOT (v_fac.kind = 'process_unit' OR v_inhouse) THEN$o$,
  $n$  SELECT * INTO v_fac FROM public.mm_processing_vendors WHERE factory_id = v_factory AND id = COALESCE(NULLIF(p_payload->>'unit_facility_id','')::uuid,
    CASE WHEN COALESCE((p_payload->>'inhouse')::boolean, false) THEN public._mm_inhouse_process_vendor(v_factory) END);
  v_inhouse := FOUND AND v_fac.ownership = 'internal';
  IF NOT FOUND THEN$n$);
SELECT pg_temp.fx('mm_proc_send', $o$  IF EXISTS (SELECT 1 FROM public.mm_facility_process_types WHERE facility_id = v_fac.id)
     AND NOT EXISTS (SELECT 1 FROM public.mm_facility_process_types WHERE facility_id = v_fac.id AND process_type_id = v_type.id) THEN$o$,
  $n$  IF NOT v_inhouse AND cardinality(v_fac.process_type_ids) > 0 AND NOT (v_type.id = ANY (v_fac.process_type_ids)) THEN$n$);
SELECT pg_temp.fx('mm_proc_send', $o$  IF v_type.makes_fabric THEN RETURN public._mm_err('INVALID', v_type.name || ' makes fabric; receive the fabric at the gate instead'); END IF;
$o$, '');
SELECT pg_temp.fx('mm_proc_send', $o$  IF v_fac.kind = 'process_unit' AND NOT v_type.done_external THEN$o$, $n$  IF NOT v_inhouse AND NOT v_type.done_external THEN$n$);
SELECT pg_temp.fx('mm_proc_send', $o$  BEGIN v_mach := NULLIF(p_payload->>'machine_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID','Invalid machine'); END;
  IF v_mach IS NOT NULL THEN
    IF NOT v_inhouse THEN RETURN public._mm_err('INVALID','A machine is only picked for in-house processing'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mm_machines m WHERE m.id = v_mach AND m.facility_id = v_fac.id AND m.is_active
                   AND (m.process_type_id IS NULL OR m.process_type_id = v_type.id)) THEN
      RETURN public._mm_err('INVALID','Pick a machine of ' || v_type.name);
    END IF;
  END IF;
$o$, '');
SELECT pg_temp.fx('mm_proc_send', $o$      machine_id = v_mach, field_values = v_fv$o$, $n$      field_values = v_fv$n$);

SELECT pg_temp.fx('mm_qc_get_roll', $o$LEFT JOIN public.mm_facilities f ON f.id = c.unit_facility_id$o$, $n$LEFT JOIN public.mm_processing_vendors f ON f.id = c.unit_facility_id$n$);
SELECT pg_temp.fx('mm_rpt_process_loss', $o$LEFT JOIN public.mm_facilities f ON f.id = c.unit_facility_id$o$, $n$LEFT JOIN public.mm_processing_vendors f ON f.id = c.unit_facility_id$n$);
CREATE OR REPLACE FUNCTION public.mm_rpt_quality_by_machine(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok(jsonb_build_object('rows', '[]'::jsonb));
END $function$;

-- receipts: fabric vendors; no machine / shift / to-facility
SELECT pg_temp.fx('mm_get_fpt_summary', $o$(SELECT x.name FROM public.mm_facilities x WHERE x.id = c.from_facility_id)$o$, $n$(SELECT x.name FROM public.mm_fabric_vendors x WHERE x.id = c.from_facility_id)$n$);
SELECT pg_temp.fx('mm_wh_get_receipt', $o$      'from', (SELECT jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind) FROM public.mm_facilities x WHERE x.id = v_c.from_facility_id),$o$,
  $n$      'from', (SELECT jsonb_build_object('id', x.id, 'name', x.name, 'kind', CASE WHEN x.ownership = 'internal' THEN 'inhouse' ELSE 'vendor' END) FROM public.mm_fabric_vendors x WHERE x.id = v_c.from_facility_id),$n$);
SELECT pg_temp.fx('mm_wh_get_receipt', $o$      'machine', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) FROM public.mm_machines m WHERE m.id = v_c.machine_id)),$o$, $n$      'machine', NULL),$n$);
SELECT pg_temp.fx('mm_wh_list_receipts', $o$FROM public.mm_facilities x WHERE x.id = c.from_facility_id$o$, $n$FROM public.mm_fabric_vendors x WHERE x.id = c.from_facility_id$n$);

SELECT pg_temp.fx('mm_wh_receive', $o$v_from public.mm_facilities%ROWTYPE;$o$, $n$v_from public.mm_fabric_vendors%ROWTYPE;$n$);
SELECT pg_temp.fx('mm_wh_receive', $o$    SELECT * INTO v_from FROM public.mm_facilities WHERE id = NULLIF(p_payload->>'from_facility_id', '')::uuid AND factory_id = v_factory;
    IF v_from.id IS NULL OR v_from.kind <> 'vendor' THEN$o$,
  $n$    SELECT * INTO v_from FROM public.mm_fabric_vendors WHERE id = NULLIF(p_payload->>'from_facility_id', '')::uuid AND factory_id = v_factory;
    IF v_from.id IS NULL OR v_from.ownership <> 'external' THEN$n$);
SELECT pg_temp.fx('mm_wh_receive', $o$    SELECT * INTO v_from FROM public.mm_facilities
    WHERE id = COALESCE(NULLIF(p_payload->>'from_facility_id', '')::uuid, public._mm_inhouse_unit(v_factory)) AND factory_id = v_factory;$o$,
  $n$    SELECT * INTO v_from FROM public.mm_fabric_vendors
    WHERE id = COALESCE(NULLIF(p_payload->>'from_facility_id', '')::uuid, public._mm_inhouse_fabric_vendor(v_factory)) AND factory_id = v_factory;$n$);
SELECT pg_temp.fx('mm_wh_receive', $o$  IF v_src = 'internal' AND NULLIF(p_payload->>'machine_id', '') IS NOT NULL THEN
    v_mach := (p_payload->>'machine_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.mm_machines WHERE id = v_mach AND factory_id = v_factory AND is_active) THEN
      RETURN public._mm_err('INVALID', 'Pick an active machine');
    END IF;
$o$, $n$  IF false THEN
$n$);
SELECT pg_temp.fx('mm_wh_receive', $o$    fabric_id, stage_code, color_ref, machine_id, shift, to_facility_id)$o$, $n$    fabric_id, stage_code, color_ref)$n$);
SELECT pg_temp.fx('mm_wh_receive', $o$    f.id, v_stage, v_colour, v_mach, NULLIF(btrim(COALESCE(p_payload->>'shift', '')), ''),
    (SELECT id FROM public.mm_facilities WHERE factory_id = v_factory AND kind = 'warehouse' AND is_active ORDER BY created_at LIMIT 1))$o$,
  $n$    f.id, v_stage, v_colour)$n$);
SELECT pg_temp.fx('mm_wh_receive', $o$      machine_id = COALESCE(v_mach, r.machine_id), shift = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'shift', '')), ''), r.shift),
$o$, '');

-- rolls: no machine / shift
SELECT pg_temp.fx('_mm_roll_row', $o$  SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) INTO v_m FROM public.mm_machines m WHERE m.id = v_r.machine_id;
$o$, '');
SELECT pg_temp.fx('_mm_roll_row', $o$'machine', v_m, 'shift', v_r.shift, 'produced_at', v_r.produced_at,$o$, $n$'machine', NULL, 'shift', NULL, 'produced_at', v_r.produced_at,$n$);

CREATE OR REPLACE FUNCTION public.mm_set_roll_tags(p_roll_ids uuid[], p_tags jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_id uuid; v_r public.mm_rolls%ROWTYPE; v_stage text; v_n int := 0;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_stage := NULLIF(upper(COALESCE(p_tags->>'stage_code','')), '');
  IF v_stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_fabric_stages WHERE factory_id = v_factory AND code = v_stage) THEN
    RETURN public._mm_err('INVALID','Unknown stage');
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_roll_ids, '{}') LOOP
    SELECT * INTO v_r FROM public.mm_rolls WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','A selected roll was not found'); END IF;
    IF v_stage IS NOT NULL AND (v_r.process_round > 0 OR EXISTS (SELECT 1 FROM public.mm_roll_lineage WHERE child_roll_id = v_id)) THEN
      RETURN public._mm_err('INVALID', v_r.roll_code || ': stage is set by processing once a roll has been processed');
    END IF;
    UPDATE public.mm_rolls SET
      produced_at = COALESCE(NULLIF(p_tags->>'produced_at','')::timestamptz, produced_at),
      unit_form   = COALESCE(NULLIF(p_tags->>'unit_form',''), unit_form),
      width_form  = COALESCE(NULLIF(p_tags->>'width_form',''), width_form),
      grade       = COALESCE(NULLIF(p_tags->>'grade',''), grade),
      dye_lot     = COALESCE(NULLIF(p_tags->>'dye_lot',''), dye_lot),
      stage_code  = COALESCE(v_stage, stage_code),
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('updated', v_n));
EXCEPTION WHEN check_violation THEN RETURN public._mm_err('INVALID','Invalid form, width form or grade');
END $function$;

-- ---------- 6. defect names: a list in Material settings ----------
SELECT pg_temp.fx('mm_qc_get_scope', $o$    'defect_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name)
        FROM public.mm_defect_types d WHERE d.factory_id = v_factory AND d.is_active), '[]'::jsonb),$o$,
  $n$    'defect_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', NULL, 'name', d) ORDER BY d)
        FROM public.factory_modules m, jsonb_array_elements_text(COALESCE(m.config->'defect_types', '[]'::jsonb)) d
        WHERE m.factory_id = v_factory AND m.module_key = 'material'), '[]'::jsonb),$n$);

UPDATE public.factory_modules m
   SET config = m.config || jsonb_build_object('defect_types', COALESCE((SELECT jsonb_agg(d.name ORDER BY d.name)
         FROM public.mm_defect_types d WHERE d.factory_id = m.factory_id AND d.is_active), '[]'::jsonb))
 WHERE m.module_key = 'material' AND NOT (m.config ? 'defect_types');

-- ---------- 7. requirement fields: JSON on the fabric type (same output as the old table) ----------
-- Part 2 blanked them; this restores the exact bundle output so the UI is unchanged.
ALTER TABLE public.mm_fabric_types ADD COLUMN IF NOT EXISTS requirement_fields jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE public.mm_fabric_types t
   SET requirement_fields = COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.seq, f.label)
         FROM public.mm_type_requirement_fields f WHERE f.type_id = t.id), '[]'::jsonb)
 WHERE t.requirement_fields = '[]'::jsonb;

SELECT pg_temp.fx('mm_get_config_bundle', $o$    'requirement_fields', '[]'::jsonb,$o$,
  $n$    'requirement_fields', COALESCE((
      SELECT jsonb_agg(f ORDER BY (f->>'seq')::int, f->>'label')
      FROM public.mm_fabric_types t, jsonb_array_elements(t.requirement_fields) f WHERE t.factory_id = v_factory
    ), '[]'::jsonb),$n$);
SELECT pg_temp.fx('mm_get_config_bundle', $o$    'attribute_defs', '[]'::jsonb$o$,
  $n$    'attribute_defs', COALESCE((
      SELECT jsonb_agg(f || jsonb_build_object('applies_to', 'material', 'data_type', 'text', 'options', '[]'::jsonb)
                       ORDER BY (f->>'seq')::int, f->>'label')
      FROM public.mm_fabric_types t, jsonb_array_elements(t.requirement_fields) f
      WHERE t.factory_id = v_factory AND (f->>'is_active')::boolean
    ), '[]'::jsonb)$n$);

CREATE OR REPLACE FUNCTION public.mm_save_type_requirement_fields(p_type_id uuid, p_fields jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_old jsonb; v_new jsonb := '[]'::jsonb; v_field jsonb; v_prev jsonb;
  v_seq int := 0; v_id uuid; v_ids uuid[] := '{}'; v_label text; v_key text; v_actor uuid := auth.uid();
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'mm_config required'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT requirement_fields INTO v_old FROM public.mm_fabric_types WHERE id = p_type_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric type not found'); END IF;
  IF jsonb_typeof(COALESCE(p_fields, '[]'::jsonb)) <> 'array' THEN
    RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'fields must be a JSON array');
  END IF;
  FOR v_field IN SELECT * FROM jsonb_array_elements(COALESCE(p_fields, '[]'::jsonb)) LOOP
    v_label := btrim(COALESCE(v_field->>'label', ''));
    IF v_label = '' THEN RETURN public._mm_err('REQUIRED_ATTR_MISSING', 'Each parameter needs a name'); END IF;
    v_seq := v_seq + 1;
    v_key := COALESCE(NULLIF(public._mm_slugify(v_label), ''), 'attr');
    IF v_key = ANY (SELECT x->>'key' FROM jsonb_array_elements(v_new) x) THEN CONTINUE; END IF;
    SELECT x INTO v_prev FROM jsonb_array_elements(v_old) x
     WHERE x->>'id' = NULLIF(v_field->>'id', '') OR x->>'key' = v_key
     ORDER BY (x->>'id' = NULLIF(v_field->>'id', '')) DESC NULLS LAST LIMIT 1;
    v_id := COALESCE((v_prev->>'id')::uuid, gen_random_uuid());
    v_ids := array_append(v_ids, v_id);
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'factory_id', v_factory, 'type_id', p_type_id, 'key', v_key, 'label', v_label,
      'remarks', NULLIF(btrim(COALESCE(v_field->>'remarks', '')), ''), 'seq', v_seq, 'is_active', true,
      'row_version', COALESCE((v_prev->>'row_version')::int, 0) + 1,
      'created_at', COALESCE(v_prev->'created_at', to_jsonb(now())), 'created_by', COALESCE(v_prev->'created_by', to_jsonb(v_actor)),
      'updated_at', now(), 'updated_by', v_actor));
  END LOOP;
  -- fields left out stay on the list, switched off (as before)
  SELECT v_new || COALESCE(jsonb_agg(CASE WHEN (x->>'is_active')::boolean
           THEN x || jsonb_build_object('is_active', false, 'row_version', (x->>'row_version')::int + 1, 'updated_at', now(), 'updated_by', v_actor)
           ELSE x END), '[]'::jsonb)
    INTO v_new
    FROM jsonb_array_elements(v_old) x
   WHERE NOT ((x->>'id')::uuid = ANY (v_ids)) AND NOT (x->>'key' = ANY (SELECT y->>'key' FROM jsonb_array_elements(v_new) y));
  UPDATE public.mm_fabric_types SET requirement_fields = v_new WHERE id = p_type_id;
  RETURN public._mm_ok(jsonb_build_object('attribute_ids', to_jsonb(v_ids)));
END $function$;

SET LOCAL check_function_bodies = on;

-- recheck: recompile every touched function with body checks on
DO $chk$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY[
    'mm_get_v4_config','mm_list_processes','mm_save_process','mm_save_process_type_rules','_mm_v4_seed_masters',
    '_mm_proc_apply_return_line','mm_proc_get_challan','mm_proc_list_challans','mm_proc_send','mm_qc_get_roll',
    'mm_rpt_process_loss','mm_rpt_quality_by_machine','mm_get_fpt_summary','mm_wh_get_receipt','mm_wh_list_receipts',
    'mm_wh_receive','_mm_roll_row','mm_set_roll_tags','mm_qc_get_scope','mm_get_config_bundle','mm_save_type_requirement_fields'])
  LOOP EXECUTE pg_get_functiondef(r.oid); END LOOP;
END $chk$;
NOTIFY pgrst, 'reload schema';
