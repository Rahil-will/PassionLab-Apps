CREATE OR REPLACE FUNCTION public._mm_next_grn_no(p_factory uuid, p_on date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_vendor_grn(
  p_style jsonb,
  p_fabric_type_id uuid,
  p_supplier_name text,
  p_invoice_ref text,
  p_grn_date date,
  p_uom text,
  p_color_ref text,
  p_lot text,
  p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
$fn$;

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_vendor_grn(
  p_fabric_type_id uuid,
  p_supplier_name text,
  p_uom text,
  p_color_ref text,
  p_lot_no text,
  p_rolls jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  RETURN public.mm_save_vendor_grn(
    NULL, p_fabric_type_id, p_supplier_name, NULL, CURRENT_DATE, p_uom, p_color_ref, p_lot_no, p_rolls
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_save_vendor_grn(jsonb, uuid, text, text, date, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_save_vendor_grn(jsonb, uuid, text, text, date, text, text, text, jsonb) TO authenticated, service_role;;
