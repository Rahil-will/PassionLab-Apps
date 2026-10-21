-- Finished fabric + roll colour (Rahil 2026-10-15)
-- A roll is FINISHED when: its stage is cuttable AND it has a colour (unless the fabric is greige_only).
-- mm_rolls.color_name is the one colour of a roll. Custody colour_ref (mill roll / stock unit) syncs into it.
-- Process return: stage defaults to the process output stage (a stage equal to the one sent out counts as "not changed"),
-- colour defaults to the challan target colour. Anything typed per roll still wins.

ALTER TABLE public.mm_rolls ADD COLUMN IF NOT EXISTS color_name text;

-- custody colour -> roll colour
CREATE OR REPLACE FUNCTION public._mm_roll_colour_sync()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.roll_id IS NOT NULL AND NULLIF(btrim(COALESCE(NEW.color_ref, '')), '') IS NOT NULL THEN
    UPDATE public.mm_rolls SET color_name = btrim(NEW.color_ref)
    WHERE id = NEW.roll_id AND color_name IS DISTINCT FROM btrim(NEW.color_ref);
  END IF;
  RETURN NULL;
END $function$;

CREATE TRIGGER mm_mill_rolls_colour_sync AFTER INSERT OR UPDATE OF color_ref, roll_id ON public.mm_mill_rolls
FOR EACH ROW EXECUTE FUNCTION public._mm_roll_colour_sync();
CREATE TRIGGER mm_stock_units_colour_sync AFTER INSERT OR UPDATE OF color_ref, roll_id ON public.mm_stock_units
FOR EACH ROW EXECUTE FUNCTION public._mm_roll_colour_sync();

-- Return line -> roll: stage default = process output stage; colour default = challan target colour
CREATE OR REPLACE FUNCTION public._mm_proc_apply_return_line()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_t public.mm_process_types%ROWTYPE; v_stage text; v_parent uuid; v_ol uuid; v_sent text; v_target text; v_colour text;
BEGIN
  SELECT t.* INTO v_t FROM public.mm_process_types t JOIN public.mm_process_challans c ON c.process_type_id = t.id
  WHERE c.id = NEW.challan_id;
  SELECT NULLIF(btrim(target_color), '') INTO v_target FROM public.mm_process_challans WHERE id = NEW.challan_id;
  SELECT upper(stage_code) INTO v_sent FROM public.mm_process_out_lines WHERE id = NEW.out_line_id;
  v_stage := NULLIF(upper(btrim(COALESCE(NEW.stage_code, ''))), '');
  IF v_stage IS NULL OR v_stage IS NOT DISTINCT FROM v_sent THEN
    v_stage := COALESCE(v_t.output_stage_code, v_stage);
  END IF;
  v_colour := COALESCE(NULLIF(btrim(COALESCE(NEW.color_ref, '')), ''), v_target);
  IF NEW.roll_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.same_identity THEN
    UPDATE public.mm_rolls SET
      process_round = process_round + 1,
      test_valid_from_round = CASE WHEN COALESCE(v_t.resets_testing, true) THEN process_round + 1 ELSE test_valid_from_round END,
      insp_valid_from_round = CASE WHEN COALESCE(v_t.resets_inspection, true) THEN process_round + 1 ELSE insp_valid_from_round END,
      stage_code = COALESCE(v_stage, stage_code),
      unit_form  = COALESCE(NEW.unit_form, v_t.output_unit_form, unit_form),
      width_form = COALESCE(NEW.width_form, width_form),
      grade      = COALESCE(NEW.grade, grade),
      dye_lot    = COALESCE(NEW.dye_lot, NULLIF(NEW.lot_no,''), dye_lot),
      color_name = COALESCE(v_colour, color_name),
      updated_at = now(), updated_by = public._mm_actor_id()
    WHERE id = NEW.roll_id;
  ELSE
    UPDATE public.mm_rolls SET
      stage_code = COALESCE(v_stage, stage_code),
      unit_form  = COALESCE(NEW.unit_form, v_t.output_unit_form, unit_form),
      width_form = COALESCE(NEW.width_form, width_form),
      grade      = COALESCE(NEW.grade, grade),
      dye_lot    = COALESCE(NEW.dye_lot, NULLIF(NEW.lot_no,''), dye_lot),
      color_name = COALESCE(v_colour, color_name),
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
END $function$;

-- Is this roll finished? {finished, missing: ['stage','colour'], needs_colour}
CREATE OR REPLACE FUNCTION public._mm_roll_finished(p_roll_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT r.id, r.color_name, COALESCE(s.can_cut, false) AS cut,
           COALESCE(f.color_method, 'solid_dyed') <> 'greige_only' AS needs_colour
    FROM public.mm_rolls r
    LEFT JOIN public.mm_fabric_stages s ON s.factory_id = r.factory_id AND s.code = r.stage_code
    LEFT JOIN public.mm_fabrics f ON f.id = r.fabric_id
    WHERE r.id = p_roll_id)
  SELECT jsonb_build_object(
    'finished', r.cut AND (NOT r.needs_colour OR NULLIF(btrim(COALESCE(r.color_name, '')), '') IS NOT NULL),
    'needs_colour', r.needs_colour,
    'missing', to_jsonb(ARRAY_REMOVE(ARRAY[
        CASE WHEN NOT r.cut THEN 'stage' END,
        CASE WHEN r.needs_colour AND NULLIF(btrim(COALESCE(r.color_name, '')), '') IS NULL THEN 'colour' END], NULL)))
  FROM r
$function$;
REVOKE EXECUTE ON FUNCTION public._mm_roll_finished(uuid) FROM anon, public;
