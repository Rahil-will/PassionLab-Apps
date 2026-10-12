-- Fabric master list: factory-coded SKUs, demand / short, opening stock as free in-stock rolls.
-- Existing codes (FAB-0001) are left as they are. New codes are FAB-{factory code}-{number}.
-- Short = greatest(0, demand - in_stock). Mill, processing, and QC do not cover demand.

-- ---------------------------------------------------------------------------
-- 1. Codes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_next_fabric_code(p_factory uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
  v_code text;
  v_fc text;
BEGIN
  SELECT left(upper(regexp_replace(COALESCE(code, ''), '[^A-Za-z0-9]', '', 'g')), 6)
  INTO v_fc
  FROM public.factories
  WHERE id = p_factory;

  INSERT INTO public.mm_doc_sequences (factory_id, doc_type, next_no) VALUES (p_factory, 'FAB', 0)
  ON CONFLICT (factory_id, doc_type) DO NOTHING;
  LOOP
    UPDATE public.mm_doc_sequences SET next_no = next_no + 1
    WHERE factory_id = p_factory AND doc_type = 'FAB'
    RETURNING next_no INTO v_n;
    v_code := CASE
      WHEN COALESCE(v_fc, '') = '' THEN 'FAB-' || lpad(v_n::text, 4, '0')
      ELSE 'FAB-' || v_fc || '-' || lpad(v_n::text, 4, '0')
    END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.mm_fabrics WHERE factory_id = p_factory AND code = v_code);
  END LOOP;
  RETURN v_code;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Demand on open orders (Completed and Cancelled are out)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mm_fabric_demand(p_factory uuid)
RETURNS TABLE (fabric_id uuid, demand numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cm.fabric_id, COALESCE(sum(cm.total_cons), 0)
  FROM public.colorway_materials cm
  JOIN public.style_orders o ON o.id = cm.order_id AND o.factory_id = p_factory
  WHERE cm.fabric_id IS NOT NULL
    AND o.status IS DISTINCT FROM 'Completed'
    AND o.status IS DISTINCT FROM 'Cancelled'
  GROUP BY cm.fabric_id;
$$;
REVOKE ALL ON FUNCTION public._mm_fabric_demand(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. List carries position: demand and short
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
               'stock', CASE WHEN v_with_stock THEN stk.totals END,
               'position', jsonb_build_object(
                 'demand', COALESCE(dem.demand, 0),
                 'short', greatest(0,
                   COALESCE(dem.demand, 0)
                   - COALESCE((stk.totals->>'in_stock')::numeric, 0))
               )
             ) AS j
      FROM public.mm_fabrics f
      JOIN public.mm_fabric_types t ON t.id = f.fabric_type_id
      JOIN public.mm_fabric_constructions c ON c.id = f.construction_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT cm.order_id) AS orders, count(*) AS lines
        FROM public.colorway_materials cm WHERE cm.fabric_id = f.id
      ) u ON true
      LEFT JOIN st ON st.fabric_id = f.id
      LEFT JOIN LATERAL (
        SELECT public._mm_stock_totals(st.rows) AS totals
      ) stk ON true
      LEFT JOIN public._mm_fabric_demand(v_factory) dem ON dem.fabric_id = f.id
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

-- ---------------------------------------------------------------------------
-- 4. Opening stock: N free in-stock rolls, equal split, last roll takes the remainder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mm_fabric_opening_stock(
  p_fabric_id uuid,
  p_qty numeric,
  p_count integer,
  p_unit_form text DEFAULT 'roll',
  p_lot_no text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_factory uuid;
  f public.mm_fabrics%ROWTYPE;
  v_form text := lower(btrim(COALESCE(p_unit_form, 'roll')));
  v_lot text := NULLIF(btrim(COALESCE(p_lot_no, '')), '');
  v_each numeric;
  v_last numeric;
  v_rolls jsonb := '[]'::jsonb;
  i integer;
  v_piece numeric;
  v_res jsonb;
  v_ch uuid;
BEGIN
  BEGIN
    v_factory := public._mm_fabric_guard('quick');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_guard_err(SQLERRM);
  END;
  BEGIN
    f := public._mm_receipt_fabric(v_factory, p_fabric_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN public._mm_err('REQUIRED', 'Quantity is required');
  END IF;
  IF p_count IS NULL OR p_count < 1 OR p_count > 200 THEN
    RETURN public._mm_err('INVALID', 'Enter between 1 and 200 rolls');
  END IF;
  IF v_form NOT IN ('roll', 'lap', 'pieces') THEN
    RETURN public._mm_err('INVALID', 'Unit must be roll, lap or pieces');
  END IF;
  v_each := round(p_qty / p_count, 3);
  IF v_each <= 0 THEN
    RETURN public._mm_err('INVALID', 'Quantity is too small for that many rolls');
  END IF;
  v_last := round(p_qty - v_each * (p_count - 1), 3);
  IF v_last <= 0 THEN
    RETURN public._mm_err('INVALID', 'Quantity is too small for that many rolls');
  END IF;

  FOR i IN 1..p_count LOOP
    v_piece := CASE WHEN i = p_count THEN v_last ELSE v_each END;
    v_rolls := v_rolls || jsonb_build_array(jsonb_build_object(
      'length_m', v_piece,
      'weight_kg', CASE WHEN f.uom = 'kg' THEN v_piece ELSE NULL END,
      'lot_no', v_lot
    ));
  END LOOP;

  BEGIN
    PERFORM set_config('mm.receipt_fabric_id', f.id::text, true);
    v_res := public.mm_save_unallocated_vendor_grn_v2(
      f.id, 'Opening stock', f.uom, NULL, v_lot, v_rolls);
    PERFORM set_config('mm.receipt_fabric_id', '', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('mm.receipt_fabric_id', '', true);
    RETURN public._mm_receipt_err(SQLERRM);
  END;
  IF COALESCE(v_res->>'ok', 'false') <> 'true' THEN
    RETURN v_res;
  END IF;
  v_ch := (v_res->'data'->>'id')::uuid;

  UPDATE public.mm_stock_units
  SET status = 'in_stock', updated_at = now(), updated_by = public._mm_actor_id()
  WHERE in_challan_id = v_ch AND factory_id = v_factory AND status = 'pending_qc';

  UPDATE public.mm_rolls r
  SET unit_form = v_form,
      dye_lot = COALESCE(v_lot, r.dye_lot),
      fabric_id = f.id,
      updated_at = now(),
      updated_by = public._mm_actor_id()
  FROM public.mm_stock_units u
  WHERE u.roll_id = r.id AND u.in_challan_id = v_ch AND u.factory_id = v_factory;

  RETURN public._mm_ok(jsonb_build_object(
    'fabric_id', f.id,
    'challan_id', v_ch,
    'challan_no', v_res->'data'->>'challan_no',
    'roll_count', p_count,
    'qty', p_qty,
    'uom', f.uom,
    'unit_form', v_form
  ));
END $$;

REVOKE ALL ON FUNCTION public.mm_fabric_opening_stock(uuid, numeric, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_fabric_opening_stock(uuid, numeric, integer, text, text) TO authenticated, service_role;
