-- 4-point can be recorded at mill (batch), after process return, or on a
-- warehouse inbound challan. One result per roll per work unit. Process return
-- clears the previous result so the cloth can be inspected again.

ALTER TABLE public.mm_mill_rolls
  ADD COLUMN IF NOT EXISTS qc_result text;

ALTER TABLE public.mm_warehouse_inspections
  ALTER COLUMN in_challan_id DROP NOT NULL,
  ALTER COLUMN stock_unit_id DROP NOT NULL;

ALTER TABLE public.mm_warehouse_inspections
  ADD COLUMN IF NOT EXISTS site text,
  ADD COLUMN IF NOT EXISTS occasion text,
  ADD COLUMN IF NOT EXISTS scope_kind text,
  ADD COLUMN IF NOT EXISTS scope_id uuid,
  ADD COLUMN IF NOT EXISTS mill_batch_id uuid REFERENCES public.mm_mill_batches (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS mill_roll_id uuid REFERENCES public.mm_mill_rolls (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS process_challan_id uuid REFERENCES public.mm_process_challans (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS inherited_from uuid REFERENCES public.mm_warehouse_inspections (id) ON DELETE SET NULL;

UPDATE public.mm_warehouse_inspections
SET
  site = COALESCE(site, 'warehouse'),
  occasion = COALESCE(occasion, 'inbound'),
  scope_kind = COALESCE(scope_kind, 'in_challan'),
  scope_id = COALESCE(scope_id, in_challan_id)
WHERE scope_kind IS NULL OR scope_id IS NULL OR site IS NULL OR occasion IS NULL;

ALTER TABLE public.mm_warehouse_inspections
  ALTER COLUMN site SET NOT NULL,
  ALTER COLUMN occasion SET NOT NULL,
  ALTER COLUMN scope_kind SET NOT NULL,
  ALTER COLUMN scope_id SET NOT NULL;

ALTER TABLE public.mm_mill_rolls DROP CONSTRAINT IF EXISTS mm_mill_rolls_qc_result_chk;
ALTER TABLE public.mm_mill_rolls
  ADD CONSTRAINT mm_mill_rolls_qc_result_chk
  CHECK (qc_result IS NULL OR qc_result = ANY (ARRAY['pass'::text, 'fail'::text]));

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_site_chk;
ALTER TABLE public.mm_warehouse_inspections
  ADD CONSTRAINT mm_warehouse_inspections_site_chk
  CHECK (site = ANY (ARRAY['mill'::text, 'warehouse'::text]));

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_occasion_chk;
ALTER TABLE public.mm_warehouse_inspections
  ADD CONSTRAINT mm_warehouse_inspections_occasion_chk
  CHECK (occasion = ANY (ARRAY['after_allocate'::text, 'after_process'::text, 'inbound'::text]));

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_scope_kind_chk;
ALTER TABLE public.mm_warehouse_inspections
  ADD CONSTRAINT mm_warehouse_inspections_scope_kind_chk
  CHECK (scope_kind = ANY (ARRAY['mill_batch'::text, 'in_challan'::text, 'process_challan'::text]));

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_scope_shape_chk;
ALTER TABLE public.mm_warehouse_inspections
  ADD CONSTRAINT mm_warehouse_inspections_scope_shape_chk
  CHECK (
    (scope_kind = 'mill_batch' AND mill_batch_id = scope_id AND mill_roll_id IS NOT NULL)
    OR (scope_kind = 'in_challan' AND in_challan_id = scope_id AND stock_unit_id IS NOT NULL)
    OR (scope_kind = 'process_challan' AND process_challan_id = scope_id
        AND (mill_roll_id IS NOT NULL OR stock_unit_id IS NOT NULL))
  );

ALTER TABLE public.mm_warehouse_inspections DROP CONSTRAINT IF EXISTS mm_warehouse_inspections_unit_uidx;
DROP INDEX IF EXISTS public.mm_warehouse_inspections_unit_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS mm_insp_scope_mill_roll_uidx
  ON public.mm_warehouse_inspections (scope_kind, scope_id, mill_roll_id)
  WHERE mill_roll_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mm_insp_scope_stock_uidx
  ON public.mm_warehouse_inspections (scope_kind, scope_id, stock_unit_id)
  WHERE stock_unit_id IS NOT NULL;

COMMENT ON COLUMN public.mm_mill_rolls.qc_result IS
  'Current mill 4-point for this roll. Cleared when the roll returns from process.';
COMMENT ON COLUMN public.mm_warehouse_inspections.scope_kind IS
  'Work unit for this 4-point: mill_batch, in_challan, or process_challan.';

CREATE OR REPLACE FUNCTION public._mm_fpt_threshold(p_unit_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ft uuid;
  v_buyer uuid;
  v_points numeric;
BEGIN
  SELECT u.factory_id, COALESCE(u.fabric_type_id, sm.fabric_type_id), o.buyer_id
    INTO v_factory, v_ft, v_buyer
  FROM public.mm_stock_units u
  LEFT JOIN public.mm_style_materials sm ON sm.id = u.style_material_id
  LEFT JOIN public.style_orders o ON o.id = sm.order_id
  WHERE u.id = p_unit_id;
  IF v_factory IS NULL THEN
    SELECT r.factory_id, r.fabric_type_id, o.buyer_id
      INTO v_factory, v_ft, v_buyer
    FROM public.mm_mill_rolls r
    LEFT JOIN public.mm_style_materials sm ON sm.id = r.style_material_id
    LEFT JOIN public.style_orders o ON o.id = sm.order_id
    WHERE r.id = p_unit_id;
  END IF;
  SELECT t.max_points INTO v_points
  FROM public.mm_fpt_thresholds t
  WHERE t.factory_id = v_factory AND t.fabric_type_id = v_ft AND t.buyer_id = v_buyer;
  IF v_points IS NULL THEN
    SELECT f.fpt_max_points INTO v_points FROM public.mm_fabric_types f WHERE f.id = v_ft;
  END IF;
  RETURN COALESCE(v_points, 40);
END;
$function$;

CREATE OR REPLACE FUNCTION public._mm_mill_inspect_stale(p_mill_roll_id uuid, p_inspected_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.mm_process_return_lines r
    JOIN public.mm_process_challans c ON c.id = r.challan_id
    WHERE r.mill_roll_id = p_mill_roll_id
      AND COALESCE(c.returned_at, r.created_at) > p_inspected_at
  );
$function$;

CREATE OR REPLACE FUNCTION public.mm_save_inspections(p_scope_kind text, p_scope_id uuid, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_kind text;
  v_site text;
  v_occasion text;
  v_batch public.mm_mill_batches%ROWTYPE;
  v_ch public.mm_in_challans%ROWTYPE;
  v_proc public.mm_process_challans%ROWTYPE;
  v_recv uuid;
  v_red uuid;
  v_row jsonb;
  v_result text;
  v_values jsonb;
  v_roll public.mm_mill_rolls%ROWTYPE;
  v_unit public.mm_stock_units%ROWTYPE;
  v_id uuid;
  v_n integer := 0;
  v_measured numeric;
  v_width numeric;
  v_width_uom text;
  v_p1 integer;
  v_p2 integer;
  v_p3 integer;
  v_p4 integer;
  v_pts integer;
  v_score numeric;
  v_threshold numeric;
  v_computed text;
  v_override text;
  v_reason text;
  v_final text;
  v_insp uuid;
  v_new_status text;
  v_new_loc uuid;
  v_current numeric;
  v_delta numeric;
  v_uom text;
  v_mill_batch uuid;
  v_mill_roll uuid;
  v_stock uuid;
  v_qc boolean := false;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
    v_qc := true;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_factory := public._mm_require_ops('mm_roll_entry');
    EXCEPTION WHEN OTHERS THEN
      RETURN public._mm_err('ERROR', SQLERRM);
    END;
  END;
  v_kind := NULLIF(btrim(COALESCE(p_scope_kind, '')), '');
  IF v_kind IS NULL OR p_scope_id IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Inspection scope is required');
  END IF;
  IF v_kind NOT IN ('mill_batch', 'in_challan', 'process_challan') THEN
    RETURN public._mm_err('INVALID', 'Unknown inspection scope');
  END IF;
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' THEN
    RETURN public._mm_err('REQUIRED', 'Set pass or fail on at least one roll');
  END IF;

  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_recv := public._mm_recv_loc(v_factory);
  v_red := COALESCE(public._mm_loc(v_factory, 'WAREHOUSE_REDLABEL'), v_recv);

  IF v_kind = 'mill_batch' THEN
    SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = p_scope_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Mill batch not found'); END IF;
    v_site := 'mill';
    v_occasion := 'after_allocate';
  ELSIF v_kind = 'in_challan' THEN
    SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_scope_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
    IF v_ch.source = 'mill' AND v_ch.status NOT IN ('received', 'partial', 'short_closed') THEN
      RETURN public._mm_err('INVALID', 'Receive this mill challan before testing');
    END IF;
    v_site := 'warehouse';
    v_occasion := 'inbound';
  ELSE
    SELECT * INTO v_proc FROM public.mm_process_challans WHERE id = p_scope_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Process challan was not found'); END IF;
    IF v_proc.status = 'open' AND NOT EXISTS (
      SELECT 1 FROM public.mm_process_return_lines r WHERE r.challan_id = v_proc.id
    ) THEN
      RETURN public._mm_err('INVALID', 'Receive the process return before inspecting');
    END IF;
    v_site := v_proc.origin;
    v_occasion := 'after_process';
  END IF;
  IF NOT v_qc AND v_kind = 'in_challan' THEN
    RETURN public._mm_err('NO_PERMISSION', 'mm_qc required');
  END IF;
  IF NOT v_qc AND v_kind = 'process_challan' AND v_proc.origin = 'warehouse' THEN
    RETURN public._mm_err('NO_PERMISSION', 'mm_qc required');
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rolls, '[]'::jsonb))
  LOOP
    v_result := lower(NULLIF(btrim(COALESCE(v_row->>'result', '')), ''));
    IF v_result IS NULL THEN CONTINUE; END IF;
    IF v_result NOT IN ('pass', 'fail') THEN
      RETURN public._mm_err('INVALID', 'Each roll must be pass or fail');
    END IF;
    BEGIN
      v_id := (v_row->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN public._mm_err('INVALID', 'A roll id is not valid');
    END;
    IF v_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'Each roll needs an id'); END IF;

    v_roll := NULL;
    v_unit := NULL;
    v_mill_roll := NULL;
    v_stock := NULL;
    v_mill_batch := NULL;

    IF v_kind = 'mill_batch' THEN
      SELECT * INTO v_roll FROM public.mm_mill_rolls
      WHERE id = v_id AND factory_id = v_factory AND mill_batch_id = v_batch.id FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this batch'); END IF;
      IF v_roll.status IS DISTINCT FROM 'draft' OR v_roll.in_challan_id IS NOT NULL OR public._mm_mill_at_process(v_roll.id) THEN
        RETURN public._mm_err('INVALID', 'Inspect only rolls still at the mill');
      END IF;
      v_mill_roll := v_roll.id;
      v_mill_batch := v_roll.mill_batch_id;
    ELSIF v_kind = 'in_challan' THEN
      SELECT * INTO v_unit FROM public.mm_stock_units
      WHERE id = v_id AND in_challan_id = v_ch.id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this challan'); END IF;
      IF v_unit.status IS DISTINCT FROM 'pending_qc' AND v_unit.status IS DISTINCT FROM 'in_stock' THEN
        RETURN public._mm_err('INVALID', 'A selected roll is not waiting for warehouse test');
      END IF;
      v_stock := v_unit.id;
    ELSE
      IF v_proc.origin = 'mill' THEN
        SELECT * INTO v_roll FROM public.mm_mill_rolls WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
        IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this process challan'); END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.mm_process_return_lines r
          WHERE r.challan_id = v_proc.id AND r.mill_roll_id = v_roll.id
        ) THEN
          RETURN public._mm_err('INVALID', 'Inspect only rolls that came back from process');
        END IF;
        v_mill_roll := v_roll.id;
        v_mill_batch := v_roll.mill_batch_id;
      ELSE
        SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
        IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this process challan'); END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.mm_process_return_lines r
          WHERE r.challan_id = v_proc.id AND r.stock_unit_id = v_unit.id
        ) THEN
          RETURN public._mm_err('INVALID', 'Inspect only rolls that came back from process');
        END IF;
        IF v_unit.status IS DISTINCT FROM 'pending_qc' AND v_unit.status IS DISTINCT FROM 'in_stock' THEN
          RETURN public._mm_err('INVALID', 'A selected roll is not waiting for warehouse test');
        END IF;
        v_stock := v_unit.id;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.mm_warehouse_inspections i
      WHERE i.scope_kind = v_kind AND i.scope_id = p_scope_id
        AND (
          (v_mill_roll IS NOT NULL AND i.mill_roll_id = v_mill_roll)
          OR (v_stock IS NOT NULL AND i.stock_unit_id = v_stock)
        )
    ) THEN
      RETURN public._mm_err('LOCKED', 'This roll is already inspected');
    END IF;

    v_values := CASE WHEN jsonb_typeof(v_row->'values') = 'object' THEN v_row->'values' ELSE '{}'::jsonb END;
    v_measured := COALESCE(NULLIF(v_values->>'inspected_length', '')::numeric, NULLIF(v_row->>'inspected_length', '')::numeric);
    v_width := COALESCE(NULLIF(v_values->>'inspected_width_in', '')::numeric, NULLIF(v_values->>'cuttable_width', '')::numeric, NULLIF(v_row->>'cuttable_width', '')::numeric);
    v_width_uom := COALESCE(NULLIF(v_values->>'width_uom', ''), 'in');
    v_p1 := 0; v_p2 := 0; v_p3 := 0; v_p4 := 0; v_pts := 0;
    v_score := NULL; v_computed := v_result; v_override := NULL; v_threshold := NULL;
    v_uom := COALESCE(v_unit.qty_uom, v_unit.uom, 'm');
    IF v_measured IS NOT NULL AND v_width IS NOT NULL THEN
      v_p1 := COALESCE(NULLIF(v_values->>'pts_1','')::int, 0);
      v_p2 := COALESCE(NULLIF(v_values->>'pts_2','')::int, 0);
      v_p3 := COALESCE(NULLIF(v_values->>'pts_3','')::int, 0);
      v_p4 := COALESCE(NULLIF(v_values->>'pts_4','')::int, 0);
      v_pts := v_p1 + 2*v_p2 + 3*v_p3 + 4*v_p4;
      v_score := public._mm_fpt_score(v_pts, v_measured, v_uom, v_width, v_width_uom);
      v_threshold := public._mm_fpt_threshold(COALESCE(v_stock, v_mill_roll));
      v_computed := CASE WHEN v_score IS NULL OR v_score <= v_threshold THEN 'pass' ELSE 'fail' END;
      IF v_result IS DISTINCT FROM v_computed THEN
        v_override := v_result;
      END IF;
    END IF;
    v_reason := NULLIF(btrim(COALESCE(v_values->>'override_reason', v_row->>'override_reason', '')), '');
    IF v_override IS NOT NULL AND v_reason IS NULL THEN
      RETURN public._mm_err('REQUIRED', 'An override needs a reason');
    END IF;
    v_final := COALESCE(v_override, v_computed);

    IF v_stock IS NOT NULL AND v_measured IS NOT NULL THEN
      v_current := COALESCE(public._mm_unit_qty_received(v_unit), 0);
      v_delta := v_measured - v_current;
      IF abs(v_delta) > 0.0001 THEN
        PERFORM public._mm_ledger(
          v_factory, v_unit.id,
          CASE WHEN v_delta < 0 THEN 'QC_DEDUCT' ELSE 'ADJUST_PLUS' END,
          v_delta, v_unit.status, v_unit.status,
          v_unit.current_location_id, v_unit.current_location_id,
          'mm_warehouse_inspections', p_scope_id, 'length confirmed at inspection'
        );
        PERFORM public._mm_set_on_hand(v_unit.id, v_measured, true);
      END IF;
    END IF;

    v_new_status := CASE WHEN v_stock IS NOT NULL AND v_final = 'fail' THEN 'rejected' ELSE COALESCE(v_unit.status, v_roll.status) END;
    v_new_loc := CASE WHEN v_stock IS NOT NULL AND v_final = 'fail' THEN v_red ELSE v_unit.current_location_id END;

    BEGIN
      INSERT INTO public.mm_warehouse_inspections (
        factory_id, site, occasion, scope_kind, scope_id,
        mill_batch_id, mill_roll_id, in_challan_id, process_challan_id, stock_unit_id,
        result, field_values, remarks, shade,
        inspected_length, cuttable_width, width_uom,
        pts_1, pts_2, pts_3, pts_4, points_per_100_sqyd, threshold_used,
        result_computed, result_override, override_reason, override_by, override_at,
        inspected_at, inspected_by, created_by, updated_by
      ) VALUES (
        v_factory, v_site, v_occasion, v_kind, p_scope_id,
        v_mill_batch, v_mill_roll,
        CASE WHEN v_kind = 'in_challan' THEN p_scope_id ELSE NULL END,
        CASE WHEN v_kind = 'process_challan' THEN p_scope_id ELSE NULL END,
        v_stock,
        v_final, v_values,
        NULLIF(btrim(COALESCE(v_row->>'remarks', '')), ''),
        NULLIF(btrim(COALESCE(v_row->>'shade', v_values->>'shade', '')), ''),
        v_measured, v_width, v_width_uom,
        v_p1, v_p2, v_p3, v_p4, v_score, v_threshold,
        v_computed, v_override, v_reason,
        CASE WHEN v_override IS NULL THEN NULL ELSE public._mm_actor_id() END,
        CASE WHEN v_override IS NULL THEN NULL ELSE now() END,
        now(), public._mm_actor_id(), public._mm_actor_id(), public._mm_actor_id()
      ) RETURNING id INTO v_insp;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'This roll is already inspected';
    END;

    IF v_mill_roll IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        qc_result = v_final,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_mill_roll;
    END IF;

    IF v_stock IS NOT NULL THEN
      UPDATE public.mm_stock_units SET
        qc_result = v_final,
        status = v_new_status,
        current_location_id = v_new_loc,
        tested_shade = COALESCE(NULLIF(btrim(COALESCE(v_row->>'shade', v_values->>'shade', '')), ''), tested_shade),
        tested_shade_at = CASE WHEN NULLIF(btrim(COALESCE(v_row->>'shade', '')), '') IS NULL THEN tested_shade_at ELSE now() END,
        tested_shade_by = CASE WHEN NULLIF(btrim(COALESCE(v_row->>'shade', '')), '') IS NULL THEN tested_shade_by ELSE public._mm_actor_id() END,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_stock;
      PERFORM public._mm_ledger(
        v_factory, v_stock, 'TRANSFER', COALESCE(v_measured, v_unit.length_m), v_unit.status, v_new_status,
        v_unit.current_location_id, v_new_loc, 'mm_warehouse_inspections', p_scope_id,
        CASE WHEN v_final = 'pass' THEN 'Warehouse 4-point pass' ELSE 'Warehouse 4-point fail' END
      );
    END IF;
    v_n := v_n + 1;
  END LOOP;

  IF v_kind = 'in_challan' THEN
    PERFORM public._mm_apply_clearance(ARRAY(SELECT u.id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id));
  ELSIF v_kind = 'process_challan' AND v_proc.origin = 'warehouse' THEN
    PERFORM public._mm_apply_clearance(ARRAY(
      SELECT r.stock_unit_id FROM public.mm_process_return_lines r WHERE r.challan_id = v_proc.id AND r.stock_unit_id IS NOT NULL
    ));
  END IF;

  RETURN public._mm_ok(jsonb_build_object('id', p_scope_id, 'saved', v_n, 'scope_kind', v_kind));
END;
$function$;

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
EXECUTE FUNCTION public._mm_mill_refuse_failed_dispatch();

CREATE OR REPLACE FUNCTION public.mm_get_process_challan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_ch public.mm_process_challans%ROWTYPE;
  v_vendor text;
  v_process text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  IF p_id IS NULL THEN RETURN public._mm_err('REQUIRED', 'A process challan is required'); END IF;
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Process challan was not found'); END IF;
  SELECT v.name INTO v_vendor FROM public.mm_process_vendors v WHERE v.id = v_ch.vendor_id AND v.factory_id = v_factory;
  SELECT t.name INTO v_process FROM public.mm_process_types t WHERE t.id = v_ch.process_type_id AND t.factory_id = v_factory;
  RETURN public._mm_ok(jsonb_build_object(
    'id', v_ch.id, 'challan_no', v_ch.challan_no, 'origin', v_ch.origin, 'status', v_ch.status,
    'vendor_name', v_vendor, 'process_name', v_process, 'remarks', v_ch.remarks,
    'created_at', v_ch.created_at, 'returned_at', v_ch.returned_at,
    'out', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'unit_code', l.unit_code, 'qty', l.qty, 'uom', l.uom, 'shade', l.shade,
        'lot_no', l.lot_no, 'color_ref', l.color_ref, 'line_status', l.line_status,
        'style_name', NULLIF(btrim(o.style_name), '')
      ) ORDER BY l.unit_code)
      FROM public.mm_process_out_lines l
      LEFT JOIN public.mm_mill_rolls mr ON mr.id = l.mill_roll_id AND mr.factory_id = v_factory
      LEFT JOIN public.mm_stock_units su ON su.id = l.stock_unit_id AND su.factory_id = v_factory
      LEFT JOIN public.mm_style_materials sm ON sm.id = COALESCE(mr.style_material_id, su.style_material_id) AND sm.factory_id = v_factory
      LEFT JOIN public.style_orders o ON o.id = sm.order_id AND o.factory_id = v_factory
      WHERE l.challan_id = v_ch.id AND l.factory_id = v_factory
    ), '[]'::jsonb),
    'back', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'out_line_id', r.out_line_id, 'same_identity', r.same_identity, 'unit_code', r.unit_code,
        'qty', r.qty, 'uom', r.uom, 'shade', r.shade, 'color_ref', r.color_ref, 'lot_no', r.lot_no,
        'mill_roll_id', r.mill_roll_id, 'stock_unit_id', r.stock_unit_id,
        'qc_result', COALESCE(mr.qc_result, su.qc_result)
      ) ORDER BY r.created_at, r.unit_code)
      FROM public.mm_process_return_lines r
      LEFT JOIN public.mm_mill_rolls mr ON mr.id = r.mill_roll_id AND mr.factory_id = v_factory
      LEFT JOIN public.mm_stock_units su ON su.id = r.stock_unit_id AND su.factory_id = v_factory
      WHERE r.challan_id = v_ch.id AND r.factory_id = v_factory
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_in_challan_rolls(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_ch public.mm_in_challans%ROWTYPE;
  v_type uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  SELECT * INTO v_ch FROM public.mm_in_challans WHERE id = p_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Challan not found'); END IF;
  SELECT COALESCE(
    (SELECT u.fabric_type_id FROM public.mm_stock_units u WHERE u.in_challan_id = v_ch.id ORDER BY u.created_at LIMIT 1),
    (SELECT sm.fabric_type_id FROM public.mm_style_materials sm WHERE sm.id = v_ch.style_material_id)
  ) INTO v_type;
  RETURN public._mm_ok(jsonb_build_object(
    'challan', public._mm_challan_header(v_ch),
    'test_fields', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type, 'options', f.options,
        'capture_site', f.capture_site
      ) ORDER BY f.seq, f.label)
      FROM public.mm_type_test_fields f
      WHERE f.factory_id = v_factory AND f.type_id = v_type AND f.is_active
    ), '[]'::jsonb),
    'rolls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'unit_code', u.unit_code, 'length_m', u.length_m, 'weight_kg', u.weight_kg,
        'shade', u.shade, 'tested_shade', u.tested_shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref,
        'attributes', u.attributes, 'mill_snapshot', u.mill_snapshot, 'status', u.status,
        'qc_result', u.qc_result, 'row_version', u.row_version, 'source', u.source,
        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
        'wh_values', COALESCE(i.field_values, '{}'::jsonb),
        'wh_remarks', i.remarks,
        'wh_result', i.result
      ) ORDER BY u.unit_code)
      FROM public.mm_stock_units u
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN LATERAL (
        SELECT x.field_values, x.remarks, x.result
        FROM public.mm_warehouse_inspections x
        WHERE x.stock_unit_id = u.id AND x.scope_kind = 'in_challan' AND x.scope_id = v_ch.id
        ORDER BY x.inspected_at DESC NULLS LAST
        LIMIT 1
      ) i ON true
      WHERE u.in_challan_id = v_ch.id
    ), '[]'::jsonb)
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_save_inspections(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_inspections(text, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mm_save_warehouse_inspections(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_warehouse_inspections(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mm_get_process_challan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_get_process_challan(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mm_get_in_challan_rolls(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_get_in_challan_rolls(uuid) TO authenticated, service_role;
