-- QC unification 2c (2026-10-15): two-way bridge between v4 QC and the old warehouse row.
--  * old row save (floor app / old Testing) -> v4 copy   (forward, existing; now wrapped with a guard)
--  * v4 inspection / test on a warehouse roll -> old row (reverse; keeps floor app + old read screens current)
-- Session flag mm.qc_reverse stops the forward mirror from copying a reverse write back.

CREATE OR REPLACE FUNCTION public._mm_qc_mirror_legacy_inspection_body(new public.mm_warehouse_inspections, old public.mm_warehouse_inspections, tg_op text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_u public.mm_stock_units%ROWTYPE; v_r public.mm_rolls%ROWTYPE; v_prev uuid; v_tid uuid; v_fv jsonb;
BEGIN
  IF NEW.stock_unit_id IS NULL OR NEW.result IS NULL THEN RETURN; END IF;
  IF TG_OP = 'UPDATE' AND NEW.result IS NOT DISTINCT FROM OLD.result AND NEW.field_values IS NOT DISTINCT FROM OLD.field_values
     AND NEW.total_points IS NOT DISTINCT FROM OLD.total_points AND NEW.result_override IS NOT DISTINCT FROM OLD.result_override THEN
    RETURN;
  END IF;
  SELECT * INTO v_u FROM public.mm_stock_units WHERE id = NEW.stock_unit_id;
  IF v_u.roll_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = v_u.roll_id;
  v_fv := COALESCE(NEW.field_values, '{}'::jsonb);
  IF v_fv <> '{}'::jsonb THEN
    IF NOT v_fv ? 'width' AND NULLIF(v_fv->>'inspected_width_in', '') IS NOT NULL THEN
      v_fv := v_fv || jsonb_build_object('width', v_fv->>'inspected_width_in');
    END IF;
    SELECT id INTO v_prev FROM public.mm_qc_tests WHERE legacy_inspection_id = NEW.id ORDER BY created_at DESC LIMIT 1;
    INSERT INTO public.mm_qc_tests (factory_id, scope_kind, scope_id, site_side, stage_code, fabric_type_id, field_values, result,
                                    origin, tested_at, remarks, created_by, legacy_inspection_id, supersedes_id)
    VALUES (NEW.factory_id, CASE WHEN NEW.in_challan_id IS NOT NULL THEN 'in_challan' ELSE 'rolls' END, NEW.in_challan_id, 'warehouse',
            v_r.stage_code, COALESCE(v_u.fabric_type_id, v_r.fabric_type_id), v_fv,
            CASE NEW.result WHEN 'fail' THEN 'fail' WHEN 'hold' THEN 'hold' ELSE 'pass' END,
            'migrated', COALESCE(NEW.inspected_at, now()), 'From warehouse testing', COALESCE(NEW.inspected_by, NEW.updated_by, NEW.created_by),
            NEW.id, v_prev)
    RETURNING id INTO v_tid;
    INSERT INTO public.mm_qc_test_rolls (factory_id, test_id, roll_id, round_at_test)
    VALUES (NEW.factory_id, v_tid, v_r.id, COALESCE(v_r.process_round, 0));
  END IF;
  IF NEW.result IN ('pass', 'fail') THEN
    v_prev := NULL;
    SELECT id INTO v_prev FROM public.mm_qc_inspections WHERE legacy_inspection_id = NEW.id ORDER BY created_at DESC LIMIT 1;
    INSERT INTO public.mm_qc_inspections (factory_id, roll_id, round_at_inspection, site_side, stage_code, inspected_length, length_uom,
      cuttable_width, width_uom, pts_1, pts_2, pts_3, pts_4, total_points, points_per_100_sqyd, threshold_used, result_computed,
      result_override, override_reason, result, origin, legacy_inspection_id, supersedes_id, inspected_at, remarks, created_by)
    VALUES (NEW.factory_id, v_r.id, COALESCE(v_r.process_round, 0), 'warehouse', v_r.stage_code, NEW.inspected_length, 'm',
      NEW.cuttable_width, COALESCE(CASE WHEN NEW.width_uom IN ('in','cm') THEN NEW.width_uom END, 'in'),
      NEW.pts_1, NEW.pts_2, NEW.pts_3, NEW.pts_4, NEW.total_points, NEW.points_per_100_sqyd, NEW.threshold_used,
      CASE WHEN NEW.result_computed IN ('pass','fail') THEN NEW.result_computed END,
      CASE WHEN NEW.result_override IN ('pass','fail') THEN NEW.result_override END, NEW.override_reason,
      NEW.result, 'migrated', NEW.id, v_prev, COALESCE(NEW.inspected_at, now()), 'From warehouse testing',
      COALESCE(NEW.inspected_by, NEW.updated_by, NEW.created_by));
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public._mm_qc_mirror_legacy_inspection_guarded()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(current_setting('mm.qc_reverse', true), '') = 'on' THEN RETURN NULL; END IF;
  PERFORM public._mm_qc_mirror_legacy_inspection_body(NEW, CASE WHEN TG_OP = 'UPDATE' THEN OLD END, TG_OP);
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER mm_warehouse_inspections_mirror_v4 AFTER INSERT OR UPDATE ON public.mm_warehouse_inspections
FOR EACH ROW EXECUTE FUNCTION public._mm_qc_mirror_legacy_inspection_guarded();

CREATE OR REPLACE FUNCTION public._mm_qc_reverse_inspection()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_u public.mm_stock_units%ROWTYPE;
BEGIN
  IF NEW.origin = 'migrated' OR NEW.voided_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_u FROM public.mm_stock_units WHERE roll_id = NEW.roll_id;
  IF v_u.id IS NULL OR v_u.in_challan_id IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('mm.qc_reverse', 'on', true);
  INSERT INTO public.mm_warehouse_inspections (factory_id, in_challan_id, stock_unit_id, scope_kind, scope_id, site, occasion,
    result, inspected_length, cuttable_width, width_uom, pts_1, pts_2, pts_3, pts_4, points_per_100_sqyd,
    threshold_used, result_computed, result_override, override_reason, inspected_at, inspected_by, created_by, updated_by, field_values)
  VALUES (NEW.factory_id, v_u.in_challan_id, v_u.id, 'in_challan', v_u.in_challan_id, 'warehouse',
    CASE WHEN COALESCE(NEW.round_at_inspection, 0) > 0 THEN 'after_process' ELSE 'inbound' END,
    NEW.result, NEW.inspected_length, NEW.cuttable_width, NEW.width_uom, NEW.pts_1, NEW.pts_2, NEW.pts_3, NEW.pts_4,
    NEW.points_per_100_sqyd, NEW.threshold_used, NEW.result_computed, NEW.result_override, NEW.override_reason,
    NEW.inspected_at, NEW.created_by, NEW.created_by, NEW.created_by, '{}'::jsonb)
  ON CONFLICT (scope_kind, scope_id, stock_unit_id) WHERE stock_unit_id IS NOT NULL DO UPDATE SET
    result = EXCLUDED.result, inspected_length = EXCLUDED.inspected_length, cuttable_width = EXCLUDED.cuttable_width,
    width_uom = EXCLUDED.width_uom, pts_1 = EXCLUDED.pts_1, pts_2 = EXCLUDED.pts_2, pts_3 = EXCLUDED.pts_3, pts_4 = EXCLUDED.pts_4,
    points_per_100_sqyd = EXCLUDED.points_per_100_sqyd, threshold_used = EXCLUDED.threshold_used,
    result_computed = EXCLUDED.result_computed, result_override = EXCLUDED.result_override, override_reason = EXCLUDED.override_reason,
    inspected_at = EXCLUDED.inspected_at, updated_by = EXCLUDED.updated_by, updated_at = now(),
    row_version = public.mm_warehouse_inspections.row_version + 1;
  PERFORM set_config('mm.qc_reverse', 'off', true);
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER mm_qc_inspections_reverse_legacy AFTER INSERT ON public.mm_qc_inspections
FOR EACH ROW EXECUTE FUNCTION public._mm_qc_reverse_inspection();

CREATE OR REPLACE FUNCTION public._mm_qc_reverse_test_roll()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t public.mm_qc_tests%ROWTYPE; v_u public.mm_stock_units%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM public.mm_qc_tests WHERE id = NEW.test_id;
  IF v_t.origin = 'migrated' OR v_t.voided_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_u FROM public.mm_stock_units WHERE roll_id = NEW.roll_id;
  IF v_u.id IS NULL OR v_u.in_challan_id IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('mm.qc_reverse', 'on', true);
  UPDATE public.mm_warehouse_inspections SET
    field_values = COALESCE(field_values, '{}'::jsonb) || COALESCE(v_t.field_values, '{}'::jsonb),
    updated_at = now(), updated_by = v_t.created_by, row_version = row_version + 1
  WHERE scope_kind = 'in_challan' AND scope_id = v_u.in_challan_id AND stock_unit_id = v_u.id;
  IF NOT FOUND AND v_t.result IN ('pass', 'fail') THEN
    INSERT INTO public.mm_warehouse_inspections (factory_id, in_challan_id, stock_unit_id, scope_kind, scope_id, site, occasion,
      result, field_values, inspected_at, inspected_by, created_by, updated_by)
    VALUES (v_t.factory_id, v_u.in_challan_id, v_u.id, 'in_challan', v_u.in_challan_id, 'warehouse',
      CASE WHEN COALESCE(NEW.round_at_test, 0) > 0 THEN 'after_process' ELSE 'inbound' END,
      v_t.result, COALESCE(v_t.field_values, '{}'::jsonb), v_t.tested_at, v_t.created_by, v_t.created_by, v_t.created_by);
  END IF;
  PERFORM set_config('mm.qc_reverse', 'off', true);
  RETURN NULL;
END $function$;

CREATE OR REPLACE TRIGGER mm_qc_test_rolls_reverse_legacy AFTER INSERT ON public.mm_qc_test_rolls
FOR EACH ROW EXECUTE FUNCTION public._mm_qc_reverse_test_roll();
