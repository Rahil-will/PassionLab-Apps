-- Fabric master RPCs. Envelope: _mm_ok(data) / _mm_err(code, message).

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_fabric_guard(p_level text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
BEGIN
  IF p_level = 'config' THEN
    RETURN public._mm_require_config();
  ELSIF p_level = 'quick' THEN
    BEGIN
      RETURN public._mm_require_config();
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'MODULE_DISABLED' THEN RAISE; END IF;
    END;
    RETURN public._mm_require_ops('mm_roll_entry');
  ELSE
    PERFORM public.assert_module_enabled('material');
    v_factory := public._mm_actor_factory_id();
    IF v_factory IS NULL THEN RAISE EXCEPTION 'NO_FACTORY'; END IF;
    RETURN v_factory;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._mm_guard_err(p_sqlerrm text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_sqlerrm
    WHEN 'MODULE_DISABLED' THEN public._mm_err('MODULE_DISABLED', 'Material module is disabled')
    WHEN 'NO_PERMISSION'   THEN public._mm_err('NO_PERMISSION', 'You do not have access to change fabrics')
    WHEN 'NO_FACTORY'      THEN public._mm_err('NO_FACTORY', 'No factory for this user')
    ELSE public._mm_err('ERROR', p_sqlerrm)
  END;
$$;

CREATE OR REPLACE FUNCTION public._mm_num(p_text text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN btrim(COALESCE(p_text, '')) ~ '^[0-9]+(\.[0-9]+)?$' THEN btrim(p_text)::numeric ELSE NULL END;
$$;

CREATE OR REPLACE FUNCTION public._mm_next_fabric_code(p_factory uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
  v_code text;
BEGIN
  INSERT INTO public.mm_doc_sequences (factory_id, doc_type, next_no) VALUES (p_factory, 'FAB', 0)
  ON CONFLICT (factory_id, doc_type) DO NOTHING;
  LOOP
    UPDATE public.mm_doc_sequences SET next_no = next_no + 1
    WHERE factory_id = p_factory AND doc_type = 'FAB'
    RETURNING next_no INTO v_n;
    v_code := 'FAB-' || lpad(v_n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.mm_fabrics WHERE factory_id = p_factory AND code = v_code);
  END LOOP;
  RETURN v_code;
END $$;

-- Validate + normalise a fabric payload. Returns {"error":{code,message}} or the clean row.
CREATE OR REPLACE FUNCTION public._mm_fabric_normalize(p_factory uuid, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_row->>'name', ''));
  v_type uuid;
  v_cons uuid;
  v_comp jsonb;
  v_text text;
  v_sum numeric;
  v_bad integer;
  v_gsm numeric := public._mm_num(p_row->>'gsm');
  v_w numeric := public._mm_num(COALESCE(p_row->>'width_in', p_row->>'width'));
  v_form text := lower(btrim(COALESCE(p_row->>'width_form', '')));
  v_uom text := lower(btrim(COALESCE(p_row->>'uom', '')));
  v_cm text := lower(btrim(COALESCE(p_row->>'color_method', '')));
  v_ref text := NULLIF(btrim(COALESCE(p_row->>'design_ref', '')), '');
  v_gg numeric := public._mm_num(p_row->>'greige_gsm');
  v_gw numeric := public._mm_num(p_row->>'greige_width_in');
  v_spec jsonb := '{}'::jsonb;
BEGIN
  IF v_name = '' THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Fabric name is required'));
  END IF;
  BEGIN
    v_type := NULLIF(p_row->>'fabric_type_id', '')::uuid;
    v_cons := NULLIF(p_row->>'construction_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('error', public._mm_err('INVALID', 'Invalid fabric type or construction id'));
  END;
  IF v_type IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_types WHERE id = v_type AND factory_id = p_factory AND is_active
  ) THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Pick a fabric type'));
  END IF;
  IF v_cons IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.mm_fabric_constructions
    WHERE id = v_cons AND factory_id = p_factory AND fabric_type_id = v_type
  ) THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Pick a construction for this fabric type'));
  END IF;

  IF jsonb_typeof(p_row->'composition') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Composition is required'));
  END IF;
  SELECT
    jsonb_agg(jsonb_build_object('fiber', s.f, 'pct', s.p) ORDER BY s.p DESC NULLS LAST, s.f),
    sum(s.p),
    string_agg(trim_scale(s.p)::text || '% ' || s.f, ' ' ORDER BY s.p DESC NULLS LAST, s.f),
    count(*) FILTER (WHERE s.p IS NULL OR s.p <= 0)
  INTO v_comp, v_sum, v_text, v_bad
  FROM (
    SELECT initcap(min(btrim(x->>'fiber'))) AS f,
           sum(public._mm_num(x->>'pct')) AS p
    FROM jsonb_array_elements(p_row->'composition') x
    WHERE btrim(COALESCE(x->>'fiber', '')) <> ''
    GROUP BY lower(btrim(x->>'fiber'))
  ) s;
  IF v_comp IS NULL THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Add at least one fibre to the composition'));
  END IF;
  IF v_bad > 0 THEN
    RETURN jsonb_build_object('error', public._mm_err('INVALID', 'Every fibre needs a % above 0'));
  END IF;
  IF abs(v_sum - 100) > 0.01 THEN
    RETURN jsonb_build_object('error', public._mm_err('INVALID', 'Composition must total 100% (now ' || trim_scale(v_sum)::text || '%)'));
  END IF;

  IF v_gsm IS NULL OR v_gsm <= 0 THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Finished GSM is required'));
  END IF;
  IF v_w IS NULL OR v_w <= 0 THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Cuttable width (inches) is required'));
  END IF;
  IF v_form NOT IN ('open', 'tubular') THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Width form must be open or tubular'));
  END IF;
  v_uom := CASE
    WHEN v_uom IN ('kg', 'kgs', 'kilogram', 'kilograms') THEN 'kg'
    WHEN v_uom IN ('m', 'mtr', 'mtrs', 'meter', 'meters', 'metre', 'metres') THEN 'm'
    ELSE NULL
  END;
  IF v_uom IS NULL THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'UOM must be kg or m'));
  END IF;
  IF v_cm NOT IN ('solid_dyed', 'yarn_dyed', 'melange', 'print', 'greige_only') THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Pick a colour method'));
  END IF;
  IF v_cm IN ('yarn_dyed', 'melange', 'print') AND v_ref IS NULL THEN
    RETURN jsonb_build_object('error', public._mm_err('REQUIRED', 'Design / colour ref is required for yarn-dyed, melange and print fabrics'));
  END IF;
  IF v_cm NOT IN ('yarn_dyed', 'melange', 'print') THEN
    v_ref := NULL;
  END IF;

  IF jsonb_typeof(p_row->'spec_values') = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(e.key, btrim(e.value #>> '{}')), '{}'::jsonb)
    INTO v_spec
    FROM jsonb_each(p_row->'spec_values') e
    WHERE e.key NOT IN ('gsm', 'width')
      AND btrim(COALESCE(e.value #>> '{}', '')) <> '';
  END IF;

  RETURN jsonb_build_object(
    'name', v_name,
    'fabric_type_id', v_type,
    'construction_id', v_cons,
    'composition', v_comp,
    'composition_text', v_text,
    'gsm', v_gsm,
    'width_in', v_w,
    'width_form', v_form,
    'uom', v_uom,
    'color_method', v_cm,
    'design_ref', v_ref,
    'greige_gsm', v_gg,
    'greige_width_in', v_gw,
    'spec_values', v_spec,
    'supplier_article_no', NULLIF(btrim(COALESCE(p_row->>'supplier_article_no', '')), ''),
    'hsn_code', NULLIF(btrim(COALESCE(p_row->>'hsn_code', '')), ''),
    'image_url', NULLIF(btrim(COALESCE(p_row->>'image_url', '')), ''),
    'remarks', NULLIF(btrim(COALESCE(p_row->>'remarks', '')), ''),
    'dedupe_key', md5(concat_ws('|', v_type, v_cons, lower(v_text), trim_scale(v_gsm), trim_scale(v_w),
                                v_form, v_cm, lower(COALESCE(v_ref, ''))))
  );
END $$;

CREATE OR REPLACE FUNCTION public._mm_fabric_locked(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.colorway_materials WHERE fabric_id = p_id)
      OR EXISTS (SELECT 1 FROM public.mm_style_materials WHERE fabric_id = p_id);
$$;

CREATE OR REPLACE FUNCTION public._mm_fabric_json(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (to_jsonb(f) - 'dedupe_key') || jsonb_build_object(
    'fabric_type', jsonb_build_object('id', t.id, 'name', t.name),
    'construction', jsonb_build_object('id', c.id, 'name', c.name),
    'used_on_orders', (SELECT count(DISTINCT cm.order_id) FROM public.colorway_materials cm WHERE cm.fabric_id = f.id),
    'used_on_lines', (SELECT count(*) FROM public.colorway_materials cm WHERE cm.fabric_id = f.id),
    'locked', public._mm_fabric_locked(f.id),
    'merged_into', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name)
                    FROM public.mm_fabrics m WHERE m.id = f.merged_into_id),
    'created_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = f.created_by)
  )
  FROM public.mm_fabrics f
  JOIN public.mm_fabric_types t ON t.id = f.fabric_type_id
  JOIN public.mm_fabric_constructions c ON c.id = f.construction_id
  WHERE f.id = p_id;
$$;

CREATE OR REPLACE FUNCTION public._mm_fabric_insert(p_factory uuid, p_norm jsonb, p_status text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.mm_fabrics (
    factory_id, code, name, fabric_type_id, construction_id, composition, composition_text,
    gsm, width_in, width_form, uom, color_method, design_ref, greige_gsm, greige_width_in,
    spec_values, supplier_article_no, hsn_code, image_url, remarks, status, dedupe_key,
    created_by, updated_by
  ) VALUES (
    p_factory, public._mm_next_fabric_code(p_factory), p_norm->>'name',
    (p_norm->>'fabric_type_id')::uuid, (p_norm->>'construction_id')::uuid,
    p_norm->'composition', p_norm->>'composition_text',
    (p_norm->>'gsm')::numeric, (p_norm->>'width_in')::numeric, p_norm->>'width_form', p_norm->>'uom',
    p_norm->>'color_method', p_norm->>'design_ref',
    (p_norm->>'greige_gsm')::numeric, (p_norm->>'greige_width_in')::numeric,
    p_norm->'spec_values', p_norm->>'supplier_article_no', p_norm->>'hsn_code',
    p_norm->>'image_url', p_norm->>'remarks', p_status, p_norm->>'dedupe_key',
    public._mm_actor_id(), public._mm_actor_id()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public._mm_fabric_duplicate_of(p_factory uuid, p_dedupe text, p_except uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.mm_fabrics
  WHERE factory_id = p_factory AND dedupe_key = p_dedupe
    AND merged_into_id IS NULL AND status <> 'inactive'
    AND id IS DISTINCT FROM p_except
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Constructions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_list_fabric_constructions(p_fabric_type_id uuid DEFAULT NULL, p_include_inactive boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'fabric_type_id', c.fabric_type_id, 'fabric_type_name', t.name,
      'name', c.name, 'seq', c.seq, 'is_active', c.is_active,
      'used_on_fabrics', (SELECT count(*) FROM public.mm_fabrics f WHERE f.construction_id = c.id)
    ) ORDER BY t.seq, t.name, c.seq, c.name)
    FROM public.mm_fabric_constructions c
    JOIN public.mm_fabric_types t ON t.id = c.fabric_type_id
    WHERE c.factory_id = v_factory
      AND (p_fabric_type_id IS NULL OR c.fabric_type_id = p_fabric_type_id)
      AND (p_include_inactive OR c.is_active)
  ), '[]'::jsonb)));
END $$;

CREATE OR REPLACE FUNCTION public.mm_save_fabric_construction(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_id uuid;
  v_type uuid;
  v_name text := btrim(COALESCE(p_row->>'name', ''));
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('config');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_id := NULLIF(p_row->>'id', '')::uuid;
    v_type := NULLIF(p_row->>'fabric_type_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid id');
  END;
  IF v_name = '' THEN RETURN public._mm_err('REQUIRED', 'Construction name is required'); END IF;

  BEGIN
    IF v_id IS NULL THEN
      IF v_type IS NULL OR NOT EXISTS (SELECT 1 FROM public.mm_fabric_types WHERE id = v_type AND factory_id = v_factory) THEN
        RETURN public._mm_err('REQUIRED', 'Pick a fabric type');
      END IF;
      INSERT INTO public.mm_fabric_constructions (factory_id, fabric_type_id, name, seq, is_active, created_by, updated_by)
      VALUES (v_factory, v_type, v_name,
              COALESCE(public._mm_num(p_row->>'seq')::integer,
                       (SELECT COALESCE(max(seq), 0) + 10 FROM public.mm_fabric_constructions WHERE factory_id = v_factory AND fabric_type_id = v_type)),
              COALESCE((p_row->>'is_active')::boolean, true),
              public._mm_actor_id(), public._mm_actor_id())
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.mm_fabric_constructions SET
        name = v_name,
        seq = COALESCE(public._mm_num(p_row->>'seq')::integer, seq),
        is_active = COALESCE((p_row->>'is_active')::boolean, is_active),
        updated_at = now(),
        updated_by = public._mm_actor_id()
      WHERE id = v_id AND factory_id = v_factory;
      IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Construction not found'); END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN public._mm_err('DUPLICATE', 'This construction already exists for the fabric type');
  END;
  RETURN public._mm_ok(jsonb_build_object('id', v_id));
END $$;

-- ---------------------------------------------------------------------------
-- Fabrics: read
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_list_fabrics(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_search text := NULLIF(btrim(COALESCE(p_filter->>'search', '')), '');
  v_type uuid;
  v_cons uuid;
  v_status text[];
  v_limit integer := LEAST(GREATEST(COALESCE(public._mm_num(p_filter->>'limit')::integer, 500), 1), 2000);
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_type := NULLIF(p_filter->>'fabric_type_id', '')::uuid;
    v_cons := NULLIF(p_filter->>'construction_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid filter id');
  END;
  IF jsonb_typeof(p_filter->'status') = 'array' THEN
    SELECT array_agg(x) INTO v_status FROM jsonb_array_elements_text(p_filter->'status') x;
  ELSE
    v_status := ARRAY['active', 'pending_review'];
  END IF;
  IF COALESCE((p_filter->>'include_inactive')::boolean, false) THEN
    v_status := array_append(v_status, 'inactive');
  END IF;

  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(r.j ORDER BY r.sort_status, r.code)
    FROM (
      SELECT f.code,
             CASE f.status WHEN 'pending_review' THEN 0 WHEN 'active' THEN 1 ELSE 2 END AS sort_status,
             (to_jsonb(f) - 'dedupe_key') || jsonb_build_object(
               'fabric_type', jsonb_build_object('id', t.id, 'name', t.name),
               'construction', jsonb_build_object('id', c.id, 'name', c.name),
               'used_on_orders', COALESCE(u.orders, 0),
               'used_on_lines', COALESCE(u.lines, 0),
               'locked', (COALESCE(u.lines, 0) > 0 OR EXISTS (SELECT 1 FROM public.mm_style_materials sm WHERE sm.fabric_id = f.id)),
               'merged_into', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name)
                               FROM public.mm_fabrics m WHERE m.id = f.merged_into_id)
             ) AS j
      FROM public.mm_fabrics f
      JOIN public.mm_fabric_types t ON t.id = f.fabric_type_id
      JOIN public.mm_fabric_constructions c ON c.id = f.construction_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT cm.order_id) AS orders, count(*) AS lines
        FROM public.colorway_materials cm WHERE cm.fabric_id = f.id
      ) u ON true
      WHERE f.factory_id = v_factory
        AND f.status = ANY (v_status)
        AND (v_type IS NULL OR f.fabric_type_id = v_type)
        AND (v_cons IS NULL OR f.construction_id = v_cons)
        AND (v_search IS NULL
             OR f.code ILIKE '%' || v_search || '%'
             OR f.name ILIKE '%' || v_search || '%'
             OR f.composition_text ILIKE '%' || v_search || '%'
             OR c.name ILIKE '%' || v_search || '%'
             OR COALESCE(f.design_ref, '') ILIKE '%' || v_search || '%'
             OR COALESCE(f.supplier_article_no, '') ILIKE '%' || v_search || '%')
      ORDER BY CASE f.status WHEN 'pending_review' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, f.code
      LIMIT v_limit
    ) r
  ), '[]'::jsonb),
  'counts', (
    SELECT jsonb_build_object(
      'active', count(*) FILTER (WHERE status = 'active'),
      'pending_review', count(*) FILTER (WHERE status = 'pending_review'),
      'inactive', count(*) FILTER (WHERE status = 'inactive'))
    FROM public.mm_fabrics WHERE factory_id = v_factory
  )));
END $$;

CREATE OR REPLACE FUNCTION public.mm_get_fabric(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_row jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  IF NOT EXISTS (SELECT 1 FROM public.mm_fabrics WHERE id = p_id AND factory_id = v_factory) THEN
    RETURN public._mm_err('NOT_FOUND', 'Fabric not found');
  END IF;
  v_row := public._mm_fabric_json(p_id);
  RETURN public._mm_ok(v_row || jsonb_build_object(
    'usage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'style_name', o.style_name, 'style_ref', o.style_ref,
        'po_number', o.po_number, 'internal_order_no', o.internal_order_no,
        'colorways', u.colorways, 'required_total', u.req
      ) ORDER BY o.created_at DESC)
      FROM (
        SELECT cm.order_id,
               jsonb_agg(DISTINCT jsonb_build_object(
                 'colorway_id', c.id, 'colorway_name', c.name,
                 'fabric_color', COALESCE(cm.fabric_color, c.name))) AS colorways,
               sum(cm.total_cons) AS req
        FROM public.colorway_materials cm
        JOIN public.colorways c ON c.id = cm.colorway_id
        WHERE cm.fabric_id = p_id
        GROUP BY cm.order_id
      ) u
      JOIN public.style_orders o ON o.id = u.order_id
    ), '[]'::jsonb)
  ));
END $$;

CREATE OR REPLACE FUNCTION public.mm_check_fabric_duplicate(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_norm jsonb;
  v_self uuid;
  v_exact uuid;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_self := NULLIF(p_row->>'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_self := NULL;
  END;
  -- name is not part of the duplicate test; fill it so partial forms can be checked
  v_norm := public._mm_fabric_normalize(v_factory, p_row || jsonb_build_object('name', COALESCE(NULLIF(btrim(p_row->>'name'), ''), 'x')));
  IF v_norm ? 'error' THEN
    RETURN public._mm_ok(jsonb_build_object('complete', false, 'exact', NULL, 'near', '[]'::jsonb,
                                            'message', v_norm->'error'->>'message'));
  END IF;
  v_exact := public._mm_fabric_duplicate_of(v_factory, v_norm->>'dedupe_key', v_self);
  RETURN public._mm_ok(jsonb_build_object(
    'complete', true,
    'exact', CASE WHEN v_exact IS NULL THEN NULL ELSE public._mm_fabric_json(v_exact) END,
    'near', COALESCE((
      SELECT jsonb_agg(public._mm_fabric_json(f.id) ORDER BY abs(f.gsm - (v_norm->>'gsm')::numeric), f.code)
      FROM public.mm_fabrics f
      WHERE f.factory_id = v_factory
        AND f.merged_into_id IS NULL AND f.status <> 'inactive'
        AND f.id IS DISTINCT FROM v_self
        AND f.id IS DISTINCT FROM v_exact
        AND f.fabric_type_id = (v_norm->>'fabric_type_id')::uuid
        AND f.construction_id = (v_norm->>'construction_id')::uuid
        AND lower(f.composition_text) = lower(v_norm->>'composition_text')
        AND abs(f.gsm - (v_norm->>'gsm')::numeric) <= (v_norm->>'gsm')::numeric * 0.05
        AND abs(f.width_in - (v_norm->>'width_in')::numeric) <= 1
    ), '[]'::jsonb)
  ));
END $$;

-- ---------------------------------------------------------------------------
-- Fabrics: write
-- ---------------------------------------------------------------------------
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

  v_norm := public._mm_fabric_normalize(v_factory, p_row);
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
  v_norm := public._mm_fabric_normalize(v_factory, p_row - 'id');
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

CREATE OR REPLACE FUNCTION public.mm_set_fabric_status(p_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_cur public.mm_fabrics%ROWTYPE;
  v_dup uuid;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('config');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  IF p_status NOT IN ('active', 'pending_review', 'inactive') THEN
    RETURN public._mm_err('INVALID', 'Status must be active, pending_review or inactive');
  END IF;
  SELECT * INTO v_cur FROM public.mm_fabrics WHERE id = p_id AND factory_id = v_factory FOR UPDATE;
  IF NOT FOUND THEN RETURN public._mm_err('NOT_FOUND', 'Fabric not found'); END IF;
  IF v_cur.merged_into_id IS NOT NULL THEN
    RETURN public._mm_err('INVALID', 'This fabric was merged into another and stays inactive');
  END IF;
  IF p_status <> 'inactive' THEN
    v_dup := public._mm_fabric_duplicate_of(v_factory, v_cur.dedupe_key, p_id);
    IF v_dup IS NOT NULL THEN
      RETURN public._mm_err('DUPLICATE', 'Already exists as ' || (SELECT code FROM public.mm_fabrics WHERE id = v_dup) || '. Merge instead.')
             || jsonb_build_object('existing', public._mm_fabric_json(v_dup));
    END IF;
  END IF;
  UPDATE public.mm_fabrics SET status = p_status, row_version = row_version + 1,
    updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = p_id;
  RETURN public._mm_ok(public._mm_fabric_json(p_id));
END $$;

CREATE OR REPLACE FUNCTION public.mm_merge_fabric(p_from_id uuid, p_into_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_from public.mm_fabrics%ROWTYPE;
  v_into public.mm_fabrics%ROWTYPE;
  v_lines integer;
  v_sm integer;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('config');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public._mm_err('REQUIRED', 'Reason is required');
  END IF;
  IF p_from_id = p_into_id THEN RETURN public._mm_err('INVALID', 'Pick a different fabric to merge into'); END IF;
  SELECT * INTO v_from FROM public.mm_fabrics WHERE id = p_from_id AND factory_id = v_factory FOR UPDATE;
  SELECT * INTO v_into FROM public.mm_fabrics WHERE id = p_into_id AND factory_id = v_factory FOR UPDATE;
  IF v_from.id IS NULL OR v_into.id IS NULL THEN RETURN public._mm_err('NOT_FOUND', 'Fabric not found'); END IF;
  IF v_from.merged_into_id IS NOT NULL THEN RETURN public._mm_err('INVALID', v_from.code || ' is already merged'); END IF;
  IF v_into.merged_into_id IS NOT NULL OR v_into.status = 'inactive' THEN
    RETURN public._mm_err('INVALID', v_into.code || ' is inactive. Pick an active fabric.');
  END IF;
  IF v_from.fabric_type_id <> v_into.fabric_type_id THEN
    RETURN public._mm_err('INVALID', 'Both fabrics must have the same fabric type');
  END IF;
  IF v_from.uom <> v_into.uom THEN
    RETURN public._mm_err('INVALID', 'Both fabrics must have the same UOM');
  END IF;

  UPDATE public.colorway_materials SET fabric_id = p_into_id WHERE fabric_id = p_from_id;
  GET DIAGNOSTICS v_lines = ROW_COUNT;
  UPDATE public.mm_style_materials SET fabric_id = p_into_id, updated_at = now(), updated_by = public._mm_actor_id()
  WHERE fabric_id = p_from_id;
  GET DIAGNOSTICS v_sm = ROW_COUNT;
  UPDATE public.mm_fabrics SET
    status = 'inactive',
    merged_into_id = p_into_id,
    remarks = concat_ws(E'\n', remarks, 'Merged into ' || v_into.code || ': ' || btrim(p_reason)),
    row_version = row_version + 1,
    updated_at = now(),
    updated_by = public._mm_actor_id()
  WHERE id = p_from_id;
  RETURN public._mm_ok(jsonb_build_object(
    'from', public._mm_fabric_json(p_from_id),
    'into', public._mm_fabric_json(p_into_id),
    'moved_order_lines', v_lines,
    'moved_style_materials', v_sm));
END $$;

-- ---------------------------------------------------------------------------
-- Grants: helpers are internal, RPCs for signed-in users
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._mm_fabric_guard(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_next_fabric_code(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_normalize(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_locked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_insert(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_fabric_duplicate_of(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.mm_list_fabric_constructions(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_save_fabric_construction(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_list_fabrics(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_get_fabric(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_check_fabric_duplicate(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_save_fabric(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_quick_create_fabric(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_set_fabric_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_merge_fabric(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_list_fabric_constructions(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_fabric_construction(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_list_fabrics(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_get_fabric(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_check_fabric_duplicate(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_fabric(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_quick_create_fabric(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_set_fabric_status(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_merge_fabric(uuid, uuid, text) TO authenticated, service_role;
