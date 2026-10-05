-- Fabric v4 · 3/6 · Processing: facilities as units, lots, return documents, reprocess, re-roll lineage, stage/round updates

-- ── Extend existing process tables (0 rows today) ──
ALTER TABLE public.mm_process_challans ALTER COLUMN vendor_id DROP NOT NULL;
ALTER TABLE public.mm_process_challans
  ADD COLUMN IF NOT EXISTS unit_facility_id  uuid REFERENCES public.mm_facilities(id),
  ADD COLUMN IF NOT EXISTS purpose           text NOT NULL DEFAULT 'fresh',
  ADD COLUMN IF NOT EXISTS parent_challan_id uuid REFERENCES public.mm_process_challans(id),
  ADD COLUMN IF NOT EXISTS reprocess_reason  text,
  ADD COLUMN IF NOT EXISTS sent_at           timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS unit_ref_no       text,
  ADD COLUMN IF NOT EXISTS voided_at         timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by         uuid,
  ADD COLUMN IF NOT EXISTS void_reason       text;
ALTER TABLE public.mm_process_challans DROP CONSTRAINT IF EXISTS mm_process_challans_status_check;
ALTER TABLE public.mm_process_challans ADD CONSTRAINT mm_process_challans_status_check
  CHECK (status IN ('open','partial','returned','void'));
DO $$ BEGIN
  ALTER TABLE public.mm_process_challans ADD CONSTRAINT mm_process_challans_purpose_chk CHECK (purpose IN ('fresh','reprocess'));
  ALTER TABLE public.mm_process_challans ADD CONSTRAINT mm_process_challans_unit_chk CHECK (num_nonnulls(vendor_id, unit_facility_id) >= 1);
  ALTER TABLE public.mm_process_challans ADD CONSTRAINT mm_process_challans_reprocess_chk
    CHECK (purpose = 'fresh' OR (parent_challan_id IS NOT NULL AND NULLIF(btrim(reprocess_reason),'') IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS mm_process_challans_unit_idx ON public.mm_process_challans (factory_id, unit_facility_id, status);

CREATE TABLE IF NOT EXISTS public.mm_process_lots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  challan_id  uuid NOT NULL REFERENCES public.mm_process_challans(id) ON DELETE CASCADE,
  lot_no      text NOT NULL,
  machine_id  uuid REFERENCES public.mm_machines(id),
  started_at  timestamptz,
  ended_at    timestamptz,
  remarks     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS mm_process_lots_no_uidx ON public.mm_process_lots (challan_id, lower(lot_no));
SELECT public._mm_lockdown_table('public.mm_process_lots');

CREATE TABLE IF NOT EXISTS public.mm_process_returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id    uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  challan_id    uuid NOT NULL REFERENCES public.mm_process_challans(id) ON DELETE CASCADE,
  return_no     text NOT NULL,
  returned_at   timestamptz NOT NULL DEFAULT now(),
  deliver_to    text NOT NULL DEFAULT 'sender' CHECK (deliver_to IN ('sender','warehouse')),
  in_challan_id uuid REFERENCES public.mm_in_challans(id),
  remarks       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX IF NOT EXISTS mm_process_returns_challan_idx ON public.mm_process_returns (challan_id);
SELECT public._mm_lockdown_table('public.mm_process_returns');

ALTER TABLE public.mm_process_out_lines
  ADD COLUMN IF NOT EXISTS roll_id    uuid REFERENCES public.mm_rolls(id),
  ADD COLUMN IF NOT EXISTS qty_kg     numeric,
  ADD COLUMN IF NOT EXISTS stage_code text,
  ADD COLUMN IF NOT EXISTS lot_id     uuid REFERENCES public.mm_process_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS write_off_reason text;
ALTER TABLE public.mm_process_out_lines DROP CONSTRAINT IF EXISTS mm_process_out_lines_line_status_check;
ALTER TABLE public.mm_process_out_lines ADD CONSTRAINT mm_process_out_lines_line_status_check
  CHECK (line_status IN ('out','returned','replaced','written_off','void'));

ALTER TABLE public.mm_process_return_lines
  ADD COLUMN IF NOT EXISTS return_id           uuid REFERENCES public.mm_process_returns(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS roll_id             uuid REFERENCES public.mm_rolls(id),
  ADD COLUMN IF NOT EXISTS qty_kg              numeric,
  ADD COLUMN IF NOT EXISTS stage_code          text,
  ADD COLUMN IF NOT EXISTS unit_form           text,
  ADD COLUMN IF NOT EXISTS width_form          text,
  ADD COLUMN IF NOT EXISTS grade               text,
  ADD COLUMN IF NOT EXISTS dye_lot             text,
  ADD COLUMN IF NOT EXISTS lot_id              uuid REFERENCES public.mm_process_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_out_line_ids uuid[];

ALTER TABLE public.mm_mill_rolls DROP CONSTRAINT IF EXISTS mm_mill_rolls_status_chk;
ALTER TABLE public.mm_mill_rolls ADD CONSTRAINT mm_mill_rolls_status_chk
  CHECK (status IN ('draft','dispatched','processed','written_off'));

-- ── Triggers: registry ids on lines; stage/round/lineage on return ──
CREATE OR REPLACE FUNCTION public._mm_proc_line_roll_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.roll_id IS NULL THEN
    IF NEW.mill_roll_id IS NOT NULL THEN SELECT roll_id INTO NEW.roll_id FROM public.mm_mill_rolls WHERE id = NEW.mill_roll_id;
    ELSIF NEW.stock_unit_id IS NOT NULL THEN SELECT roll_id INTO NEW.roll_id FROM public.mm_stock_units WHERE id = NEW.stock_unit_id;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'mm_process_out_lines' AND NEW.stage_code IS NULL THEN
    SELECT stage_code INTO NEW.stage_code FROM public.mm_rolls WHERE id = NEW.roll_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mm_process_out_lines_roll_trg ON public.mm_process_out_lines;
CREATE TRIGGER mm_process_out_lines_roll_trg BEFORE INSERT ON public.mm_process_out_lines
  FOR EACH ROW EXECUTE FUNCTION public._mm_proc_line_roll_id();
DROP TRIGGER IF EXISTS mm_process_return_lines_roll_trg ON public.mm_process_return_lines;
CREATE TRIGGER mm_process_return_lines_roll_trg BEFORE INSERT ON public.mm_process_return_lines
  FOR EACH ROW EXECUTE FUNCTION public._mm_proc_line_roll_id();

CREATE OR REPLACE FUNCTION public._mm_proc_apply_return_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t public.mm_process_types%ROWTYPE; v_stage text; v_parent uuid; v_ol uuid;
BEGIN
  SELECT t.* INTO v_t FROM public.mm_process_types t JOIN public.mm_process_challans c ON c.process_type_id = t.id
  WHERE c.id = NEW.challan_id;
  v_stage := COALESCE(NULLIF(upper(NEW.stage_code), ''), v_t.output_stage_code);
  IF NEW.roll_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.same_identity THEN
    UPDATE public.mm_rolls SET
      process_round = process_round + 1,
      test_valid_from_round = CASE WHEN COALESCE(v_t.resets_testing, true) THEN process_round + 1 ELSE test_valid_from_round END,
      insp_valid_from_round = CASE WHEN COALESCE(v_t.resets_inspection, true) THEN process_round + 1 ELSE insp_valid_from_round END,
      stage_code = COALESCE(v_stage, stage_code),
      unit_form  = COALESCE(NEW.unit_form, unit_form),
      width_form = COALESCE(NEW.width_form, width_form),
      grade      = COALESCE(NEW.grade, grade),
      dye_lot    = COALESCE(NEW.dye_lot, NULLIF(NEW.lot_no,''), dye_lot),
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = NEW.roll_id;
  ELSE
    UPDATE public.mm_rolls SET
      stage_code = COALESCE(v_stage, stage_code),
      unit_form  = COALESCE(NEW.unit_form, unit_form),
      width_form = COALESCE(NEW.width_form, width_form),
      grade      = COALESCE(NEW.grade, grade),
      dye_lot    = COALESCE(NEW.dye_lot, NULLIF(NEW.lot_no,''), dye_lot),
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = NEW.roll_id;
    FOR v_ol IN SELECT DISTINCT x FROM unnest(array_append(COALESCE(NEW.parent_out_line_ids, '{}'), NEW.out_line_id)) x LOOP
      SELECT roll_id INTO v_parent FROM public.mm_process_out_lines WHERE id = v_ol;
      IF v_parent IS NOT NULL AND v_parent <> NEW.roll_id THEN
        INSERT INTO public.mm_roll_lineage (factory_id, child_roll_id, parent_roll_id, return_line_id)
        VALUES (NEW.factory_id, NEW.roll_id, v_parent, NEW.id)
        ON CONFLICT (child_roll_id, parent_roll_id) DO UPDATE SET return_line_id = EXCLUDED.return_line_id;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mm_process_return_lines_apply_trg ON public.mm_process_return_lines;
CREATE TRIGGER mm_process_return_lines_apply_trg AFTER INSERT ON public.mm_process_return_lines
  FOR EACH ROW EXECUTE FUNCTION public._mm_proc_apply_return_line();

-- ════════════ Processing v4 RPCs ════════════
-- payload: { side:'mill'|'warehouse', unit_facility_id, process_type_id, roll_ids:[registry ids], challan_no?, unit_ref_no?,
--            sent_at?, purpose?:'fresh'|'reprocess', parent_challan_id?, reprocess_reason?, remarks? }
CREATE OR REPLACE FUNCTION public.mm_proc_send(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_factory uuid; v_actor uuid; v_side text; v_fac public.mm_facilities%ROWTYPE; v_type public.mm_process_types%ROWTYPE;
  v_ids uuid[]; v_id uuid; v_no text; v_ch uuid; v_purpose text; v_parent uuid; v_reason text;
  v_roll public.mm_mill_rolls%ROWTYPE; v_unit public.mm_stock_units%ROWTYPE; v_rr public.mm_rolls%ROWTYPE;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  v_side := p_payload->>'side';
  IF v_side IS NULL OR v_side NOT IN ('mill','warehouse') THEN RETURN public._mm_err('INVALID','Send from the mill or the warehouse'); END IF;
  SELECT * INTO v_fac FROM public.mm_facilities WHERE id = NULLIF(p_payload->>'unit_facility_id','')::uuid AND factory_id = v_factory;
  IF NOT FOUND OR v_fac.kind <> 'process_unit' THEN RETURN public._mm_err('INVALID','Pick a processing unit'); END IF;
  IF NOT v_fac.is_active THEN RETURN public._mm_err('INACTIVE','That processing unit is inactive'); END IF;
  SELECT * INTO v_type FROM public.mm_process_types WHERE id = NULLIF(p_payload->>'process_type_id','')::uuid AND factory_id = v_factory;
  IF NOT FOUND OR NOT v_type.active THEN RETURN public._mm_err('INVALID','Pick an active process'); END IF;
  IF EXISTS (SELECT 1 FROM public.mm_facility_process_types WHERE facility_id = v_fac.id)
     AND NOT EXISTS (SELECT 1 FROM public.mm_facility_process_types WHERE facility_id = v_fac.id AND process_type_id = v_type.id) THEN
    RETURN public._mm_err('INVALID','This unit does not do ' || v_type.name);
  END IF;
  v_purpose := COALESCE(NULLIF(p_payload->>'purpose',''), 'fresh');
  v_parent := NULLIF(p_payload->>'parent_challan_id','')::uuid;
  v_reason := NULLIF(btrim(COALESCE(p_payload->>'reprocess_reason','')), '');
  IF v_purpose NOT IN ('fresh','reprocess') THEN RETURN public._mm_err('INVALID','Purpose must be fresh or reprocess'); END IF;
  IF v_purpose = 'reprocess' THEN
    IF v_parent IS NULL OR v_reason IS NULL THEN RETURN public._mm_err('REQUIRED','Reprocess needs the original challan and a reason'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mm_process_challans WHERE id = v_parent AND factory_id = v_factory) THEN
      RETURN public._mm_err('NOT_FOUND','Original challan not found');
    END IF;
  END IF;
  v_ids := ARRAY(SELECT DISTINCT (x)::uuid FROM jsonb_array_elements_text(COALESCE(p_payload->'roll_ids','[]'::jsonb)) x);
  IF COALESCE(array_length(v_ids,1),0) = 0 THEN RETURN public._mm_err('REQUIRED','Select rolls to send'); END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_rr FROM public.mm_rolls WHERE id = v_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','A selected roll was not found'); END IF;
    IF EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = v_id AND l.line_status = 'out') THEN
      RETURN public._mm_err('AT_PROCESS', v_rr.roll_code || ' is already at a processing unit');
    END IF;
    IF v_side = 'mill' THEN
      SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE roll_id = v_id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND OR v_roll.status <> 'draft' OR v_roll.in_challan_id IS NOT NULL THEN
        RETURN public._mm_err('INVALID', v_rr.roll_code || ' is not at the mill');
      END IF;
    ELSE
      SELECT * INTO v_unit FROM public.mm_stock_units WHERE roll_id = v_id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND OR v_unit.status NOT IN ('in_stock','pending_qc') THEN
        RETURN public._mm_err('INVALID', v_rr.roll_code || ' is not in the warehouse');
      END IF;
      IF v_unit.on_hold THEN RETURN public._mm_err('HOLD', v_rr.roll_code || ' is on hold'); END IF;
      IF COALESCE(v_unit.qty_available,0) <= 0 THEN RETURN public._mm_err('INVALID', v_rr.roll_code || ' has no qty on hand'); END IF;
    END IF;
  END LOOP;

  v_no := NULLIF(btrim(COALESCE(p_payload->>'challan_no','')), '');
  IF v_no IS NULL THEN v_no := public._mm_next_doc(v_factory, 'PC'); END IF;
  BEGIN
    INSERT INTO public.mm_process_challans (factory_id, challan_no, origin, vendor_id, unit_facility_id, process_type_id,
      purpose, parent_challan_id, reprocess_reason, sent_at, unit_ref_no, remarks, created_by, updated_by)
    VALUES (v_factory, v_no, v_side, NULL, v_fac.id, v_type.id, v_purpose, v_parent, v_reason,
      COALESCE(NULLIF(p_payload->>'sent_at','')::timestamptz, now()), NULLIF(p_payload->>'unit_ref_no',''),
      NULLIF(btrim(COALESCE(p_payload->>'remarks','')), ''), v_actor, v_actor)
    RETURNING id INTO v_ch;
  EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE','That challan number is already used');
  END;

  IF v_side = 'warehouse' THEN PERFORM public._mm_seed_ops_locations(v_factory, v_actor); END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_side = 'mill' THEN
      SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE roll_id = v_id;
      INSERT INTO public.mm_process_out_lines (factory_id, challan_id, mill_roll_id, roll_id, unit_code, qty, uom, qty_kg,
        shade, lot_no, color_ref)
      VALUES (v_factory, v_ch, v_roll.id, v_id, v_roll.unit_code, v_roll.length_m, 'm', v_roll.weight_kg,
        v_roll.shade, v_roll.lot_no, v_roll.color_ref);
    ELSE
      SELECT * INTO v_unit FROM public.mm_stock_units WHERE roll_id = v_id FOR UPDATE;
      INSERT INTO public.mm_process_out_lines (factory_id, challan_id, stock_unit_id, roll_id, unit_code, qty, uom, qty_kg,
        shade, lot_no, color_ref)
      VALUES (v_factory, v_ch, v_unit.id, v_id, v_unit.unit_code, v_unit.qty_available, COALESCE(v_unit.qty_uom, v_unit.uom, 'm'),
        v_unit.weight_kg, v_unit.shade, v_unit.lot_no, v_unit.color_ref);
      PERFORM public._mm_ledger(v_factory, v_unit.id, 'TRANSFER', 0, v_unit.status, 'at_process',
        v_unit.current_location_id, NULL, 'mm_process_challans', v_ch, 'sent to process');
      UPDATE public.mm_stock_units SET status = 'at_process', current_location_id = NULL,
        row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_unit.id;
    END IF;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', array_length(v_ids,1)));
END $$;

-- p_lots: [{ id?, lot_no, machine_id?, started_at?, ended_at?, remarks?, out_line_ids:[...], remove?:bool }]
CREATE OR REPLACE FUNCTION public.mm_proc_save_lots(p_challan_id uuid, p_lots jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_ch public.mm_process_challans%ROWTYPE; v_fac public.mm_facilities%ROWTYPE;
        v_l jsonb; v_id uuid; v_mid uuid; v_n int := 0;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = p_challan_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Challan not found'); END IF;
  IF v_ch.status = 'void' THEN RETURN public._mm_err('CLOSED','This challan is void'); END IF;
  SELECT * INTO v_fac FROM public.mm_facilities WHERE id = v_ch.unit_facility_id;
  FOR v_l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lots,'[]'::jsonb)) LOOP
    v_id := NULLIF(v_l->>'id','')::uuid;
    IF COALESCE((v_l->>'remove')::boolean, false) AND v_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.mm_process_return_lines WHERE lot_id = v_id) THEN
        RETURN public._mm_err('INVALID','A lot with returned rolls cannot be removed');
      END IF;
      DELETE FROM public.mm_process_lots WHERE id = v_id AND challan_id = v_ch.id;
      CONTINUE;
    END IF;
    v_mid := NULLIF(v_l->>'machine_id','')::uuid;
    IF v_mid IS NOT NULL THEN
      IF v_fac.ownership <> 'internal' THEN RETURN public._mm_err('INVALID','Machines are only recorded for in-house units'); END IF;
      IF NOT EXISTS (SELECT 1 FROM public.mm_machines WHERE id = v_mid AND facility_id = v_fac.id) THEN
        RETURN public._mm_err('INVALID','That machine is not in this unit');
      END IF;
    END IF;
    IF NULLIF(btrim(COALESCE(v_l->>'lot_no','')), '') IS NULL THEN RETURN public._mm_err('REQUIRED','Each lot needs a lot number'); END IF;
    BEGIN
      IF v_id IS NULL THEN
        INSERT INTO public.mm_process_lots (factory_id, challan_id, lot_no, machine_id, started_at, ended_at, remarks, created_by, updated_by)
        VALUES (v_factory, v_ch.id, btrim(v_l->>'lot_no'), v_mid, NULLIF(v_l->>'started_at','')::timestamptz,
          NULLIF(v_l->>'ended_at','')::timestamptz, NULLIF(v_l->>'remarks',''), public._mm_actor_id(), public._mm_actor_id())
        RETURNING id INTO v_id;
      ELSE
        UPDATE public.mm_process_lots SET lot_no = btrim(v_l->>'lot_no'), machine_id = v_mid,
          started_at = NULLIF(v_l->>'started_at','')::timestamptz, ended_at = NULLIF(v_l->>'ended_at','')::timestamptz,
          remarks = NULLIF(v_l->>'remarks',''), updated_at = now(), updated_by = public._mm_actor_id()
        WHERE id = v_id AND challan_id = v_ch.id;
        IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Lot not found'); END IF;
      END IF;
    EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE','Lot number already used on this challan');
    END;
    IF v_l ? 'out_line_ids' THEN
      UPDATE public.mm_process_out_lines SET lot_id = NULL WHERE lot_id = v_id AND challan_id = v_ch.id;
      UPDATE public.mm_process_out_lines SET lot_id = v_id
      WHERE challan_id = v_ch.id AND id IN (SELECT (x)::uuid FROM jsonb_array_elements_text(v_l->'out_line_ids') x);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('saved', v_n));
END $$;

-- payload: { challan_id, return_no?, returned_at?, remarks?, deliver_to?:'sender'|'warehouse',
--   dispatch?:{challan_no?, reference_no?, to_location?},
--   same_rolls:[{out_line_id, qty, qty_kg?, shade?, color_ref?, stage_code?, unit_form?, width_form?, grade?, dye_lot?, lot_id?}],
--   re_rolled:[{out_line_ids:[..], outputs:[{unit_code, qty, qty_kg?, shade?, color_ref?, stage_code?, unit_form?, width_form?, grade?, dye_lot?, lot_id?}]}],
--   write_offs:[{out_line_id, reason}] }
CREATE OR REPLACE FUNCTION public.mm_proc_return(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_factory uuid; v_actor uuid; v_ch public.mm_process_challans%ROWTYPE; v_ret uuid; v_ret_no text; v_deliver text;
  v_seen uuid[] := '{}'; v_e jsonb; v_o jsonb; v_lid uuid; v_lids uuid[]; v_line public.mm_process_out_lines%ROWTYPE;
  v_roll public.mm_mill_rolls%ROWTYPE; v_unit public.mm_stock_units%ROWTYPE; v_child uuid; v_recv uuid; v_qty numeric;
  v_delta numeric; v_out_mill uuid[] := '{}'; v_outputs jsonb := '[]'::jsonb; v_disp jsonb; v_code text; v_stage text;
  v_sm uuid; v_ft uuid; v_batch uuid; v_first boolean; v_wh_units uuid[] := '{}';
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = NULLIF(p_payload->>'challan_id','')::uuid AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Challan not found'); END IF;
  IF v_ch.status IN ('returned','void') THEN RETURN public._mm_err('CLOSED','This challan is closed'); END IF;
  v_deliver := COALESCE(NULLIF(p_payload->>'deliver_to',''), 'sender');
  IF v_deliver NOT IN ('sender','warehouse') THEN RETURN public._mm_err('INVALID','deliver_to must be sender or warehouse'); END IF;
  IF v_deliver = 'warehouse' AND v_ch.origin <> 'mill' THEN v_deliver := 'sender'; END IF;

  -- validate every referenced out line once
  FOR v_lid IN
    SELECT (e->>'out_line_id')::uuid FROM jsonb_array_elements(COALESCE(p_payload->'same_rolls','[]'::jsonb)) e
    UNION ALL SELECT (x)::uuid FROM jsonb_array_elements(COALESCE(p_payload->'re_rolled','[]'::jsonb)) g,
                                   jsonb_array_elements_text(COALESCE(g->'out_line_ids','[]'::jsonb)) x
    UNION ALL SELECT (e->>'out_line_id')::uuid FROM jsonb_array_elements(COALESCE(p_payload->'write_offs','[]'::jsonb)) e
  LOOP
    IF v_lid = ANY (v_seen) THEN RETURN public._mm_err('INVALID','A sent roll appears twice in this return'); END IF;
    v_seen := v_seen || v_lid;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_lid AND challan_id = v_ch.id FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','A sent roll is not on this challan'); END IF;
    IF v_line.line_status <> 'out' THEN RETURN public._mm_err('INVALID', v_line.unit_code || ' is already back'); END IF;
  END LOOP;
  IF COALESCE(array_length(v_seen,1),0) = 0 THEN RETURN public._mm_err('REQUIRED','Enter what came back'); END IF;

  v_ret_no := COALESCE(NULLIF(btrim(COALESCE(p_payload->>'return_no','')), ''), public._mm_next_doc(v_factory, 'PR'));
  INSERT INTO public.mm_process_returns (factory_id, challan_id, return_no, returned_at, deliver_to, remarks, created_by)
  VALUES (v_factory, v_ch.id, v_ret_no, COALESCE(NULLIF(p_payload->>'returned_at','')::timestamptz, now()), v_deliver,
          NULLIF(p_payload->>'remarks',''), v_actor)
  RETURNING id INTO v_ret;

  IF v_ch.origin = 'warehouse' THEN
    PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
    v_recv := public._mm_recv_loc(v_factory);
  END IF;

  -- same rolls
  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'same_rolls','[]'::jsonb)) LOOP
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = (v_e->>'out_line_id')::uuid;
    v_qty := NULLIF(v_e->>'qty','')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION '%: return qty must be greater than zero', v_line.unit_code; END IF;
    IF v_ch.origin = 'mill' THEN
      UPDATE public.mm_mill_rolls SET length_m = v_qty,
        weight_kg = COALESCE(NULLIF(v_e->>'qty_kg','')::numeric, weight_kg),
        shade = COALESCE(NULLIF(v_e->>'shade',''), shade), color_ref = COALESCE(NULLIF(v_e->>'color_ref',''), color_ref),
        row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_line.mill_roll_id;
      v_out_mill := v_out_mill || v_line.mill_roll_id;
      v_child := v_line.mill_roll_id;
    ELSE
      SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
      v_delta := v_qty - COALESCE(v_unit.qty_available, 0);
      PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
      IF v_delta < -0.001 THEN
        PERFORM public._mm_ledger(v_factory, v_unit.id, 'QC_DEDUCT', -v_delta, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process loss');
      ELSIF v_delta > 0.001 THEN
        PERFORM public._mm_ledger(v_factory, v_unit.id, 'ADJUST_PLUS', v_delta, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process gain');
      ELSE
        PERFORM public._mm_ledger(v_factory, v_unit.id, 'TRANSFER', 0, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process return');
      END IF;
      UPDATE public.mm_stock_units SET status = 'pending_qc', current_location_id = v_recv, length_m = v_qty,
        weight_kg = COALESCE(NULLIF(v_e->>'qty_kg','')::numeric, weight_kg),
        shade = COALESCE(NULLIF(v_e->>'shade',''), shade), color_ref = COALESCE(NULLIF(v_e->>'color_ref',''), color_ref),
        qc_result = NULL, row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_unit.id;
      v_wh_units := v_wh_units || v_unit.id;
      v_child := v_unit.id;
    END IF;
    UPDATE public.mm_process_out_lines SET line_status = 'returned' WHERE id = v_line.id;
    INSERT INTO public.mm_process_return_lines (factory_id, challan_id, out_line_id, return_id, same_identity, unit_code, qty, uom,
      qty_kg, shade, color_ref, lot_no, mill_roll_id, stock_unit_id, stage_code, unit_form, width_form, grade, dye_lot, lot_id, created_by)
    VALUES (v_factory, v_ch.id, v_line.id, v_ret, true, v_line.unit_code, v_qty, v_line.uom,
      NULLIF(v_e->>'qty_kg','')::numeric, NULLIF(v_e->>'shade',''), NULLIF(v_e->>'color_ref',''), NULL,
      CASE WHEN v_ch.origin = 'mill' THEN v_child END, CASE WHEN v_ch.origin = 'warehouse' THEN v_child END,
      NULLIF(upper(v_e->>'stage_code'),''), NULLIF(v_e->>'unit_form',''), NULLIF(v_e->>'width_form',''),
      NULLIF(v_e->>'grade',''), NULLIF(v_e->>'dye_lot',''), COALESCE(NULLIF(v_e->>'lot_id','')::uuid, v_line.lot_id), v_actor);
    v_outputs := v_outputs || jsonb_build_object('roll_id', v_line.roll_id, 'unit_code', v_line.unit_code, 'same', true);
  END LOOP;

  -- re-rolled groups
  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'re_rolled','[]'::jsonb)) LOOP
    v_lids := ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(v_e->'out_line_ids','[]'::jsonb)) x);
    IF COALESCE(array_length(v_lids,1),0) = 0 OR jsonb_array_length(COALESCE(v_e->'outputs','[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'Each re-rolled group needs the sent rolls and the new rolls';
    END IF;
    -- shared attributes of the parents
    v_sm := NULL; v_ft := NULL; v_batch := NULL; v_first := true;
    FOREACH v_lid IN ARRAY v_lids LOOP
      SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_lid;
      IF v_ch.origin = 'mill' THEN
        SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_line.mill_roll_id FOR UPDATE;
        IF v_first THEN v_sm := v_roll.style_material_id; v_ft := v_roll.fabric_type_id; v_batch := v_roll.mill_batch_id;
        ELSE
          IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN RAISE EXCEPTION 'Rolls re-rolled together must be the same fabric type'; END IF;
          IF v_roll.style_material_id IS DISTINCT FROM v_sm THEN v_sm := NULL; END IF;
        END IF;
        UPDATE public.mm_mill_rolls SET status = 'processed', row_version = row_version + 1, updated_at = now(), updated_by = v_actor
        WHERE id = v_roll.id;
      ELSE
        SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
        IF v_first THEN v_sm := v_unit.style_material_id; v_ft := v_unit.fabric_type_id; v_batch := v_unit.mill_batch_id;
        ELSE
          IF v_unit.fabric_type_id IS DISTINCT FROM v_ft THEN RAISE EXCEPTION 'Rolls re-rolled together must be the same fabric type'; END IF;
          IF v_unit.style_material_id IS DISTINCT FROM v_sm THEN v_sm := NULL; END IF;
        END IF;
        IF COALESCE(v_unit.qty_available,0) > 0 THEN
          PERFORM public._mm_ledger(v_factory, v_unit.id, 'WRITE_OFF', v_unit.qty_available, 'at_process', 'written_off', NULL, NULL,
            'mm_process_returns', v_ret, 're-rolled at process');
        END IF;
        UPDATE public.mm_stock_units SET status = 'written_off', current_location_id = NULL,
          row_version = row_version + 1, updated_at = now(), updated_by = v_actor WHERE id = v_unit.id;
      END IF;
      UPDATE public.mm_process_out_lines SET line_status = 'replaced' WHERE id = v_lid;
      v_first := false;
    END LOOP;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_lids[1];
    IF v_ch.origin = 'mill' THEN SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_line.mill_roll_id;
    ELSE SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id; END IF;

    FOR v_o IN SELECT * FROM jsonb_array_elements(v_e->'outputs') LOOP
      v_code := NULLIF(btrim(COALESCE(v_o->>'unit_code','')), '');
      v_qty := NULLIF(v_o->>'qty','')::numeric;
      IF v_code IS NULL THEN RAISE EXCEPTION 'Each new roll needs a roll number'; END IF;
      IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION '%: qty must be greater than zero', v_code; END IF;
      IF v_ch.origin = 'mill' THEN
        IF EXISTS (SELECT 1 FROM public.mm_mill_rolls r WHERE r.factory_id = v_factory AND r.mill_batch_id = v_batch AND lower(r.unit_code) = lower(v_code)) THEN
          RAISE EXCEPTION 'Roll % is already used in this batch', v_code;
        END IF;
        INSERT INTO public.mm_mill_rolls (factory_id, mill_batch_id, style_material_id, fabric_type_id, unit_code, length_m, weight_kg,
          shade, lot_no, color_ref, attributes, status, parent_mill_roll_id, created_by, updated_by)
        VALUES (v_factory, v_batch, v_sm, v_ft, v_code, v_qty, NULLIF(v_o->>'qty_kg','')::numeric,
          NULLIF(v_o->>'shade',''), v_roll.lot_no, COALESCE(NULLIF(v_o->>'color_ref',''), v_roll.color_ref),
          COALESCE(v_roll.attributes, '{}'::jsonb), 'draft', v_roll.id, v_actor, v_actor)
        RETURNING id INTO v_child;
        v_out_mill := v_out_mill || v_child;
      ELSE
        IF (v_batch IS NOT NULL AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.factory_id = v_factory AND u.mill_batch_id = v_batch AND lower(u.unit_code) = lower(v_code)))
           OR (v_batch IS NULL AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.factory_id = v_factory AND u.mill_batch_id IS NULL AND u.unit_code = v_code)) THEN
          RAISE EXCEPTION 'Roll % is already used', v_code;
        END IF;
        INSERT INTO public.mm_stock_units (factory_id, unit_code, unit_kind, style_material_id, source, uom, qty_uom, length_m, weight_kg,
          shade, lot_no, color_ref, attributes, mill_snapshot, status, current_location_id, fabric_type_id, mill_batch_id, mill_roll_id,
          declared_width_in, qty_declared, qty_received, qty_available, parent_stock_unit_id, created_by, updated_by)
        VALUES (v_factory, v_code, v_unit.unit_kind, v_sm, v_unit.source, v_unit.uom, COALESCE(v_unit.qty_uom, v_unit.uom), v_qty,
          NULLIF(v_o->>'qty_kg','')::numeric, NULLIF(v_o->>'shade',''), v_unit.lot_no, COALESCE(NULLIF(v_o->>'color_ref',''), v_unit.color_ref),
          COALESCE(v_unit.attributes, '{}'::jsonb), v_unit.mill_snapshot, 'pending_qc', v_recv, v_ft, v_batch, NULL,
          v_unit.declared_width_in, v_qty, v_qty, 0, v_unit.id, v_actor, v_actor)
        RETURNING id INTO v_child;
        PERFORM public._mm_ledger(v_factory, v_child, 'RECEIPT_IN', v_qty, 'pending_qc', 'pending_qc', v_recv, v_recv, 'mm_process_returns', v_ret, 'process return (re-rolled)');
        v_wh_units := v_wh_units || v_child;
      END IF;
      INSERT INTO public.mm_process_return_lines (factory_id, challan_id, out_line_id, return_id, same_identity, unit_code, qty, uom,
        qty_kg, shade, color_ref, mill_roll_id, stock_unit_id, stage_code, unit_form, width_form, grade, dye_lot, lot_id,
        parent_out_line_ids, created_by)
      VALUES (v_factory, v_ch.id, v_lids[1], v_ret, false, v_code, v_qty, v_line.uom, NULLIF(v_o->>'qty_kg','')::numeric,
        NULLIF(v_o->>'shade',''), NULLIF(v_o->>'color_ref',''),
        CASE WHEN v_ch.origin = 'mill' THEN v_child END, CASE WHEN v_ch.origin = 'warehouse' THEN v_child END,
        NULLIF(upper(v_o->>'stage_code'),''), NULLIF(v_o->>'unit_form',''), NULLIF(v_o->>'width_form',''),
        NULLIF(v_o->>'grade',''), NULLIF(v_o->>'dye_lot',''), COALESCE(NULLIF(v_o->>'lot_id','')::uuid, v_line.lot_id), v_lids, v_actor);
      v_outputs := v_outputs || jsonb_build_object('unit_code', v_code, 'same', false,
        'roll_id', CASE WHEN v_ch.origin = 'mill' THEN (SELECT roll_id FROM public.mm_mill_rolls WHERE id = v_child)
                        ELSE (SELECT roll_id FROM public.mm_stock_units WHERE id = v_child) END);
    END LOOP;
  END LOOP;

  -- write-offs (lost/damaged at the unit)
  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'write_offs','[]'::jsonb)) LOOP
    IF NULLIF(btrim(COALESCE(v_e->>'reason','')), '') IS NULL THEN RAISE EXCEPTION 'A write-off needs a reason'; END IF;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = (v_e->>'out_line_id')::uuid;
    IF v_ch.origin = 'mill' THEN
      UPDATE public.mm_mill_rolls SET status = 'written_off', row_version = row_version + 1, updated_at = now(), updated_by = v_actor
      WHERE id = v_line.mill_roll_id;
    ELSE
      SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
      IF COALESCE(v_unit.qty_available,0) > 0 THEN
        PERFORM public._mm_ledger(v_factory, v_unit.id, 'WRITE_OFF', v_unit.qty_available, 'at_process', 'written_off', NULL, NULL,
          'mm_process_returns', v_ret, 'written off at process: ' || (v_e->>'reason'));
      END IF;
      UPDATE public.mm_stock_units SET status = 'written_off', current_location_id = NULL,
        row_version = row_version + 1, updated_at = now(), updated_by = v_actor WHERE id = v_unit.id;
    END IF;
    UPDATE public.mm_process_out_lines SET line_status = 'written_off', write_off_reason = btrim(v_e->>'reason') WHERE id = v_line.id;
  END LOOP;

  PERFORM public._mm_process_refresh(v_ch.id);

  -- warehouse returns: clear into stock where allowed
  IF array_length(v_wh_units,1) > 0 THEN PERFORM public._mm_apply_clearance(v_wh_units); END IF;

  -- mill → warehouse in the same step
  IF v_deliver = 'warehouse' AND array_length(v_out_mill,1) > 0 THEN
    v_disp := public.mm_dispatch_mill_rolls(v_out_mill,
      COALESCE(NULLIF(p_payload->'dispatch'->>'challan_no',''), public._mm_next_doc(v_factory, 'DC')),
      NULLIF(p_payload->'dispatch'->>'reference_no',''), COALESCE(NULLIF(p_payload->'dispatch'->>'to_location',''), 'Warehouse'),
      COALESCE(NULLIF(p_payload->>'returned_at','')::date, CURRENT_DATE), 'Delivered direct from ' || v_ch.challan_no);
    IF NOT COALESCE((v_disp->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'Return saved but dispatch failed: %', v_disp->>'message';
    END IF;
    UPDATE public.mm_process_returns SET in_challan_id = (v_disp->'data'->>'id')::uuid WHERE id = v_ret;
  END IF;

  RETURN public._mm_ok(jsonb_build_object('return_id', v_ret, 'return_no', v_ret_no, 'outputs', v_outputs, 'dispatch', v_disp->'data'));
EXCEPTION WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION public.mm_proc_void_challan(p_challan_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_actor uuid; v_ch public.mm_process_challans%ROWTYPE; v_line record; v_recv uuid; v_units uuid[] := '{}';
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  IF NULLIF(btrim(COALESCE(p_reason,'')), '') IS NULL THEN RETURN public._mm_err('REQUIRED','Give a reason'); END IF;
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = p_challan_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Challan not found'); END IF;
  IF v_ch.status = 'void' THEN RETURN public._mm_err('CLOSED','Already void'); END IF;
  IF EXISTS (SELECT 1 FROM public.mm_process_out_lines WHERE challan_id = v_ch.id AND line_status <> 'out') THEN
    RETURN public._mm_err('INVALID','Rolls have already come back on this challan; it cannot be voided');
  END IF;
  IF v_ch.origin = 'warehouse' THEN
    PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
    v_recv := public._mm_recv_loc(v_factory);
    FOR v_line IN SELECT * FROM public.mm_process_out_lines WHERE challan_id = v_ch.id LOOP
      PERFORM public._mm_ledger(v_factory, v_line.stock_unit_id, 'TRANSFER', 0, 'at_process', 'pending_qc', NULL, v_recv,
        'mm_process_challans', v_ch.id, 'process challan voided');
      UPDATE public.mm_stock_units SET status = 'pending_qc', current_location_id = v_recv,
        row_version = row_version + 1, updated_at = now(), updated_by = v_actor WHERE id = v_line.stock_unit_id;
      v_units := v_units || v_line.stock_unit_id;
    END LOOP;
  END IF;
  UPDATE public.mm_process_out_lines SET line_status = 'void' WHERE challan_id = v_ch.id;
  UPDATE public.mm_process_challans SET status = 'void', voided_at = now(), voided_by = v_actor, void_reason = btrim(p_reason),
    updated_at = now(), updated_by = v_actor WHERE id = v_ch.id;
  IF array_length(v_units,1) > 0 THEN PERFORM public._mm_apply_clearance(v_units); END IF;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch.id));
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public._mm_proc_line_roll_id()','public._mm_proc_apply_return_line()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.mm_proc_send(jsonb)','public.mm_proc_save_lots(uuid,jsonb)',
    'public.mm_proc_return(jsonb)','public.mm_proc_void_challan(uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;;
