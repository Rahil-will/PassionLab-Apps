-- Mill removal, part 1 (applied live 2026-10-15 as mm_rm_mill_1..5): every live function stops reading/writing mill tables.
-- Non-destructive (CREATE OR REPLACE only). Part 2 = 20261015180000_mm_remove_mill.sql.
BEGIN;
-- temp patch helper: replace exact text in one public function; asserts the expected count.
CREATE OR REPLACE FUNCTION pg_temp.fx(p_name text, p_old text, p_new text, p_n int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $fx$
DECLARE v_oid oid; v_def text; v_cnt int;
BEGIN
  SELECT p.oid INTO STRICT v_oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / greatest(length(p_old), 1);
  IF v_cnt <> p_n THEN
    RAISE EXCEPTION 'fx %: expected % match(es), found % for [%]', p_name, p_n, v_cnt, left(p_old, 120);
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END $fx$;
SET LOCAL check_function_bodies = off;
-- ===== Part 1: small helpers / triggers without the mill =====

CREATE OR REPLACE FUNCTION public._mm_fabric_locked(p_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.colorway_materials WHERE fabric_id = p_id)
      OR EXISTS (SELECT 1 FROM public.mm_style_materials WHERE fabric_id = p_id)
      OR EXISTS (SELECT 1 FROM public.mm_rolls WHERE fabric_id = p_id);
$function$;

CREATE OR REPLACE FUNCTION public._mm_feature(p_factory uuid, p_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE p_key
    WHEN 'fabric_warehouse' THEN COALESCE((SELECT enabled FROM public.mm_factory_features WHERE factory_id = p_factory AND feature_key = 'fabric_warehouse'), true)
    WHEN 'trims' THEN COALESCE((SELECT enabled FROM public.mm_factory_features WHERE factory_id = p_factory AND feature_key = 'trims'), false)
    ELSE false END
$function$;


CREATE OR REPLACE FUNCTION public._mm_invalidate_qc_after_process()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.stock_unit_id IS NOT NULL THEN
    UPDATE public.mm_stock_units
    SET qc_result = NULL, row_version = row_version + 1, updated_at = now()
    WHERE id = NEW.stock_unit_id AND qc_result IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$function$;




CREATE OR REPLACE FUNCTION public._mm_proc_line_roll_id()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.roll_id IS NULL AND NEW.stock_unit_id IS NOT NULL THEN
    SELECT roll_id INTO NEW.roll_id FROM public.mm_stock_units WHERE id = NEW.stock_unit_id;
  END IF;
  IF TG_TABLE_NAME = 'mm_process_out_lines' AND NEW.stage_code IS NULL THEN
    SELECT stage_code INTO NEW.stage_code FROM public.mm_rolls WHERE id = NEW.roll_id;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._mm_qc_scope_rolls(p_factory uuid, p_kind text, p_id uuid)
 RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT DISTINCT x.roll_id FROM (
    SELECT rl.roll_id FROM public.mm_process_return_lines rl
     WHERE p_kind = 'process_challan' AND rl.factory_id = p_factory AND rl.challan_id = p_id
    UNION ALL
    SELECT rl.roll_id FROM public.mm_process_return_lines rl
     WHERE p_kind = 'process_lot' AND rl.factory_id = p_factory AND rl.lot_id = p_id
    UNION ALL
    SELECT u.roll_id FROM public.mm_in_challan_lines cl JOIN public.mm_stock_units u ON u.id = cl.stock_unit_id
     WHERE p_kind = 'in_challan' AND cl.factory_id = p_factory AND cl.challan_id = p_id
  ) x WHERE x.roll_id IS NOT NULL AND public._mm_roll_alive(x.roll_id);
$function$;

CREATE OR REPLACE FUNCTION public._mm_roll_alive(p_roll_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = p_roll_id AND l.line_status = 'out')
     AND EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.roll_id = p_roll_id
                 AND u.status NOT IN ('consumed','written_off','returned_to_supplier','missing','at_process'));
$function$;

CREATE OR REPLACE FUNCTION public._mm_roll_custody(p_roll_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object('side','processing','process_challan_id', l.challan_id, 'out_line_id', l.id)
       FROM public.mm_process_out_lines l WHERE l.roll_id = p_roll_id AND l.line_status = 'out' LIMIT 1),
    (SELECT jsonb_build_object('side','warehouse','stock_unit_id', u.id, 'status', u.status, 'style_material_id', u.style_material_id,
            'qty', u.qty_available, 'uom', COALESCE(u.qty_uom, u.uom), 'on_hold', u.on_hold, 'location_id', u.current_location_id,
            'alive', u.status NOT IN ('consumed','written_off','returned_to_supplier','missing'))
       FROM public.mm_stock_units u WHERE u.roll_id = p_roll_id),
    jsonb_build_object('side','none','alive', false));
$function$;

CREATE OR REPLACE FUNCTION public._mm_roll_style_material(p_roll_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT u.style_material_id FROM public.mm_stock_units u WHERE u.roll_id = p_roll_id LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public._mm_rolls_fabric_inherit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.fabric_id IS NULL THEN
    NEW.fabric_id := public._mm_receipt_fabric_guc();
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._mm_stock_row_extra(p_factory uuid, p_roll_id uuid, p_side text, p_stock_unit_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'stage_code', r.stage_code,
    'stage_label', COALESCE(st.label, r.stage_code),
    'stage_seq', st.seq,
    'can_cut', COALESCE(st.can_cut, true),
    'dye_lot', r.dye_lot,
    'unit_form', COALESCE(r.unit_form, 'roll'),
    'home', 'warehouse')
  FROM public.mm_rolls r
  LEFT JOIN public.mm_fabric_stages st ON st.factory_id = p_factory AND st.code = r.stage_code
  WHERE r.id = p_roll_id
$function$;

CREATE OR REPLACE FUNCTION public.colorway_materials_sync_style_material()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.mm_style_materials sm SET
    fabric_id = NEW.fabric_id,
    fabric_type_id = CASE
      WHEN NEW.fabric_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.mm_stock_units x WHERE x.style_material_id = sm.id)
       AND NOT EXISTS (SELECT 1 FROM public.mm_in_challans x WHERE x.style_material_id = sm.id)
       AND NOT EXISTS (SELECT 1 FROM public.mm_store_challans x WHERE x.style_material_id = sm.id)
      THEN (SELECT f.fabric_type_id FROM public.mm_fabrics f WHERE f.id = NEW.fabric_id)
      ELSE sm.fabric_type_id
    END,
    updated_at = now()
  WHERE sm.colorway_material_id = NEW.id
    AND sm.fabric_id IS DISTINCT FROM NEW.fabric_id;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.mm_seed_factory_features()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (NEW.id, 'receive_goods', false),
    (NEW.id, 'test_rolls', false)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mm_fpt_threshold(p_unit_id uuid)
 RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
  SELECT t.max_points INTO v_points
  FROM public.mm_fpt_thresholds t
  WHERE t.factory_id = v_factory AND t.fabric_type_id = v_ft AND t.buyer_id = v_buyer;
  IF v_points IS NULL THEN
    SELECT f.fpt_max_points INTO v_points FROM public.mm_fabric_types f WHERE f.id = v_ft;
  END IF;
  RETURN COALESCE(v_points, 40);
END;
$function$;

-- allocation log: warehouse only
CREATE OR REPLACE FUNCTION public._mm_log_allocation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_from uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.style_material_id IS NULL THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.mm_roll_allocations a WHERE a.roll_id = NEW.roll_id
               AND a.to_style_material_id = NEW.style_material_id) THEN
      RETURN NEW;
    END IF;
    v_from := NULL;
  ELSE
    IF NEW.style_material_id IS NOT DISTINCT FROM OLD.style_material_id THEN RETURN NEW; END IF;
    v_from := OLD.style_material_id;
  END IF;
  INSERT INTO public.mm_roll_allocations (factory_id, roll_id, side, stock_unit_id,
    from_style_material_id, to_style_material_id, reason, event_at, created_by)
  VALUES (NEW.factory_id, NEW.roll_id, 'warehouse', NEW.id,
    v_from, NEW.style_material_id, NULLIF(current_setting('mm.alloc_reason', true), ''), now(), public._mm_actor_id());
  RETURN NEW;
END $function$;

-- registry: a new stock unit creates its roll (origin inhouse / vendor / process)
CREATE OR REPLACE FUNCTION public._mm_registry_on_stock_unit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_p public.mm_rolls%ROWTYPE; v_id uuid; v_stage text;
BEGIN
  IF NEW.roll_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.parent_stock_unit_id IS NOT NULL THEN
    SELECT r.* INTO v_p FROM public.mm_rolls r JOIN public.mm_stock_units u ON u.roll_id = r.id
    WHERE u.id = NEW.parent_stock_unit_id;
    INSERT INTO public.mm_rolls (factory_id, roll_code, origin, origin_facility_id, fabric_type_id,
      stage_code, unit_form, width_form, grade, dye_lot, produced_at, created_by)
    VALUES (NEW.factory_id, NEW.unit_code, 'process', v_p.origin_facility_id, NEW.fabric_type_id,
      COALESCE(v_p.stage_code, 'FINISHED'), COALESCE(v_p.unit_form, 'roll'), v_p.width_form, v_p.grade, v_p.dye_lot,
      now(), public._mm_actor_id())
    RETURNING id INTO v_id;
    IF v_p.id IS NOT NULL THEN
      INSERT INTO public.mm_roll_lineage (factory_id, child_roll_id, parent_roll_id) VALUES (NEW.factory_id, v_id, v_p.id)
      ON CONFLICT DO NOTHING;
    END IF;
    NEW.roll_id := v_id;
  END IF;
  IF NEW.roll_id IS NULL THEN
    v_stage := COALESCE(NULLIF(current_setting('mm.v4_receipt_stage', true), ''), 'FINISHED');
    INSERT INTO public.mm_rolls (factory_id, roll_code, origin, origin_facility_id, fabric_type_id,
      stage_code, produced_at, created_by)
    VALUES (NEW.factory_id, NEW.unit_code, CASE WHEN NEW.source = 'mill' THEN 'mill' ELSE 'vendor' END,
      NULLIF(current_setting('mm.v4_receipt_facility', true), '')::uuid,
      NEW.fabric_type_id, v_stage, now(), public._mm_actor_id())
    RETURNING id INTO v_id;
    NEW.roll_id := v_id;
  END IF;
  RETURN NEW;
END $function$;

-- cutting gate: every active test field must have a value on the roll (receipt grid) or its inspection
CREATE OR REPLACE FUNCTION public._mm_cutting_param_block(p_unit mm_stock_units)
 RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_field record;
  v_bag jsonb;
  v_wh_bag jsonb;
BEGIN
  v_bag := CASE WHEN jsonb_typeof(p_unit.attributes) = 'object' THEN p_unit.attributes ELSE '{}'::jsonb END;
  SELECT COALESCE(i.field_values, '{}'::jsonb) INTO v_wh_bag
  FROM public.mm_warehouse_inspections i
  WHERE i.stock_unit_id = p_unit.id;
  IF v_wh_bag IS NULL OR jsonb_typeof(v_wh_bag) <> 'object' THEN
    v_wh_bag := '{}'::jsonb;
  END IF;
  FOR v_field IN
    SELECT f.key, f.label
    FROM public.mm_type_test_fields f
    WHERE f.factory_id = p_unit.factory_id
      AND f.type_id = p_unit.fabric_type_id
      AND f.is_active
    ORDER BY f.seq, f.label
  LOOP
    IF public._mm_param_text(v_bag, v_field.key) IS NULL AND public._mm_param_text(v_wh_bag, v_field.key) IS NULL THEN
      RETURN 'Testing parameter missing: ' || v_field.label;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- spec check reads the warehouse copy only
SELECT pg_temp.fx('_mm_roll_spec',
$o$  SELECT COALESCE(u.attributes, m.attributes, '{}'::jsonb) INTO v_attrs
  FROM (SELECT 1) one
  LEFT JOIN public.mm_stock_units u ON u.roll_id = v_r.id
  LEFT JOIN public.mm_mill_rolls m ON m.roll_id = v_r.id;$o$,
$n$  SELECT COALESCE(u.attributes, '{}'::jsonb) INTO v_attrs
  FROM (SELECT 1) one
  LEFT JOIN public.mm_stock_units u ON u.roll_id = v_r.id;$n$);

SELECT pg_temp.fx('_mm_qc_threshold',
$o$  v_sm := COALESCE((SELECT style_material_id FROM public.mm_stock_units WHERE roll_id = p_roll_id),
                   (SELECT style_material_id FROM public.mm_mill_rolls WHERE roll_id = p_roll_id));$o$,
$n$  v_sm := (SELECT style_material_id FROM public.mm_stock_units WHERE roll_id = p_roll_id);$n$);

SELECT pg_temp.fx('_mm_style_material_fabric_rolls',
$o$
          UNION
          SELECT m.roll_id FROM public.mm_mill_rolls m WHERE m.style_material_id = NEW.id AND m.roll_id IS NOT NULL)$o$,
$n$)$n$, 2);

SELECT pg_temp.fx('_mm_stock_movement_action', $o$THEN 'Mill inbound'$o$, $n$THEN 'In-house inbound'$n$);
SELECT pg_temp.fx('_mm_stock_movement_action', $o$THEN 'Mill dispatched'$o$, $n$THEN 'In transit'$n$);

SELECT pg_temp.fx('_mm_seed_ops_locations',
$o$    (p_factory, 'MILL', 'Mill', 'virtual', NULL, false, true, p_actor, p_actor),
$o$, '');

-- vendor GRN (floor): no mill snapshot
SELECT pg_temp.fx('_mm_insert_rolls',
$o$    IF p_freeze THEN
      v_snap := jsonb_build_object(
        'length_m', v_len, 'weight_kg', v_wt, 'shade', v_shade, 'lot_no', v_lot,
        'color_ref', v_color, 'attributes', v_attrs
      );
    ELSE
      v_snap := NULL;
    END IF;
$o$, '');
SELECT pg_temp.fx('_mm_insert_rolls', $o$color_ref, attributes, mill_snapshot, status,$o$, $n$color_ref, attributes, status,$n$);
SELECT pg_temp.fx('_mm_insert_rolls', $o$v_color, v_attrs, v_snap, p_status, p_loc,$o$, $n$v_color, v_attrs, p_status, p_loc,$n$);
SELECT pg_temp.fx('_mm_insert_rolls', $o$  v_snap jsonb;
$o$, '');




-- floor unallocate: warehouse copy only
SELECT pg_temp.fx('mm_unallocate_rolls',
$o$    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = NULL,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_unit.mill_roll_id AND factory_id = v_factory;
    END IF;
$o$, '');

-- ===== Part 2: core roll readers / allocation check, warehouse only =====
SELECT pg_temp.fx('_mm_roll_row',
$o$    v_sm := COALESCE((SELECT style_material_id FROM public.mm_stock_units WHERE roll_id = v_r.id),
                     (SELECT style_material_id FROM public.mm_mill_rolls WHERE roll_id = v_r.id));$o$,
$n$    v_sm := (SELECT style_material_id FROM public.mm_stock_units WHERE roll_id = v_r.id);$n$);
SELECT pg_temp.fx('_mm_roll_row',
$o$  SELECT COALESCE(u.length_m, mr.length_m), COALESCE(u.weight_kg, mr.weight_kg),
         jsonb_build_object('shade', COALESCE(u.shade, mr.shade), 'lot_no', COALESCE(u.lot_no, mr.lot_no), 'color_ref', COALESCE(u.color_ref, mr.color_ref),
                            'mill_roll_id', mr.id, 'stock_unit_id', u.id, 'attributes', COALESCE(u.attributes, mr.attributes, '{}'::jsonb), 'qty_available', u.qty_available, 'uom', COALESCE(u.qty_uom, u.uom, 'm'))
    INTO v_qty, v_kg, v_extra
  FROM public.mm_rolls r LEFT JOIN public.mm_stock_units u ON u.roll_id = r.id LEFT JOIN public.mm_mill_rolls mr ON mr.roll_id = r.id
  WHERE r.id = v_r.id;$o$,
$n$  SELECT u.length_m, u.weight_kg,
         jsonb_build_object('shade', u.shade, 'lot_no', u.lot_no, 'color_ref', u.color_ref,
                            'stock_unit_id', u.id, 'attributes', COALESCE(u.attributes, '{}'::jsonb), 'qty_available', u.qty_available, 'uom', COALESCE(u.qty_uom, u.uom, 'm'),
                            'receipt_id', u.in_challan_id, 'receipt_no', COALESCE(ic.grn_no, ic.challan_no))
    INTO v_qty, v_kg, v_extra
  FROM public.mm_rolls r LEFT JOIN public.mm_stock_units u ON u.roll_id = r.id LEFT JOIN public.mm_in_challans ic ON ic.id = u.in_challan_id
  WHERE r.id = v_r.id;$n$);
SELECT pg_temp.fx('_mm_roll_row',
$o$'origin', v_r.origin, 'mill_batch_id', v_r.mill_batch_id,
    'batch_no', (SELECT batch_no FROM public.mm_mill_batches WHERE id = v_r.mill_batch_id),$o$,
$n$'origin', v_r.origin,$n$);

CREATE OR REPLACE FUNCTION public._mm_alloc_check_roll(p_factory uuid, p_roll_id uuid, p_t jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text := COALESCE(NULLIF(p_t->>'mode', ''), 'allocate');
  v_r public.mm_rolls%ROWTYPE; v_side text; v_su public.mm_stock_units%ROWTYPE;
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
    SELECT NULLIF(btrim(c.target_color), '') INTO v_target_colour FROM public.mm_process_challans c WHERE c.id = v_line.challan_id;
    v_sm := v_su.style_material_id;
    v_kg := CASE WHEN lower(COALESCE(v_line.uom, '')) IN ('kg', 'kgs') THEN v_line.qty ELSE v_line.qty_kg END;
    v_m := CASE WHEN lower(COALESCE(v_line.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN v_line.qty END;
    v_colour := COALESCE(v_target_colour, NULLIF(btrim(v_line.color_ref), ''), NULLIF(btrim(v_su.color_ref), ''));
  ELSE
    SELECT * INTO v_su FROM public.mm_stock_units WHERE roll_id = v_r.id
      AND status NOT IN ('consumed', 'written_off', 'returned_to_supplier', 'missing', 'cancelled') LIMIT 1;
    IF v_su.id IS NOT NULL THEN
      v_side := 'warehouse';
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
      v_side := 'none'; v_block := 'Roll is not in the warehouse or at processing';
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
    IF v_r.fabric_id IS NULL THEN v_block := 'Roll has no fabric — set it on the receipt first';
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
    'stock_unit_id', v_su.id, 'out_line_id', v_line.id, 'status', v_su.status,
    'booked_style_material_id', v_r.booked_style_material_id,
    'already', CASE WHEN v_mode = 'book' THEN v_r.booked_style_material_id IS NOT DISTINCT FROM v_target_sm AND v_target_sm IS NOT NULL
                    ELSE v_sm IS NOT NULL AND v_sm = v_target_sm END,
    'block', v_block, 'warnings', to_jsonb(v_warn));
END $function$;

-- stock rows: warehouse + processing only (mill_roll_id output stays NULL until the signature is dropped)
CREATE OR REPLACE FUNCTION public._mm_roll_stock(p_factory uuid)
 RETURNS TABLE(roll_id uuid, roll_code text, fabric_id uuid, fabric_type_id uuid, side text, bucket text, style_material_id uuid, colour text, qty_kg numeric, qty_m numeric, qty numeric, uom text, stock_unit_id uuid, mill_roll_id uuid, out_line_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH proc AS (
    SELECT l.roll_id, l.id AS out_line_id, l.qty, l.uom, l.qty_kg, l.color_ref,
           su.style_material_id AS sm_id, l.stock_unit_id
    FROM public.mm_process_out_lines l
    LEFT JOIN public.mm_stock_units su ON su.id = l.stock_unit_id
    WHERE l.factory_id = p_factory AND l.line_status = 'out' AND l.roll_id IS NOT NULL
  ), base AS (
    SELECT p.roll_id, 'processing'::text AS side, 'at_processing'::text AS bucket, p.sm_id, p.color_ref,
           CASE WHEN lower(COALESCE(p.uom, '')) = 'kg' THEN p.qty ELSE p.qty_kg END AS kg,
           CASE WHEN lower(COALESCE(p.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN p.qty END AS m,
           p.stock_unit_id, p.out_line_id
    FROM proc p
    UNION ALL
    SELECT u.roll_id, 'warehouse',
           CASE WHEN u.on_hold THEN 'on_hold'
                WHEN u.status = 'pending_qc' THEN 'qc_pending'
                WHEN u.status = 'rejected' THEN 'rejected'
                WHEN u.status IN ('issued', 'issued_pending', 'partially_consumed') THEN 'issued'
                ELSE 'in_stock' END,
           u.style_material_id, u.color_ref,
           CASE WHEN lower(COALESCE(u.qty_uom, u.uom, '')) = 'kg' THEN u.qty_available ELSE u.weight_kg END,
           CASE WHEN lower(COALESCE(u.qty_uom, u.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN u.qty_available ELSE u.length_m END,
           u.id, NULL::uuid
    FROM public.mm_stock_units u
    WHERE u.factory_id = p_factory AND u.roll_id IS NOT NULL
      AND u.status NOT IN ('consumed', 'written_off', 'returned_to_supplier', 'missing', 'cancelled', 'draft')
      AND COALESCE(u.qty_available, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM proc p WHERE p.roll_id = u.roll_id)
  )
  SELECT b.roll_id, r.roll_code, r.fabric_id, r.fabric_type_id, b.side, b.bucket, b.sm_id,
         COALESCE(NULLIF(btrim(cm.fabric_color), ''), cw.name, NULLIF(btrim(b.color_ref), '')) AS colour,
         b.kg, b.m,
         CASE f.uom WHEN 'kg' THEN b.kg WHEN 'm' THEN b.m ELSE NULL END,
         COALESCE(f.uom, 'mixed'),
         b.stock_unit_id, NULL::uuid, b.out_line_id
  FROM base b
  JOIN public.mm_rolls r ON r.id = b.roll_id
  LEFT JOIN public.mm_fabrics f ON f.id = r.fabric_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = b.sm_id
  LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
  LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id;
$function$;

SELECT pg_temp.fx('_mm_resolve_style_material',
$o$
          OR EXISTS (SELECT 1 FROM public.mm_mill_rolls x WHERE x.style_material_id = mm_style_materials.id)
          OR EXISTS (SELECT 1 FROM public.mm_mill_batches x WHERE x.style_material_id = mm_style_materials.id)$o$, '');

SELECT pg_temp.fx('mm_allocate_rolls_to_style',
$o$    IF v_unit.mill_roll_id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        style_material_id = v_sm_id,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_unit.mill_roll_id AND factory_id = v_factory;
    END IF;
$o$, '');

-- stock totals: no at-mill bucket
SELECT pg_temp.fx('_mm_stock_totals', $o$
    'at_mill',        COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'at_mill'), 0),$o$, '');
SELECT pg_temp.fx('_mm_stock_totals', $o$
      'at_mill', jsonb_build_object('rolls', count(*) FILTER (WHERE x->>'bucket' = 'at_mill' AND x->>'unit_form' = 'roll'), 'laps', count(*) FILTER (WHERE x->>'bucket' = 'at_mill' AND x->>'unit_form' = 'lap')),$o$, '');
SELECT pg_temp.fx('_mm_stock_totals', $o$
       'at_mill', count(*) FILTER (WHERE x->>'bucket' = 'at_mill'),$o$, '');

-- floor allowlist: the mill bundle receive paths are gone
SELECT pg_temp.fx('mm_floor_call', $o$  ELSIF p_fn = 'mm_receive_mill_floor' THEN
    RETURN public.mm_receive_mill_floor(
      (v_args->>'id')::uuid,
      COALESCE(v_args->'roll_edits', '[]'::jsonb),
      COALESCE((v_args->>'row_version')::int, 1),
      CASE
        WHEN jsonb_typeof(v_args->'missing_unit_ids') = 'array' THEN
          ARRAY(SELECT jsonb_array_elements_text(v_args->'missing_unit_ids')::uuid)
        ELSE NULL
      END
    );
$o$, '');
SELECT pg_temp.fx('mm_floor_call', $o$  ELSIF p_fn = 'mm_receive_mill_bundle' THEN
    RETURN public.mm_receive_mill_bundle(v_args);
$o$, '');
-- ===== Part 3: feature switches, shade log, QC queue, partners (structural) =====
CREATE OR REPLACE FUNCTION public.mm_enable_module(p_config jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  IF NOT public.is_factory_admin() THEN
    RETURN public._mm_err('NO_PERMISSION', 'Admin required');
  END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  PERFORM public.set_factory_module('material', true, COALESCE(p_config, '{}'::jsonb));
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled)
  VALUES
    (v_factory, 'receive_goods', false),
    (v_factory, 'test_rolls', false)
  ON CONFLICT (factory_id, feature_key) DO NOTHING;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  RETURN public._mm_ok(jsonb_build_object('factory_id', v_factory));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_get_material_features()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid := public.current_factory_id(); v_mod boolean;
BEGIN
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  SELECT enabled INTO v_mod FROM public.factory_modules WHERE factory_id = v_factory AND module_key = 'material';
  RETURN public._mm_ok(jsonb_build_object(
    'material', COALESCE(v_mod, false),
    'fabric_warehouse', COALESCE(v_mod, false) AND public._mm_feature(v_factory, 'fabric_warehouse'),
    'trims', COALESCE(v_mod, false) AND public._mm_feature(v_factory, 'trims')));
END $function$;

CREATE OR REPLACE FUNCTION public.mm_get_ops_context()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MODULE_DISABLED' THEN RETURN public._mm_err('MODULE_DISABLED', 'Material module is disabled'); END IF;
    IF SQLERRM = 'NO_PERMISSION' THEN RETURN public._mm_err('NO_PERMISSION', 'Not allowed'); END IF;
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  RETURN public._mm_ok(jsonb_build_object(
    'features', COALESCE((
      SELECT jsonb_object_agg(feature_key, enabled)
      FROM public.mm_factory_features WHERE factory_id = v_factory
    ), '{}'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'name', name, 'location_type', location_type,
        'parent_id', parent_id, 'is_pickable', is_pickable
      ) ORDER BY code)
      FROM public.mm_locations WHERE factory_id = v_factory AND is_active
    ), '[]'::jsonb)
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_set_material_feature(p_key text, p_enabled boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_on boolean := COALESCE(p_enabled, false);
BEGIN
  IF NOT public.is_factory_admin() THEN RETURN public._mm_err('NO_PERMISSION', 'Admin required'); END IF;
  v_factory := public.current_factory_id();
  IF v_factory IS NULL THEN RETURN public._mm_err('NO_FACTORY', 'No factory'); END IF;
  IF p_key NOT IN ('fabric_warehouse', 'trims') THEN
    RETURN public._mm_err('INVALID', 'Switch must be fabric_warehouse or trims');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.factory_modules WHERE factory_id = v_factory AND module_key = 'material' AND enabled) THEN
    RETURN public._mm_err('MODULE_DISABLED', 'Turn on Material Management first');
  END IF;
  INSERT INTO public.mm_factory_features (factory_id, feature_key, enabled) VALUES (v_factory, p_key, v_on)
  ON CONFLICT (factory_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;
  IF v_on AND p_key = 'fabric_warehouse' THEN
    PERFORM public._mm_v4_seed_masters(v_factory);
    PERFORM public._mm_seed_ops_locations(v_factory, public._mm_actor_id());
  END IF;
  RETURN public.mm_get_material_features();
END $function$;

CREATE OR REPLACE FUNCTION public._mm_log_shade_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'mm_stock_units' THEN
    IF NEW.shade IS DISTINCT FROM OLD.shade THEN
      INSERT INTO public.mm_shade_history (
        factory_id, stock_unit_id, side, shade_field, old_value, new_value, changed_by
      ) VALUES (
        NEW.factory_id, NEW.id, 'warehouse', 'shade', OLD.shade, NEW.shade, public._mm_actor_id()
      );
    END IF;
    IF NEW.tested_shade IS DISTINCT FROM OLD.tested_shade THEN
      INSERT INTO public.mm_shade_history (
        factory_id, stock_unit_id, side, shade_field, old_value, new_value, changed_by
      ) VALUES (
        NEW.factory_id, NEW.id, 'warehouse', 'tested_shade', OLD.tested_shade, NEW.tested_shade, public._mm_actor_id()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_qc_list_queue(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_need text; v_q text; v_lim int; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_need := COALESCE(NULLIF(p_filter->>'need',''), 'any');
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search',''))), ''); v_lim := LEAST(COALESCE((p_filter->>'limit')::int, 300), 1000);
  SELECT COALESCE(jsonb_agg(x.row ORDER BY x.row->>'roll_code'), '[]'::jsonb) INTO v_rows FROM (
    SELECT public._mm_roll_row(r.id) AS row FROM public.mm_rolls r
    JOIN public.mm_stock_units u ON u.roll_id = r.id
    WHERE r.factory_id = v_factory AND public._mm_roll_alive(r.id)
      AND (NULLIF(p_filter->>'style_material_id','') IS NULL OR u.style_material_id = (p_filter->>'style_material_id')::uuid)
      AND (NULLIF(p_filter->>'receipt_id','') IS NULL OR u.in_challan_id = (p_filter->>'receipt_id')::uuid)
      AND (v_q IS NULL OR lower(r.roll_code) LIKE '%'||v_q||'%')
    LIMIT 2000) x
  WHERE (v_need IN ('test','any') AND x.row->>'test_status' <> 'PASS') OR (v_need IN ('inspection','any') AND x.row->>'inspection_status' <> 'PASS');
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(v_rows) e LIMIT v_lim) s), '[]'::jsonb)));
END $function$;

SELECT pg_temp.fx('mm_list_partners', $o$
             OR EXISTS (SELECT 1 FROM public.mm_mill_batches b WHERE b.facility_id = f.id)$o$, '');
SELECT pg_temp.fx('mm_update_roll', $o$    mill_snapshot = mill_snapshot,
$o$, '');
-- ===== Part 4: readers / small RPCs, warehouse only =====
SELECT pg_temp.fx('mm_set_roll_colour', $o$  UPDATE public.mm_mill_rolls SET color_ref = v_colour, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE roll_id = ANY (v_ids) AND factory_id = v_factory;
$o$, '');

SELECT pg_temp.fx('mm_set_roll_tags', $o$_mm_require_ops('mm_mill_ops')$o$, $n$_mm_require_ops('mm_roll_entry')$n$);
SELECT pg_temp.fx('mm_set_roll_tags', $o$machine is not in the mill that made this roll$o$, $n$machine is not in the unit that made this roll$n$);

SELECT pg_temp.fx('mm_get_in_challan_rolls', $o$,
        'capture_site', f.capture_site
      ) ORDER BY f.seq, f.label)$o$, $n$
      ) ORDER BY f.seq, f.label)$n$);
SELECT pg_temp.fx('mm_get_in_challan_rolls', $o$'attributes', u.attributes, 'mill_snapshot', u.mill_snapshot, 'status', u.status,$o$, $n$'attributes', u.attributes, 'status', u.status,$n$);
SELECT pg_temp.fx('mm_get_in_challan_rolls', $o$        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,
$o$, $n$        'batch_no', u.lot_no,
$n$);
SELECT pg_temp.fx('mm_get_in_challan_rolls', $o$      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
$o$, '');

SELECT pg_temp.fx('mm_get_fpt_summary', $o$  IF v_group NOT IN ('mill', 'supplier', 'fabric_type') THEN
    RETURN public._mm_err('INVALID', 'Group by mill, supplier, or fabric_type');$o$, $n$  IF v_group NOT IN ('supplier', 'fabric_type') THEN
    RETURN public._mm_err('INVALID', 'Group by supplier or fabric_type');$n$);
SELECT pg_temp.fx('mm_get_fpt_summary', $o$          WHEN 'mill' THEN COALESCE(NULLIF(btrim(b.mill_ref), ''), 'No mill')
          WHEN 'supplier' THEN COALESCE(NULLIF(btrim(c.supplier_name), ''), NULLIF(btrim(b.mill_ref), ''), 'Unknown')$o$,
$n$          WHEN 'supplier' THEN COALESCE(NULLIF(btrim(c.supplier_name), ''), (SELECT x.name FROM public.mm_facilities x WHERE x.id = c.from_facility_id), 'Unknown')$n$);
SELECT pg_temp.fx('mm_get_fpt_summary', $o$      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
$o$, '');

SELECT pg_temp.fx('mm_merge_fabric', $o$  UPDATE public.mm_mill_batches SET fabric_id = p_into_id WHERE fabric_id = p_from_id;
$o$, '');

SELECT pg_temp.fx('mm_putaway_rolls', $o$      mill_snapshot = mill_snapshot,
$o$, '');

SELECT pg_temp.fx('mm_fabric_stock_rolls', $o$('at_mill', 'at_processing',$o$, $n$('at_processing',$n$);
SELECT pg_temp.fx('mm_fabric_stock_rolls', $o$'stock_unit_id', s.stock_unit_id, 'mill_roll_id', s.mill_roll_id, 'out_line_id', s.out_line_id)$o$,
$n$'stock_unit_id', s.stock_unit_id, 'out_line_id', s.out_line_id)$n$);

CREATE OR REPLACE FUNCTION public.mm_list_rolls_v4(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid; v_for text; v_q text; v_lim int; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_for := NULLIF(p_filter->>'available_for','');
  v_q := NULLIF(lower(btrim(COALESCE(p_filter->>'search',''))), ''); v_lim := LEAST(COALESCE((p_filter->>'limit')::int, 300), 1000);
  SELECT COALESCE(jsonb_agg(public._mm_roll_row(x.id) ORDER BY x.roll_code), '[]'::jsonb) INTO v_rows FROM (
    SELECT r.id, r.roll_code FROM public.mm_rolls r
    JOIN public.mm_stock_units u ON u.roll_id = r.id
    WHERE r.factory_id = v_factory
      AND (NULLIF(p_filter->>'receipt_id','') IS NULL OR u.in_challan_id = (p_filter->>'receipt_id')::uuid)
      AND (NULLIF(p_filter->>'fabric_id','') IS NULL OR r.fabric_id = (p_filter->>'fabric_id')::uuid)
      AND (NULLIF(p_filter->>'booked_style_material_id','') IS NULL OR r.booked_style_material_id = (p_filter->>'booked_style_material_id')::uuid)
      AND (NULLIF(p_filter->>'fabric_type_id','') IS NULL OR r.fabric_type_id = (p_filter->>'fabric_type_id')::uuid)
      AND (NULLIF(p_filter->>'stage_code','') IS NULL OR r.stage_code = upper(p_filter->>'stage_code'))
      AND (NULLIF(p_filter->>'style_material_id','') IS NULL OR u.style_material_id = (p_filter->>'style_material_id')::uuid)
      AND (NOT COALESCE((p_filter->>'unallocated')::boolean, false) OR u.style_material_id IS NULL)
      AND (v_q IS NULL OR lower(r.roll_code) LIKE '%' || v_q || '%' OR lower(COALESCE(r.dye_lot,'')) LIKE '%' || v_q || '%')
      AND (v_for IS NULL
        OR (v_for = 'process' AND NOT EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = r.id AND l.line_status = 'out')
            AND u.status IN ('in_stock','pending_qc') AND NOT COALESCE(u.on_hold,false) AND u.qty_available > 0)
        OR (v_for = 'test' AND public._mm_roll_alive(r.id))
        OR (v_for = 'cut' AND u.status = 'in_stock'))
    ORDER BY r.roll_code LIMIT v_lim) x;
  RETURN public._mm_ok(jsonb_build_object('rows', v_rows));
END $function$;
-- ===== Part 5: allocate / unallocate, test fields, QC saves, process challan reader =====
SELECT pg_temp.fx('mm_allocate_rolls_v4', $o$    v_mr := NULLIF(v_e->>'mill_roll_id', '')::uuid;
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
$o$, '');
SELECT pg_temp.fx('mm_allocate_rolls_v4', $o$  FOREACH v_b IN ARRAY (SELECT COALESCE(array_agg(DISTINCT b), '{}') FROM unnest(v_batches) b) LOOP
    UPDATE public.mm_mill_batches b SET style_material_id = v_sm, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
    WHERE b.id = v_b AND b.factory_id = v_factory AND b.style_material_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id AND r.style_material_id IS DISTINCT FROM v_sm);
  END LOOP;

$o$, '');
SELECT pg_temp.fx('mm_allocate_rolls_v4', $o$  v_su public.mm_stock_units%ROWTYPE; v_mrr public.mm_mill_rolls%ROWTYPE; v_pos jsonb;
  v_batches uuid[] := '{}'; v_b uuid; v_mr uuid; v_cnt int;$o$, $n$  v_su public.mm_stock_units%ROWTYPE; v_pos jsonb;$n$);

SELECT pg_temp.fx('mm_unallocate_rolls_v4', $o$    v_su := NULL; v_mr := NULL; v_line := NULL;$o$, $n$    v_su := NULL; v_line := NULL;$n$);
SELECT pg_temp.fx('mm_unallocate_rolls_v4', $o$      SELECT * INTO v_su FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
      SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE id = COALESCE(v_line.mill_roll_id, v_su.mill_roll_id) FOR UPDATE;$o$,
$n$      SELECT * INTO v_su FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;$n$);
SELECT pg_temp.fx('mm_unallocate_rolls_v4', $o$        SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE id = v_su.mill_roll_id FOR UPDATE;
      ELSE
        SELECT * INTO v_mr FROM public.mm_mill_rolls WHERE roll_id = v_id FOR UPDATE;
        IF v_mr.id IS NULL OR v_mr.status <> 'draft' THEN
          RETURN public._mm_err('INVALID', v_code || ': roll is not at the mill, processing or warehouse');
        END IF;
      END IF;$o$,
$n$      ELSE
        RETURN public._mm_err('INVALID', v_code || ': roll is not in the warehouse or at processing');
      END IF;$n$);
SELECT pg_temp.fx('mm_unallocate_rolls_v4', $o$    v_sm := COALESCE(v_su.style_material_id, v_mr.style_material_id);$o$, $n$    v_sm := v_su.style_material_id;$n$);
SELECT pg_temp.fx('mm_unallocate_rolls_v4', $o$    IF v_mr.id IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET style_material_id = NULL, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE id = v_mr.id;
      UPDATE public.mm_mill_batches b SET style_material_id = NULL, row_version = row_version + 1, updated_at = now(), updated_by = public._mm_actor_id()
      WHERE b.id = v_mr.mill_batch_id AND b.style_material_id = v_sm
        AND NOT EXISTS (SELECT 1 FROM public.mm_mill_rolls r WHERE r.mill_batch_id = b.id AND r.style_material_id = v_sm);
    END IF;
$o$, '');
SELECT pg_temp.fx('mm_unallocate_rolls_v4', $o$ v_su public.mm_stock_units%ROWTYPE; v_mr public.mm_mill_rolls%ROWTYPE;$o$, $n$ v_su public.mm_stock_units%ROWTYPE;$n$);

SELECT pg_temp.fx('mm_allocate_auto_pick', $o$ARRAY['warehouse', 'processing', 'mill']$o$, $n$ARRAY['warehouse', 'processing']$n$);
SELECT pg_temp.fx('mm_allocate_auto_pick', $o$('in_stock', 'qc_pending', 'at_processing', 'at_mill')$o$, $n$('in_stock', 'qc_pending', 'at_processing')$n$);

SELECT pg_temp.fx('mm_get_store_challan', $o$        'batch_no', COALESCE(b.batch_no, NULLIF(trim(u.mill_snapshot->>'batch_no'), '')),
        'mill_snapshot', u.mill_snapshot,
$o$, $n$        'batch_no', u.lot_no,
$n$);
SELECT pg_temp.fx('mm_get_store_challan', $o$      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
$o$, '');

-- test fields: no capture site
SELECT pg_temp.fx('mm_save_type_test_fields', $o$    v_site := COALESCE(NULLIF(v_field->>'capture_site', ''), 'either');
    IF v_site NOT IN ('mill', 'warehouse', 'both', 'either') THEN v_site := 'either'; END IF;
$o$, '');
SELECT pg_temp.fx('mm_save_type_test_fields', $o$        capture_site = v_site,
$o$, '');
SELECT pg_temp.fx('mm_save_type_test_fields', $o$options, capture_site, seq, created_by$o$, $n$options, seq, created_by$n$);
SELECT pg_temp.fx('mm_save_type_test_fields', $o$v_options, v_site, v_seq,$o$, $n$v_options, v_seq,$n$);
SELECT pg_temp.fx('mm_save_type_test_fields', $o$        capture_site = EXCLUDED.capture_site,
$o$, '');
SELECT pg_temp.fx('mm_save_type_test_fields', $o$  v_site text;
$o$, '');
SELECT pg_temp.fx('mm_list_test_fields', $o$'options', f.options, 'capture_site', f.capture_site$o$, $n$'options', f.options$n$);

-- QC saves: site is processing or warehouse; no mill_batch scope
SELECT pg_temp.fx('mm_qc_save_test', $o$v_kind NOT IN ('mill_batch','process_challan','process_lot','in_challan','rolls')$o$, $n$v_kind NOT IN ('process_challan','process_lot','in_challan','rolls')$n$);
SELECT pg_temp.fx('mm_qc_save_test', $o$v_side NOT IN ('mill','processing','warehouse')$o$, $n$v_side NOT IN ('processing','warehouse')$n$);
SELECT pg_temp.fx('mm_qc_save_inspections', $o$v_side NOT IN ('mill','processing','warehouse')$o$, $n$v_side NOT IN ('processing','warehouse')$n$);

SELECT pg_temp.fx('mm_proc_get_challan', $o$public._mm_style_label(COALESCE(u.style_material_id, m.style_material_id))$o$, $n$public._mm_style_label(u.style_material_id)$n$);
SELECT pg_temp.fx('mm_proc_get_challan', $o$
        LEFT JOIN public.mm_mill_rolls m ON m.id = l.mill_roll_id WHERE l.challan_id = v_c.id$o$, $n$ WHERE l.challan_id = v_c.id$n$);

SELECT pg_temp.fx('mm_fabric_stock_summary', $o$  IF v_side IS NOT NULL AND v_side NOT IN ('mill', 'warehouse') THEN
    RETURN public._mm_err('INVALID', 'side must be mill or warehouse');$o$, $n$  IF v_side IS NOT NULL AND v_side NOT IN ('warehouse', 'processing') THEN
    RETURN public._mm_err('INVALID', 'side must be warehouse or processing');$n$);
-- ===== Part 6: send to processing, warehouse only =====
CREATE OR REPLACE FUNCTION public.mm_proc_send(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_actor uuid; v_fac public.mm_facilities%ROWTYPE; v_type public.mm_process_types%ROWTYPE;
  v_ids uuid[]; v_id uuid; v_no text; v_ch uuid; v_purpose text; v_parent uuid; v_reason text;
  v_unit public.mm_stock_units%ROWTYPE; v_rr public.mm_rolls%ROWTYPE; v_mach uuid; v_fv jsonb := '{}'::jsonb; v_f jsonb; v_val text;
  v_inhouse boolean;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  SELECT * INTO v_fac FROM public.mm_facilities WHERE factory_id = v_factory AND id = COALESCE(NULLIF(p_payload->>'unit_facility_id','')::uuid,
    CASE WHEN COALESCE((p_payload->>'inhouse')::boolean, false) THEN public._mm_inhouse_unit(v_factory) END);
  v_inhouse := FOUND AND v_fac.kind = 'mill' AND v_fac.ownership = 'internal';
  IF NOT FOUND OR NOT (v_fac.kind = 'process_unit' OR v_inhouse) THEN
    RETURN public._mm_err('INVALID','Pick in-house or a process vendor');
  END IF;
  IF NOT v_fac.is_active THEN RETURN public._mm_err('INACTIVE','That processing unit is inactive'); END IF;
  SELECT * INTO v_type FROM public.mm_process_types WHERE id = NULLIF(p_payload->>'process_type_id','')::uuid AND factory_id = v_factory;
  IF NOT FOUND OR NOT v_type.active THEN RETURN public._mm_err('INVALID','Pick an active process'); END IF;
  IF EXISTS (SELECT 1 FROM public.mm_facility_process_types WHERE facility_id = v_fac.id)
     AND NOT EXISTS (SELECT 1 FROM public.mm_facility_process_types WHERE facility_id = v_fac.id AND process_type_id = v_type.id) THEN
    RETURN public._mm_err('INVALID','This unit does not do ' || v_type.name);
  END IF;
  IF v_type.makes_fabric THEN RETURN public._mm_err('INVALID', v_type.name || ' makes fabric; receive the fabric at the gate instead'); END IF;
  IF v_inhouse AND NOT v_type.done_inhouse THEN
    RETURN public._mm_err('INVALID', v_type.name || ' is not done in-house. Tick In-house on the process in Settings.');
  END IF;
  IF v_fac.kind = 'process_unit' AND NOT v_type.done_external THEN
    RETURN public._mm_err('INVALID', v_type.name || ' is done in-house only');
  END IF;
  BEGIN v_mach := NULLIF(p_payload->>'machine_id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN public._mm_err('INVALID','Invalid machine'); END;
  IF v_mach IS NOT NULL THEN
    IF NOT v_inhouse THEN RETURN public._mm_err('INVALID','A machine is only picked for in-house processing'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.mm_machines m WHERE m.id = v_mach AND m.facility_id = v_fac.id AND m.is_active
                   AND (m.process_type_id IS NULL OR m.process_type_id = v_type.id)) THEN
      RETURN public._mm_err('INVALID','Pick a machine of ' || v_type.name);
    END IF;
  END IF;
  FOR v_f IN SELECT * FROM jsonb_array_elements(COALESCE(v_type.challan_fields, '[]'::jsonb)) LOOP
    v_val := NULLIF(btrim(COALESCE(p_payload->'field_values'->>(v_f->>'key'), p_payload->>(v_f->>'key'), '')), '');
    IF v_val IS NULL THEN
      IF COALESCE((v_f->>'required')::boolean, false) THEN RETURN public._mm_err('REQUIRED', (v_f->>'label') || ' is required'); END IF;
      CONTINUE;
    END IF;
    IF v_f->>'type' = 'number' AND v_val !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN public._mm_err('INVALID', (v_f->>'label') || ' must be a number');
    END IF;
    IF v_f->>'type' = 'select' AND NOT (to_jsonb(v_val) <@ COALESCE(v_f->'options', '[]'::jsonb)) THEN
      RETURN public._mm_err('INVALID', (v_f->>'label') || ': pick one of the options');
    END IF;
    v_fv := v_fv || jsonb_build_object(v_f->>'key', v_val);
  END LOOP;
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
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE roll_id = v_id AND factory_id = v_factory FOR UPDATE;
    IF NOT FOUND OR v_unit.status NOT IN ('in_stock','pending_qc') THEN
      RETURN public._mm_err('INVALID', v_rr.roll_code || ' is not in the warehouse');
    END IF;
    IF v_unit.on_hold THEN RETURN public._mm_err('HOLD', v_rr.roll_code || ' is on hold'); END IF;
    IF COALESCE(v_unit.qty_available,0) <= 0 THEN RETURN public._mm_err('INVALID', v_rr.roll_code || ' has no qty on hand'); END IF;
  END LOOP;

  v_no := NULLIF(btrim(COALESCE(p_payload->>'challan_no','')), '');
  IF v_no IS NULL THEN v_no := public._mm_next_doc(v_factory, 'PC'); END IF;
  BEGIN
    INSERT INTO public.mm_process_challans (factory_id, challan_no, origin, vendor_id, unit_facility_id, process_type_id,
      purpose, parent_challan_id, reprocess_reason, sent_at, unit_ref_no, remarks, created_by, updated_by)
    VALUES (v_factory, v_no, 'warehouse', NULL, v_fac.id, v_type.id, v_purpose, v_parent, v_reason,
      COALESCE(NULLIF(p_payload->>'sent_at','')::timestamptz, now()), NULLIF(p_payload->>'unit_ref_no',''),
      NULLIF(btrim(COALESCE(p_payload->>'remarks','')), ''), v_actor, v_actor)
    RETURNING id INTO v_ch;
  EXCEPTION WHEN unique_violation THEN RETURN public._mm_err('DUPLICATE','That challan number is already used');
  END;

  PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
  FOREACH v_id IN ARRAY v_ids LOOP
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
  END LOOP;
  UPDATE public.mm_process_challans
  SET target_color = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'target_color', '')), ''), v_fv->>'target_color'),
      target_shade = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'target_shade', '')), ''), v_fv->>'target_shade'),
      machine_id = v_mach, field_values = v_fv
  WHERE id = v_ch;
  RETURN public._mm_ok(jsonb_build_object('id', v_ch, 'challan_no', v_no, 'roll_count', array_length(v_ids,1)));
END $function$;
-- ===== Part 7: process return, always back to the warehouse =====
CREATE OR REPLACE FUNCTION public.mm_proc_return(p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid; v_actor uuid; v_ch public.mm_process_challans%ROWTYPE; v_ret uuid; v_ret_no text;
  v_seen uuid[] := '{}'; v_e jsonb; v_o jsonb; v_lid uuid; v_lids uuid[]; v_line public.mm_process_out_lines%ROWTYPE;
  v_unit public.mm_stock_units%ROWTYPE; v_child uuid; v_recv uuid; v_qty numeric;
  v_delta numeric; v_outputs jsonb := '[]'::jsonb; v_code text;
  v_sm uuid; v_ft uuid; v_first boolean; v_wh_units uuid[] := '{}';
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_proc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_actor := public._mm_actor_id();
  SELECT * INTO v_ch FROM public.mm_process_challans WHERE id = NULLIF(p_payload->>'challan_id','')::uuid AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND','Challan not found'); END IF;
  IF v_ch.status IN ('returned','void') THEN RETURN public._mm_err('CLOSED','This challan is closed'); END IF;

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
  VALUES (v_factory, v_ch.id, v_ret_no, COALESCE(NULLIF(p_payload->>'returned_at','')::timestamptz, now()), 'sender',
          NULLIF(p_payload->>'remarks',''), v_actor)
  RETURNING id INTO v_ret;

  PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
  v_recv := public._mm_recv_loc(v_factory);

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'same_rolls','[]'::jsonb)) LOOP
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = (v_e->>'out_line_id')::uuid;
    v_qty := NULLIF(v_e->>'qty','')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION '%: return qty must be greater than zero', v_line.unit_code; END IF;
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
    v_delta := v_qty - COALESCE(v_unit.qty_available, 0);
    -- order matters: qty_available may never exceed qty_received
    IF v_delta < -0.001 THEN
      PERFORM public._mm_ledger(v_factory, v_unit.id, 'QC_DEDUCT', -v_delta, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process loss');
      PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
    ELSIF v_delta > 0.001 THEN
      PERFORM public._mm_set_on_hand(v_unit.id, GREATEST(v_qty, COALESCE(v_unit.qty_received, 0)), true);
      PERFORM public._mm_ledger(v_factory, v_unit.id, 'ADJUST_PLUS', v_delta, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process gain');
      PERFORM public._mm_set_on_hand(v_unit.id, v_qty, true);
    ELSE
      PERFORM public._mm_ledger(v_factory, v_unit.id, 'TRANSFER', 0, 'at_process', 'pending_qc', NULL, v_recv, 'mm_process_returns', v_ret, 'process return');
    END IF;
    UPDATE public.mm_stock_units SET status = 'pending_qc', current_location_id = v_recv, length_m = v_qty,
      weight_kg = COALESCE(NULLIF(v_e->>'qty_kg','')::numeric, CASE WHEN lower(COALESCE(v_line.uom, '')) IN ('kg', 'kgs') THEN v_qty END, weight_kg),
      shade = COALESCE(NULLIF(v_e->>'shade',''), shade), color_ref = COALESCE(NULLIF(v_e->>'color_ref',''), NULLIF(btrim(v_ch.target_color),''), color_ref),
      qc_result = NULL, row_version = row_version + 1, updated_at = now(), updated_by = v_actor
    WHERE id = v_unit.id;
    v_wh_units := v_wh_units || v_unit.id;
    UPDATE public.mm_process_out_lines SET line_status = 'returned' WHERE id = v_line.id;
    INSERT INTO public.mm_process_return_lines (factory_id, challan_id, out_line_id, return_id, same_identity, unit_code, qty, uom,
      qty_kg, shade, color_ref, lot_no, stock_unit_id, stage_code, unit_form, width_form, grade, dye_lot, lot_id, created_by)
    VALUES (v_factory, v_ch.id, v_line.id, v_ret, true, v_line.unit_code, v_qty, v_line.uom,
      NULLIF(v_e->>'qty_kg','')::numeric, NULLIF(v_e->>'shade',''), COALESCE(NULLIF(v_e->>'color_ref',''), NULLIF(btrim(v_ch.target_color),'')), NULL,
      v_unit.id,
      NULLIF(upper(v_e->>'stage_code'),''), NULLIF(v_e->>'unit_form',''), NULLIF(v_e->>'width_form',''),
      NULLIF(v_e->>'grade',''), NULLIF(v_e->>'dye_lot',''), COALESCE(NULLIF(v_e->>'lot_id','')::uuid, v_line.lot_id), v_actor);
    v_outputs := v_outputs || jsonb_build_object('roll_id', v_line.roll_id, 'unit_code', v_line.unit_code, 'same', true);
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'re_rolled','[]'::jsonb)) LOOP
    v_lids := ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(v_e->'out_line_ids','[]'::jsonb)) x);
    IF COALESCE(array_length(v_lids,1),0) = 0 OR jsonb_array_length(COALESCE(v_e->'outputs','[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'Each re-rolled group needs the sent rolls and the new rolls';
    END IF;
    v_sm := NULL; v_ft := NULL; v_first := true;
    FOREACH v_lid IN ARRAY v_lids LOOP
      SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_lid;
      SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
      IF v_first THEN v_sm := v_unit.style_material_id; v_ft := v_unit.fabric_type_id;
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
      UPDATE public.mm_process_out_lines SET line_status = 'replaced' WHERE id = v_lid;
      v_first := false;
    END LOOP;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = v_lids[1];
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id;

    FOR v_o IN SELECT * FROM jsonb_array_elements(v_e->'outputs') LOOP
      v_code := NULLIF(btrim(COALESCE(v_o->>'unit_code','')), '');
      v_qty := NULLIF(v_o->>'qty','')::numeric;
      IF v_code IS NULL THEN RAISE EXCEPTION 'Each new roll needs a roll number'; END IF;
      IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION '%: qty must be greater than zero', v_code; END IF;
      IF EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.factory_id = v_factory AND lower(u.unit_code) = lower(v_code)
                 AND u.in_challan_id IS NOT DISTINCT FROM v_unit.in_challan_id) THEN
        RAISE EXCEPTION 'Roll % is already used', v_code;
      END IF;
      INSERT INTO public.mm_stock_units (factory_id, unit_code, unit_kind, style_material_id, source, uom, qty_uom, length_m, weight_kg,
        shade, lot_no, color_ref, attributes, status, current_location_id, fabric_type_id, in_challan_id,
        declared_width_in, qty_declared, qty_received, qty_available, parent_stock_unit_id, created_by, updated_by)
      VALUES (v_factory, v_code, v_unit.unit_kind, v_sm, v_unit.source, v_unit.uom, COALESCE(v_unit.qty_uom, v_unit.uom), v_qty,
        NULLIF(v_o->>'qty_kg','')::numeric, NULLIF(v_o->>'shade',''), v_unit.lot_no, COALESCE(NULLIF(v_o->>'color_ref',''), NULLIF(btrim(v_ch.target_color),''), v_unit.color_ref),
        COALESCE(v_unit.attributes, '{}'::jsonb), 'pending_qc', v_recv, v_ft, v_unit.in_challan_id,
        v_unit.declared_width_in, v_qty, v_qty, 0, v_unit.id, v_actor, v_actor)
      RETURNING id INTO v_child;
      PERFORM public._mm_ledger(v_factory, v_child, 'RECEIPT_IN', v_qty, 'pending_qc', 'pending_qc', v_recv, v_recv, 'mm_process_returns', v_ret, 'process return (re-rolled)');
      v_wh_units := v_wh_units || v_child;
      INSERT INTO public.mm_process_return_lines (factory_id, challan_id, out_line_id, return_id, same_identity, unit_code, qty, uom,
        qty_kg, shade, color_ref, stock_unit_id, stage_code, unit_form, width_form, grade, dye_lot, lot_id,
        parent_out_line_ids, created_by)
      VALUES (v_factory, v_ch.id, v_lids[1], v_ret, false, v_code, v_qty, v_line.uom, NULLIF(v_o->>'qty_kg','')::numeric,
        NULLIF(v_o->>'shade',''), COALESCE(NULLIF(v_o->>'color_ref',''), NULLIF(btrim(v_ch.target_color),'')),
        v_child,
        NULLIF(upper(v_o->>'stage_code'),''), NULLIF(v_o->>'unit_form',''), NULLIF(v_o->>'width_form',''),
        NULLIF(v_o->>'grade',''), NULLIF(v_o->>'dye_lot',''), COALESCE(NULLIF(v_o->>'lot_id','')::uuid, v_line.lot_id), v_lids, v_actor);
      v_outputs := v_outputs || jsonb_build_object('unit_code', v_code, 'same', false,
        'roll_id', (SELECT roll_id FROM public.mm_stock_units WHERE id = v_child));
    END LOOP;
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'write_offs','[]'::jsonb)) LOOP
    IF NULLIF(btrim(COALESCE(v_e->>'reason','')), '') IS NULL THEN RAISE EXCEPTION 'A write-off needs a reason'; END IF;
    SELECT * INTO v_line FROM public.mm_process_out_lines WHERE id = (v_e->>'out_line_id')::uuid;
    SELECT * INTO v_unit FROM public.mm_stock_units WHERE id = v_line.stock_unit_id FOR UPDATE;
    IF COALESCE(v_unit.qty_available,0) > 0 THEN
      PERFORM public._mm_ledger(v_factory, v_unit.id, 'WRITE_OFF', v_unit.qty_available, 'at_process', 'written_off', NULL, NULL,
        'mm_process_returns', v_ret, 'written off at process: ' || (v_e->>'reason'));
    END IF;
    UPDATE public.mm_stock_units SET status = 'written_off', current_location_id = NULL,
      row_version = row_version + 1, updated_at = now(), updated_by = v_actor WHERE id = v_unit.id;
    UPDATE public.mm_process_out_lines SET line_status = 'written_off', write_off_reason = btrim(v_e->>'reason') WHERE id = v_line.id;
  END LOOP;

  UPDATE public.mm_process_return_lines rl
  SET actual_gsm = NULLIF(e->>'actual_gsm', '')::numeric, actual_width_in = NULLIF(e->>'actual_width_in', '')::numeric
  FROM jsonb_array_elements(COALESCE(p_payload->'same_rolls', '[]'::jsonb)) e
  WHERE rl.return_id = v_ret AND rl.same_identity AND rl.out_line_id = (e->>'out_line_id')::uuid
    AND (NULLIF(e->>'actual_gsm', '') IS NOT NULL OR NULLIF(e->>'actual_width_in', '') IS NOT NULL);
  UPDATE public.mm_process_return_lines rl
  SET actual_gsm = NULLIF(o->>'actual_gsm', '')::numeric, actual_width_in = NULLIF(o->>'actual_width_in', '')::numeric
  FROM jsonb_array_elements(COALESCE(p_payload->'re_rolled', '[]'::jsonb)) g, jsonb_array_elements(COALESCE(g->'outputs', '[]'::jsonb)) o
  WHERE rl.return_id = v_ret AND NOT rl.same_identity AND lower(rl.unit_code) = lower(btrim(o->>'unit_code'))
    AND (NULLIF(o->>'actual_gsm', '') IS NOT NULL OR NULLIF(o->>'actual_width_in', '') IS NOT NULL);
  PERFORM public._mm_process_refresh(v_ch.id);
  IF array_length(v_wh_units,1) > 0 THEN PERFORM public._mm_apply_clearance(v_wh_units); END IF;

  RETURN public._mm_ok(jsonb_build_object('return_id', v_ret, 'return_no', v_ret_no, 'outputs', v_outputs));
EXCEPTION WHEN raise_exception THEN RETURN public._mm_err('INVALID', SQLERRM);
END $function$;
-- ===== Part 8: legacy inspection save (floor + warehouse testing), warehouse only =====
SELECT pg_temp.fx('mm_save_inspections', $o$v_kind NOT IN ('mill_batch', 'in_challan', 'process_challan')$o$, $n$v_kind NOT IN ('in_challan', 'process_challan')$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$  IF v_kind = 'mill_batch' THEN
    SELECT * INTO v_batch FROM public.mm_mill_batches WHERE id = p_scope_id AND factory_id = v_factory;
    IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Mill batch not found'); END IF;
    v_site := 'mill';
    v_occasion := 'after_allocate';
  ELSIF v_kind = 'in_challan' THEN$o$, $n$  IF v_kind = 'in_challan' THEN$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$    IF v_ch.source = 'mill' AND v_ch.status NOT IN ('received', 'partial', 'short_closed') THEN
      RETURN public._mm_err('INVALID', 'Receive this mill challan before testing');
    END IF;
$o$, '');
SELECT pg_temp.fx('mm_save_inspections', $o$    v_site := v_proc.origin;$o$, $n$    v_site := 'warehouse';$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$    v_roll := NULL;
    v_unit := NULL;
    v_mill_roll := NULL;
    v_stock := NULL;
    v_mill_batch := NULL;
$o$, $n$    v_unit := NULL;
    v_stock := NULL;
$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$    IF v_kind = 'mill_batch' THEN
      SELECT * INTO v_roll FROM public.mm_mill_rolls
      WHERE id = v_id AND factory_id = v_factory AND mill_batch_id = v_batch.id FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'A selected roll was not found on this batch'); END IF;
      IF v_roll.status IS DISTINCT FROM 'draft' OR v_roll.in_challan_id IS NOT NULL OR public._mm_mill_at_process(v_roll.id) THEN
        RETURN public._mm_err('INVALID', 'Inspect only rolls still at the mill');
      END IF;
      v_mill_roll := v_roll.id;
      v_mill_batch := v_roll.mill_batch_id;
    ELSIF v_kind = 'in_challan' THEN$o$, $n$    IF v_kind = 'in_challan' THEN$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$      IF v_proc.origin = 'mill' THEN
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
$o$, '');
SELECT pg_temp.fx('mm_save_inspections', $o$        v_stock := v_unit.id;
      END IF;
    END IF;$o$, $n$        v_stock := v_unit.id;
    END IF;$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$          (v_mill_roll IS NOT NULL AND i.mill_roll_id = v_mill_roll)
          OR (v_stock IS NOT NULL AND i.stock_unit_id = v_stock)$o$, $n$          (v_stock IS NOT NULL AND i.stock_unit_id = v_stock)$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$COALESCE(v_stock, v_mill_roll)$o$, $n$v_stock$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$COALESCE(v_unit.status, v_roll.status)$o$, $n$v_unit.status$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$        mill_batch_id, mill_roll_id, in_challan_id, process_challan_id, stock_unit_id,$o$, $n$        in_challan_id, process_challan_id, stock_unit_id,$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$        v_mill_batch, v_mill_roll,
$o$, '');
SELECT pg_temp.fx('mm_save_inspections', $o$    IF v_mill_roll IS NOT NULL THEN
      UPDATE public.mm_mill_rolls SET
        qc_result = v_final,
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_mill_roll;
    END IF;

$o$, '');
SELECT pg_temp.fx('mm_save_inspections', $o$  ELSIF v_kind = 'process_challan' AND v_proc.origin = 'warehouse' THEN$o$, $n$  ELSIF v_kind = 'process_challan' THEN$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$  IF NOT v_qc AND v_kind = 'process_challan' AND v_proc.origin = 'warehouse' THEN$o$, $n$  IF NOT v_qc AND v_kind = 'process_challan' THEN$n$);
SELECT pg_temp.fx('mm_save_inspections', $o$  v_batch public.mm_mill_batches%ROWTYPE;
$o$, '');
SELECT pg_temp.fx('mm_save_inspections', $o$  v_roll public.mm_mill_rolls%ROWTYPE;
$o$, '');
SELECT pg_temp.fx('mm_save_inspections', $o$  v_mill_batch uuid;
  v_mill_roll uuid;
$o$, '');
-- ===== Part 9: boards, style views, receive, roll sync =====
SELECT pg_temp.fx('mm_get_rack_ops_board', $o$        'mill_batch_id', u.mill_batch_id, 'batch_no', b.batch_no,$o$, $n$        'batch_no', u.lot_no,$n$, 3);
SELECT pg_temp.fx('mm_get_rack_ops_board', $o$      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
$o$, '', 3);

SELECT pg_temp.fx('mm_get_warehouse_dispatch_board', $o$'mill_snapshot', u.mill_snapshot, 'source', u.source,$o$, $n$'source', u.source,$n$, 2);

SELECT pg_temp.fx('mm_get_style_warehouse', $o$'mill_snapshot', u.mill_snapshot, $o$, '');
SELECT pg_temp.fx('mm_get_style_warehouse', $o$CASE WHEN u.status = 'draft' THEN 'mill' WHEN u.status = 'in_transit'$o$, $n$CASE WHEN u.status = 'in_transit'$n$);
SELECT pg_temp.fx('mm_get_style_warehouse', $o$        COALESCE((SELECT count(*)::int FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.source = 'mill' AND u.status = 'draft' AND u.in_challan_id IS NULL), 0) AS rolls_at_mill,
        COALESCE((SELECT sum(u.qty_available) FROM public.mm_stock_units u WHERE u.style_material_id = sm.id AND u.source = 'mill' AND u.status = 'draft' AND u.in_challan_id IS NULL), 0) AS qty_at_mill,
$o$, '');
SELECT pg_temp.fx('mm_get_style_warehouse', $o$        0 AS rolls_at_mill, 0::numeric AS qty_at_mill,
$o$, '');

SELECT pg_temp.fx('mm_get_warehouse_dashboard', $o$          SELECT jsonb_build_object(
            'kind', 'mill', 'id', c.id, 'label',
            'Batch ' || c.challan_no || ' — ' || COALESCE(o.style_name, 'Unallocated') ||
            CASE WHEN cw.name IS NULL THEN '' ELSE ' / ' || cw.name END || ' — ' ||
            (SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = c.id) || ' rolls — sent ' ||
            CASE WHEN c.sent_at IS NULL THEN 'today'
                 WHEN c.sent_at > now() - interval '1 day' THEN 'today'
                 ELSE (EXTRACT(DAY FROM now() - c.sent_at)::int)::text || ' days ago' END,
            'ts', c.sent_at
          ) AS x, c.sent_at AS ts
          FROM public.mm_in_challans c
          LEFT JOIN public.mm_style_materials sm ON sm.id = c.style_material_id
          LEFT JOIN public.style_orders o ON o.id = sm.order_id
          LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id
          WHERE c.factory_id = v_factory AND c.source = 'mill' AND c.status = 'pending'
          UNION ALL
$o$, '');
SELECT pg_temp.fx('mm_get_warehouse_dashboard', $o$    'internal_pending', (
      SELECT count(*) FROM public.mm_in_challans
      WHERE factory_id = v_factory AND source = 'mill' AND status = 'pending'
    ),
$o$, '');

SELECT pg_temp.fx('mm_style_fabric_position', $o$COALESCE(cm.mill_short_closed, false) AS short_closed$o$, $n$false AS short_closed$n$);
SELECT pg_temp.fx('mm_style_fabric_position', $o$        COALESCE(sum(q.q) FILTER (WHERE q.side = 'mill'), 0) AS mill_qty,
        count(*) FILTER (WHERE q.side = 'mill' AND q.unit_form = 'roll')::int AS mill_rolls,
        count(*) FILTER (WHERE q.side = 'mill' AND q.unit_form = 'lap')::int AS mill_laps,
$o$, '');
SELECT pg_temp.fx('mm_style_fabric_position', $o$      'at_mill', jsonb_build_object('qty', o.mill_qty, 'rolls', o.mill_rolls, 'laps', o.mill_laps),
$o$, '');

SELECT pg_temp.fx('mm_wh_receive', $o$AND mill_batch_id IS NULL AND unit_code = v_code$o$, $n$AND unit_code = v_code$n$);

-- roll props: warehouse copy only
CREATE OR REPLACE FUNCTION public._mm_roll_props_sync()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.roll_id IS NULL OR TG_TABLE_NAME <> 'mm_stock_units' THEN RETURN NULL; END IF;
  UPDATE public.mm_rolls SET
    shade = NULLIF(btrim(COALESCE(NEW.shade, '')), ''),
    length_m = NEW.length_m,
    weight_kg = NEW.weight_kg,
    width_in = COALESCE(NEW.declared_width_in, width_in),
    attributes = COALESCE(NEW.attributes, '{}'::jsonb),
    allocated_style_material_id = NEW.style_material_id
  WHERE id = NEW.roll_id
    AND (shade IS DISTINCT FROM NULLIF(btrim(COALESCE(NEW.shade, '')), '') OR length_m IS DISTINCT FROM NEW.length_m
         OR weight_kg IS DISTINCT FROM NEW.weight_kg OR width_in IS DISTINCT FROM COALESCE(NEW.declared_width_in, width_in)
         OR attributes IS DISTINCT FROM COALESCE(NEW.attributes, '{}'::jsonb)
         OR allocated_style_material_id IS DISTINCT FROM NEW.style_material_id);
  RETURN NULL;
END $function$;

CREATE OR REPLACE VIEW public.mm_roll_drift WITH (security_invoker = true) AS
SELECT r.id AS roll_id, r.roll_code, r.factory_id,
       'warehouse'::text AS custody,
       r.shade AS roll_shade, u.shade AS custody_shade,
       r.length_m AS roll_length, u.length_m AS custody_length,
       r.color_name AS roll_colour, u.color_ref AS custody_colour,
       r.allocated_style_material_id AS roll_style, u.style_material_id AS custody_style
FROM public.mm_rolls r
JOIN public.mm_stock_units u ON u.roll_id = r.id
WHERE r.shade IS DISTINCT FROM NULLIF(btrim(COALESCE(u.shade, '')), '')
   OR r.length_m IS DISTINCT FROM u.length_m
   OR r.allocated_style_material_id IS DISTINCT FROM u.style_material_id
   OR (NULLIF(btrim(COALESCE(u.color_ref, '')), '') IS NOT NULL AND r.color_name IS DISTINCT FROM btrim(u.color_ref));
COMMIT;
