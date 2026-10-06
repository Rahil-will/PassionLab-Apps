CREATE OR REPLACE FUNCTION public.mm_list_test_fields(p_fabric_type_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_qc');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_factory := public._mm_require_ops('mm_inventory');
    EXCEPTION WHEN OTHERS THEN
      RETURN public._mm_err('ERROR', SQLERRM);
    END;
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', f.id, 'key', f.key, 'label', f.label, 'data_type', f.data_type,
      'options', f.options, 'capture_site', f.capture_site
    ) ORDER BY f.seq, f.label)
    FROM public.mm_type_test_fields f
    WHERE f.factory_id = v_factory AND f.type_id = p_fabric_type_id AND f.is_active
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.mm_receive_mill_bundle(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_recv jsonb;
  v_len jsonb;
  v_ins jsonb;
  v_rolls jsonb := COALESCE(p_payload->'inspection_rolls', '[]'::jsonb);
BEGIN
  v_recv := public.mm_receive_mill_floor(
    NULLIF(p_payload->>'id', '')::uuid,
    COALESCE(p_payload->'roll_edits', '[]'::jsonb),
    COALESCE((p_payload->>'row_version')::int, 1),
    CASE
      WHEN jsonb_typeof(p_payload->'missing_unit_ids') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'missing_unit_ids')::uuid)
      ELSE NULL
    END
  );
  IF COALESCE(v_recv->>'ok', 'false') <> 'true' THEN
    RAISE EXCEPTION '%', COALESCE(v_recv->>'message', v_recv->>'code', 'Receive failed');
  END IF;
  IF jsonb_typeof(p_payload->'lengths') = 'array' AND jsonb_array_length(p_payload->'lengths') > 0 THEN
    v_len := public.mm_confirm_received_lengths(
      NULLIF(p_payload->>'id', '')::uuid,
      p_payload->'lengths'
    );
    IF COALESCE(v_len->>'ok', 'false') <> 'true' THEN
      RAISE EXCEPTION '%', COALESCE(v_len->>'message', 'Length confirm failed');
    END IF;
  END IF;
  IF jsonb_typeof(v_rolls) = 'array' AND jsonb_array_length(v_rolls) > 0 THEN
    v_ins := public.mm_save_warehouse_inspections(NULLIF(p_payload->>'id', '')::uuid, v_rolls);
    IF COALESCE(v_ins->>'ok', 'false') <> 'true' THEN
      RAISE EXCEPTION '%', COALESCE(v_ins->>'message', 'Inspection save failed');
    END IF;
  END IF;
  RETURN public._mm_ok(jsonb_build_object(
    'receive', v_recv->'data',
    'lengths', v_len->'data',
    'inspection', v_ins->'data'
  ));
END;
$fn$;;
