-- Phase 3b: fabric stock reads, roll/batch fabric assignment, v5 receipt wrappers, merge/lock/list updates.

-- ===========================================================================
-- 1. One row per live roll position (mill / processing / warehouse)
-- ===========================================================================
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
         CASE f.uom WHEN 'kg' THEN b.kg WHEN 'm' THEN b.m ELSE COALESCE(b.kg, b.m) END,
         COALESCE(f.uom, CASE WHEN b.kg IS NOT NULL THEN 'kg' ELSE 'm' END),
         b.stock_unit_id, b.mill_roll_id, b.out_line_id
  FROM base b
  JOIN public.mm_rolls r ON r.id = b.roll_id
  LEFT JOIN public.mm_fabrics f ON f.id = r.fabric_id
  LEFT JOIN public.mm_style_materials sm ON sm.id = b.sm_id
  LEFT JOIN public.colorway_materials cm ON cm.id = sm.colorway_material_id
  LEFT JOIN public.colorways cw ON cw.id = sm.colorway_id;
$$;

-- totals object for a set of roll-stock rows (qty in the fabric's UOM)
CREATE OR REPLACE FUNCTION public._mm_stock_totals(p_rows jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'rolls',          count(*) FILTER (WHERE x->>'bucket' <> 'issued'),
    'on_hand',        COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' <> 'issued'), 0),
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

-- ===========================================================================
-- 2. RPC: stock summary per fabric × colour (+ "not linked to a fabric" groups per fabric type)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.mm_fabric_stock_summary(p_filter jsonb DEFAULT '{}'::jsonb)
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
  v_fabric uuid;
  v_unlinked boolean := COALESCE((p_filter->>'include_unlinked')::boolean, true);
  v_in_stock_only boolean := COALESCE((p_filter->>'only_with_stock')::boolean, false);
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_type := NULLIF(p_filter->>'fabric_type_id', '')::uuid;
    v_fabric := NULLIF(p_filter->>'fabric_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid filter id');
  END;

  RETURN public._mm_ok(jsonb_build_object('groups', COALESCE((
    WITH s AS (
      SELECT rs.*, to_jsonb(rs) AS j FROM public._mm_roll_stock(v_factory) rs
    ), grp AS (
      SELECT s.fabric_id,
             CASE WHEN s.fabric_id IS NULL THEN s.fabric_type_id END AS unlinked_type_id,
             jsonb_agg(s.j) AS rows
      FROM s
      WHERE (v_type IS NULL OR s.fabric_type_id = v_type)
        AND (v_fabric IS NULL OR s.fabric_id = v_fabric)
        AND (v_unlinked OR s.fabric_id IS NOT NULL)
      GROUP BY s.fabric_id, CASE WHEN s.fabric_id IS NULL THEN s.fabric_type_id END
    ), col AS (
      SELECT s.fabric_id, CASE WHEN s.fabric_id IS NULL THEN s.fabric_type_id END AS unlinked_type_id,
             COALESCE(s.colour, '') AS colour, jsonb_agg(s.j) AS rows
      FROM s
      GROUP BY 1, 2, 3
    )
    SELECT jsonb_agg(g.obj ORDER BY g.sort_unlinked, g.sort_code)
    FROM (
      SELECT (grp.fabric_id IS NULL) AS sort_unlinked, COALESCE(f.code, 'ZZZ') AS sort_code,
             jsonb_build_object(
               'fabric', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object(
                  'id', f.id, 'code', f.code, 'name', f.name, 'uom', f.uom, 'status', f.status,
                  'composition_text', f.composition_text, 'gsm', f.gsm, 'width_in', f.width_in,
                  'width_form', f.width_form, 'color_method', f.color_method, 'design_ref', f.design_ref,
                  'construction', (SELECT c.name FROM public.mm_fabric_constructions c WHERE c.id = f.construction_id)) END,
               'fabric_type', (SELECT jsonb_build_object('id', t.id, 'name', t.name)
                               FROM public.mm_fabric_types t
                               WHERE t.id = COALESCE(f.fabric_type_id, grp.unlinked_type_id)),
               'unlinked', grp.fabric_id IS NULL,
               'uom', COALESCE(f.uom, 'mixed'),
               'totals', public._mm_stock_totals(grp.rows),
               'colours', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('colour', NULLIF(col.colour, ''), 'totals', public._mm_stock_totals(col.rows))
                                   ORDER BY col.colour)
                  FROM col
                  WHERE col.fabric_id IS NOT DISTINCT FROM grp.fabric_id
                    AND col.unlinked_type_id IS NOT DISTINCT FROM grp.unlinked_type_id), '[]'::jsonb)
             ) AS obj
      FROM grp
      LEFT JOIN public.mm_fabrics f ON f.id = grp.fabric_id
      WHERE (v_search IS NULL
             OR f.code ILIKE '%' || v_search || '%'
             OR f.name ILIKE '%' || v_search || '%'
             OR f.composition_text ILIKE '%' || v_search || '%'
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(grp.rows) x WHERE x->>'colour' ILIKE '%' || v_search || '%'))
        AND (NOT v_in_stock_only OR (public._mm_stock_totals(grp.rows)->>'on_hand')::numeric > 0)
    ) g
  ), '[]'::jsonb)));
END $$;

-- ===========================================================================
-- 3. RPC: roll drill-down
--   p_filter: { fabric_id? | unlinked?:true (+ fabric_type_id?), colour?, bucket?, allocation?: 'free'|'allocated', search?, limit? }
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.mm_fabric_stock_rolls(p_filter jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  v_fabric uuid;
  v_type uuid;
  v_unlinked boolean := COALESCE((p_filter->>'unlinked')::boolean, false);
  v_colour text := p_filter->>'colour';
  v_bucket text := NULLIF(p_filter->>'bucket', '');
  v_alloc text := NULLIF(p_filter->>'allocation', '');
  v_search text := NULLIF(btrim(COALESCE(p_filter->>'search', '')), '');
  v_limit integer := LEAST(GREATEST(COALESCE(public._mm_num(p_filter->>'limit')::integer, 500), 1), 2000);
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    v_fabric := NULLIF(p_filter->>'fabric_id', '')::uuid;
    v_type := NULLIF(p_filter->>'fabric_type_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN public._mm_err('INVALID', 'Invalid filter id');
  END;
  IF v_fabric IS NULL AND NOT v_unlinked THEN
    RETURN public._mm_err('REQUIRED', 'Pass fabric_id or unlinked=true');
  END IF;
  IF v_bucket IS NOT NULL AND v_bucket NOT IN ('at_mill', 'at_processing', 'qc_pending', 'on_hold', 'rejected', 'in_stock', 'issued', 'on_hand') THEN
    RETURN public._mm_err('INVALID', 'Unknown bucket');
  END IF;

  RETURN public._mm_ok(jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(public._mm_roll_row(s.roll_id, true) || jsonb_build_object('stock', jsonb_build_object(
             'side', s.side, 'bucket', s.bucket, 'qty', s.qty, 'uom', s.uom, 'qty_kg', s.qty_kg, 'qty_m', s.qty_m,
             'colour', s.colour, 'allocated', s.style_material_id IS NOT NULL, 'style_material_id', s.style_material_id,
             'stock_unit_id', s.stock_unit_id, 'mill_roll_id', s.mill_roll_id, 'out_line_id', s.out_line_id))
           ORDER BY s.bucket, s.roll_code)
    FROM (
      SELECT * FROM public._mm_roll_stock(v_factory) rs
      WHERE (CASE WHEN v_unlinked THEN rs.fabric_id IS NULL ELSE rs.fabric_id = v_fabric END)
        AND (v_type IS NULL OR rs.fabric_type_id = v_type)
        AND (v_colour IS NULL OR lower(COALESCE(rs.colour, '')) = lower(btrim(v_colour)))
        AND (v_bucket IS NULL
             OR (v_bucket = 'on_hand' AND rs.bucket <> 'issued')
             OR rs.bucket = v_bucket)
        AND (v_alloc IS NULL
             OR (v_alloc = 'free' AND rs.style_material_id IS NULL)
             OR (v_alloc = 'allocated' AND rs.style_material_id IS NOT NULL))
        AND (v_search IS NULL OR rs.roll_code ILIKE '%' || v_search || '%')
      ORDER BY rs.bucket, rs.roll_code
      LIMIT v_limit
    ) s
  ), '[]'::jsonb)));
END $$;

-- ===========================================================================
-- 4. Assign a fabric to rolls / a mill batch (link existing or unlinked stock)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.mm_set_rolls_fabric(p_roll_ids uuid[], p_fabric_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  f public.mm_fabrics%ROWTYPE;
  r record;
  v_line uuid;
  v_n integer := 0;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard(CASE WHEN p_fabric_id IS NULL THEN 'config' ELSE 'quick' END);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  IF p_roll_ids IS NULL OR cardinality(p_roll_ids) = 0 THEN
    RETURN public._mm_err('REQUIRED', 'Pick at least one roll');
  END IF;
  IF p_fabric_id IS NOT NULL THEN
    BEGIN
      f := public._mm_receipt_fabric(v_factory, p_fabric_id);
    EXCEPTION WHEN raise_exception THEN
      RETURN public._mm_err(split_part(SQLERRM, '|', 1), substr(SQLERRM, position('|' IN SQLERRM) + 1));
    END;
  END IF;

  FOR r IN SELECT * FROM public.mm_rolls WHERE id = ANY (p_roll_ids) FOR UPDATE LOOP
    IF r.factory_id <> v_factory THEN RETURN public._mm_err('NOT_FOUND', 'Roll not found'); END IF;
    IF f.id IS NOT NULL AND r.fabric_type_id IS NOT NULL AND r.fabric_type_id <> f.fabric_type_id THEN
      RETURN public._mm_err('INVALID', 'Roll ' || r.roll_code || ' is a different fabric type than ' || f.code);
    END IF;
    SELECT sm.fabric_id INTO v_line FROM public.mm_style_materials sm WHERE sm.id = public._mm_roll_style_material(r.id);
    IF v_line IS NOT NULL AND v_line IS DISTINCT FROM f.id THEN
      RETURN public._mm_err('FABRIC_MISMATCH', 'Roll ' || r.roll_code || ' is allocated to a style line using '
             || (SELECT code FROM public.mm_fabrics WHERE id = v_line) || '. Unallocate it first.');
    END IF;
    UPDATE public.mm_rolls SET fabric_id = f.id, updated_at = now(), updated_by = public._mm_actor_id() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  IF v_n <> cardinality(p_roll_ids) THEN
    RETURN public._mm_err('NOT_FOUND', 'Some rolls were not found');
  END IF;
  RETURN public._mm_ok(jsonb_build_object('updated', v_n, 'fabric_id', f.id));
END $$;

CREATE OR REPLACE FUNCTION public.mm_set_batch_fabric(p_batch_id uuid, p_fabric_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  b public.mm_mill_batches%ROWTYPE;
  f public.mm_fabrics%ROWTYPE;
  v_rolls uuid[];
  v_res jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('quick');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  SELECT * INTO b FROM public.mm_mill_batches WHERE id = p_batch_id AND factory_id = v_factory FOR UPDATE;
  IF b.id IS NULL THEN RETURN public._mm_err('NOT_FOUND', 'Batch not found'); END IF;
  BEGIN
    f := public._mm_receipt_fabric(v_factory, p_fabric_id);
  EXCEPTION WHEN raise_exception THEN
    RETURN public._mm_err(split_part(SQLERRM, '|', 1), substr(SQLERRM, position('|' IN SQLERRM) + 1));
  END;
  IF b.fabric_type_id IS NOT NULL AND b.fabric_type_id <> f.fabric_type_id THEN
    RETURN public._mm_err('INVALID', 'Batch ' || b.batch_no || ' is a different fabric type than ' || f.code);
  END IF;
  SELECT array_agg(id) INTO v_rolls FROM public.mm_rolls WHERE mill_batch_id = b.id;
  IF v_rolls IS NOT NULL THEN
    v_res := public.mm_set_rolls_fabric(v_rolls, f.id);
    IF NOT (v_res->>'ok')::boolean THEN RETURN v_res; END IF;
  END IF;
  UPDATE public.mm_mill_batches SET fabric_id = f.id, fabric_ref_name = f.code || ' · ' || f.name,
         updated_at = now(), updated_by = public._mm_actor_id()
  WHERE id = b.id;
  RETURN public._mm_ok(jsonb_build_object('batch_id', b.id, 'fabric_id', f.id, 'rolls', COALESCE(cardinality(v_rolls), 0)));
END $$;

-- ===========================================================================
-- 5. v5 receipt wrappers: same payload as v4 + fabric_id. Without fabric_id they behave exactly like v4.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._mm_receipt_err(p_msg text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_msg LIKE 'FABRIC_MISMATCH:%' THEN public._mm_err('FABRIC_MISMATCH', btrim(substr(p_msg, 17)))
    WHEN position('|' IN p_msg) > 0 THEN public._mm_err(split_part(p_msg, '|', 1), substr(p_msg, position('|' IN p_msg) + 1))
    ELSE public._mm_err('ERROR', p_msg)
  END;
$$;

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

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_vendor_grn_v2(
  p_fabric_id uuid, p_supplier_name text, p_uom text, p_color_ref text, p_lot_no text, p_rolls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  f public.mm_fabrics%ROWTYPE;
  v_res jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
    f := public._mm_receipt_fabric(v_factory, p_fabric_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  BEGIN
    PERFORM set_config('mm.receipt_fabric_id', f.id::text, true);
    v_res := public.mm_save_unallocated_vendor_grn(f.fabric_type_id, p_supplier_name,
               COALESCE(NULLIF(p_uom, ''), f.uom), p_color_ref, p_lot_no, p_rolls);
    PERFORM set_config('mm.receipt_fabric_id', '', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('mm.receipt_fabric_id', '', true);
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  RETURN v_res;
END $$;

CREATE OR REPLACE FUNCTION public.mm_save_unallocated_mill_batch_v2(
  p_fabric_id uuid, p_batch_no text, p_mill_ref text, p_production_date date, p_remarks text,
  p_color_ref text, p_lot_no text, p_rolls jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  f public.mm_fabrics%ROWTYPE;
  v_res jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('read');
    f := public._mm_receipt_fabric(v_factory, p_fabric_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  BEGIN
    PERFORM set_config('mm.receipt_fabric_id', f.id::text, true);
    v_res := public.mm_save_unallocated_mill_batch(f.fabric_type_id, p_batch_no, p_mill_ref, p_production_date,
               p_remarks, p_color_ref, p_lot_no, p_rolls, f.code || ' · ' || f.name);
    PERFORM set_config('mm.receipt_fabric_id', '', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('mm.receipt_fabric_id', '', true);
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  IF (v_res->>'ok')::boolean AND v_res->'data' ? 'id' THEN
    UPDATE public.mm_mill_batches SET fabric_id = f.id WHERE id = (v_res->'data'->>'id')::uuid AND fabric_id IS NULL;
  END IF;
  RETURN v_res;
END $$;

-- ===========================================================================
-- 6. Fabric lock / merge / list now include rolls
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._mm_fabric_locked(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.colorway_materials WHERE fabric_id = p_id)
      OR EXISTS (SELECT 1 FROM public.mm_style_materials WHERE fabric_id = p_id)
      OR EXISTS (SELECT 1 FROM public.mm_rolls WHERE fabric_id = p_id)
      OR EXISTS (SELECT 1 FROM public.mm_mill_batches WHERE fabric_id = p_id);
$$;

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
  v_rolls integer;
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

  -- rolls first, so the style-line trigger does not see a mismatch
  UPDATE public.mm_rolls SET fabric_id = p_into_id, updated_at = now() WHERE fabric_id = p_from_id;
  GET DIAGNOSTICS v_rolls = ROW_COUNT;
  UPDATE public.mm_mill_batches SET fabric_id = p_into_id WHERE fabric_id = p_from_id;
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
    'moved_style_materials', v_sm,
    'moved_rolls', v_rolls));
END $$;

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
  v_with_stock boolean := COALESCE((p_filter->>'with_stock')::boolean, true);
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
    WITH st AS (
      SELECT rs.fabric_id, jsonb_agg(to_jsonb(rs)) AS rows
      FROM public._mm_roll_stock(v_factory) rs
      WHERE v_with_stock AND rs.fabric_id IS NOT NULL
      GROUP BY rs.fabric_id
    )
    SELECT jsonb_agg(r.j ORDER BY r.sort_status, r.code)
    FROM (
      SELECT f.code,
             CASE f.status WHEN 'pending_review' THEN 0 WHEN 'active' THEN 1 ELSE 2 END AS sort_status,
             (to_jsonb(f) - 'dedupe_key') || jsonb_build_object(
               'fabric_type', jsonb_build_object('id', t.id, 'name', t.name),
               'construction', jsonb_build_object('id', c.id, 'name', c.name),
               'used_on_orders', COALESCE(u.orders, 0),
               'used_on_lines', COALESCE(u.lines, 0),
               'locked', public._mm_fabric_locked(f.id),
               'merged_into', (SELECT jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name)
                               FROM public.mm_fabrics m WHERE m.id = f.merged_into_id),
               'stock', CASE WHEN v_with_stock THEN public._mm_stock_totals(st.rows) END
             ) AS j
      FROM public.mm_fabrics f
      JOIN public.mm_fabric_types t ON t.id = f.fabric_type_id
      JOIN public.mm_fabric_constructions c ON c.id = f.construction_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT cm.order_id) AS orders, count(*) AS lines
        FROM public.colorway_materials cm WHERE cm.fabric_id = f.id
      ) u ON true
      LEFT JOIN st ON st.fabric_id = f.id
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
  ),
  'unlinked_stock', CASE WHEN v_with_stock THEN (
    SELECT public._mm_stock_totals(jsonb_agg(to_jsonb(rs)))
    FROM public._mm_roll_stock(v_factory) rs WHERE rs.fabric_id IS NULL) END
  ));
END $$;

-- ===========================================================================
-- 7. Grants
-- ===========================================================================
REVOKE ALL ON FUNCTION public._mm_roll_stock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_stock_totals(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mm_receipt_err(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mm_fabric_stock_summary(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_fabric_stock_rolls(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_set_rolls_fabric(uuid[], uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_set_batch_fabric(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_mill_save_batch_v5(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_wh_save_vendor_grn_v5(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_save_unallocated_vendor_grn_v2(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mm_save_unallocated_mill_batch_v2(uuid, text, text, date, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_fabric_stock_summary(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_fabric_stock_rolls(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_set_rolls_fabric(uuid[], uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_set_batch_fabric(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_mill_save_batch_v5(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_wh_save_vendor_grn_v5(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_vendor_grn_v2(uuid, text, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mm_save_unallocated_mill_batch_v2(uuid, text, text, date, text, text, text, jsonb) TO authenticated, service_role;
