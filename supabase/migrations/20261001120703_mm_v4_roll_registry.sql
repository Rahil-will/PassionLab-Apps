-- Fabric v4 · 2/6 · Roll registry (one row per physical roll), lineage, allocation log, batch extensions

-- ── Batch extensions ──
ALTER TABLE public.mm_mill_batches
  ADD COLUMN IF NOT EXISTS facility_id        uuid REFERENCES public.mm_facilities(id),
  ADD COLUMN IF NOT EXISTS initial_stage_code text NOT NULL DEFAULT 'GREIGE',
  ADD COLUMN IF NOT EXISTS yarn_lot           text,
  ADD COLUMN IF NOT EXISTS yarn_count         text,
  ADD COLUMN IF NOT EXISTS batch_kind         text GENERATED ALWAYS AS (CASE WHEN style_material_id IS NULL THEN 'general' ELSE 'style' END) STORED;

UPDATE public.mm_mill_batches b SET facility_id = f.id
FROM public.mm_facilities f
WHERE b.facility_id IS NULL AND f.factory_id = b.factory_id AND f.code = 'MILL-1';

CREATE TABLE IF NOT EXISTS public.mm_mill_batch_style_intents (
  factory_id        uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  batch_id          uuid NOT NULL REFERENCES public.mm_mill_batches(id) ON DELETE CASCADE,
  style_material_id uuid NOT NULL REFERENCES public.mm_style_materials(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  PRIMARY KEY (batch_id, style_material_id)
);
SELECT public._mm_lockdown_table('public.mm_mill_batch_style_intents');

-- ── Registry ──
CREATE TABLE IF NOT EXISTS public.mm_rolls (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id             uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  roll_code              text NOT NULL,
  origin                 text NOT NULL CHECK (origin IN ('mill','vendor','process')),
  origin_facility_id     uuid REFERENCES public.mm_facilities(id),
  mill_batch_id          uuid REFERENCES public.mm_mill_batches(id) ON DELETE SET NULL,
  fabric_type_id         uuid REFERENCES public.mm_fabric_types(id),
  -- written by mill / receipt (origin facts)
  machine_id             uuid REFERENCES public.mm_machines(id),
  shift                  text,
  produced_at            timestamptz,
  -- written by processing (and by receipt for vendor rolls)
  stage_code             text NOT NULL DEFAULT 'GREIGE',
  unit_form              text NOT NULL DEFAULT 'roll' CHECK (unit_form IN ('roll','lap','pieces')),
  width_form             text CHECK (width_form IN ('tubular','open')),
  grade                  text CHECK (grade IN ('A','B','C','fents','rags')),
  dye_lot                text,
  process_round          integer NOT NULL DEFAULT 0,
  test_valid_from_round  integer NOT NULL DEFAULT 0,
  insp_valid_from_round  integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid
);
CREATE INDEX IF NOT EXISTS mm_rolls_factory_idx ON public.mm_rolls (factory_id, stage_code);
CREATE INDEX IF NOT EXISTS mm_rolls_batch_idx ON public.mm_rolls (mill_batch_id);
CREATE INDEX IF NOT EXISTS mm_rolls_machine_idx ON public.mm_rolls (machine_id);
SELECT public._mm_lockdown_table('public.mm_rolls');

CREATE TABLE IF NOT EXISTS public.mm_roll_lineage (
  factory_id      uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  child_roll_id   uuid NOT NULL REFERENCES public.mm_rolls(id) ON DELETE CASCADE,
  parent_roll_id  uuid NOT NULL REFERENCES public.mm_rolls(id) ON DELETE CASCADE,
  return_line_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_roll_id, parent_roll_id)
);
CREATE INDEX IF NOT EXISTS mm_roll_lineage_parent_idx ON public.mm_roll_lineage (parent_roll_id);
SELECT public._mm_lockdown_table('public.mm_roll_lineage');

CREATE TABLE IF NOT EXISTS public.mm_roll_allocations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id             uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  roll_id                uuid NOT NULL REFERENCES public.mm_rolls(id) ON DELETE CASCADE,
  side                   text NOT NULL CHECK (side IN ('mill','warehouse')),
  mill_roll_id           uuid REFERENCES public.mm_mill_rolls(id) ON DELETE SET NULL,
  stock_unit_id          uuid REFERENCES public.mm_stock_units(id) ON DELETE SET NULL,
  from_style_material_id uuid,
  to_style_material_id   uuid,
  reason                 text,
  event_at               timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid
);
CREATE INDEX IF NOT EXISTS mm_roll_allocations_roll_idx ON public.mm_roll_allocations (roll_id, created_at);
SELECT public._mm_lockdown_table('public.mm_roll_allocations');

ALTER TABLE public.mm_mill_rolls  ADD COLUMN IF NOT EXISTS roll_id uuid REFERENCES public.mm_rolls(id);
ALTER TABLE public.mm_stock_units ADD COLUMN IF NOT EXISTS roll_id uuid REFERENCES public.mm_rolls(id);

-- ── Backfill existing rolls (legacy rows are treated as finished fabric) ──
DO $$
DECLARE r record; v_id uuid;
BEGIN
  FOR r IN SELECT mr.*, b.facility_id AS b_fac FROM public.mm_mill_rolls mr
           LEFT JOIN public.mm_mill_batches b ON b.id = mr.mill_batch_id
           WHERE mr.roll_id IS NULL ORDER BY mr.created_at LOOP
    INSERT INTO public.mm_rolls (factory_id, roll_code, origin, origin_facility_id, mill_batch_id, fabric_type_id,
                                 produced_at, stage_code, created_at, created_by)
    VALUES (r.factory_id, r.unit_code, CASE WHEN r.parent_mill_roll_id IS NULL THEN 'mill' ELSE 'process' END,
            r.b_fac, r.mill_batch_id, r.fabric_type_id, r.created_at, 'FINISHED', r.created_at, r.created_by)
    RETURNING id INTO v_id;
    UPDATE public.mm_mill_rolls SET roll_id = v_id WHERE id = r.id;
  END LOOP;

  UPDATE public.mm_stock_units u SET roll_id = mr.roll_id
  FROM public.mm_mill_rolls mr
  WHERE u.roll_id IS NULL AND u.mill_roll_id = mr.id AND u.parent_stock_unit_id IS NULL;

  FOR r IN SELECT * FROM public.mm_stock_units WHERE roll_id IS NULL ORDER BY created_at LOOP
    INSERT INTO public.mm_rolls (factory_id, roll_code, origin, mill_batch_id, fabric_type_id, produced_at, stage_code, created_at, created_by)
    VALUES (r.factory_id, r.unit_code, CASE WHEN r.parent_stock_unit_id IS NOT NULL THEN 'process'
                                            WHEN r.source = 'mill' THEN 'mill' ELSE 'vendor' END,
            r.mill_batch_id, r.fabric_type_id, r.created_at, 'FINISHED', r.created_at, r.created_by)
    RETURNING id INTO v_id;
    UPDATE public.mm_stock_units SET roll_id = v_id WHERE id = r.id;
  END LOOP;

  INSERT INTO public.mm_roll_lineage (factory_id, child_roll_id, parent_roll_id)
  SELECT c.factory_id, c.roll_id, p.roll_id FROM public.mm_mill_rolls c JOIN public.mm_mill_rolls p ON p.id = c.parent_mill_roll_id
  ON CONFLICT DO NOTHING;
  INSERT INTO public.mm_roll_lineage (factory_id, child_roll_id, parent_roll_id)
  SELECT c.factory_id, c.roll_id, p.roll_id FROM public.mm_stock_units c JOIN public.mm_stock_units p ON p.id = c.parent_stock_unit_id
  WHERE c.roll_id <> p.roll_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.mm_roll_allocations (factory_id, roll_id, side, mill_roll_id, to_style_material_id, reason, event_at, created_at, created_by)
  SELECT mr.factory_id, mr.roll_id, 'mill', mr.id, mr.style_material_id, 'backfill', mr.created_at, mr.created_at, mr.created_by
  FROM public.mm_mill_rolls mr WHERE mr.style_material_id IS NOT NULL;
END $$;

ALTER TABLE public.mm_mill_rolls  ALTER COLUMN roll_id SET NOT NULL;
ALTER TABLE public.mm_stock_units ALTER COLUMN roll_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mm_mill_rolls_roll_uidx  ON public.mm_mill_rolls (roll_id);
CREATE UNIQUE INDEX IF NOT EXISTS mm_stock_units_roll_uidx ON public.mm_stock_units (roll_id);

-- ── Registry triggers (make every insert path v4-correct, old RPCs included) ──
CREATE OR REPLACE FUNCTION public._mm_registry_on_mill_roll()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_p public.mm_rolls%ROWTYPE; v_b public.mm_mill_batches%ROWTYPE; v_id uuid;
BEGIN
  IF NEW.roll_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_b FROM public.mm_mill_batches WHERE id = NEW.mill_batch_id;
  IF NEW.parent_mill_roll_id IS NOT NULL THEN
    SELECT r.* INTO v_p FROM public.mm_rolls r JOIN public.mm_mill_rolls mr ON mr.roll_id = r.id
    WHERE mr.id = NEW.parent_mill_roll_id;
    INSERT INTO public.mm_rolls (factory_id, roll_code, origin, origin_facility_id, mill_batch_id, fabric_type_id,
      stage_code, unit_form, width_form, grade, dye_lot, produced_at, created_by)
    VALUES (NEW.factory_id, NEW.unit_code, 'process', v_p.origin_facility_id, NEW.mill_batch_id, NEW.fabric_type_id,
      COALESCE(v_p.stage_code, 'GREIGE'), COALESCE(v_p.unit_form, 'roll'), v_p.width_form, v_p.grade, v_p.dye_lot,
      now(), public._mm_actor_id())
    RETURNING id INTO v_id;
    IF v_p.id IS NOT NULL THEN
      INSERT INTO public.mm_roll_lineage (factory_id, child_roll_id, parent_roll_id) VALUES (NEW.factory_id, v_id, v_p.id)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    INSERT INTO public.mm_rolls (factory_id, roll_code, origin, origin_facility_id, mill_batch_id, fabric_type_id,
      stage_code, produced_at, created_by)
    VALUES (NEW.factory_id, NEW.unit_code, 'mill', v_b.facility_id, NEW.mill_batch_id, NEW.fabric_type_id,
      COALESCE(v_b.initial_stage_code, 'GREIGE'), COALESCE(v_b.production_date::timestamptz, now()), public._mm_actor_id())
    RETURNING id INTO v_id;
  END IF;
  NEW.roll_id := v_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mm_mill_rolls_registry_trg ON public.mm_mill_rolls;
CREATE TRIGGER mm_mill_rolls_registry_trg BEFORE INSERT ON public.mm_mill_rolls
  FOR EACH ROW EXECUTE FUNCTION public._mm_registry_on_mill_roll();

CREATE OR REPLACE FUNCTION public._mm_registry_on_stock_unit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_p public.mm_rolls%ROWTYPE; v_id uuid; v_stage text;
BEGIN
  IF NEW.roll_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.parent_stock_unit_id IS NOT NULL THEN
    SELECT r.* INTO v_p FROM public.mm_rolls r JOIN public.mm_stock_units u ON u.roll_id = r.id
    WHERE u.id = NEW.parent_stock_unit_id;
    INSERT INTO public.mm_rolls (factory_id, roll_code, origin, origin_facility_id, mill_batch_id, fabric_type_id,
      stage_code, unit_form, width_form, grade, dye_lot, produced_at, created_by)
    VALUES (NEW.factory_id, NEW.unit_code, 'process', v_p.origin_facility_id, NEW.mill_batch_id, NEW.fabric_type_id,
      COALESCE(v_p.stage_code, 'FINISHED'), COALESCE(v_p.unit_form, 'roll'), v_p.width_form, v_p.grade, v_p.dye_lot,
      now(), public._mm_actor_id())
    RETURNING id INTO v_id;
    IF v_p.id IS NOT NULL THEN
      INSERT INTO public.mm_roll_lineage (factory_id, child_roll_id, parent_roll_id) VALUES (NEW.factory_id, v_id, v_p.id)
      ON CONFLICT DO NOTHING;
    END IF;
    NEW.roll_id := v_id;
  ELSIF NEW.mill_roll_id IS NOT NULL THEN
    SELECT roll_id INTO NEW.roll_id FROM public.mm_mill_rolls WHERE id = NEW.mill_roll_id;
  END IF;
  IF NEW.roll_id IS NULL THEN
    v_stage := COALESCE(NULLIF(current_setting('mm.v4_receipt_stage', true), ''), 'FINISHED');
    INSERT INTO public.mm_rolls (factory_id, roll_code, origin, origin_facility_id, mill_batch_id, fabric_type_id,
      stage_code, produced_at, created_by)
    VALUES (NEW.factory_id, NEW.unit_code, CASE WHEN NEW.source = 'mill' THEN 'mill' ELSE 'vendor' END,
      NULLIF(current_setting('mm.v4_receipt_facility', true), '')::uuid,
      NEW.mill_batch_id, NEW.fabric_type_id, v_stage, now(), public._mm_actor_id())
    RETURNING id INTO v_id;
    NEW.roll_id := v_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mm_stock_units_registry_trg ON public.mm_stock_units;
CREATE TRIGGER mm_stock_units_registry_trg BEFORE INSERT ON public.mm_stock_units
  FOR EACH ROW EXECUTE FUNCTION public._mm_registry_on_stock_unit();

-- keep registry code in sync with the custody row's roll number
CREATE OR REPLACE FUNCTION public._mm_registry_sync_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.unit_code IS DISTINCT FROM OLD.unit_code THEN
    UPDATE public.mm_rolls SET roll_code = NEW.unit_code, updated_at = now() WHERE id = NEW.roll_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mm_mill_rolls_code_sync_trg ON public.mm_mill_rolls;
CREATE TRIGGER mm_mill_rolls_code_sync_trg AFTER UPDATE OF unit_code ON public.mm_mill_rolls
  FOR EACH ROW EXECUTE FUNCTION public._mm_registry_sync_code();
DROP TRIGGER IF EXISTS mm_stock_units_code_sync_trg ON public.mm_stock_units;
CREATE TRIGGER mm_stock_units_code_sync_trg AFTER UPDATE OF unit_code ON public.mm_stock_units
  FOR EACH ROW EXECUTE FUNCTION public._mm_registry_sync_code();

-- ── Allocation log (fires for old and new allocate RPCs alike) ──
CREATE OR REPLACE FUNCTION public._mm_log_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_side text := CASE WHEN TG_TABLE_NAME = 'mm_mill_rolls' THEN 'mill' ELSE 'warehouse' END;
        v_from uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.style_material_id IS NULL THEN RETURN NEW; END IF;
    -- a stock unit created by dispatch carries the mill allocation; don't log it twice
    IF v_side = 'warehouse' AND EXISTS (SELECT 1 FROM public.mm_roll_allocations a WHERE a.roll_id = NEW.roll_id
                                        AND a.to_style_material_id = NEW.style_material_id) THEN
      RETURN NEW;
    END IF;
    v_from := NULL;
  ELSE
    IF NEW.style_material_id IS NOT DISTINCT FROM OLD.style_material_id THEN RETURN NEW; END IF;
    v_from := OLD.style_material_id;
  END IF;
  INSERT INTO public.mm_roll_allocations (factory_id, roll_id, side, mill_roll_id, stock_unit_id,
    from_style_material_id, to_style_material_id, reason, event_at, created_by)
  VALUES (NEW.factory_id, NEW.roll_id, v_side,
    CASE WHEN v_side = 'mill' THEN NEW.id END, CASE WHEN v_side = 'warehouse' THEN NEW.id END,
    v_from, NEW.style_material_id, NULLIF(current_setting('mm.alloc_reason', true), ''), now(), public._mm_actor_id());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mm_mill_rolls_alloc_log_trg ON public.mm_mill_rolls;
CREATE TRIGGER mm_mill_rolls_alloc_log_trg AFTER INSERT OR UPDATE OF style_material_id ON public.mm_mill_rolls
  FOR EACH ROW EXECUTE FUNCTION public._mm_log_allocation();
DROP TRIGGER IF EXISTS mm_stock_units_alloc_log_trg ON public.mm_stock_units;
CREATE TRIGGER mm_stock_units_alloc_log_trg AFTER INSERT OR UPDATE OF style_material_id ON public.mm_stock_units
  FOR EACH ROW EXECUTE FUNCTION public._mm_log_allocation();

-- ── Labels ──
CREATE OR REPLACE FUNCTION public._mm_style_label(p_sm uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN p_sm IS NULL THEN NULL ELSE (
    SELECT jsonb_build_object('style_material_id', sm.id, 'order_id', o.id, 'style_name', o.style_name,
      'style_ref', o.style_ref, 'po_number', o.po_number, 'buyer_name', o.buyer_name,
      'colorway_id', c.id, 'colorway_name', c.name, 'fabric_line', cm.name, 'fabric_type_id', sm.fabric_type_id,
      'fabric_type_name', ft.name)
    FROM public.mm_style_materials sm
    LEFT JOIN public.style_orders o ON o.id = sm.order_id
    LEFT JOIN public.colorways c ON c.id = sm.colorway_id
    LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
    LEFT JOIN public.mm_fabric_types ft ON ft.id = sm.fabric_type_id
    WHERE sm.id = p_sm) END;
$$;

-- ════════════ Mill v4 RPCs ════════════
-- payload: { facility_id?, style_material_id? | order_id+colorway_id+colorway_material_id?, fabric_type_id?,
--   batch_no, mill_ref?, production_date?, initial_stage_code?, yarn_lot?, yarn_count?, color_ref?, fabric_ref_name?,
--   remarks?, intent_style_material_ids?: uuid[],
--   rolls: [{unit_code, length_m, weight_kg?, shade?, lot_no?, color_ref?, attributes?, machine_id?, shift?, produced_at?,
--            unit_form?, width_form?}] }
CREATE OR REPLACE FUNCTION public.mm_mill_save_batch_v4(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_factory uuid; v_actor uuid; v_sm uuid; v_ft uuid; v_fac uuid; v_stage text; v_batch uuid; v_no text;
  v_res jsonb; v_n int; v_r jsonb; v_mid uuid; v_x uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_mill_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();

  v_sm := NULLIF(p_payload->>'style_material_id','')::uuid;
  IF v_sm IS NULL AND NULLIF(p_payload->>'order_id','') IS NOT NULL THEN
    v_res := public._mm_resolve_style_material((p_payload->>'order_id')::uuid, (p_payload->>'colorway_id')::uuid,
                                               (p_payload->>'colorway_material_id')::uuid);
    IF NOT (v_res->>'ok')::boolean THEN RETURN v_res; END IF;
    v_sm := (v_res->'data'->>'id')::uuid;
  END IF;
  IF v_sm IS NOT NULL THEN
    SELECT fabric_type_id INTO v_ft FROM public.mm_style_materials WHERE id = v_sm AND factory_id = v_factory;
    IF v_ft IS NULL THEN RETURN public._mm_err('NOT_FOUND','Style fabric not found'); END IF;
  ELSE
    v_ft := NULLIF(p_payload->>'fabric_type_id','')::uuid;
    IF v_ft IS NULL OR NOT EXISTS (SELECT 1 FROM public.mm_fabric_types WHERE id = v_ft AND factory_id = v_factory) THEN
      RETURN public._mm_err('REQUIRED','Pick a fabric type for a general batch');
    END IF;
  END IF;

  v_fac := NULLIF(p_payload->>'facility_id','')::uuid;
  IF v_fac IS NULL THEN
    SELECT id INTO v_fac FROM public.mm_facilities WHERE factory_id = v_factory AND kind = 'mill' AND ownership = 'internal' AND is_active
    ORDER BY created_at LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mm_facilities WHERE id = v_fac AND factory_id = v_factory AND kind = 'mill') THEN
    RETURN public._mm_err('INVALID','Pick a mill');
  END IF;
  v_stage := COALESCE(NULLIF(upper(p_payload->>'initial_stage_code'),''), 'GREIGE');
  IF NOT EXISTS (SELECT 1 FROM public.mm_fabric_stages WHERE factory_id = v_factory AND code = v_stage) THEN
    RETURN public._mm_err('INVALID','Unknown stage');
  END IF;
  v_no := NULLIF(btrim(COALESCE(p_payload->>'batch_no','')), '');
  IF v_no IS NULL THEN v_no := public._mm_next_doc(v_factory, 'MB'); END IF;

  -- machines must belong to this mill
  FOR v_r IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'rolls','[]'::jsonb)) LOOP
    v_mid := NULLIF(v_r->>'machine_id','')::uuid;
    IF v_mid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_machines WHERE id = v_mid AND facility_id = v_fac) THEN
      RETURN public._mm_err('INVALID','Machine on roll ' || COALESCE(v_r->>'unit_code','?') || ' is not in this mill');
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.mm_mill_batches (factory_id, style_material_id, batch_no, mill_ref, production_date, remarks,
      fabric_type_id, fabric_ref_name, color_ref, facility_id, initial_stage_code, yarn_lot, yarn_count, created_by, updated_by)
    VALUES (v_factory, v_sm, v_no, NULLIF(p_payload->>'mill_ref',''), COALESCE(NULLIF(p_payload->>'production_date','')::date, CURRENT_DATE),
      NULLIF(p_payload->>'remarks',''), v_ft, NULLIF(p_payload->>'fabric_ref_name',''), NULLIF(p_payload->>'color_ref',''),
      v_fac, v_stage, NULLIF(p_payload->>'yarn_lot',''), NULLIF(p_payload->>'yarn_count',''), v_actor, v_actor)
    RETURNING id INTO v_batch;
  EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE','That batch number already exists');
  END;

  BEGIN
    v_n := public._mm_insert_mill_batch_rolls(v_factory, v_sm, v_batch, NULL, p_payload->'rolls');
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '%', SQLERRM; END;

  PERFORM public._mm_apply_roll_tags_from_payload(v_factory, v_batch, p_payload->'rolls');

  FOR v_x IN SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'intent_style_material_ids','[]'::jsonb)) x LOOP
    INSERT INTO public.mm_mill_batch_style_intents (factory_id, batch_id, style_material_id, created_by)
    SELECT v_factory, v_batch, sm.id, v_actor FROM public.mm_style_materials sm WHERE sm.id = v_x AND sm.factory_id = v_factory
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN public._mm_ok(jsonb_build_object('id', v_batch, 'batch_no', v_no, 'roll_count', v_n));
EXCEPTION WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
END $$;

-- internal: write machine/shift/form tags onto registry rows for rolls just inserted in a batch
CREATE OR REPLACE FUNCTION public._mm_apply_roll_tags_from_payload(p_factory uuid, p_batch uuid, p_rolls jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_r jsonb;
BEGIN
  FOR v_r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls,'[]'::jsonb)) LOOP
    UPDATE public.mm_rolls rr SET
      machine_id  = COALESCE(NULLIF(v_r->>'machine_id','')::uuid, rr.machine_id),
      shift       = COALESCE(NULLIF(v_r->>'shift',''), rr.shift),
      produced_at = COALESCE(NULLIF(v_r->>'produced_at','')::timestamptz, rr.produced_at),
      unit_form   = COALESCE(NULLIF(v_r->>'unit_form',''), rr.unit_form),
      width_form  = COALESCE(NULLIF(v_r->>'width_form',''), rr.width_form),
      updated_at  = now(), updated_by = public._mm_actor_id()
    FROM public.mm_mill_rolls mr
    WHERE mr.roll_id = rr.id AND mr.factory_id = p_factory AND mr.mill_batch_id = p_batch
      AND lower(mr.unit_code) = lower(btrim(v_r->>'unit_code'));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.mm_mill_add_rolls_v4(p_batch_id uuid, p_rolls jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_b public.mm_mill_batches%ROWTYPE; v_n int; v_r jsonb; v_mid uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_mill_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT * INTO v_b FROM public.mm_mill_batches WHERE id = p_batch_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Batch not found'); END IF;
  FOR v_r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls,'[]'::jsonb)) LOOP
    v_mid := NULLIF(v_r->>'machine_id','')::uuid;
    IF v_mid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_machines WHERE id = v_mid AND facility_id = v_b.facility_id) THEN
      RETURN public._mm_err('INVALID','Machine on roll ' || COALESCE(v_r->>'unit_code','?') || ' is not in this mill');
    END IF;
  END LOOP;
  v_n := public._mm_insert_mill_batch_rolls(v_factory, v_b.style_material_id, v_b.id, NULL, p_rolls);
  PERFORM public._mm_apply_roll_tags_from_payload(v_factory, v_b.id, p_rolls);
  RETURN public._mm_ok(jsonb_build_object('id', v_b.id, 'added', v_n));
EXCEPTION WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION public.mm_set_batch_style_intents(p_batch_id uuid, p_style_material_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_mill_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF NOT EXISTS (SELECT 1 FROM public.mm_mill_batches WHERE id = p_batch_id AND factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND','Batch not found');
  END IF;
  DELETE FROM public.mm_mill_batch_style_intents WHERE batch_id = p_batch_id;
  INSERT INTO public.mm_mill_batch_style_intents (factory_id, batch_id, style_material_id, created_by)
  SELECT v_factory, p_batch_id, sm.id, public._mm_actor_id()
  FROM public.mm_style_materials sm WHERE sm.factory_id = v_factory AND sm.id = ANY (COALESCE(p_style_material_ids, '{}'));
  RETURN public._mm_ok(jsonb_build_object('id', p_batch_id));
END $$;

-- Tag rolls (registry ids). stage_code only while the roll has no processing history.
-- p_tags: { machine_id?, shift?, produced_at?, unit_form?, width_form?, grade?, dye_lot?, stage_code?, reason? }
CREATE OR REPLACE FUNCTION public.mm_set_roll_tags(p_roll_ids uuid[], p_tags jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_id uuid; v_r public.mm_rolls%ROWTYPE; v_mid uuid; v_stage text; v_n int := 0; v_fac uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_mill_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_mid := NULLIF(p_tags->>'machine_id','')::uuid;
  v_stage := NULLIF(upper(COALESCE(p_tags->>'stage_code','')), '');
  IF v_stage IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mm_fabric_stages WHERE factory_id = v_factory AND code = v_stage) THEN
    RETURN public._mm_err('INVALID','Unknown stage');
  END IF;
  FOREACH v_id IN ARRAY COALESCE(p_roll_ids, '{}') LOOP
    SELECT * INTO v_r FROM public.mm_rolls WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','A selected roll was not found'); END IF;
    IF v_mid IS NOT NULL THEN
      SELECT facility_id INTO v_fac FROM public.mm_machines WHERE id = v_mid AND factory_id = v_factory;
      IF v_fac IS NULL THEN RETURN public._mm_err('NOT_FOUND','Machine not found'); END IF;
      IF v_r.origin_facility_id IS NOT NULL AND v_fac <> v_r.origin_facility_id THEN
        RETURN public._mm_err('INVALID', v_r.roll_code || ': machine is not in the mill that made this roll');
      END IF;
    END IF;
    IF v_stage IS NOT NULL AND (v_r.process_round > 0 OR EXISTS (SELECT 1 FROM public.mm_roll_lineage WHERE child_roll_id = v_id)) THEN
      RETURN public._mm_err('INVALID', v_r.roll_code || ': stage is set by processing once a roll has been processed');
    END IF;
    UPDATE public.mm_rolls SET
      machine_id  = COALESCE(v_mid, machine_id),
      shift       = COALESCE(NULLIF(p_tags->>'shift',''), shift),
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
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._mm_registry_on_mill_roll()','public._mm_registry_on_stock_unit()','public._mm_registry_sync_code()',
    'public._mm_log_allocation()','public._mm_style_label(uuid)','public._mm_apply_roll_tags_from_payload(uuid,uuid,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.mm_mill_save_batch_v4(jsonb)','public.mm_mill_add_rolls_v4(uuid,jsonb)',
    'public.mm_set_batch_style_intents(uuid,uuid[])','public.mm_set_roll_tags(uuid[],jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;;
