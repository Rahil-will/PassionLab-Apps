-- QC unification 2b: mirror every mm_warehouse_inspections save (floor app + old Testing page) into v4 QC.
CREATE OR REPLACE FUNCTION public._mm_qc_mirror_legacy_inspection()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_u public.mm_stock_units%ROWTYPE; v_r public.mm_rolls%ROWTYPE; v_prev uuid; v_tid uuid; v_fv jsonb;
BEGIN
  IF NEW.stock_unit_id IS NULL OR NEW.result IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.result IS NOT DISTINCT FROM OLD.result AND NEW.field_values IS NOT DISTINCT FROM OLD.field_values
     AND NEW.total_points IS NOT DISTINCT FROM OLD.total_points AND NEW.result_override IS NOT DISTINCT FROM OLD.result_override THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_u FROM public.mm_stock_units WHERE id = NEW.stock_unit_id;
  IF v_u.roll_id IS NULL THEN RETURN NULL; END IF;
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
  RETURN NULL;
END $function$;

CREATE TRIGGER mm_warehouse_inspections_mirror_v4 AFTER INSERT OR UPDATE ON public.mm_warehouse_inspections
FOR EACH ROW EXECUTE FUNCTION public._mm_qc_mirror_legacy_inspection();
