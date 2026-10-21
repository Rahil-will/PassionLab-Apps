-- Fabric stages no longer edit Initial. A save that omits is_initial keeps the stored flag.
CREATE OR REPLACE FUNCTION public.mm_save_fabric_stage(p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_code text;
BEGIN
  BEGIN v_factory := public._mm_require_config();
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  v_code := upper(btrim(COALESCE(p_row->>'code','')));
  IF v_code !~ '^[A-Z0-9_]{2,20}$' THEN RETURN public._mm_err('INVALID','Code: 2-20 letters, numbers or _'); END IF;
  IF NULLIF(btrim(COALESCE(p_row->>'label','')), '') IS NULL THEN RETURN public._mm_err('REQUIRED','Label is required'); END IF;
  INSERT INTO public.mm_fabric_stages (factory_id, code, label, seq, can_cut, is_initial, is_active)
  VALUES (v_factory, v_code, btrim(p_row->>'label'), COALESCE((p_row->>'seq')::int, 100),
          COALESCE((p_row->>'can_cut')::boolean, false), COALESCE((p_row->>'is_initial')::boolean, false),
          COALESCE((p_row->>'is_active')::boolean, true))
  ON CONFLICT (factory_id, code) DO UPDATE SET
    label = EXCLUDED.label,
    seq = EXCLUDED.seq,
    can_cut = EXCLUDED.can_cut,
    is_initial = CASE WHEN p_row ? 'is_initial' THEN EXCLUDED.is_initial ELSE public.mm_fabric_stages.is_initial END,
    is_active = EXCLUDED.is_active,
    updated_at = now();
  RETURN public._mm_ok(jsonb_build_object('code', v_code));
END $$;
