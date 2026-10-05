CREATE TABLE IF NOT EXISTS public.mm_facilities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('mill','process_unit','warehouse','vendor')),
  ownership   text NOT NULL CHECK (ownership IN ('internal','external')),
  code        text NOT NULL,
  name        text NOT NULL,
  address     text,
  contact     text,
  remarks     text,
  is_active   boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT mm_facilities_vendor_external_chk CHECK (kind <> 'vendor' OR ownership = 'external')
);
CREATE UNIQUE INDEX IF NOT EXISTS mm_facilities_code_uidx ON public.mm_facilities (factory_id, lower(code));
CREATE INDEX IF NOT EXISTS mm_facilities_kind_idx ON public.mm_facilities (factory_id, kind, is_active);
SELECT public._mm_lockdown_table('public.mm_facilities');

CREATE TABLE IF NOT EXISTS public.mm_facility_process_types (
  factory_id      uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  facility_id     uuid NOT NULL REFERENCES public.mm_facilities(id) ON DELETE CASCADE,
  process_type_id uuid NOT NULL REFERENCES public.mm_process_types(id) ON DELETE CASCADE,
  PRIMARY KEY (facility_id, process_type_id)
);
SELECT public._mm_lockdown_table('public.mm_facility_process_types');

CREATE TABLE IF NOT EXISTS public.mm_machines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id   uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  facility_id  uuid NOT NULL REFERENCES public.mm_facilities(id) ON DELETE CASCADE,
  machine_kind text NOT NULL CHECK (machine_kind IN (
    'knitting','loom','jet_dyeing','softflow','jigger','stenter','compactor',
    'printing','raising','washing','inspection','other')),
  code         text NOT NULL,
  name         text NOT NULL,
  specs        jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  row_version  integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS mm_machines_code_uidx ON public.mm_machines (facility_id, lower(code));
CREATE INDEX IF NOT EXISTS mm_machines_factory_idx ON public.mm_machines (factory_id, facility_id);
SELECT public._mm_lockdown_table('public.mm_machines');

CREATE OR REPLACE FUNCTION public._mm_machine_internal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mm_facilities f
                 WHERE f.id = NEW.facility_id AND f.factory_id = NEW.factory_id AND f.ownership = 'internal') THEN
    RAISE EXCEPTION 'Machines can only be added to an in-house facility';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mm_machines_internal_trg ON public.mm_machines;
CREATE TRIGGER mm_machines_internal_trg BEFORE INSERT OR UPDATE ON public.mm_machines
  FOR EACH ROW EXECUTE FUNCTION public._mm_machine_internal_guard();

CREATE TABLE IF NOT EXISTS public.mm_fabric_stages (
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  code       text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  label      text NOT NULL,
  seq        integer NOT NULL DEFAULT 0,
  can_cut    boolean NOT NULL DEFAULT false,
  is_initial boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (factory_id, code)
);
SELECT public._mm_lockdown_table('public.mm_fabric_stages');

ALTER TABLE public.mm_process_types
  ADD COLUMN IF NOT EXISTS output_stage_code   text,
  ADD COLUMN IF NOT EXISTS default_return_mode text NOT NULL DEFAULT 'same_rolls',
  ADD COLUMN IF NOT EXISTS resets_testing      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS resets_inspection   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS machine_kinds       text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  ALTER TABLE public.mm_process_types ADD CONSTRAINT mm_process_types_return_mode_chk
    CHECK (default_return_mode IN ('same_rolls','re_rolled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.mm_type_test_fields
  ADD COLUMN IF NOT EXISTS test_level         text NOT NULL DEFAULT 'roll',
  ADD COLUMN IF NOT EXISTS required_at_stages text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  ALTER TABLE public.mm_type_test_fields ADD CONSTRAINT mm_type_test_fields_level_chk
    CHECK (test_level IN ('roll','lot'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public._mm_next_doc(p_factory uuid, p_prefix text, p_on date DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_key text; v_n integer;
BEGIN
  v_key := p_prefix || '-' || to_char(COALESCE(p_on, CURRENT_DATE), 'YYMM');
  INSERT INTO public.mm_doc_sequences (factory_id, doc_type, next_no) VALUES (p_factory, v_key, 0)
  ON CONFLICT (factory_id, doc_type) DO NOTHING;
  UPDATE public.mm_doc_sequences SET next_no = next_no + 1
  WHERE factory_id = p_factory AND doc_type = v_key RETURNING next_no INTO v_n;
  RETURN v_key || '-' || lpad(v_n::text, 4, '0');
END $$;

CREATE OR REPLACE FUNCTION public._mm_v4_on(p_factory uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE((SELECT enabled FROM public.mm_factory_features
                   WHERE factory_id = p_factory AND feature_key = 'fabric_v4'), false);
$$;

CREATE OR REPLACE FUNCTION public._mm_v4_seed_masters(p_factory uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cut_stages text[] := ARRAY['PFGD','DYED','PRINTED','FINISHED'];
BEGIN
  INSERT INTO public.mm_fabric_stages (factory_id, code, label, seq, can_cut, is_initial) VALUES
    (p_factory, 'GREIGE',   'Greige',                         10, false, true),
    (p_factory, 'RFD',      'RFD (ready for dyeing)',         20, false, false),
    (p_factory, 'PFD',      'PFD (prepared for dyeing)',      30, false, false),
    (p_factory, 'PFGD',     'PFGD (for garment dyeing)',      40, true,  false),
    (p_factory, 'DYED',     'Dyed',                           50, true,  false),
    (p_factory, 'PRINTED',  'Printed',                        60, true,  false),
    (p_factory, 'FINISHED', 'Finished',                       70, true,  false)
  ON CONFLICT (factory_id, code) DO NOTHING;

  INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name)
  VALUES (p_factory, 'mill', 'internal', 'MILL-1', 'In-house mill'),
         (p_factory, 'warehouse', 'internal', 'WH-1', 'Fabric warehouse')
  ON CONFLICT DO NOTHING;

  UPDATE public.mm_process_types SET output_stage_code = 'DYED', default_return_mode = 're_rolled',
         machine_kinds = ARRAY['jet_dyeing','softflow','jigger']
   WHERE factory_id = p_factory AND lower(name) = 'dyeing' AND output_stage_code IS NULL;
  UPDATE public.mm_process_types SET output_stage_code = 'PRINTED', machine_kinds = ARRAY['printing']
   WHERE factory_id = p_factory AND lower(name) = 'printing' AND output_stage_code IS NULL;
  UPDATE public.mm_process_types SET machine_kinds = ARRAY['washing']
   WHERE factory_id = p_factory AND lower(name) = 'washing' AND machine_kinds = '{}';

  INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code,
         default_return_mode, resets_testing, resets_inspection, machine_kinds)
  SELECT p_factory, v.name, v.so, true, v.stage, v.mode, v.rt, v.ri, v.mk
  FROM (VALUES
    ('Scouring & Bleaching', 5, 'RFD',      're_rolled',  true, true,  ARRAY['jet_dyeing','softflow','jigger']),
    ('Finishing',            6, 'FINISHED', 'same_rolls', true, true,  ARRAY['stenter','compactor','raising']),
    ('Compacting',           7, NULL,       'same_rolls', true, false, ARRAY['compactor'])
  ) AS v(name, so, stage, mode, rt, ri, mk)
  WHERE NOT EXISTS (SELECT 1 FROM public.mm_process_types t
                    WHERE t.factory_id = p_factory AND lower(t.name) = lower(v.name));

  UPDATE public.mm_type_test_fields SET required_at_stages = v_cut_stages
   WHERE factory_id = p_factory AND is_active AND required_at_stages = '{}';

  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES (p_factory, 'fabric_v4', false) ON CONFLICT DO NOTHING;
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT factory_id FROM public.mm_factory_features LOOP
    PERFORM public._mm_v4_seed_masters(r.factory_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._mm_v4_seed_new_factory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN PERFORM public._mm_v4_seed_masters(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS mm_v4_seed_factory_trg ON public.factories;
CREATE TRIGGER mm_v4_seed_factory_trg AFTER INSERT ON public.factories
  FOR EACH ROW EXECUTE FUNCTION public._mm_v4_seed_new_factory();

CREATE OR REPLACE FUNCTION public.mm_get_v4_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  RETURN public._mm_ok(jsonb_build_object(
    'fabric_v4', public._mm_v4_on(v_factory),
    'stages', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'factory_id' ORDER BY s.seq)
                        FROM public.mm_fabric_stages s WHERE s.factory_id = v_factory), '[]'::jsonb),
    'facilities', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'kind', f.kind, 'ownership', f.ownership, 'code', f.code, 'name', f.name,
        'address', f.address, 'contact', f.contact, 'remarks', f.remarks, 'is_active', f.is_active,
        'process_type_ids', COALESCE((SELECT jsonb_agg(fp.process_type_id) FROM public.mm_facility_process_types fp
                                      WHERE fp.facility_id = f.id), '[]'::jsonb))
        ORDER BY f.kind, f.name) FROM public.mm_facilities f WHERE f.factory_id = v_factory), '[]'::jsonb),
    'machines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'facility_id', m.facility_id, 'machine_kind', m.machine_kind, 'code', m.code,
        'name', m.name, 'specs', m.specs, 'is_active', m.is_active) ORDER BY m.code)
        FROM public.mm_machines m WHERE m.factory_id = v_factory), '[]'::jsonb),
    'process_types', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'sort_order', t.sort_order, 'active', t.active,
        'output_stage_code', t.output_stage_code, 'default_return_mode', t.default_return_mode,
        'resets_testing', t.resets_testing, 'resets_inspection', t.resets_inspection,
        'machine_kinds', to_jsonb(t.machine_kinds)) ORDER BY t.sort_order, t.name)
        FROM public.mm_process_types t WHERE t.factory_id = v_factory), '[]'::jsonb),
    'unit_forms', '["roll","lap","pieces"]'::jsonb,
    'width_forms', '["tubular","open"]'::jsonb,
    'grades', '["A","B","C","fents","rags"]'::jsonb,
    'machine_kinds', '["knitting","loom","jet_dyeing","softflow","jigger","stenter","compactor","printing","raising","washing","inspection","other"]'::jsonb
  ));
END $$;

CREATE OR REPLACE FUNCTION public.mm_save_facility(p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_id uuid; v_kind text; v_own text; v_code text; v_name text; v_pt uuid;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_id   := NULLIF(p_row->>'id','')::uuid;
  v_kind := p_row->>'kind';
  v_own  := p_row->>'ownership';
  v_code := NULLIF(btrim(COALESCE(p_row->>'code','')), '');
  v_name := NULLIF(btrim(COALESCE(p_row->>'name','')), '');
  IF v_kind IS NULL OR v_kind NOT IN ('mill','process_unit','warehouse','vendor') THEN RETURN public._mm_err('INVALID','Pick a facility type'); END IF;
  IF v_own IS NULL OR v_own NOT IN ('internal','external') THEN RETURN public._mm_err('INVALID','Pick in-house or external'); END IF;
  IF v_kind = 'vendor' AND v_own = 'internal' THEN RETURN public._mm_err('INVALID','A fabric vendor is always external'); END IF;
  IF v_code IS NULL OR v_name IS NULL THEN RETURN public._mm_err('REQUIRED','Code and name are required'); END IF;
  IF v_own = 'external' AND v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.mm_machines m WHERE m.facility_id = v_id) THEN
    RETURN public._mm_err('INVALID','Remove its machines before marking this facility external');
  END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.mm_facilities (factory_id, kind, ownership, code, name, address, contact, remarks, is_active, created_by, updated_by)
      VALUES (v_factory, v_kind, v_own, v_code, v_name, NULLIF(p_row->>'address',''), NULLIF(p_row->>'contact',''),
              NULLIF(p_row->>'remarks',''), COALESCE((p_row->>'is_active')::boolean, true), public._mm_actor_id(), public._mm_actor_id())
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.mm_facilities SET kind = v_kind, ownership = v_own, code = v_code, name = v_name,
        address = NULLIF(p_row->>'address',''), contact = NULLIF(p_row->>'contact',''), remarks = NULLIF(p_row->>'remarks',''),
        is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
        row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_id AND factory_id = v_factory;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Facility not found'); END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE','That code is already used');
  END;
  IF p_row ? 'process_type_ids' THEN
    DELETE FROM public.mm_facility_process_types WHERE facility_id = v_id;
    FOR v_pt IN SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(p_row->'process_type_ids','[]'::jsonb)) x LOOP
      INSERT INTO public.mm_facility_process_types (factory_id, facility_id, process_type_id)
      SELECT v_factory, v_id, t.id FROM public.mm_process_types t WHERE t.id = v_pt AND t.factory_id = v_factory
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $$;

CREATE OR REPLACE FUNCTION public.mm_save_machine(p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_id uuid; v_fac uuid; v_code text; v_name text; v_kind text;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_id   := NULLIF(p_row->>'id','')::uuid;
  v_fac  := NULLIF(p_row->>'facility_id','')::uuid;
  v_kind := p_row->>'machine_kind';
  v_code := NULLIF(btrim(COALESCE(p_row->>'code','')), '');
  v_name := COALESCE(NULLIF(btrim(COALESCE(p_row->>'name','')), ''), v_code);
  IF v_fac IS NULL OR v_code IS NULL OR v_kind IS NULL THEN RETURN public._mm_err('REQUIRED','Facility, machine type and code are required'); END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.mm_machines (factory_id, facility_id, machine_kind, code, name, specs, is_active, created_by, updated_by)
      VALUES (v_factory, v_fac, v_kind, v_code, v_name, COALESCE(p_row->'specs','{}'::jsonb),
              COALESCE((p_row->>'is_active')::boolean, true), public._mm_actor_id(), public._mm_actor_id())
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.mm_machines SET facility_id = v_fac, machine_kind = v_kind, code = v_code, name = v_name,
        specs = COALESCE(p_row->'specs', specs), is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
        row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_id AND factory_id = v_factory;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Machine not found'); END IF;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE','That machine code is already used in this facility');
    WHEN check_violation THEN RETURN public._mm_err('INVALID','Pick a valid machine type');
    WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $$;

CREATE OR REPLACE FUNCTION public.mm_save_fabric_stage(p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_code text;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_code := upper(btrim(COALESCE(p_row->>'code','')));
  IF v_code !~ '^[A-Z0-9_]{2,20}$' THEN RETURN public._mm_err('INVALID','Code: 2-20 letters, numbers or _'); END IF;
  IF NULLIF(btrim(COALESCE(p_row->>'label','')), '') IS NULL THEN RETURN public._mm_err('REQUIRED','Label is required'); END IF;
  INSERT INTO public.mm_fabric_stages (factory_id, code, label, seq, can_cut, is_initial, is_active)
  VALUES (v_factory, v_code, btrim(p_row->>'label'), COALESCE((p_row->>'seq')::int, 100),
          COALESCE((p_row->>'can_cut')::boolean, false), COALESCE((p_row->>'is_initial')::boolean, false),
          COALESCE((p_row->>'is_active')::boolean, true))
  ON CONFLICT (factory_id, code) DO UPDATE SET label = EXCLUDED.label, seq = EXCLUDED.seq, can_cut = EXCLUDED.can_cut,
    is_initial = EXCLUDED.is_initial, is_active = EXCLUDED.is_active, updated_at = now();
  RETURN public._mm_ok(jsonb_build_object('code', v_code));
END $$;

CREATE OR REPLACE FUNCTION public.mm_save_process_type_rules(p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_id uuid; v_stage text; v_mode text;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_id := NULLIF(p_row->>'id','')::uuid;
  v_stage := NULLIF(upper(btrim(COALESCE(p_row->>'output_stage_code',''))), '');
  v_mode := COALESCE(NULLIF(p_row->>'default_return_mode',''), 'same_rolls');
  IF v_stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_fabric_stages WHERE factory_id = v_factory AND code = v_stage) THEN
    RETURN public._mm_err('INVALID','Unknown stage');
  END IF;
  IF v_mode NOT IN ('same_rolls','re_rolled') THEN RETURN public._mm_err('INVALID','Return mode must be same_rolls or re_rolled'); END IF;
  IF v_id IS NULL THEN
    IF NULLIF(btrim(COALESCE(p_row->>'name','')), '') IS NULL THEN RETURN public._mm_err('REQUIRED','Name is required'); END IF;
    INSERT INTO public.mm_process_types (factory_id, name, sort_order, active, output_stage_code, default_return_mode,
      resets_testing, resets_inspection, machine_kinds, created_by, updated_by)
    VALUES (v_factory, btrim(p_row->>'name'), COALESCE((p_row->>'sort_order')::int, 100), COALESCE((p_row->>'active')::boolean, true),
      v_stage, v_mode, COALESCE((p_row->>'resets_testing')::boolean, true), COALESCE((p_row->>'resets_inspection')::boolean, true),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_row->'machine_kinds')), '{}'), public._mm_actor_id(), public._mm_actor_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.mm_process_types SET
      name = COALESCE(NULLIF(btrim(COALESCE(p_row->>'name','')), ''), name),
      sort_order = COALESCE((p_row->>'sort_order')::int, sort_order),
      active = COALESCE((p_row->>'active')::boolean, active),
      output_stage_code = v_stage, default_return_mode = v_mode,
      resets_testing = COALESCE((p_row->>'resets_testing')::boolean, resets_testing),
      resets_inspection = COALESCE((p_row->>'resets_inspection')::boolean, resets_inspection),
      machine_kinds = CASE WHEN p_row ? 'machine_kinds' THEN ARRAY(SELECT jsonb_array_elements_text(p_row->'machine_kinds')) ELSE machine_kinds END,
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = v_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Process type not found'); END IF;
  END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE','That process name is already used');
END $$;

CREATE OR REPLACE FUNCTION public.mm_save_test_field_rules(p_rules jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_r jsonb; v_n int := 0;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  FOR v_r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rules,'[]'::jsonb)) LOOP
    UPDATE public.mm_type_test_fields SET
      test_level = COALESCE(NULLIF(v_r->>'test_level',''), test_level),
      required_at_stages = CASE WHEN v_r ? 'required_at_stages'
        THEN ARRAY(SELECT upper(x) FROM jsonb_array_elements_text(v_r->'required_at_stages') x) ELSE required_at_stages END,
      row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = (v_r->>'field_id')::uuid AND factory_id = v_factory;
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('updated', v_n));
EXCEPTION WHEN check_violation THEN RETURN public._mm_err('INVALID','test_level must be roll or lot');
END $$;

CREATE OR REPLACE FUNCTION public.mm_set_fabric_v4(p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid;
BEGIN
  IF NOT public.is_factory_admin() THEN RETURN public._mm_err('NO_PERMISSION','Admin required'); END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY','No factory'); END IF;
  PERFORM public._mm_v4_seed_masters(v_factory);
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled) VALUES (v_factory, 'fabric_v4', COALESCE(p_enabled,false))
  ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  RETURN public._mm_ok(jsonb_build_object('fabric_v4', COALESCE(p_enabled,false)));
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._mm_machine_internal_guard()','public._mm_next_doc(uuid,text,date)','public._mm_v4_on(uuid)',
    'public._mm_v4_seed_masters(uuid)','public._mm_v4_seed_new_factory()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.mm_get_v4_config()','public.mm_save_facility(jsonb)','public.mm_save_machine(jsonb)',
    'public.mm_save_fabric_stage(jsonb)','public.mm_save_process_type_rules(jsonb)',
    'public.mm_save_test_field_rules(jsonb)','public.mm_set_fabric_v4(boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;;
