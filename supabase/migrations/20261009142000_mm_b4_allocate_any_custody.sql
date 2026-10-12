-- B4: allocate rolls (registry mm_rolls ids) to a style fabric line at ANY custody — at mill, at processing, in warehouse.
-- New functions only; the locked Allocate rolls page keeps mm_allocate_mill_rolls_to_style / mm_allocate_rolls_to_style.
--   mm_allocate_check(payload)      → per-roll checks (blocks + warnings), totals, line position after.
--   mm_allocate_rolls_v4(payload)   → allocate; blocks fail, warnings (colour / GSM) need confirm = true.
--   mm_allocate_auto_pick(payload)  → suggested rolls to cover the short (no write).
--   mm_unallocate_rolls_v4(payload) → unallocate at any custody (not issued).
-- Target: { style_material_id } or { order_id, colorway_id, colorway_material_id }.

-- Target line ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_alloc_target(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid := public._mm_actor_factory_id(); v_sm public.mm_style_materials%ROWTYPE; v_r jsonb; v_id uuid;
BEGIN
  BEGIN
    v_id := NULLIF(p_payload->>'style_material_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid style line id'); END;
  IF v_id IS NULL THEN
    BEGIN
      v_r := public._mm_resolve_style_material(NULLIF(p_payload->>'order_id', '')::uuid, NULLIF(p_payload->>'colorway_id', '')::uuid,
                                              NULLIF(p_payload->>'colorway_material_id', '')::uuid);
    EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid style line id'); END;
    IF COALESCE(v_r->>'ok', 'false') <> 'true' THEN RETURN v_r; END IF;
    v_id := (v_r->'data'->>'id')::uuid;
  END IF;
  SELECT * INTO v_sm FROM public.mm_style_materials WHERE id = v_id AND factory_id = v_factory;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Style fabric line not found'); END IF;
  RETURN public._mm_ok((
    SELECT jsonb_build_object(
      'style_material_id', v_sm.id, 'order_id', v_sm.order_id, 'colorway_id', v_sm.colorway_id,
      'colorway_material_id', v_sm.colorway_material_id,
      'fabric_id', COALESCE(cm.fabric_id, v_sm.fabric_id), 'fabric_type_id', v_sm.fabric_type_id,
      'colour', COALESCE(NULLIF(btrim(cm.fabric_color), ''), cw.name),
      'gsm', f.gsm,
      'uom', CASE WHEN lower(btrim(COALESCE(cm.unit, ''))) IN ('kg', 'kgs') THEN 'kg'
                  WHEN lower(btrim(COALESCE(cm.unit, ''))) IN ('m', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres') THEN 'm'
                  ELSE COALESCE(f.uom, 'm') END,
      'required', COALESCE(cm.total_cons, 0),
      'style', public._mm_style_label(v_sm.id))
    FROM (SELECT 1) one
    LEFT JOIN public.colorway_materials cm ON cm.id = v_sm.colorway_material_id
    LEFT JOIN public.colorways cw ON cw.id = v_sm.colorway_id
    LEFT JOIN public.mm_fabrics f ON f.id = COALESCE(cm.fabric_id, v_sm.fabric_id)));
END $function$;

-- One roll vs the target -------------------------------------------------------------------------------------
-- Returns { roll_id, roll_code, side, stage_code, can_cut, unit_form, dye_lot, colour, gsm, qty, qty_kg, qty_m,
--           stock_unit_id, mill_roll_id, out_line_id, already (bool), block (text|null), warnings [code…] }
CREATE OR REPLACE FUNCTION public._mm_alloc_check_roll(p_factory uuid, p_roll_id uuid, p_t jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_r public.mm_rolls%ROWTYPE; v_side text; v_su public.mm_stock_units%ROWTYPE; v_mr public.mm_mill_rolls%ROWTYPE;
  v_line public.mm_process_out_lines%ROWTYPE; v_target_colour text; v_sm uuid; v_kg numeric; v_m numeric; v_colour text;
  v_gsm numeric; v_attrs jsonb; v_block text; v_warn text[] := '{}'; v_wh uuid; v_cut uuid; v_tgsm numeric;
  v_stage public.mm_fabric_stages%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = p_roll_id AND factory_id = p_factory;
  IF NOT FOUND THEN RETURN jsonb_build_object('roll_id', p_roll_id, 'block', 'Roll not found', 'warnings', '[]'::jsonb); END IF;
  SELECT * INTO v_stage FROM public.mm_fabric_stages WHERE factory_id = p_factory AND code = v_r.stage_code;

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
      v_cut := public._mm_loc(p_factory, 'CUTTING_STORE');
      IF v_su.status = 'rejected' THEN v_block := 'Roll is rejected';
      ELSIF v_su.status IN ('issued', 'issued_pending', 'partially_consumed') THEN v_block := 'Roll is already issued to cutting';
      ELSIF NOT public._mm_unit_alloc_ok(v_su.status, v_su.current_location_id, v_su.store_challan_id, v_wh, v_cut) THEN
        v_block := 'Roll is not in the warehouse (receiving, rack, test or red label)';
      END IF;
    ELSE
      SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE roll_id = v_r.id LIMIT 1;
      IF v_mr.id IS NOT NULL AND v_mr.status = 'draft' AND v_mr.in_challan_id IS NULL THEN
        v_side := 'mill';
        v_sm := v_mr.style_material_id;
        v_kg := v_mr.weight_kg; v_m := v_mr.length_m;
        v_colour := NULLIF(btrim(v_mr.color_ref), '');
      ELSE
        v_side := 'none';
        v_block := 'Roll is not at the mill, at processing or in the warehouse';
      END IF;
    END IF;
  END IF;

  v_attrs := COALESCE(v_su.attributes, v_mr.attributes, '{}'::jsonb);
  BEGIN v_gsm := NULLIF(v_attrs->>'gsm', '')::numeric; EXCEPTION WHEN OTHERS THEN v_gsm := NULL; END;

  IF v_block IS NULL AND v_sm IS NOT NULL AND v_sm IS DISTINCT FROM (p_t->>'style_material_id')::uuid THEN
    v_block := 'Already allocated to ' || COALESCE((SELECT concat_ws(' · ', l->>'style_name', l->>'colorway_name') FROM (SELECT public._mm_style_label(v_sm) l) z), 'another style') || ' — unallocate first';
  END IF;
  IF v_block IS NULL THEN
    IF v_r.fabric_id IS NOT NULL AND NULLIF(p_t->>'fabric_id', '') IS NOT NULL AND v_r.fabric_id <> (p_t->>'fabric_id')::uuid THEN
      v_block := 'Different fabric (' || COALESCE(public._mm_fabric_code(v_r.fabric_id), '?') || ')';
    ELSIF v_r.fabric_type_id IS DISTINCT FROM NULLIF(p_t->>'fabric_type_id', '')::uuid THEN
      v_block := 'Fabric type must match the style fabric';
    END IF;
  END IF;

  IF v_colour IS NOT NULL AND NULLIF(p_t->>'colour', '') IS NOT NULL
     AND lower(regexp_replace(v_colour, '\s+', '', 'g')) <> lower(regexp_replace(p_t->>'colour', '\s+', '', 'g')) THEN
    v_warn := array_append(v_warn, 'colour_mismatch');
  END IF;
  v_tgsm := NULLIF(p_t->>'gsm', '')::numeric;
  IF v_gsm IS NOT NULL AND v_tgsm IS NOT NULL AND v_tgsm > 0 AND abs(v_gsm - v_tgsm) / v_tgsm > 0.05 THEN
    v_warn := array_append(v_warn, 'gsm_out_of_tolerance');
  END IF;

  RETURN jsonb_build_object(
    'roll_id', v_r.id, 'roll_code', v_r.roll_code, 'side', v_side,
    'stage_code', v_r.stage_code, 'stage_label', COALESCE(v_stage.label, v_r.stage_code), 'can_cut', COALESCE(v_stage.can_cut, true),
    'unit_form', COALESCE(v_r.unit_form, 'roll'), 'dye_lot', v_r.dye_lot, 'grade', v_r.grade,
    'colour', v_colour, 'gsm', v_gsm,
    'qty_kg', v_kg, 'qty_m', v_m,
    'qty', CASE p_t->>'uom' WHEN 'kg' THEN COALESCE(v_kg, v_m) ELSE COALESCE(v_m, v_kg) END,
    'stock_unit_id', v_su.id, 'mill_roll_id', v_mr.id, 'out_line_id', v_line.id, 'status', COALESCE(v_su.status, v_mr.status),
    'already', v_sm IS NOT NULL AND v_sm = (p_t->>'style_material_id')::uuid,
    'block', v_block, 'warnings', to_jsonb(v_warn));
END $function$;

CREATE OR REPLACE FUNCTION public._mm_alloc_roll_ids(p_payload jsonb)
 RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $function$
  SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}') FROM jsonb_array_elements_text(COALESCE(p_payload->'roll_ids', '[]'::jsonb)) x
$function$;

-- Check ------------------------------------------------------------------------------------------------------
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
  v_t := v_t->'data';
  SELECT COALESCE(jsonb_agg(public._mm_alloc_check_roll(v_factory, x, v_t)), '[]'::jsonb) INTO v_rows FROM unnest(v_ids) x;
  v_pos := public.mm_style_fabric_position(jsonb_build_object('style_material_id', v_t->>'style_material_id', 'include_closed', true))->'data'->'rows'->0;
  RETURN public._mm_ok(jsonb_build_object(
    'target', v_t,
    'rolls', v_rows,
    'selected_qty', (SELECT COALESCE(sum((e->>'qty')::numeric), 0) FROM jsonb_array_elements(v_rows) e WHERE e->>'block' IS NULL AND NOT (e->>'already')::boolean),
    'blocked', (SELECT count(*) FROM jsonb_array_elements(v_rows) e WHERE e->>'block' IS NOT NULL),
    'warned', (SELECT count(*) FROM jsonb_array_elements(v_rows) e WHERE e->>'block' IS NULL AND jsonb_array_length(e->'warnings') > 0),
    'required', v_t->'required',
    'allocated_before', COALESCE((v_pos->>'allocated')::numeric, 0) + COALESCE((v_pos->'issued'->>'qty')::numeric, 0),
    'short_before', COALESCE((v_pos->>'short')::numeric, (v_t->>'required')::numeric)));
END $function$;

-- Allocate ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_allocate_rolls_v4(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_chk jsonb; v_t jsonb; v_e jsonb; v_sm uuid; v_n int := 0; v_qty numeric := 0; v_style text;
  v_confirm boolean := COALESCE((p_payload->>'confirm')::boolean, false); v_su public.mm_stock_units%ROWTYPE; v_pos jsonb;
  v_batches uuid[] := '{}'; v_b uuid; v_mr uuid;
BEGIN
  v_chk := public.mm_allocate_check(p_payload);
  IF COALESCE(v_chk->>'ok', 'false') <> 'true' THEN RETURN v_chk; END IF;
  v_factory := public._mm_actor_factory_id();
  v_chk := v_chk->'data'; v_t := v_chk->'target'; v_sm := (v_t->>'style_material_id')::uuid;
  IF jsonb_array_length(v_chk->'rolls') = 0 THEN RETURN public._mm_err('REQUIRED', 'Select rolls to allocate'); END IF;
  SELECT e INTO v_e FROM jsonb_array_elements(v_chk->'rolls') e WHERE e->>'block' IS NOT NULL LIMIT 1;
  IF v_e IS NOT NULL THEN
    RETURN public._mm_err('BLOCKED', COALESCE(v_e->>'roll_code', 'Roll') || ': ' || (v_e->>'block'));
  END IF;
  IF (v_chk->>'warned')::int > 0 AND NOT v_confirm THEN
    RETURN public._mm_err('CONFIRM', (v_chk->>'warned') || ' roll(s) differ in colour or GSM from the style fabric — confirm to allocate');
  END IF;
  v_style := concat_ws(' · ', v_t->'style'->>'style_name', v_t->'style'->>'colorway_name');

  FOR v_e IN SELECT e FROM jsonb_array_elements(v_chk->'rolls') e WHERE NOT (e->>'already')::boolean LOOP
    -- Lock and re-check ownership (race with another allocation)
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
                                CASE WHEN jsonb_array_length(v_e->'warnings') > 0 THEN ' · confirmed: ' || (SELECT string_agg(w, ', ') FROM jsonb_array_elements_text(v_e->'warnings') w) ELSE '' END);
    END IF;
    v_mr := NULLIF(v_e->>'mill_roll_id', '')::uuid;
    IF v_mr IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET style_material_id = v_sm, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_mr AND factory_id = v_factory AND (style_material_id IS NULL OR style_material_id = v_sm);
      SELECT array_append(v_batches, mill_batch_id) INTO v_batches FROM public.mm_mill_rolls WHERE id = v_mr AND mill_batch_id IS NOT NULL;
    END IF;
    v_n := v_n + 1;
    v_qty := v_qty + COALESCE((v_e->>'qty')::numeric, 0);
  END LOOP;

  -- Batch becomes a style batch when all its rolls are on this line (same rule as the mill allocate).
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

-- Auto-pick --------------------------------------------------------------------------------------------------
-- Payload: target + { qty?: number (default = short), sides?: ['warehouse','processing','mill'] (default all),
--                     same_dye_lot?: bool (default true → fill from the fewest lots), include_warned?: bool (default false) }
-- Order: warehouse cuttable → warehouse other stage → QC pending → processing → mill; within that biggest dye lot first.
CREATE OR REPLACE FUNCTION public.mm_allocate_auto_pick(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_t jsonb; v_pos jsonb; v_target numeric; v_sides text[]; v_lot boolean; v_warned boolean;
  v_cands jsonb; v_pick jsonb := '[]'::jsonb; v_sum numeric := 0; v_e jsonb; v_avail numeric;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_t := public._mm_alloc_target(p_payload);
  IF COALESCE(v_t->>'ok', 'false') <> 'true' THEN RETURN v_t; END IF;
  v_t := v_t->'data';
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_pos := public.mm_style_fabric_position(jsonb_build_object('style_material_id', v_t->>'style_material_id', 'include_closed', true))->'data'->'rows'->0;
  v_target := COALESCE(NULLIF(p_payload->>'qty', '')::numeric, (v_pos->>'short')::numeric, (v_t->>'required')::numeric, 0);
  v_sides := COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_payload->'sides') x), ARRAY['warehouse', 'processing', 'mill']);
  v_lot := COALESCE((p_payload->>'same_dye_lot')::boolean, true);
  v_warned := COALESCE((p_payload->>'include_warned')::boolean, false);

  WITH c AS (
    SELECT public._mm_alloc_check_roll(v_factory, rs.roll_id, v_t) AS j, rs.bucket
    FROM public._mm_roll_stock(v_factory) rs
    JOIN public.mm_rolls r ON r.id = rs.roll_id
    WHERE rs.style_material_id IS NULL
      AND rs.bucket IN ('in_stock', 'qc_pending', 'at_processing', 'at_mill')
      AND rs.side = ANY (v_sides)
      AND r.fabric_type_id IS NOT DISTINCT FROM NULLIF(v_t->>'fabric_type_id', '')::uuid
      AND (NULLIF(v_t->>'fabric_id', '') IS NULL OR r.fabric_id IS NULL OR r.fabric_id = (v_t->>'fabric_id')::uuid)
  ), ok AS (
    SELECT c.j, c.bucket,
           CASE WHEN c.bucket = 'in_stock' AND (c.j->>'can_cut')::boolean THEN 1
                WHEN c.bucket = 'in_stock' THEN 2 WHEN c.bucket = 'qc_pending' THEN 3
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
    'target', v_t, 'target_qty', v_target, 'uom', v_t->>'uom',
    'picked', v_pick, 'picked_qty', v_sum, 'picked_count', jsonb_array_length(v_pick),
    'dye_lots', (SELECT COALESCE(jsonb_agg(DISTINCT e->>'dye_lot') FILTER (WHERE e->>'dye_lot' IS NOT NULL), '[]'::jsonb) FROM jsonb_array_elements(v_pick) e),
    'covers', v_sum >= v_target,
    'available_qty', v_avail, 'available_count', jsonb_array_length(v_cands)));
END $function$;

-- Unallocate (any custody, not issued) ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_unallocate_rolls_v4(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_ids uuid[]; v_id uuid; v_c jsonb; v_su public.mm_stock_units%ROWTYPE; v_mr public.mm_mill_rolls%ROWTYPE;
  v_line public.mm_process_out_lines%ROWTYPE; v_wh uuid; v_cut uuid; v_n int := 0; v_code text; v_sm uuid;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  BEGIN v_ids := public._mm_alloc_roll_ids(p_payload);
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID', 'Invalid roll id'); END;
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN RETURN public._mm_err('REQUIRED', 'Select rolls to unallocate'); END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  v_wh := public._mm_loc(v_factory, 'WAREHOUSE');
  v_cut := public._mm_loc(v_factory, 'CUTTING_STORE');

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT roll_code INTO v_code FROM public.mm_rolls WHERE id = v_id AND factory_id = v_factory;
    IF v_code IS NULL THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found'); END IF;
    v_su := NULL; v_mr := NULL; v_line := NULL;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE roll_id = v_id AND line_status = 'out' LIMIT 1;
    IF v_line.id IS NOT NULL THEN
      SELECT * INTO v_su FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
      SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE id = COALESCE(v_line.mill_roll_id, v_su.mill_roll_id) FOR UPDATE;
    ELSE
      SELECT * INTO v_su FROM public.mm_stock_units WHERE roll_id = v_id
        AND status NOT IN ('consumed', 'written_off', 'returned_to_supplier', 'missing', 'cancelled') LIMIT 1 FOR UPDATE;
      IF v_su.id IS NOT NULL THEN
        IF NOT public._mm_unit_alloc_ok(v_su.status, v_su.current_location_id, v_su.store_challan_id, v_wh, v_cut) THEN
          RETURN public._mm_err('INVALID', v_code || ': unallocate only rolls still in the warehouse (not issued)');
        END IF;
        SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE id = v_su.mill_roll_id FOR UPDATE;
      ELSE
        SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE roll_id = v_id FOR UPDATE;
        IF v_mr.id IS NULL OR v_mr.status <> 'draft' THEN
          RETURN public._mm_err('INVALID', v_code || ': roll is not at the mill, processing or warehouse');
        END IF;
      END IF;
    END IF;
    v_sm := COALESCE(v_su.style_material_id, v_mr.style_material_id);
    IF v_sm IS NULL THEN RETURN public._mm_err('INVALID', v_code || ' is not allocated'); END IF;
    IF v_su.id IS NOT NULL THEN
      UPDATE public.mm_stock_units SET style_material_id = NULL, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_su.id;
      PERFORM public._mm_ledger(v_factory, v_su.id, 'UNALLOCATE', 0, v_su.status, v_su.status, v_su.current_location_id, v_su.current_location_id,
                                'mm_stock_units', v_su.id, 'Unallocated' || CASE WHEN v_line.id IS NOT NULL THEN ' (at processing)' ELSE '' END);
    END IF;
    IF v_mr.id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET style_material_id = NULL, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_mr.id;
      UPDATE public.mm_mill_batches b SET style_material_id = NULL, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE b.id = v_mr.mill_batch_id AND b.style_material_id = v_sm
        AND NOT EXISTS (SELECT 1 FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id AND r.style_material_id = v_sm);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object('count', v_n));
END $function$;

GRANT EXECUTE ON FUNCTION public.mm_allocate_check(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_allocate_rolls_v4(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_allocate_auto_pick(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mm_unallocate_rolls_v4(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._mm_alloc_target(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._mm_alloc_check_roll(uuid, uuid, jsonb) FROM anon, public;
