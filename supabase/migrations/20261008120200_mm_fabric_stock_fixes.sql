-- Phase 3c: fixes on top of 20261008120000 / 20261008120100 (applied live as
-- mm_fabric_mismatch_errcode_and_precheck, mm_style_material_fabric_rolls_guard,
-- mm_stock_totals_missing_qty, mm_stock_unlinked_units).
-- 1. FABRIC_MISMATCH raised with default errcode (v4 GRN masks check_violation) + pre-check in v5 wrappers
-- 2. linking a style line is blocked when its rolls already carry another fabric
-- 3. stock qty in the fabric's own UOM; unlinked rolls -> uom 'mixed', qty NULL; totals add on_hand_kg / on_hand_m / rolls_missing_qty

-- ---------------------------------------------------------------------------
-- 1. errcode + pre-check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_custody_fabric_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_line uuid;
  v_roll uuid;
  v_code text;
  v_line_code text;
  v_roll_code text;
BEGIN
  IF NEW.roll_id IS NULL OR NEW.style_material_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.style_material_id IS NOT DISTINCT FROM OLD.style_material_id
     AND NEW.roll_id IS NOT DISTINCT FROM OLD.roll_id THEN
    RETURN NEW;
  END IF;
  SELECT fabric_id INTO v_line FROM public.mm_style_materials WHERE id = NEW.style_material_id;
  IF v_line IS NULL THEN RETURN NEW; END IF;
  SELECT fabric_id, roll_code INTO v_roll, v_code FROM public.mm_rolls WHERE id = NEW.roll_id;
  IF v_roll IS NULL THEN
    UPDATE public.mm_rolls SET fabric_id = v_line, updated_at = now() WHERE id = NEW.roll_id;
  ELSIF v_roll <> v_line THEN
    SELECT code INTO v_line_code FROM public.mm_fabrics WHERE id = v_line;
    SELECT code INTO v_roll_code FROM public.mm_fabrics WHERE id = v_roll;
    RAISE EXCEPTION 'FABRIC_MISMATCH: roll % is % but this style line uses %', COALESCE(v_code, NEW.unit_code), v_roll_code, v_line_code;
  END IF;
  RETURN NEW;
END $$;

-- fabric of the style line a receipt payload targets (style object, style_material_id or order/colorway/line ids)
CREATE OR REPLACE FUNCTION public._mm_payload_line_fabric(p_factory uuid, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sm uuid;
  v_cm uuid;
  v_out uuid;
BEGIN
  BEGIN
    v_sm := NULLIF(p_payload->>'style_material_id', '')::uuid;
    v_cm := COALESCE(NULLIF(p_payload->'style'->>'colorway_material_id', ''),
                     NULLIF(p_payload->>'colorway_material_id', ''))::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
  IF v_sm IS NOT NULL THEN
    SELECT fabric_id INTO v_out FROM public.mm_style_materials WHERE id = v_sm AND factory_id = p_factory;
  ELSIF v_cm IS NOT NULL THEN
    SELECT fabric_id INTO v_out FROM public.colorway_materials WHERE id = v_cm AND factory_id = p_factory;
  END IF;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public._mm_payload_line_fabric(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mm_mill_save_batch_v5(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  f public.mm_fabrics%ROWTYPE;
  v_fid uuid;
  v_line uuid;
  v_res jsonb;
BEGIN
  BEGIN
    v_fid := NULLIF(p_payload->>'fabric_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid fabric_id');
  END;
  IF v_fid IS NULL THEN RETURN public.mm_mill_save_batch_v4(p_payload); END IF;
  BEGIN
    v_factory := public._mm_fabric_guard('read');
    f := public._mm_receipt_fabric(v_factory, v_fid);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  v_line := public._mm_payload_line_fabric(v_factory, p_payload);
  IF v_line IS NOT NULL AND v_line <> f.id THEN
    RETURN public._mm_err('FABRIC_MISMATCH', 'This style line uses ' || (SELECT code FROM public.mm_fabrics WHERE id = v_line)
           || ', not ' || f.code);
  END IF;
  BEGIN
    PERFORM set_config('mm.receipt_fabric_id', f.id::text, true);
    v_res := public.mm_mill_save_batch_v4(
      (p_payload - 'fabric_id') || jsonb_build_object('fabric_type_id', f.fabric_type_id,
                                                      'fabric_ref_name', f.code || ' · ' || f.name));
    PERFORM set_config('mm.receipt_fabric_id', '', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('mm.receipt_fabric_id', '', true);
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  IF (v_res->>'ok')::boolean AND v_res->'data' ? 'id' THEN
    UPDATE public.mm_mill_batches SET fabric_id = f.id WHERE id = (v_res->'data'->>'id')::uuid AND fabric_id IS NULL;
    v_res := jsonb_set(v_res, '{data,fabric_id}', to_jsonb(f.id));
  END IF;
  RETURN v_res;
END $$;

CREATE OR REPLACE FUNCTION public.mm_wh_save_vendor_grn_v5(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  f public.mm_fabrics%ROWTYPE;
  v_fid uuid;
  v_line uuid;
  v_res jsonb;
BEGIN
  BEGIN
    v_fid := NULLIF(p_payload->>'fabric_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid fabric_id');
  END;
  IF v_fid IS NULL THEN RETURN public.mm_wh_save_vendor_grn_v4(p_payload); END IF;
  BEGIN
    v_factory := public._mm_fabric_guard('read');
    f := public._mm_receipt_fabric(v_factory, v_fid);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  v_line := public._mm_payload_line_fabric(v_factory, p_payload);
  IF v_line IS NOT NULL AND v_line <> f.id THEN
    RETURN public._mm_err('FABRIC_MISMATCH', 'This style line uses ' || (SELECT code FROM public.mm_fabrics WHERE id = v_line)
           || ', not ' || f.code);
  END IF;
  BEGIN
    PERFORM set_config('mm.receipt_fabric_id', f.id::text, true);
    v_res := public.mm_wh_save_vendor_grn_v4(
      (p_payload - 'fabric_id') || jsonb_build_object('fabric_type_id', f.fabric_type_id,
                                                      'uom', COALESCE(NULLIF(p_payload->>'uom', ''), f.uom)));
    PERFORM set_config('mm.receipt_fabric_id', '', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('mm.receipt_fabric_id', '', true);
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  IF (v_res->>'ok')::boolean AND jsonb_typeof(v_res->'data') = 'object' THEN
    v_res := jsonb_set(v_res, '{data,fabric_id}', to_jsonb(f.id));
  END IF;
  RETURN v_res;
END $$;

-- ---------------------------------------------------------------------------
-- 2. style line link guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_style_material_fabric_rolls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bad text;
BEGIN
  IF NEW.fabric_id IS NULL THEN RETURN NULL; END IF;
  SELECT string_agg(r.roll_code || ' (' || f.code || ')', ', ') INTO v_bad
  FROM public.mm_rolls r
  JOIN public.mm_fabrics f ON f.id = r.fabric_id
  WHERE r.id IN (
          SELECT u.roll_id FROM public.mm_stock_units u WHERE u.style_material_id = NEW.id AND u.roll_id IS NOT NULL
          UNION
          SELECT m.roll_id FROM public.mm_mill_rolls m WHERE m.style_material_id = NEW.id AND m.roll_id IS NOT NULL)
    AND r.fabric_id <> NEW.fabric_id
    AND r.fabric_id IS DISTINCT FROM OLD.fabric_id;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'FABRIC_MISMATCH: rolls on this style line are a different fabric: %', v_bad;
  END IF;
  UPDATE public.mm_rolls r SET fabric_id = NEW.fabric_id, updated_at = now()
  WHERE r.id IN (
          SELECT u.roll_id FROM public.mm_stock_units u WHERE u.style_material_id = NEW.id AND u.roll_id IS NOT NULL
          UNION
          SELECT m.roll_id FROM public.mm_mill_rolls m WHERE m.style_material_id = NEW.id AND m.roll_id IS NOT NULL)
    AND (r.fabric_id IS NULL OR r.fabric_id IS NOT DISTINCT FROM OLD.fabric_id);
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. stock units
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_roll_stock(p_factory uuid)
RETURNS TABLE (roll_id uuid, roll_code text, fabric_id uuid, fabric_type_id uuid, side text, bucket text,
               style_material_id uuid, colour text, qty_kg numeric, qty_m numeric, qty numeric, uom text,
               stock_unit_id uuid, mill_roll_id uuid, out_line_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH proc AS (
    SELECT l.roll_id, l.id AS out_line_id, l.qty, l.uom, l.qty_kg, l.color_ref,
           COALESCE(su.style_material_id, mr.style_material_id) AS sm_id, l.stock_unit_id, l.mill_roll_id
    FROM public.mm_process_out_lines l
    LEFT JOIN public.mm_stock_units su ON su.id = l.stock_unit_id
    LEFT JOIN public.mm_mill_rolls mr ON mr.id = l.mill_roll_id
    WHERE l.factory_id = p_factory AND l.line_status = 'out' AND l.roll_id IS NOT NULL
  ), base AS (
    SELECT p.roll_id, 'processing'::text AS side, 'at_processing'::text AS bucket, p.sm_id, p.color_ref,
           CASE WHEN lower(COALESCE(p.uom, '')) = 'kg' THEN p.qty ELSE p.qty_kg END AS kg,
           CASE WHEN lower(COALESCE(p.uom, '')) IN ('m', 'mtr', 'meter', 'metre') THEN p.qty END AS m,
           p.stock_unit_id, p.mill_roll_id, p.out_line_id
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
           u.id, u.mill_roll_id, NULL::uuid
    FROM public.mm_stock_units u
    WHERE u.factory_id = p_factory AND u.roll_id IS NOT NULL
      AND u.status NOT IN ('consumed', 'written_off', 'returned_to_supplier', 'missing', 'cancelled', 'draft')
      AND COALESCE(u.qty_available, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM proc p WHERE p.roll_id = u.roll_id)
    UNION ALL
    SELECT m.roll_id, 'mill', 'at_mill', m.style_material_id, m.color_ref, m.weight_kg, m.length_m,
           NULL::uuid, m.id, NULL::uuid
    FROM public.mm_mill_rolls m
    WHERE m.factory_id = p_factory AND m.roll_id IS NOT NULL AND m.status = 'draft'
      AND NOT EXISTS (SELECT 1 FROM proc p WHERE p.roll_id = m.roll_id)
      AND NOT EXISTS (SELECT 1 FROM public.mm_stock_units u WHERE u.roll_id = m.roll_id)
  )
  SELECT b.roll_id, r.roll_code, r.fabric_id, r.fabric_type_id, b.side, b.bucket, b.sm_id,
         COALESCE(NULLIF(btrim(cm.fabric_color), ''), cw.name, NULLIF(btrim(b.color_ref), '')) AS colour,
         b.kg, b.m,
         CASE f.uom WHEN 'kg' THEN b.kg WHEN 'm' THEN b.m ELSE NULL END,
         COALESCE(f.uom, 'mixed'),
         b.stock_unit_id, b.mill_roll_id, b.out_line_id
  FROM base b
  JOIN public.mm_rolls r ON r.id = b.roll_id
  LEFT JOIN public.mm_fabrics f ON f.id = r.fabric_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = b.sm_id
  LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
  LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id;
$$;

CREATE OR REPLACE FUNCTION public._mm_stock_totals(p_rows jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'rolls',          count(*) FILTER (WHERE x->>'bucket' <> 'issued'),
    'rolls_missing_qty', count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'qty' IS NULL AND x->>'uom' <> 'mixed'),
    'on_hand',        COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' <> 'issued'), 0),
    'on_hand_kg',     COALESCE(sum((x->>'qty_kg')::numeric) FILTER (WHERE x->>'bucket' <> 'issued'), 0),
    'on_hand_m',      COALESCE(sum((x->>'qty_m')::numeric) FILTER (WHERE x->>'bucket' <> 'issued'), 0),
    'free',           COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'style_material_id' IS NULL), 0),
    'allocated',      COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'style_material_id' IS NOT NULL), 0),
    'available',      COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'style_material_id' IS NULL), 0),
    'at_mill',        COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'at_mill'), 0),
    'at_processing',  COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'at_processing'), 0),
    'qc_pending',     COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'qc_pending'), 0),
    'on_hold',        COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'on_hold'), 0),
    'rejected',       COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'rejected'), 0),
    'in_stock',       COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'in_stock'), 0),
    'issued',         COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'issued'), 0),
    'on_hand_rolls',  count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'unit_form' = 'roll'),
    'on_hand_laps',   count(*) FILTER (WHERE x->>'bucket' <> 'issued' AND x->>'unit_form' = 'lap'),
    'available_rolls', count(*) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'style_material_id' IS NULL AND x->>'unit_form' = 'roll'),
    'available_laps', count(*) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'style_material_id' IS NULL AND x->>'unit_form' = 'lap'),
    'rolls_by_bucket', jsonb_build_object(
       'at_mill',       count(*) FILTER (WHERE x->>'bucket' = 'at_mill'),
       'at_processing', count(*) FILTER (WHERE x->>'bucket' = 'at_processing'),
       'qc_pending',    count(*) FILTER (WHERE x->>'bucket' = 'qc_pending'),
       'on_hold',       count(*) FILTER (WHERE x->>'bucket' = 'on_hold'),
       'rejected',      count(*) FILTER (WHERE x->>'bucket' = 'rejected'),
       'in_stock',      count(*) FILTER (WHERE x->>'bucket' = 'in_stock'),
       'issued',        count(*) FILTER (WHERE x->>'bucket' = 'issued'))
  )
  FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x;
$$;
