CREATE OR REPLACE FUNCTION public.mm_save_warehouse_inspections(p_id uuid, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.mm_save_inspections('in_challan', p_id, p_rolls);
END;
$function$;

CREATE OR REPLACE FUNCTION public._mm_inherit_mill_inspection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_insp public.mm_warehouse_inspections%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending_qc' OR OLD.status IS DISTINCT FROM 'in_transit' OR NEW.source IS DISTINCT FROM 'mill' THEN
    RETURN NEW;
  END IF;
  IF NEW.mill_roll_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_insp
  FROM public.mm_warehouse_inspections i
  WHERE i.mill_roll_id = NEW.mill_roll_id AND i.site = 'mill'
  ORDER BY i.inspected_at DESC NULLS LAST
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF public._mm_mill_inspect_stale(NEW.mill_roll_id, v_insp.inspected_at) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.mm_warehouse_inspections (
    factory_id, site, occasion, scope_kind, scope_id,
    mill_batch_id, mill_roll_id, in_challan_id, stock_unit_id, inherited_from,
    result, field_values, remarks, shade,
    inspected_length, cuttable_width, width_uom,
    pts_1, pts_2, pts_3, pts_4, points_per_100_sqyd, threshold_used,
    result_computed, result_override, override_reason,
    inspected_at, inspected_by, created_by, updated_by
  ) VALUES (
    NEW.factory_id, 'warehouse', 'inbound', 'in_challan', NEW.in_challan_id,
    NEW.mill_batch_id, NEW.mill_roll_id, NEW.in_challan_id, NEW.id, v_insp.id,
    v_insp.result, '{}'::jsonb, v_insp.remarks, v_insp.shade,
    v_insp.inspected_length, v_insp.cuttable_width, v_insp.width_uom,
    v_insp.pts_1, v_insp.pts_2, v_insp.pts_3, v_insp.pts_4, v_insp.points_per_100_sqyd, v_insp.threshold_used,
    v_insp.result_computed, v_insp.result_override, v_insp.override_reason,
    now(), public._mm_actor_id(), public._mm_actor_id(), public._mm_actor_id()
  )
  ON CONFLICT DO NOTHING;
  NEW.qc_result := v_insp.result;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mm_inherit_mill_inspection ON public.mm_stock_units;
CREATE TRIGGER trg_mm_inherit_mill_inspection
BEFORE UPDATE OF status ON public.mm_stock_units
FOR EACH ROW
EXECUTE FUNCTION public._mm_inherit_mill_inspection();

CREATE OR REPLACE FUNCTION public._mm_invalidate_qc_after_process()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.mill_roll_id IS NOT NULL THEN
    UPDATE public.mm_mill_rolls
    SET qc_result = NULL, row_version = row_version + 1, updated_at = now()
    WHERE id = NEW.mill_roll_id AND qc_result IS NOT NULL;
  END IF;
  IF NEW.stock_unit_id IS NOT NULL THEN
    UPDATE public.mm_stock_units
    SET qc_result = NULL, row_version = row_version + 1, updated_at = now()
    WHERE id = NEW.stock_unit_id AND qc_result IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mm_invalidate_qc_after_process ON public.mm_process_return_lines;
CREATE TRIGGER trg_mm_invalidate_qc_after_process
AFTER INSERT ON public.mm_process_return_lines
FOR EACH ROW
EXECUTE FUNCTION public._mm_invalidate_qc_after_process();

DO $patch$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_mill_line';
  IF def IS NOT NULL AND def NOT LIKE '%qc_result%' THEN
    def := replace(
      def,
      '''at_mill'', (r.status = ''draft'' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id))',
      '''qc_result'', r.qc_result, ''at_mill'', (r.status = ''draft'' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id))'
    );
    EXECUTE def;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_unallocated_mill';
  IF def IS NOT NULL AND def NOT LIKE '%qc_result%' THEN
    def := replace(
      def,
      '''at_mill'', (r.status = ''draft'' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id))',
      '''qc_result'', r.qc_result, ''at_mill'', (r.status = ''draft'' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id))'
    );
    EXECUTE def;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_mill_stock';
  IF def IS NOT NULL THEN
    IF def NOT LIKE '%qc_result%' THEN
      def := replace(def, '''place'', ''at_mill''', '''qc_result'', r.qc_result, ''place'', ''at_mill''');
    END IF;
    IF def NOT LIKE '%inspect_pending%' THEN
      def := replace(
        def,
        '''total'', v_total,',
        '''total'', v_total, ''inspect_pending'', (SELECT count(*)::int FROM public.mm_mill_rolls r WHERE r.factory_id = v_factory AND r.status = ''draft'' AND r.in_challan_id IS NULL AND NOT public._mm_mill_at_process(r.id) AND r.qc_result IS NULL),'
      );
    END IF;
    EXECUTE def;
  END IF;

END
$patch$;

CREATE OR REPLACE FUNCTION public._mm_mill_refuse_failed_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'dispatched' AND OLD.status = 'draft' AND OLD.qc_result = 'fail' THEN
    RAISE EXCEPTION 'A selected roll failed 4-point. Remove it from this challan';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mm_mill_refuse_failed_dispatch ON public.mm_mill_rolls;
CREATE TRIGGER trg_mm_mill_refuse_failed_dispatch
BEFORE UPDATE OF status ON public.mm_mill_rolls
FOR EACH ROW
EXECUTE FUNCTION public._mm_mill_refuse_failed_dispatch();;
