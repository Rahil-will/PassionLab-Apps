-- Processes RPCs: where done (in-house / external), machines per process, vendors per process, challan-field template.

CREATE OR REPLACE FUNCTION public.mm_list_processes()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_unit uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT id INTO v_unit FROM public.mm_facilities
  WHERE factory_id = v_factory AND kind = 'mill' AND ownership = 'internal' AND is_active ORDER BY created_at LIMIT 1;
  RETURN public._mm_ok(jsonb_build_object(
    'inhouse_unit', (SELECT jsonb_build_object('id', f.id, 'name', f.name) FROM public.mm_facilities f WHERE f.id = v_unit),
    'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'output_stage_code', t.output_stage_code,
      'output_stage_label', (SELECT s.label FROM public.mm_fabric_stages s WHERE s.factory_id = v_factory AND s.code = t.output_stage_code),
      'output_unit_form', COALESCE(t.output_unit_form, 'keep'), 'active', t.active, 'sort_order', t.sort_order,
      'makes_fabric', t.makes_fabric, 'done_inhouse', t.done_inhouse, 'done_external', t.done_external,
      'challan_fields', t.challan_fields, 'machine_kinds', to_jsonb(COALESCE(t.machine_kinds, '{}')),
      'vendor_ids', COALESCE((SELECT jsonb_agg(f.id ORDER BY f.name) FROM public.mm_facility_process_types x JOIN public.mm_facilities f ON f.id = x.facility_id
                              WHERE x.process_type_id = t.id AND f.kind = 'process_unit'), '[]'::jsonb),
      'vendors', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'is_active', f.is_active) ORDER BY f.name)
                           FROM public.mm_facility_process_types x JOIN public.mm_facilities f ON f.id = x.facility_id
                           WHERE x.process_type_id = t.id AND f.kind = 'process_unit'), '[]'::jsonb),
      'vendor_count', (SELECT count(*) FROM public.mm_facility_process_types x JOIN public.mm_facilities f ON f.id = x.facility_id
                       WHERE x.process_type_id = t.id AND f.kind = 'process_unit' AND f.is_active),
      'machines', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name, 'machine_kind', m.machine_kind,
                              'is_active', m.is_active,
                              'in_use', EXISTS (SELECT 1 FROM public.mm_process_challans c WHERE c.machine_id = m.id)
                                     OR EXISTS (SELECT 1 FROM public.mm_rolls r WHERE r.machine_id = m.id))
                              ORDER BY m.is_active DESC, m.code)
                            FROM public.mm_machines m WHERE m.process_type_id = t.id), '[]'::jsonb),
      'in_use', EXISTS (SELECT 1 FROM public.mm_process_challans c WHERE c.process_type_id = t.id))
      ORDER BY t.active DESC, t.makes_fabric DESC, t.sort_order, t.name)
    FROM public.mm_process_types t WHERE t.factory_id = v_factory
  ), '[]'::jsonb)));
END $function$;

-- Process send: in-house option, process where-done rules, optional in-house machine, challan field values.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_proc_send(jsonb)'::regprocedure);
  IF position('v_fv jsonb' in d) > 0 THEN RETURN; END IF;

  d := replace(d, 'v_uom text; v_qty numeric; v_kg numeric;',
                  'v_uom text; v_qty numeric; v_kg numeric; v_mach uuid; v_fv jsonb := ''{}''::jsonb; v_f jsonb; v_val text;');
  d := replace(d, $a$SELECT * INTO v_fac FROM public.mm_facilities WHERE id = NULLIF(p_payload->>'unit_facility_id','')::uuid AND factory_id = v_factory;$a$,
    $b$SELECT * INTO v_fac FROM public.mm_facilities WHERE factory_id = v_factory AND id = COALESCE(NULLIF(p_payload->>'unit_facility_id','')::uuid,
    CASE WHEN COALESCE((p_payload->>'inhouse')::boolean, false) THEN public._mm_inhouse_unit(v_factory) END);$b$);
  d := replace(d, $a$IF NOT FOUND OR v_fac.kind <> 'process_unit' THEN RETURN public._mm_err('INVALID','Pick a processing unit'); END IF;$a$,
    $b$IF NOT FOUND OR NOT (v_fac.kind = 'process_unit' OR (v_fac.kind = 'mill' AND v_fac.ownership = 'internal')) THEN
    RETURN public._mm_err('INVALID','Pick in-house or a process vendor');
  END IF;$b$);
  d := replace(d, $a$    RETURN public._mm_err('INVALID','This unit does not do ' || v_type.name);
  END IF;$a$, $b$    RETURN public._mm_err('INVALID','This unit does not do ' || v_type.name);
  END IF;
  IF v_type.makes_fabric THEN RETURN public._mm_err('INVALID', v_type.name || ' makes fabric. Use New mill batch.'); END IF;
  IF v_fac.kind = 'mill' AND NOT v_type.done_inhouse THEN
    RETURN public._mm_err('INVALID', v_type.name || ' is not done in-house. Tick In-house on the process in Settings.');
  END IF;
  IF v_fac.kind = 'process_unit' AND NOT v_type.done_external THEN
    RETURN public._mm_err('INVALID', v_type.name || ' is done in-house only');
  END IF;
  BEGIN v_mach := NULLIF(p_payload->>'machine_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID','Invalid machine'); END;
  IF v_mach IS NOT NULL THEN
    IF v_fac.kind <> 'mill' THEN RETURN public._mm_err('INVALID','A machine is only picked for in-house processing'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mm_machines m WHERE m.id = v_mach AND m.facility_id = v_fac.id AND m.is_active
                   AND (m.process_type_id IS NULL OR m.process_type_id = v_type.id)) THEN
      RETURN public._mm_err('INVALID','Pick a machine of ' || v_type.name);
    END IF;
  END IF;
  FOR v_f IN SELECT * FROM jsonb_array_elements(COALESCE(v_type.challan_fields, '[]'::jsonb)) LOOP
    v_val := NULLIF(btrim(COALESCE(p_payload->'field_values'->>(v_f->>'key'), p_payload->>(v_f->>'key'), '')), '');
    IF v_val IS NULL THEN
      IF COALESCE((v_f->>'required')::boolean, false) THEN RETURN public._mm_err('REQUIRED', (v_f->>'label') || ' is required'); END IF;
      CONTINUE;
    END IF;
    IF v_f->>'type' = 'number' AND v_val !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN public._mm_err('INVALID', (v_f->>'label') || ' must be a number');
    END IF;
    IF v_f->>'type' = 'select' AND NOT (to_jsonb(v_val) <@ COALESCE(v_f->'options', '[]'::jsonb)) THEN
      RETURN public._mm_err('INVALID', (v_f->>'label') || ': pick one of the options');
    END IF;
    v_fv := v_fv || jsonb_build_object(v_f->>'key', v_val);
  END LOOP;$b$);
  d := replace(d, $a$  SET target_color = NULLIF(btrim(COALESCE(p_payload->>'target_color', '')), ''),
      target_shade = NULLIF(btrim(COALESCE(p_payload->>'target_shade', '')), '')
  WHERE id = v_ch;$a$, $b$  SET target_color = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'target_color', '')), ''), v_fv->>'target_color'),
      target_shade = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'target_shade', '')), ''), v_fv->>'target_shade'),
      machine_id = v_mach, field_values = v_fv
  WHERE id = v_ch;$b$);
  IF position('_mm_inhouse_unit(v_factory)' in d) = 0 OR position('Pick in-house or a process vendor' in d) = 0
     OR position('makes fabric. Use New mill batch' in d) = 0 OR position('machine_id = v_mach' in d) = 0 THEN
    RAISE EXCEPTION 'mm_proc_send patch failed';
  END IF;
  EXECUTE d;
END $mig$;

-- Challan reads: machine + field values + template
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_proc_get_challan(uuid)'::regprocedure);
  IF position('''challan_fields''' in d) = 0 THEN
    d := replace(d, $a$'target_color', v_c.target_color, 'target_shade', v_c.target_shade,$a$,
      $b$'target_color', v_c.target_color, 'target_shade', v_c.target_shade,
      'place', (SELECT CASE WHEN f.kind = 'mill' AND f.ownership = 'internal' THEN 'inhouse' ELSE 'external' END FROM public.mm_facilities f WHERE f.id = v_c.unit_facility_id),
      'machine', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) FROM public.mm_machines m WHERE m.id = v_c.machine_id),
      'field_values', v_c.field_values,
      'challan_fields', (SELECT t.challan_fields FROM public.mm_process_types t WHERE t.id = v_c.process_type_id),$b$);
    IF position('''challan_fields''' in d) = 0 THEN RAISE EXCEPTION 'get_challan patch failed'; END IF;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.mm_proc_list_challans(jsonb)'::regprocedure);
  IF position('''field_values''' in d) = 0 THEN
    d := replace(d, $a$'reprocess_reason', c.reprocess_reason,$a$,
      $b$'reprocess_reason', c.reprocess_reason,
      'place', (SELECT CASE WHEN f.kind = 'mill' AND f.ownership = 'internal' THEN 'inhouse' ELSE 'external' END FROM public.mm_facilities f WHERE f.id = c.unit_facility_id),
      'machine', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name) FROM public.mm_machines m WHERE m.id = c.machine_id),
      'field_values', c.field_values,$b$);
    IF position('''field_values''' in d) = 0 THEN RAISE EXCEPTION 'list_challans patch failed'; END IF;
    EXECUTE d;
  END IF;
END $mig$;

-- Fabric makers (mill batches / mill orders): the in-house unit, any mill, or a vendor doing a fabric-making process.
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_list_partners(text,boolean)'::regprocedure);
  IF position('_mm_is_fabric_maker' in d) = 0 THEN
    d := replace(d, $a$WHERE f.factory_id = v_factory AND f.kind = v_fkind AND$a$,
      $b$WHERE f.factory_id = v_factory AND (f.kind = v_fkind OR (v_fkind = 'mill' AND public._mm_is_fabric_maker(f.id))) AND$b$);
    d := replace(d, $a$'id', f.id, 'name', f.name, 'contact', f.contact,$a$,
      $b$'id', f.id, 'name', f.name, 'inhouse', (f.kind = 'mill' AND f.ownership = 'internal'), 'contact', f.contact,$b$);
    IF position('_mm_is_fabric_maker' in d) = 0 OR position('''inhouse''' in d) = 0 THEN RAISE EXCEPTION 'list_partners patch failed'; END IF;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.mm_mill_save_batch_v4(jsonb)'::regprocedure);
  IF position('_mm_is_fabric_maker' in d) = 0 THEN
    d := replace(d, $a$IF NOT EXISTS (SELECT 1 FROM public.mm_facilities WHERE id = v_fac AND factory_id = v_factory AND kind = 'mill') THEN$a$,
      $b$IF NOT EXISTS (SELECT 1 FROM public.mm_facilities WHERE id = v_fac AND factory_id = v_factory AND public._mm_is_fabric_maker(id)) THEN$b$);
    IF position('_mm_is_fabric_maker' in d) = 0 THEN RAISE EXCEPTION 'save_batch_v4 patch failed'; END IF;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.mm_mill_update_batch_v4(uuid,jsonb)'::regprocedure);
  IF position('_mm_is_fabric_maker' in d) = 0 THEN
    d := replace(d, $a$AND factory_id = v_factory AND kind = 'mill';$a$, $b$AND factory_id = v_factory AND public._mm_is_fabric_maker(id);$b$);
    IF position('_mm_is_fabric_maker' in d) = 0 THEN RAISE EXCEPTION 'update_batch_v4 patch failed'; END IF;
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.mm_mill_order_save(jsonb)'::regprocedure);
  IF position('_mm_is_fabric_maker' in d) = 0 THEN
    d := replace(d, $a$WHERE id = v_fac AND factory_id = v_factory AND kind = 'mill') THEN$a$,
      $b$WHERE id = v_fac AND factory_id = v_factory AND public._mm_is_fabric_maker(id)) THEN$b$);
    IF position('_mm_is_fabric_maker' in d) = 0 THEN RAISE EXCEPTION 'mill_order_save patch failed'; END IF;
    EXECUTE d;
  END IF;
END $mig$;

-- mm_save_process (vendor links stay on mm_save_partner process_type_ids)
CREATE OR REPLACE FUNCTION public.mm_save_process(p_row jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_id uuid; v_name text; v_stage text; v_form text; v_t public.mm_process_types%ROWTYPE;
  v_makes boolean; v_in boolean; v_ext boolean; v_active boolean; v_fields jsonb; v_unit uuid; v_m jsonb; v_mid uuid;
  v_code text; v_kind text; v_keep uuid[] := '{}'; v_actor uuid;
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
  v_form := COALESCE(NULLIF(p_row->>'output_unit_form', ''), 'keep');
  IF v_form NOT IN ('keep', 'roll', 'lap') THEN RETURN public._mm_err('INVALID', 'Comes back as must be keep, roll or lap'); END IF;
  v_makes  := COALESCE((p_row->>'makes_fabric')::boolean, v_t.makes_fabric, false);
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
    INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code, default_return_mode,
                                         resets_testing, resets_inspection, output_unit_form, makes_fabric, done_inhouse,
                                         done_external, challan_fields, created_by, updated_by)
    VALUES (v_factory, v_name, COALESCE(NULLIF(p_row->>'sort_order', '')::int, (SELECT COALESCE(max(sort_order), 0) + 1 FROM public.mm_process_types WHERE factory_id = v_factory)),
            v_active, v_stage, 'same_rolls', v_stage IS NOT NULL, v_stage IS NOT NULL, NULLIF(v_form, 'keep'),
            v_makes, v_in, v_ext, v_fields, v_actor, v_actor)
    RETURNING * INTO v_t;
    v_id := v_t.id;
  ELSE
    UPDATE public.mm_process_types SET name = v_name, output_stage_code = v_stage, output_unit_form = NULLIF(v_form, 'keep'),
      resets_testing = v_stage IS NOT NULL, resets_inspection = v_stage IS NOT NULL, active = v_active,
      sort_order = COALESCE(NULLIF(p_row->>'sort_order', '')::int, sort_order),
      makes_fabric = v_makes, done_inhouse = v_in, done_external = v_ext, challan_fields = v_fields,
      updated_at = now(), updated_by = v_actor
    WHERE id = v_id RETURNING * INTO v_t;
  END IF;

  -- Vendors that do this process (process vendors only)
  IF p_row ? 'machines' THEN
    IF jsonb_typeof(p_row->'machines') <> 'array' THEN RETURN public._mm_err('INVALID', 'Machines must be a list'); END IF;
    v_unit := public._mm_inhouse_unit(v_factory);
    v_kind := COALESCE(v_t.machine_kinds[1], CASE WHEN v_makes THEN 'knitting' ELSE 'other' END);
    BEGIN
      FOR v_m IN SELECT * FROM jsonb_array_elements(p_row->'machines') LOOP
        v_code := NULLIF(btrim(COALESCE(v_m->>'code', '')), '');
        IF v_code IS NULL THEN RETURN public._mm_err('REQUIRED', 'Every machine needs a code'); END IF;
        v_mid := NULLIF(v_m->>'id', '')::uuid;
        IF v_mid IS NOT NULL THEN
          UPDATE public.mm_machines SET code = v_code,
            name = COALESCE(NULLIF(btrim(COALESCE(v_m->>'name', '')), ''), v_code),
            machine_kind = COALESCE(NULLIF(v_m->>'machine_kind', ''), machine_kind),
            is_active = COALESCE((v_m->>'is_active')::boolean, true), process_type_id = v_id,
            row_version = row_version + 1, updated_at = now(), updated_by = v_actor
          WHERE id = v_mid AND factory_id = v_factory AND facility_id = v_unit;
          IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Machine ' || v_code || ' not found'); END IF;
        ELSE
          INSERT INTO public.mm_machines (factory_id, facility_id, machine_kind, code, name, specs, is_active, process_type_id, created_by, updated_by)
          VALUES (v_factory, v_unit, COALESCE(NULLIF(v_m->>'machine_kind', ''), v_kind), v_code,
                  COALESCE(NULLIF(btrim(COALESCE(v_m->>'name', '')), ''), v_code), '{}'::jsonb,
                  COALESCE((v_m->>'is_active')::boolean, true), v_id, v_actor, v_actor)
          RETURNING id INTO v_mid;
        END IF;
        v_keep := array_append(v_keep, v_mid);
      END LOOP;
    EXCEPTION
      WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE', 'That machine code is already used in-house');
      WHEN check_violation THEN RETURN public._mm_err('INVALID', 'Pick a valid machine type');
      WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid machine id');
    END;
    UPDATE public.mm_machines SET is_active = false, updated_at = now(), updated_by = v_actor
    WHERE process_type_id = v_id AND is_active AND NOT (id = ANY (v_keep));
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $function$;

