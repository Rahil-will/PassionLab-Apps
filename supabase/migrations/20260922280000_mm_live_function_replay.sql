-- DO NOT APPLY. Historical snapshot only.
-- Later migrations dropped mm_save_vendor_in_challan, mm_send_to_warehouse,
-- mm_list_putaway_queue, mm_list_warehouse_locations, mm_save_warehouse_location,
-- and mm_deactivate_warehouse_location, and renamed mm_resolve_style_material to
-- _mm_resolve_style_material. Re-applying this file would recreate those RPCs.
-- Live replay of material functions whose body is missing from, or differs from, the latest CREATE in earlier migrations.
-- Bodies are pg_get_functiondef from project xtfljldeceonqyzgkoyp.
-- A store challan does not refuse missing or mixed shade bands.
-- These three tables exist live and are not created by an earlier migration.

CREATE TABLE IF NOT EXISTS public.mm_defect_types (
  id uuid DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mm_fpt_thresholds (
  id uuid DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL,
  buyer_id uuid,
  fabric_type_id uuid,
  max_points numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mm_inspection_defects (
  id uuid DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  defect_type_id uuid,
  defect_code text,
  points integer NOT NULL,
  size_band text,
  hole boolean DEFAULT false,
  position_from numeric,
  created_at timestamp with time zone DEFAULT now()
);

CREATE OR REPLACE FUNCTION public._mm_fpt_score(p_points numeric, p_length numeric, p_length_uom text, p_width numeric, p_width_uom text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN COALESCE(p_length, 0) <= 0 OR COALESCE(p_width, 0) <= 0 THEN NULL
    ELSE round(
      COALESCE(p_points, 0) * 3600 / (
        (CASE WHEN lower(COALESCE(p_length_uom, 'm')) = 'yd' THEN p_length ELSE p_length / 0.9144 END)
        * (CASE WHEN lower(COALESCE(p_width_uom, 'in')) = 'cm' THEN p_width / 2.54 ELSE p_width END)
      ), 2)
  END;
$function$;

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
  SELECT t.max_points INTO v_points
  FROM public.mm_fpt_thresholds t
  WHERE t.factory_id = v_factory AND t.fabric_type_id = v_ft AND t.buyer_id = v_buyer;
  IF v_points IS NULL THEN
    SELECT f.fpt_max_points INTO v_points FROM public.mm_fabric_types f WHERE f.id = v_ft;
  END IF;
  RETURN COALESCE(v_points, 40);
END;
$function$;

CREATE OR REPLACE FUNCTION public._mm_next_grn_no(p_factory uuid, p_on date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_n integer;
BEGIN
  v_key := 'GRN-' || to_char(COALESCE(p_on, CURRENT_DATE), 'YYMM');
  INSERT INTO public.mm_doc_sequences (factory_id, doc_type, next_no)
  VALUES (p_factory, v_key, 0)
  ON CONFLICT (factory_id, doc_type) DO NOTHING;
  UPDATE public.mm_doc_sequences
  SET next_no = next_no + 1
  WHERE factory_id = p_factory AND doc_type = v_key
  RETURNING next_no INTO v_n;
  RETURN v_key || '-' || lpad(v_n::text, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public._mm_set_on_hand(p_unit_id uuid, p_qty numeric, p_received boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(p_received, false) THEN
    RETURN;
  END IF;
  UPDATE public.mm_stock_units
  SET qty_received = p_qty,
      qty_declared = COALESCE(qty_declared, p_qty),
      updated_at = now(),
      updated_by = public._mm_actor_id()
  WHERE id = p_unit_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._mm_unit_qty_received(p_unit mm_stock_units)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mm_stock_units' AND column_name = 'qty_received'
  ) THEN
    RETURN NULLIF(to_jsonb(p_unit)->>'qty_received', '')::numeric;
  END IF;
  RETURN p_unit.length_m;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_stock_unit_qty_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.mm_stock_ledger (
    factory_id, stock_unit_id, entry_type, qty, qty_delta, qty_after, qty_uom, balance_after,
    status_after, location_after, note
  ) VALUES (
    NEW.factory_id, NEW.id, 'RECEIPT_IN',
    COALESCE(NEW.qty_available, 0), COALESCE(NEW.qty_available, 0),
    COALESCE(NEW.qty_available, 0), COALESCE(NEW.qty_uom, 'm'), COALESCE(NEW.qty_available, 0),
    NEW.status, NEW.current_location_id, 'opening balance'
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_floor_call(p_factory_id uuid, p_user_id uuid, p_fn text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_args jsonb := COALESCE(p_args, '{}'::jsonb);
  v_ids uuid[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN public._mm_err('FORBIDDEN', 'Floor dispatch is service role only');
  END IF;
  IF p_user_id IS NULL OR p_factory_id IS NULL THEN
    RETURN public._mm_err('FORBIDDEN', 'Factory and user are required');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.factory_id = p_factory_id AND p.status = 'Active'
  ) THEN
    RETURN public._mm_err('FORBIDDEN', 'Floor user is not active in this factory');
  END IF;
  PERFORM set_config('mm.actor_user', p_user_id::text, true);
  PERFORM set_config('mm.actor_factory', p_factory_id::text, true);

  IF v_args ? 'unit_ids' AND jsonb_typeof(v_args->'unit_ids') = 'array' THEN
    SELECT COALESCE(array_agg(x::uuid), ARRAY[]::uuid[]) INTO v_ids
    FROM jsonb_array_elements_text(v_args->'unit_ids') AS t(x);
  END IF;

  IF p_fn = 'mm_floor_gaps' THEN
    RETURN public.mm_floor_gaps();
  ELSIF p_fn = 'mm_list_receive_catalog' THEN
    RETURN public.mm_list_receive_catalog();
  ELSIF p_fn = 'mm_list_floor_grns' THEN
    RETURN public.mm_list_floor_grns(NULLIF(v_args->>'source', ''));
  ELSIF p_fn = 'mm_list_in_challans' THEN
    RETURN public.mm_list_in_challans(NULLIF(v_args->>'source', ''), NULLIF(v_args->>'status', ''));
  ELSIF p_fn = 'mm_get_in_challan_rolls' THEN
    RETURN public.mm_get_in_challan_rolls((v_args->>'id')::uuid);
  ELSIF p_fn = 'mm_get_expected_board' THEN
    RETURN public.mm_get_expected_board(
      NULLIF(v_args->>'status', ''),
      NULLIF(v_args->>'search', ''),
      COALESCE((v_args->>'limit')::int, 50),
      COALESCE((v_args->>'offset')::int, 0)
    );
  ELSIF p_fn = 'mm_save_vendor_grn' THEN
    RETURN public.mm_save_vendor_grn(
      CASE WHEN jsonb_typeof(v_args->'style') = 'object' THEN v_args->'style' ELSE NULL END,
      NULLIF(v_args->>'fabric_type_id', '')::uuid,
      v_args->>'supplier_name',
      v_args->>'invoice_ref',
      NULLIF(v_args->>'grn_date', '')::date,
      v_args->>'uom',
      v_args->>'color_ref',
      v_args->>'lot',
      COALESCE(v_args->'rolls', '[]'::jsonb)
    );
  ELSIF p_fn = 'mm_confirm_received_lengths' THEN
    RETURN public.mm_confirm_received_lengths((v_args->>'challan_id')::uuid, COALESCE(v_args->'lengths', '[]'::jsonb));
  ELSIF p_fn = 'mm_receive_mill_floor' THEN
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
  ELSIF p_fn = 'mm_save_vendor_roll_tests' THEN
    RETURN public.mm_save_vendor_roll_tests((v_args->>'id')::uuid, COALESCE(v_args->'roll_results', '[]'::jsonb));
  ELSIF p_fn = 'mm_save_warehouse_inspections' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_args->'rolls', '[]'::jsonb)) r
      WHERE jsonb_typeof(r->'defects') = 'array' AND jsonb_array_length(r->'defects') > 0
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'mm_inspection_defects'
    ) THEN
      RETURN public._mm_err('WAITING_P3', 'Defect scoring is not available yet');
    END IF;
    RETURN public.mm_save_warehouse_inspections((v_args->>'id')::uuid, COALESCE(v_args->'rolls', '[]'::jsonb));
  ELSIF p_fn = 'mm_list_inspection_queue' THEN
    RETURN public.mm_list_inspection_queue();
  ELSIF p_fn = 'mm_exclude_roll' THEN
    RETURN public.mm_exclude_roll((v_args->>'unit_id')::uuid);
  ELSIF p_fn = 'mm_get_rack_ops_board' THEN
    RETURN public.mm_get_rack_ops_board();
  ELSIF p_fn = 'mm_list_warehouse_stock' THEN
    RETURN public.mm_list_warehouse_stock(
      NULLIF(v_args->>'search', ''),
      NULLIF(v_args->>'location', ''),
      NULLIF(v_args->>'buyer', ''),
      COALESCE((v_args->>'page')::int, 1),
      COALESCE((v_args->>'page_size')::int, 50)
    );
  ELSIF p_fn = 'mm_list_warehouse_locations' THEN
    RETURN public.mm_list_warehouse_locations();
  ELSIF p_fn = 'mm_list_putaway_queue' THEN
    RETURN public.mm_list_putaway_queue();
  ELSIF p_fn = 'mm_list_rack_master' THEN
    RETURN public.mm_list_rack_master();
  ELSIF p_fn = 'mm_putaway_rolls' THEN
    RETURN public.mm_putaway_rolls(v_ids, NULLIF(v_args->>'location_id', '')::uuid);
  ELSIF p_fn = 'mm_allocate_rolls_to_style' THEN
    RETURN public.mm_allocate_rolls_to_style(
      v_ids,
      NULLIF(v_args->>'order_id', '')::uuid,
      NULLIF(v_args->>'colorway_id', '')::uuid,
      NULLIF(v_args->>'colorway_material_id', '')::uuid
    );
  ELSIF p_fn = 'mm_unallocate_rolls' THEN
    RETURN public.mm_unallocate_rolls(v_ids);
  ELSIF p_fn = 'mm_create_store_challan' THEN
    RETURN public.mm_create_store_challan(
      NULLIF(v_args->>'style_material_id', '')::uuid,
      v_ids,
      NULLIF(v_args->>'challan_no', ''),
      NULLIF(v_args->>'reference_no', ''),
      NULLIF(v_args->>'sent_at', '')::date,
      NULLIF(v_args->>'remarks', '')
    );
  ELSIF p_fn = 'mm_list_store_challans' THEN
    RETURN public.mm_list_store_challans(NULLIF(v_args->>'status', ''));
  ELSIF p_fn = 'mm_list_store_stock' THEN
    RETURN public.mm_list_store_stock(NULLIF(v_args->>'style_material_id', '')::uuid);
  ELSIF p_fn = 'mm_list_cutting_rolls' THEN
    RETURN public.mm_list_cutting_rolls(
      NULLIF(v_args->>'order_id', '')::uuid,
      NULLIF(v_args->>'colorway_id', '')::uuid,
      NULLIF(v_args->>'style_material_id', '')::uuid,
      NULLIF(v_args->>'search', '')
    );
  ELSIF p_fn = 'mm_save_lay_consumptions' THEN
    RETURN public.mm_save_lay_consumptions(
      (v_args->>'lay_id')::uuid,
      COALESCE(v_args->'rows', '[]'::jsonb),
      NULLIF(v_args->>'style_material_id', '')::uuid
    );
  ELSIF p_fn = 'mm_get_lay_report' THEN
    RETURN public.mm_get_lay_report((v_args->>'lay_id')::uuid);
  ELSIF p_fn = 'mm_list_test_fields' THEN
    RETURN public.mm_list_test_fields(NULLIF(v_args->>'fabric_type_id', '')::uuid);
  ELSIF p_fn = 'mm_receive_mill_bundle' THEN
    RETURN public.mm_receive_mill_bundle(v_args);
  ELSIF p_fn = 'mm_short_close_in_challan' THEN
    RETURN public.mm_short_close_in_challan((v_args->>'id')::uuid, v_args->>'reason');
  END IF;

  RETURN public._mm_err('FORBIDDEN', 'Function is not on the floor allowlist');
END;
$function$;

CREATE OR REPLACE FUNCTION public.mm_save_vendor_grn(p_style jsonb, p_fabric_type_id uuid, p_supplier_name text, p_invoice_ref text, p_grn_date date, p_uom text, p_color_ref text, p_lot text, p_rolls jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_actor uuid;
  v_sup text;
  v_inv text;
  v_ft uuid;
  v_sm_id uuid;
  v_sm jsonb;
  v_sm_ft uuid;
  v_recv uuid;
  v_ch uuid;
  v_no text;
  v_rolls jsonb := '[]'::jsonb;
  v_row jsonb;
  v_len numeric;
  v_n integer;
  v_warn text;
  v_unit public.mm_stock_units%ROWTYPE;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  v_actor := public._mm_actor_id();
  v_sup := NULLIF(btrim(COALESCE(p_supplier_name, '')), '');
  IF v_sup IS NULL THEN RETURN public._mm_err('REQUIRED', 'Supplier name is required'); END IF;
  SELECT id INTO v_ft FROM public.mm_fabric_types
  WHERE id = p_fabric_type_id AND factory_id = v_factory AND is_active;
  IF v_ft IS NULL THEN RETURN public._mm_err('REQUIRED', 'Fabric type is required'); END IF;
  IF p_style IS NOT NULL AND jsonb_typeof(p_style) = 'object' AND p_style <> '{}'::jsonb THEN
    v_sm := public.mm_resolve_style_material(
      NULLIF(p_style->>'order_id', '')::uuid,
      NULLIF(p_style->>'colorway_id', '')::uuid,
      NULLIF(p_style->>'colorway_material_id', '')::uuid
    );
    IF COALESCE(v_sm->>'ok', 'false') <> 'true' THEN RETURN v_sm; END IF;
    v_sm_id := (v_sm->'data'->>'id')::uuid;
    SELECT fabric_type_id INTO v_sm_ft FROM public.mm_style_materials WHERE id = v_sm_id;
    IF v_sm_ft IS DISTINCT FROM v_ft THEN
      RETURN public._mm_err('INVALID', 'Fabric type must match the style fabric');
    END IF;
  END IF;
  IF jsonb_typeof(COALESCE(p_rolls, '[]'::jsonb)) <> 'array' OR jsonb_array_length(p_rolls) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Add at least one roll');
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rolls) LOOP
    v_len := COALESCE(NULLIF(v_row->>'length', '')::numeric, NULLIF(v_row->>'length_m', '')::numeric);
    IF v_len IS NULL OR v_len <= 0 THEN
      RETURN public._mm_err('REQUIRED', 'Each roll needs a length');
    END IF;
    v_rolls := v_rolls || jsonb_build_array(
      jsonb_build_object(
        'length_m', v_len,
        'fabric_type_id', v_ft,
        'uom', COALESCE(NULLIF(btrim(COALESCE(p_uom, '')), ''), 'm'),
        'color_ref', COALESCE(NULLIF(btrim(COALESCE(v_row->>'color_ref', '')), ''), NULLIF(btrim(COALESCE(p_color_ref, '')), '')),
        'lot_no', COALESCE(NULLIF(btrim(COALESCE(v_row->>'lot_no', '')), ''), NULLIF(btrim(COALESCE(p_lot, '')), '')),
        'shade', NULLIF(btrim(COALESCE(v_row->>'shade', '')), ''),
        'attributes', jsonb_strip_nulls(jsonb_build_object(
          'roll_no', NULLIF(btrim(COALESCE(v_row->>'roll_no', '')), ''),
          'width_in', NULLIF(v_row->>'width_in', '')
        ))
      )
    );
  END LOOP;
  v_inv := NULLIF(btrim(COALESCE(p_invoice_ref, '')), '');
  IF v_inv IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.mm_in_challans c
    WHERE c.factory_id = v_factory AND c.source = 'vendor'
      AND lower(c.supplier_name) = lower(v_sup)
      AND c.invoice_ref = v_inv
  ) THEN
    v_warn := 'This supplier invoice was already received';
  END IF;
  PERFORM public._mm_seed_ops_locations(v_factory, v_actor);
  v_recv := public._mm_recv_loc(v_factory);
  v_no := public._mm_next_grn_no(v_factory, COALESCE(p_grn_date, CURRENT_DATE));
  INSERT INTO public.mm_in_challans (
    factory_id, challan_no, grn_no, source, style_material_id, supplier_name,
    invoice_ref, reference_no, status, received_at, received_by, created_by, updated_by
  ) VALUES (
    v_factory, v_no, v_no, 'vendor', v_sm_id, v_sup,
    v_inv, v_inv, 'received', now(), v_actor, v_actor, v_actor
  ) RETURNING id INTO v_ch;
  BEGIN
    v_n := public._mm_insert_rolls(v_factory, v_sm_id, v_ch, 'vendor', 'pending_qc', v_recv, v_rolls, false);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('INVALID', SQLERRM);
  END;
  UPDATE public.mm_stock_units u
  SET declared_width_in = NULLIF(u.attributes->>'width_in', '')::numeric,
      created_by = v_actor,
      updated_by = v_actor
  WHERE u.in_challan_id = v_ch;
  FOR v_unit IN SELECT * FROM public.mm_stock_units WHERE in_challan_id = v_ch LOOP
    PERFORM public._mm_set_on_hand(v_unit.id, v_unit.length_m, true);
  END LOOP;
  RETURN public._mm_ok(jsonb_build_object(
    'id', v_ch, 'challan_no', v_no, 'grn_no', v_no, 'roll_count', v_n, 'warning', v_warn
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_save_vendor_grn(jsonb, uuid, text, text, date, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_grn(jsonb, uuid, text, text, date, text, text, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mm_floor_call(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_floor_call(uuid, uuid, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public._mm_fpt_score(numeric, numeric, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mm_fpt_score(numeric, numeric, text, numeric, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._mm_fpt_threshold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mm_fpt_threshold(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._mm_next_grn_no(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mm_next_grn_no(uuid, date) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._mm_set_on_hand(uuid, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mm_set_on_hand(uuid, numeric, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._mm_unit_qty_received(mm_stock_units) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mm_unit_qty_received(mm_stock_units) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mm_stock_unit_qty_open() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_stock_unit_qty_open() TO authenticated, service_role;
