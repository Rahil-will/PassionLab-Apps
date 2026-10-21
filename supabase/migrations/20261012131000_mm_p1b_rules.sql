-- Phase 1B: one check for every allocate/book path. Spec (GSM/width, stage-aware, fabric tolerance), colour (override reason),
-- finished-only allocation, booking, race fix. Old allocate RPCs now run the same check.

-- Stage-aware spec: greige-ish stage → greige targets; cuttable stage → finished targets.
-- Actual = latest valid QC test values (gsm / width), else creation measurements (process round 0 only).
CREATE OR REPLACE FUNCTION public._mm_roll_spec(p_roll_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_r public.mm_rolls%ROWTYPE; v_f public.mm_fabrics%ROWTYPE; v_cut boolean; v_vals jsonb; v_attrs jsonb;
  v_tg numeric; v_tw numeric; v_ag numeric; v_aw numeric; v_gok boolean; v_wok boolean;
BEGIN
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = p_roll_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_f FROM public.mm_fabrics WHERE id = v_r.fabric_id;
  IF v_f.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'checked', false); END IF;
  v_cut := public._mm_roll_can_cut(v_r.id);
  v_tg := CASE WHEN v_cut THEN v_f.gsm ELSE v_f.greige_gsm END;
  v_tw := CASE WHEN v_cut THEN v_f.width_in ELSE v_f.greige_width_in END;
  v_vals := COALESCE(public._mm_qc_passport(v_r.id)->'test'->'values', '{}'::jsonb);
  SELECT COALESCE(u.attributes, m.attributes, '{}'::jsonb) INTO v_attrs
  FROM (SELECT 1) one
  LEFT JOIN public.mm_stock_units u ON u.roll_id = v_r.id
  LEFT JOIN public.mm_mill_rolls m ON m.roll_id = v_r.id;
  BEGIN v_ag := NULLIF(v_vals->>'gsm', '')::numeric; EXCEPTION WHEN OTHERS THEN v_ag := NULL; END;
  BEGIN v_aw := NULLIF(v_vals->>'width', '')::numeric; EXCEPTION WHEN OTHERS THEN v_aw := NULL; END;
  IF COALESCE(v_r.process_round, 0) = 0 THEN
    BEGIN v_ag := COALESCE(v_ag, NULLIF(v_attrs->>'actual_gsm', '')::numeric, NULLIF(v_attrs->>'gsm', '')::numeric); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN v_aw := COALESCE(v_aw, NULLIF(v_attrs->>'actual_width_in', '')::numeric, NULLIF(v_attrs->>'width', '')::numeric); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  v_gok := v_tg IS NULL OR v_ag IS NULL OR v_tg = 0 OR abs(v_ag - v_tg) / v_tg * 100 <= v_f.gsm_tol_pct;
  v_wok := v_tw IS NULL OR v_aw IS NULL OR v_tw = 0 OR abs(v_aw - v_tw) / v_tw * 100 <= v_f.width_tol_pct;
  RETURN jsonb_build_object('ok', v_gok AND v_wok, 'checked', (v_tg IS NOT NULL AND v_ag IS NOT NULL) OR (v_tw IS NOT NULL AND v_aw IS NOT NULL),
    'basis', CASE WHEN v_cut THEN 'finished' ELSE 'greige' END,
    'gsm', jsonb_build_object('target', v_tg, 'actual', v_ag, 'tol_pct', v_f.gsm_tol_pct, 'ok', v_gok),
    'width', jsonb_build_object('target', v_tw, 'actual', v_aw, 'tol_pct', v_f.width_tol_pct, 'ok', v_wok));
END $function$;

CREATE OR REPLACE FUNCTION public._mm_norm_colour(p text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $function$ SELECT NULLIF(lower(regexp_replace(COALESCE(p, ''), '[^a-zA-Z0-9]', '', 'g')), '') $function$;

-- One roll vs target. p_t->>'mode' = 'allocate' (default) | 'book'.
CREATE OR REPLACE FUNCTION public._mm_alloc_check_roll(p_factory uuid, p_roll_id uuid, p_t jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text := COALESCE(NULLIF(p_t->>'mode', ''), 'allocate');
  v_r public.mm_rolls%ROWTYPE; v_side text; v_su public.mm_stock_units%ROWTYPE; v_mr public.mm_mill_rolls%ROWTYPE;
  v_line public.mm_process_out_lines%ROWTYPE; v_target_colour text; v_sm uuid; v_kg numeric; v_m numeric; v_colour text;
  v_block text; v_warn text[] := '{}'; v_wh uuid; v_cut_loc uuid; v_stage public.mm_fabric_stages%ROWTYPE; v_can_cut boolean;
  v_spec jsonb; v_target_sm uuid := NULLIF(p_t->>'style_material_id', '')::uuid; v_lbl jsonb;
BEGIN
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = p_roll_id AND factory_id = p_factory;
  IF NOT FOUND THEN RETURN jsonb_build_object('roll_id', p_roll_id, 'block', 'Roll not found', 'warnings', '[]'::jsonb); END IF;
  SELECT * INTO v_stage FROM public.mm_fabric_stages WHERE factory_id = p_factory AND code = v_r.stage_code;
  v_can_cut := COALESCE(v_stage.can_cut, false);

  SELECT * INTO v_line FROM public.mm_process_out_lines WHERE roll_id = v_r.id AND line_status = 'out' LIMIT 1;
  IF v_line.id IS NOT NULL THEN
    v_side := 'processing';
    SELECT * INTO v_su FROM public.mm_stock_units WHERE id = v_line.stock_unit_id;
    SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE id = COALESCE(v_line.mill_roll_id, v_su.mill_roll_id);
    SELECT NULLIF(btrim(c.target_color), '') INTO v_target_colour FROM public.mm_process_challans c WHERE c.id = v_line.challan_id;
    v_sm := COALESCE(v_su.style_material_id, v_mr.style_material_id);
    v_kg := CASE WHEN lower(COALESCE(v_line.uom, '')) IN ('kg', 'kgs') THEN v_line.qty ELSE v_line.qty_kg END;
    v_m := CASE WHEN lower(COALESCE(v_line.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN v_line.qty END;
    v_colour := COALESCE(v_target_colour, NULLIF(btrim(v_line.color_ref), ''), NULLIF(btrim(v_su.color_ref), ''), NULLIF(btrim(v_mr.color_ref), ''));
  ELSE
    SELECT * INTO v_su FROM public.mm_stock_units WHERE roll_id = v_r.id
      AND status NOT IN ('consumed', 'written_off', 'returned_to_supplier', 'missing', 'cancelled') LIMIT 1;
    IF v_su.id IS NOT NULL THEN
      v_side := 'warehouse';
      SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE id = v_su.mill_roll_id;
      v_sm := v_su.style_material_id;
      v_kg := CASE WHEN lower(COALESCE(v_su.qty_uom, v_su.uom, '')) = 'kg' THEN v_su.qty_available ELSE v_su.weight_kg END;
      v_m := CASE WHEN lower(COALESCE(v_su.qty_uom, v_su.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN v_su.qty_available ELSE v_su.length_m END;
      v_colour := NULLIF(btrim(v_su.color_ref), '');
      v_wh := public._mm_loc(p_factory, 'WAREHOUSE');
      v_cut_loc := public._mm_loc(p_factory, 'CUTTING_STORE');
      IF v_su.status = 'rejected' THEN v_block := 'Roll is rejected';
      ELSIF v_su.status IN ('issued', 'issued_pending', 'partially_consumed') THEN v_block := 'Roll is already issued to cutting';
      ELSIF NOT public._mm_unit_alloc_ok(v_su.status, v_su.current_location_id, v_su.store_challan_id, v_wh, v_cut_loc) THEN
        v_block := 'Roll is not in the warehouse (receiving, rack, test or red label)';
      END IF;
    ELSE
      SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE roll_id = v_r.id LIMIT 1;
      IF v_mr.id IS NOT NULL AND v_mr.status = 'draft' AND v_mr.in_challan_id IS NULL THEN
        v_side := 'mill'; v_sm := v_mr.style_material_id; v_kg := v_mr.weight_kg; v_m := v_mr.length_m;
        v_colour := NULLIF(btrim(v_mr.color_ref), '');
      ELSE
        v_side := 'none'; v_block := 'Roll is not at the mill, at processing or in the warehouse';
      END IF;
    END IF;
  END IF;

  IF v_block IS NULL AND v_sm IS NOT NULL AND v_sm IS DISTINCT FROM v_target_sm THEN
    v_lbl := public._mm_style_label(v_sm);
    v_block := 'Already allocated to ' || COALESCE(concat_ws(' · ', v_lbl->>'style_name', v_lbl->>'colorway_name'), 'another style') || ' — unallocate first';
  END IF;
  IF v_block IS NULL AND v_r.booked_style_material_id IS NOT NULL AND v_r.booked_style_material_id IS DISTINCT FROM v_target_sm THEN
    v_lbl := public._mm_style_label(v_r.booked_style_material_id);
    v_block := 'Booked for ' || COALESCE(concat_ws(' · ', v_lbl->>'style_name', v_lbl->>'colorway_name'), 'another style') || ' — unbook first';
  END IF;
  IF v_block IS NULL THEN
    IF v_r.fabric_id IS NULL THEN v_block := 'Roll has no fabric — set the batch fabric first';
    ELSIF NULLIF(p_t->>'fabric_id', '') IS NULL THEN v_block := 'This style line has no fabric — pick it on the order first';
    ELSIF v_r.fabric_id <> (p_t->>'fabric_id')::uuid THEN
      v_block := 'Different fabric (' || COALESCE(public._mm_fabric_code(v_r.fabric_id), '?') || ' vs ' || COALESCE(public._mm_fabric_code((p_t->>'fabric_id')::uuid), '?') || ')';
    END IF;
  END IF;
  IF v_block IS NULL THEN
    IF v_mode = 'allocate' AND NOT v_can_cut THEN
      v_block := 'Not finished (' || COALESCE(v_stage.label, v_r.stage_code) || ') — book it for the style instead';
    ELSIF v_mode = 'book' AND v_can_cut THEN
      v_block := 'Finished fabric — allocate it instead of booking';
    ELSIF v_mode = 'book' AND v_sm IS NOT NULL THEN
      v_block := 'Already allocated — unallocate first';
    END IF;
  END IF;

  IF v_mode = 'allocate' AND public._mm_norm_colour(v_colour) IS NOT NULL AND public._mm_norm_colour(p_t->>'colour') IS NOT NULL
     AND public._mm_norm_colour(v_colour) <> public._mm_norm_colour(p_t->>'colour') THEN
    v_warn := array_append(v_warn, 'colour_mismatch');
  END IF;
  v_spec := public._mm_roll_spec(v_r.id);
  IF NOT COALESCE((v_spec->'gsm'->>'ok')::boolean, true) THEN v_warn := array_append(v_warn, 'gsm_out_of_spec'); END IF;
  IF NOT COALESCE((v_spec->'width'->>'ok')::boolean, true) THEN v_warn := array_append(v_warn, 'width_out_of_spec'); END IF;

  RETURN jsonb_build_object(
    'roll_id', v_r.id, 'roll_code', v_r.roll_code, 'side', v_side, 'mode', v_mode,
    'stage_code', v_r.stage_code, 'stage_label', COALESCE(v_stage.label, v_r.stage_code), 'can_cut', v_can_cut,
    'unit_form', COALESCE(v_r.unit_form, 'roll'), 'dye_lot', v_r.dye_lot, 'grade', v_r.grade,
    'colour', v_colour, 'gsm', v_spec->'gsm'->'actual', 'spec', v_spec,
    'qty_kg', v_kg, 'qty_m', v_m,
    'qty', CASE p_t->>'uom' WHEN 'kg' THEN COALESCE(v_kg, v_m) ELSE COALESCE(v_m, v_kg) END,
    'stock_unit_id', v_su.id, 'mill_roll_id', v_mr.id, 'out_line_id', v_line.id, 'status', COALESCE(v_su.status, v_mr.status),
    'booked_style_material_id', v_r.booked_style_material_id,
    'already', CASE WHEN v_mode = 'book' THEN v_r.booked_style_material_id IS NOT DISTINCT FROM v_target_sm AND v_target_sm IS NOT NULL
                    ELSE v_sm IS NOT NULL AND v_sm = v_target_sm END,
    'block', v_block, 'warnings', to_jsonb(v_warn));
END $function$;

-- Check: unchanged shape + mode passthrough
CREATE OR REPLACE FUNCTION public.mm_allocate_check(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_t jsonb; v_ids uuid[]; v_rows jsonb; v_pos jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  BEGIN v_ids := public._mm_alloc_roll_ids(p_payload);
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid roll id'); END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_t := public._mm_alloc_target(p_payload);
  IF COALESCE(v_t->>'ok', 'false') <> 'true' THEN RETURN v_t; END IF;
  v_t := (v_t->'data') || jsonb_build_object('mode', COALESCE(NULLIF(p_payload->>'mode', ''), 'allocate'));
  SELECT COALESCE(jsonb_agg(public._mm_alloc_check_roll(v_factory, x, v_t)), '[]'::jsonb) INTO v_rows FROM unnest(v_ids) x;
  v_pos := public.mm_style_fabric_position(jsonb_build_object('style_material_id', v_t->>'style_material_id', 'include_closed', true))->'data'->'rows'->0;
  RETURN public._mm_ok(jsonb_build_object(
    'target', v_t, 'rolls', v_rows,
    'selected_qty', (SELECT COALESCE(sum((e->>'qty')::numeric), 0) FROM jsonb_array_elements(v_rows) e WHERE e->>'block' IS NULL AND NOT (e->>'already')::boolean),
    'blocked', (SELECT count(*) FROM jsonb_array_elements(v_rows) e WHERE e->>'block' IS NOT NULL),
    'warned', (SELECT count(*) FROM jsonb_array_elements(v_rows) e WHERE e->>'block' IS NULL AND jsonb_array_length(e->'warnings') > 0),
    'colour_mismatch', (SELECT count(*) FROM jsonb_array_elements(v_rows) e WHERE e->>'block' IS NULL AND e->'warnings' ? 'colour_mismatch'),
    'required', v_t->'required',
    'allocated_before', COALESCE((v_pos->>'allocated')::numeric, 0) + COALESCE((v_pos->'issued'->>'qty')::numeric, 0),
    'booked_before', COALESCE((v_pos->'booked'->>'qty')::numeric, 0),
    'short_before', COALESCE((v_pos->>'short')::numeric, (v_t->>'required')::numeric)));
END $function$;

-- Allocate (finished only). Warnings need confirm; colour mismatch also needs override_reason.
CREATE OR REPLACE FUNCTION public.mm_allocate_rolls_v4(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_chk jsonb; v_t jsonb; v_e jsonb; v_sm uuid; v_n int := 0; v_qty numeric := 0; v_style text;
  v_confirm boolean := COALESCE((p_payload->>'confirm')::boolean, false);
  v_reason text := NULLIF(btrim(COALESCE(p_payload->>'override_reason', '')), '');
  v_su public.mm_stock_units%ROWTYPE; v_mrr public.mm_mill_rolls%ROWTYPE; v_pos jsonb;
  v_batches uuid[] := '{}'; v_b uuid; v_mr uuid; v_cnt int;
BEGIN
  v_chk := public.mm_allocate_check((p_payload - 'mode') || jsonb_build_object('mode', 'allocate'));
  IF COALESCE(v_chk->>'ok', 'false') <> 'true' THEN RETURN v_chk; END IF;
  v_factory := public._mm_actor_factory_id();
  v_chk := v_chk->'data'; v_t := v_chk->'target'; v_sm := (v_t->>'style_material_id')::uuid;
  IF jsonb_array_length(v_chk->'rolls') = 0 THEN RETURN public._mm_err('REQUIRED', 'Select rolls to allocate'); END IF;
  SELECT e INTO v_e FROM jsonb_array_elements(v_chk->'rolls') e WHERE e->>'block' IS NOT NULL LIMIT 1;
  IF v_e IS NOT NULL THEN RETURN public._mm_err('BLOCKED', COALESCE(v_e->>'roll_code', 'Roll') || ': ' || (v_e->>'block')); END IF;
  IF (v_chk->>'colour_mismatch')::int > 0 AND v_reason IS NULL THEN
    RETURN public._mm_err('REASON', (v_chk->>'colour_mismatch') || ' roll(s) are a different colour from the style — give a reason to allocate anyway');
  END IF;
  IF (v_chk->>'warned')::int > 0 AND NOT v_confirm THEN
    RETURN public._mm_err('CONFIRM', (v_chk->>'warned') || ' roll(s) are out of spec or a different colour — confirm to allocate');
  END IF;
  v_style := concat_ws(' · ', v_t->'style'->>'style_name', v_t->'style'->>'colorway_name');

  FOR v_e IN SELECT e FROM jsonb_array_elements(v_chk->'rolls') e WHERE NOT (e->>'already')::boolean LOOP
    IF NULLIF(v_e->>'stock_unit_id', '') IS NOT NULL THEN
      SELECT * INTO v_su FROM public.mm_stock_units WHERE id = (v_e->>'stock_unit_id')::uuid FOR UPDATE;
      IF v_su.style_material_id IS NOT NULL AND v_su.style_material_id <> v_sm THEN
        RETURN public._mm_err('CONFLICT', (v_e->>'roll_code') || ' was just allocated elsewhere');
      END IF;
      UPDATE public.mm_stock_units SET style_material_id = v_sm, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_su.id;
      PERFORM public._mm_ledger(v_factory, v_su.id, 'ALLOCATE', 0, v_su.status, v_su.status, v_su.current_location_id, v_su.current_location_id,
                                'mm_style_materials', v_sm, 'Allocated to ' || COALESCE(v_style, 'style') ||
                                CASE WHEN v_e->>'side' = 'processing' THEN ' (at processing)' ELSE '' END ||
                                CASE WHEN jsonb_array_length(v_e->'warnings') > 0 THEN ' · confirmed: ' || (SELECT string_agg(w, ', ') FROM jsonb_array_elements_text(v_e->'warnings') w) ELSE '' END ||
                                CASE WHEN v_reason IS NOT NULL AND v_e->'warnings' ? 'colour_mismatch' THEN ' · reason: ' || v_reason ELSE '' END);
    END IF;
    v_mr := NULLIF(v_e->>'mill_roll_id', '')::uuid;
    IF v_mr IS NOT NULL THEN
      SELECT * INTO v_mrr FROM public.mm_mill_rolls WHERE id = v_mr AND factory_id = v_factory FOR UPDATE;
      IF v_mrr.id IS NULL OR (v_mrr.style_material_id IS NOT NULL AND v_mrr.style_material_id <> v_sm) THEN
        RETURN public._mm_err('CONFLICT', (v_e->>'roll_code') || ' changed while allocating — reload and try again');
      END IF;
      UPDATE public.mm_mill_rolls SET style_material_id = v_sm, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_mr;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt = 0 THEN RETURN public._mm_err('CONFLICT', (v_e->>'roll_code') || ' could not be allocated — reload and try again'); END IF;
      IF v_mrr.mill_batch_id IS NOT NULL THEN v_batches := array_append(v_batches, v_mrr.mill_batch_id); END IF;
    END IF;
    v_n := v_n + 1;
    v_qty := v_qty + COALESCE((v_e->>'qty')::numeric, 0);
  END LOOP;

  FOREACH v_b IN ARRAY (SELECT COALESCE(array_agg(DISTINCT b), '{}') FROM unnest(v_batches) b) LOOP
    UPDATE public.mm_mill_batches b SET style_material_id = v_sm, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE b.id = v_b AND b.factory_id = v_factory AND b.style_material_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id AND r.style_material_id IS DISTINCT FROM v_sm);
  END LOOP;

  v_pos := public.mm_style_fabric_position(jsonb_build_object('style_material_id', v_sm, 'include_closed', true))->'data'->'rows'->0;
  RETURN public._mm_ok(jsonb_build_object(
    'count', v_n, 'qty', v_qty, 'style_material_id', v_sm, 'position', v_pos,
    'over_allocated', COALESCE((v_pos->>'required')::numeric, 0) > 0
                      AND COALESCE((v_pos->>'allocated')::numeric, 0) + COALESCE((v_pos->'issued'->>'qty')::numeric, 0) > (v_pos->>'required')::numeric,
    'warnings', CASE WHEN COALESCE((v_pos->>'required')::numeric, 0) > 0
                      AND COALESCE((v_pos->>'allocated')::numeric, 0) + COALESCE((v_pos->'issued'->>'qty')::numeric, 0) > (v_pos->>'required')::numeric
                     THEN '["over_required"]'::jsonb ELSE '[]'::jsonb END));
END $function$;

-- Book greige / not-finished rolls for a style line (reservation; rolls stay free in custody)
CREATE OR REPLACE FUNCTION public.mm_book_rolls(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_chk jsonb; v_e jsonb; v_sm uuid; v_n int := 0; v_qty numeric := 0;
BEGIN
  v_chk := public.mm_allocate_check((p_payload - 'mode') || jsonb_build_object('mode', 'book'));
  IF COALESCE(v_chk->>'ok', 'false') <> 'true' THEN RETURN v_chk; END IF;
  v_chk := v_chk->'data'; v_sm := (v_chk->'target'->>'style_material_id')::uuid;
  IF jsonb_array_length(v_chk->'rolls') = 0 THEN RETURN public._mm_err('REQUIRED', 'Select rolls to book'); END IF;
  SELECT e INTO v_e FROM jsonb_array_elements(v_chk->'rolls') e WHERE e->>'block' IS NOT NULL LIMIT 1;
  IF v_e IS NOT NULL THEN RETURN public._mm_err('BLOCKED', COALESCE(v_e->>'roll_code', 'Roll') || ': ' || (v_e->>'block')); END IF;
  FOR v_e IN SELECT e FROM jsonb_array_elements(v_chk->'rolls') e WHERE NOT (e->>'already')::boolean LOOP
    UPDATE public.mm_rolls SET booked_style_material_id = v_sm, booked_at = now(), booked_by = public._mm_actor_id(), updated_at = now()
    WHERE id = (v_e->>'roll_id')::uuid AND (booked_style_material_id IS NULL OR booked_style_material_id = v_sm);
    v_n := v_n + 1; v_qty := v_qty + COALESCE((v_e->>'qty')::numeric, 0);
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('count', v_n, 'qty', v_qty, 'style_material_id', v_sm,
    'position', public.mm_style_fabric_position(jsonb_build_object('style_material_id', v_sm, 'include_closed', true))->'data'->'rows'->0));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_unbook_rolls(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_ids uuid[]; v_n int;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  BEGIN v_ids := public._mm_alloc_roll_ids(p_payload);
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid roll id'); END;
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN RETURN public._mm_err('REQUIRED', 'Select rolls to unbook'); END IF;
  UPDATE public.mm_rolls SET booked_style_material_id = NULL, booked_at = NULL, booked_by = NULL, updated_at = now()
  WHERE id = ANY (v_ids) AND factory_id = v_factory AND booked_style_material_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN public._mm_ok(jsonb_build_object('count', v_n));
END $function$;

-- Auto-pick. mode 'allocate' (default): finished rolls; rolls booked for this line first. mode 'book': not-finished, unbooked rolls.
CREATE OR REPLACE FUNCTION public.mm_allocate_auto_pick(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_t jsonb; v_pos jsonb; v_target numeric; v_sides text[]; v_lot boolean; v_warned boolean;
  v_cands jsonb; v_pick jsonb := '[]'::jsonb; v_sum numeric := 0; v_e jsonb; v_avail numeric;
  v_mode text := COALESCE(NULLIF(p_payload->>'mode', ''), 'allocate');
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  IF v_mode NOT IN ('allocate', 'book') THEN RETURN public._mm_err('INVALID', 'mode must be allocate or book'); END IF;
  v_t := public._mm_alloc_target(p_payload);
  IF COALESCE(v_t->>'ok', 'false') <> 'true' THEN RETURN v_t; END IF;
  v_t := (v_t->'data') || jsonb_build_object('mode', v_mode);
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_pos := public.mm_style_fabric_position(jsonb_build_object('style_material_id', v_t->>'style_material_id', 'include_closed', true))->'data'->'rows'->0;
  v_target := COALESCE(NULLIF(p_payload->>'qty', '')::numeric,
                       CASE WHEN v_mode = 'book' THEN (v_pos->>'uncovered')::numeric ELSE (v_pos->>'short')::numeric END,
                       (v_t->>'required')::numeric, 0);
  v_sides := COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'sides') x), ARRAY['warehouse', 'processing', 'mill']);
  v_lot := COALESCE((p_payload->>'same_dye_lot')::boolean, true);
  v_warned := COALESCE((p_payload->>'include_warned')::boolean, false);

  WITH c AS (
    SELECT public._mm_alloc_check_roll(v_factory, rs.roll_id, v_t) AS j, rs.bucket, r.booked_style_material_id AS booked
    FROM public._mm_roll_stock(v_factory) rs
    JOIN public.mm_rolls r ON r.id = rs.roll_id
    WHERE rs.style_material_id IS NULL
      AND rs.bucket IN ('in_stock', 'qc_pending', 'at_processing', 'at_mill')
      AND rs.side = ANY (v_sides)
      AND r.fabric_id = NULLIF(v_t->>'fabric_id', '')::uuid
      AND (r.booked_style_material_id IS NULL OR r.booked_style_material_id = (v_t->>'style_material_id')::uuid)
      AND (v_mode = 'allocate' OR r.booked_style_material_id IS NULL)
  ), ok AS (
    SELECT c.j, c.bucket,
           CASE WHEN c.booked IS NOT NULL THEN 0
                WHEN c.bucket = 'in_stock' THEN 1 WHEN c.bucket = 'qc_pending' THEN 3
                WHEN c.bucket = 'at_processing' THEN 4 ELSE 5 END AS pri
    FROM c
    WHERE c.j->>'block' IS NULL AND COALESCE((c.j->>'qty')::numeric, 0) > 0
      AND (v_warned OR jsonb_array_length(c.j->'warnings') = 0)
  ), lots AS (
    SELECT COALESCE(ok.j->>'dye_lot', '') AS lot, min(pri) AS lot_pri, sum((ok.j->>'qty')::numeric) AS lot_qty FROM ok GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(ok.j || jsonb_build_object('bucket', ok.bucket) ORDER BY
           CASE WHEN v_lot THEN l.lot_pri ELSE ok.pri END,
           CASE WHEN v_lot THEN -l.lot_qty ELSE 0 END,
           CASE WHEN v_lot THEN l.lot ELSE '' END,
           ok.pri, (ok.j->>'qty')::numeric DESC, ok.j->>'roll_code'), '[]'::jsonb)
    INTO v_cands
  FROM ok JOIN lots l ON l.lot = COALESCE(ok.j->>'dye_lot', '');

  SELECT COALESCE(sum((e->>'qty')::numeric), 0) INTO v_avail FROM jsonb_array_elements(v_cands) e;
  IF v_target > 0 THEN
    FOR v_e IN SELECT e FROM jsonb_array_elements(v_cands) e LOOP
      EXIT WHEN v_sum >= v_target;
      v_pick := v_pick || jsonb_build_array(v_e);
      v_sum := v_sum + (v_e->>'qty')::numeric;
    END LOOP;
  END IF;

  RETURN public._mm_ok(jsonb_build_object(
    'mode', v_mode, 'target', v_t, 'target_qty', v_target, 'uom', v_t->>'uom',
    'picked', v_pick, 'picked_qty', v_sum, 'picked_count', jsonb_array_length(v_pick),
    'dye_lots', (SELECT COALESCE(jsonb_agg(DISTINCT e->>'dye_lot') FILTER (WHERE e->>'dye_lot' IS NOT NULL), '[]'::jsonb) FROM jsonb_array_elements(v_pick) e),
    'covers', v_sum >= v_target,
    'available_qty', v_avail, 'available_count', jsonb_array_length(v_cands)));
END $function$;

-- Old allocate RPCs (locked page + MmAllocateRollsModal): run the same check; colour mismatch blocks (no override UI there)
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.mm_allocate_rolls_to_style(uuid[],uuid,uuid,uuid)'::regprocedure);
  d := replace(d, $a$  v_style text;
BEGIN$a$, $b$  v_style text;
  v_t jsonb; v_c jsonb;
BEGIN$b$);
  d := replace(d, $a$    IF NOT public._mm_unit_alloc_ok(v_unit.status, v_unit.current_location_id, v_unit.store_challan_id, v_wh, v_cut) THEN
      RETURN public._mm_err('INVALID', 'Allocate only rolls in warehouse receiving, rack, test, or red label');
    END IF;$a$, $b$    IF NOT public._mm_unit_alloc_ok(v_unit.status, v_unit.current_location_id, v_unit.store_challan_id, v_wh, v_cut) THEN
      RETURN public._mm_err('INVALID', 'Allocate only rolls in warehouse receiving, rack, test, or red label');
    END IF;
    IF v_t IS NULL THEN v_t := (public._mm_alloc_target(jsonb_build_object('style_material_id', v_sm_id))->'data') || '{"mode":"allocate"}'::jsonb; END IF;
    v_c := public._mm_alloc_check_roll(v_factory, v_unit.roll_id, v_t);
    IF v_c->>'block' IS NOT NULL THEN RETURN public._mm_err('BLOCKED', COALESCE(v_unit.unit_code, 'Roll') || ': ' || (v_c->>'block')); END IF;
    IF v_c->'warnings' ? 'colour_mismatch' THEN
      RETURN public._mm_err('BLOCKED', COALESCE(v_unit.unit_code, 'Roll') || ' is a different colour from the style — use Allocate (new) to override with a reason');
    END IF;$b$);
  IF position('_mm_alloc_check_roll(v_factory, v_unit.roll_id' in d) = 0 OR position('v_t jsonb; v_c jsonb;' in d) = 0 THEN RAISE EXCEPTION 'wh alloc patch failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.mm_allocate_mill_rolls_to_style(uuid[],uuid,uuid,uuid)'::regprocedure);
  d := replace(d, $a$  v_batch uuid;
BEGIN$a$, $b$  v_batch uuid;
  v_t jsonb; v_c jsonb;
BEGIN$b$);
  d := replace(d, $a$    IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Fabric type must match the style fabric');
    END IF;
    UPDATE public.mm_mill_rolls SET$a$, $b$    IF v_roll.fabric_type_id IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Fabric type must match the style fabric');
    END IF;
    IF v_t IS NULL THEN v_t := (public._mm_alloc_target(jsonb_build_object('style_material_id', v_sm_id))->'data') || '{"mode":"allocate"}'::jsonb; END IF;
    v_c := public._mm_alloc_check_roll(v_factory, v_roll.roll_id, v_t);
    IF v_c->>'block' IS NOT NULL THEN RETURN public._mm_err('BLOCKED', COALESCE(v_roll.unit_code, 'Roll') || ': ' || (v_c->>'block')); END IF;
    IF v_c->'warnings' ? 'colour_mismatch' THEN
      RETURN public._mm_err('BLOCKED', COALESCE(v_roll.unit_code, 'Roll') || ' is a different colour from the style — use Allocate (new) to override with a reason');
    END IF;
    UPDATE public.mm_mill_rolls SET$b$);
  IF position('_mm_alloc_check_roll(v_factory, v_roll.roll_id' in d) = 0 OR position('v_t jsonb; v_c jsonb;' in d) = 0 THEN RAISE EXCEPTION 'mill alloc patch failed'; END IF;
  EXECUTE d;
END $mig$;

GRANT EXECUTE ON FUNCTION public.mm_book_rolls(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_unbook_rolls(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._mm_roll_spec(uuid) FROM anon, public;
