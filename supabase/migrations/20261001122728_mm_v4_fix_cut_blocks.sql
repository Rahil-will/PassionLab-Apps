CREATE OR REPLACE FUNCTION public._mm_v4_cut_blocks(p_stock_unit_id uuid, p_style_material_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_u public.mm_stock_units%ROWTYPE; v_r public.mm_rolls%ROWTYPE; v_pp jsonb; v_codes text[] := '{}'::text[]; v_ok_codes text[];
        v_cut boolean; v_ts text; v_is text;
BEGIN
  SELECT * INTO v_u FROM public.mm_stock_units WHERE id = p_stock_unit_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('codes', '["NOT_FOUND"]'::jsonb, 'overridden', '[]'::jsonb, 'cut_ready', false); END IF;
  SELECT * INTO v_r FROM public.mm_rolls WHERE id = v_u.roll_id;
  SELECT can_cut INTO v_cut FROM public.mm_fabric_stages WHERE factory_id = v_r.factory_id AND code = v_r.stage_code;
  IF NOT COALESCE(v_cut, false) THEN v_codes := array_append(v_codes, 'STAGE_NOT_CUTTABLE'::text); END IF;
  v_pp := public._mm_qc_passport(v_r.id);
  v_ts := v_pp->'test'->>'status';
  v_is := v_pp->'inspection'->>'status';
  IF v_ts <> 'PASS' THEN v_codes := array_append(v_codes, ('TEST_' || CASE v_ts WHEN 'NONE' THEN 'MISSING' ELSE v_ts END)::text); END IF;
  IF v_is <> 'PASS' THEN v_codes := array_append(v_codes, ('INSPECTION_' || CASE v_is WHEN 'NONE' THEN 'MISSING' ELSE v_is END)::text); END IF;
  IF v_u.status <> 'in_stock' OR COALESCE(v_u.qty_available,0) <= 0 THEN v_codes := array_append(v_codes, 'NOT_AVAILABLE'::text); END IF;
  IF COALESCE(v_u.on_hold, false) THEN v_codes := array_append(v_codes, 'ON_HOLD'::text); END IF;
  IF v_u.style_material_id IS NULL OR (p_style_material_id IS NOT NULL AND v_u.style_material_id <> p_style_material_id) THEN
    v_codes := array_append(v_codes, 'NOT_ALLOCATED'::text);
  END IF;
  v_ok_codes := ARRAY(SELECT DISTINCT c FROM public.mm_qc_cut_approvals a, unnest(a.codes) c
                      WHERE a.roll_id = v_r.id AND a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now()));
  RETURN jsonb_build_object(
    'codes', to_jsonb(ARRAY(SELECT c FROM unnest(v_codes) c WHERE NOT (c = ANY (v_ok_codes)))),
    'overridden', to_jsonb(ARRAY(SELECT c FROM unnest(v_codes) c WHERE c = ANY (v_ok_codes))),
    'cut_ready', NOT EXISTS (SELECT 1 FROM unnest(v_codes) c WHERE NOT (c = ANY (v_ok_codes))),
    'passport', v_pp);
END $$;;
