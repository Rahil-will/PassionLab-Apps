CREATE OR REPLACE FUNCTION public.mm_floor_call(
  p_factory_id uuid,
  p_user_id uuid,
  p_fn text,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
  END IF;

  RETURN public._mm_err('FORBIDDEN', 'Function is not on the floor allowlist');
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_floor_call(uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_floor_call(uuid, uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.mm_floor_call(uuid, uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mm_floor_call(uuid, uuid, text, jsonb) TO service_role;;
