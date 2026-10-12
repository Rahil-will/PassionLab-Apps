-- Fabric save path: custom spec fields validated (_mm_fabric_normalize_full) + custom locked_when_used joins the spec lock.

CREATE OR REPLACE FUNCTION public.mm_save_fabric(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_norm jsonb;
  v_cur public.mm_fabrics%ROWTYPE;
  v_dup uuid;
  v_uses integer;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('config');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_id := NULLIF(p_row->>'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid fabric id');
  END;

  v_norm := public._mm_fabric_normalize_full(v_factory, p_row);
  IF v_norm ? 'error' THEN RETURN v_norm->'error'; END IF;

  v_dup := public._mm_fabric_duplicate_of(v_factory, v_norm->>'dedupe_key', v_id);
  IF v_dup IS NOT NULL THEN
    RETURN public._mm_err('DUPLICATE', 'Already exists as ' || (SELECT code FROM public.mm_fabrics WHERE id = v_dup))
           || jsonb_build_object('existing', public._mm_fabric_json(v_dup));
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      v_id := public._mm_fabric_insert(v_factory, v_norm, 'active');
    ELSE
      SELECT * INTO v_cur FROM public.mm_fabrics WHERE id = v_id AND factory_id = v_factory FOR UPDATE;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric not found'); END IF;
      IF v_cur.merged_into_id IS NOT NULL THEN
        RETURN public._mm_err('INVALID', 'This fabric was merged and cannot be edited');
      END IF;
      IF p_row ? 'row_version' AND public._mm_num(p_row->>'row_version')::integer IS DISTINCT FROM v_cur.row_version THEN
        RETURN public._mm_err('CONFLICT', 'This fabric was changed by someone else. Reload and try again.');
      END IF;
      IF public._mm_fabric_locked(v_id) AND (
           v_cur.fabric_type_id IS DISTINCT FROM (v_norm->>'fabric_type_id')::uuid
        OR v_cur.construction_id IS DISTINCT FROM (v_norm->>'construction_id')::uuid
        OR lower(v_cur.composition_text) IS DISTINCT FROM lower(v_norm->>'composition_text')
        OR v_cur.gsm IS DISTINCT FROM (v_norm->>'gsm')::numeric
        OR v_cur.width_in IS DISTINCT FROM (v_norm->>'width_in')::numeric
        OR v_cur.width_form IS DISTINCT FROM v_norm->>'width_form'
        OR v_cur.uom IS DISTINCT FROM v_norm->>'uom'
        OR v_cur.color_method IS DISTINCT FROM v_norm->>'color_method'
        OR COALESCE(v_cur.design_ref, '') IS DISTINCT FROM COALESCE(v_norm->>'design_ref', '')
        OR EXISTS (
             SELECT 1 FROM public._mm_fabric_custom_fields(v_factory, v_cur.fabric_type_id) cf
             WHERE cf.locked_when_used
               AND NULLIF(btrim(COALESCE(v_cur.spec_values->>cf.spec_key, '')), '')
                   IS DISTINCT FROM NULLIF(btrim(COALESCE(v_norm->'spec_values'->>cf.spec_key, '')), ''))
      ) THEN
        SELECT count(DISTINCT order_id) INTO v_uses FROM public.colorway_materials WHERE fabric_id = v_id;
        RETURN public._mm_err('LOCKED', 'Used on ' || v_uses || ' order(s). Spec cannot change. Create a new fabric instead.');
      END IF;
      UPDATE public.mm_fabrics SET
        name = v_norm->>'name',
        fabric_type_id = (v_norm->>'fabric_type_id')::uuid,
        construction_id = (v_norm->>'construction_id')::uuid,
        composition = v_norm->'composition',
        composition_text = v_norm->>'composition_text',
        gsm = (v_norm->>'gsm')::numeric,
        width_in = (v_norm->>'width_in')::numeric,
        width_form = v_norm->>'width_form',
        uom = v_norm->>'uom',
        color_method = v_norm->>'color_method',
        design_ref = v_norm->>'design_ref',
        greige_gsm = (v_norm->>'greige_gsm')::numeric,
        greige_width_in = (v_norm->>'greige_width_in')::numeric,
        spec_values = v_norm->'spec_values',
        supplier_article_no = v_norm->>'supplier_article_no',
        hsn_code = v_norm->>'hsn_code',
        image_url = v_norm->>'image_url',
        remarks = v_norm->>'remarks',
        dedupe_key = v_norm->>'dedupe_key',
        row_version = row_version + 1,
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_id;
      -- refresh the name/spec snapshot on order lines
      UPDATE public.colorway_materials SET updated_at = now() WHERE fabric_id = v_id;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'A fabric with the same specification already exists');
  END;
  RETURN public._mm_ok(public._mm_fabric_json(v_id));
END $$;

CREATE OR REPLACE FUNCTION public.mm_quick_create_fabric(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_norm jsonb;
  v_dup uuid;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('quick');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  v_norm := public._mm_fabric_normalize_full(v_factory, p_row - 'id');
  IF v_norm ? 'error' THEN RETURN v_norm->'error'; END IF;
  v_dup := public._mm_fabric_duplicate_of(v_factory, v_norm->>'dedupe_key', NULL);
  IF v_dup IS NOT NULL THEN
    RETURN public._mm_err('DUPLICATE', 'Already exists as ' || (SELECT code FROM public.mm_fabrics WHERE id = v_dup))
           || jsonb_build_object('existing', public._mm_fabric_json(v_dup));
  END IF;
  BEGIN
    v_id := public._mm_fabric_insert(v_factory, v_norm, 'pending_review');
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'A fabric with the same specification already exists');
  END;
  RETURN public._mm_ok(public._mm_fabric_json(v_id));
END $$;
