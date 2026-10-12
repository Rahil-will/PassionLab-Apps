-- B1 (2026-10-09): stage in stock.
-- * Stock rows carry stage_code, stage_label, can_cut, dye_lot, home ('mill' | 'warehouse' = whose stock it is, incl. while at processing).
-- * mm_fabric_stock_summary: filter `side` ('mill'|'warehouse'), per group `stages[]` (stage → totals + colours).
-- * mm_fabric_stock_rolls: filter `side`, `stage_code`; stock block adds stage/can_cut/home.
-- * _mm_stock_totals: + in_stock_cuttable, available_cuttable (rows without can_cut count as cuttable).
-- * mm_list_fabrics position.short = demand − cuttable in-stock.
-- * Batch list stage counts cover all rolls of the batch (was draft only).
-- * Data fix: abc mill rolls never processed get their batch's initial stage (were backfilled FINISHED).

CREATE OR REPLACE FUNCTION public._mm_stock_row_extra(p_factory uuid, p_roll_id uuid, p_side text, p_stock_unit_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'stage_code', r.stage_code,
    'stage_label', COALESCE(st.label, r.stage_code),
    'stage_seq', st.seq,
    'can_cut', COALESCE(st.can_cut, true),
    'dye_lot', r.dye_lot,
    'unit_form', COALESCE(r.unit_form, 'roll'),
    'home', CASE WHEN p_side = 'mill' OR (p_side = 'processing' AND p_stock_unit_id IS NULL) THEN 'mill' ELSE 'warehouse' END)
  FROM public.mm_rolls r
  LEFT JOIN public.mm_fabric_stages st ON st.factory_id = p_factory AND st.code = r.stage_code
  WHERE r.id = p_roll_id
$function$;

-- totals: add cuttable figures
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._mm_stock_totals(jsonb)'::regprocedure);
  d := replace(d, $a$    'rolls_by_bucket', jsonb_build_object($a$,
    $b$    'in_stock_cuttable', COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'in_stock' AND COALESCE((x->>'can_cut')::boolean, true)), 0),
    'available_cuttable', COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' = 'in_stock' AND x->>'style_material_id' IS NULL AND COALESCE((x->>'can_cut')::boolean, true)), 0),
    'not_cuttable', COALESCE(sum((x->>'qty')::numeric) FILTER (WHERE x->>'bucket' <> 'issued' AND NOT COALESCE((x->>'can_cut')::boolean, true)), 0),
    'rolls_by_bucket', jsonb_build_object($b$);
  IF position('in_stock_cuttable' in d) = 0 THEN RAISE EXCEPTION 'totals replace failed'; END IF;
  EXECUTE d;

  -- batch list: stage counts over all rolls of the batch
  d := pg_get_functiondef('public._mm_mill_list_batches_v4_base'::regproc);
  d := regexp_replace(d,
    'FROM public\.mm_rolls r\s+JOIN public\.mm_mill_rolls mr ON mr\.roll_id = r\.id WHERE mr\.mill_batch_id = b\.id AND mr\.status = ''draft'' GROUP BY 1',
    'FROM public.mm_rolls r WHERE r.mill_batch_id = b.id GROUP BY 1');
  IF position('FROM public.mm_rolls r WHERE r.mill_batch_id = b.id GROUP BY 1' in d) = 0 THEN RAISE EXCEPTION 'batch stage replace failed'; END IF;
  EXECUTE d;

  -- stock rolls: side + stage filters, stage info in stock block
  d := pg_get_functiondef('public.mm_fabric_stock_rolls(jsonb)'::regprocedure);
  d := replace(d, $a$  v_search text := NULLIF(btrim(COALESCE(p_filter->>'search', '')), '');$a$,
    $b$  v_search text := NULLIF(btrim(COALESCE(p_filter->>'search', '')), '');
  v_side text := NULLIF(p_filter->>'side', '');
  v_stage text := NULLIF(upper(p_filter->>'stage_code'), '');$b$);
  d := replace(d, $a$             'stock_unit_id', s.stock_unit_id, 'mill_roll_id', s.mill_roll_id, 'out_line_id', s.out_line_id))$a$,
    $b$             'stock_unit_id', s.stock_unit_id, 'mill_roll_id', s.mill_roll_id, 'out_line_id', s.out_line_id)
             || public._mm_stock_row_extra(v_factory, s.roll_id, s.side, s.stock_unit_id))$b$);
  d := replace(d, $a$        AND (v_search IS NULL OR rs.roll_code ILIKE '%' || v_search || '%')$a$,
    $b$        AND (v_search IS NULL OR rs.roll_code ILIKE '%' || v_search || '%')
        AND (v_side IS NULL OR (public._mm_stock_row_extra(v_factory, rs.roll_id, rs.side, rs.stock_unit_id)->>'home') = v_side)
        AND (v_stage IS NULL OR EXISTS (SELECT 1 FROM public.mm_rolls rr WHERE rr.id = rs.roll_id AND rr.stage_code = v_stage))$b$);
  IF position('v_side text' in d) = 0 OR position('_mm_stock_row_extra(v_factory, s.roll_id' in d) = 0 OR position('v_stage IS NULL OR EXISTS' in d) = 0 THEN
    RAISE EXCEPTION 'stock rolls replace failed';
  END IF;
  EXECUTE d;

  -- list fabrics: rows carry can_cut; short uses cuttable in-stock
  d := pg_get_functiondef('public.mm_list_fabrics(jsonb)'::regprocedure);
  d := replace(d, $a$jsonb_agg(to_jsonb(rs) || jsonb_build_object('unit_form', r.unit_form)) AS rows$a$,
    $b$jsonb_agg(to_jsonb(rs) || public._mm_stock_row_extra(v_factory, rs.roll_id, rs.side, rs.stock_unit_id)) AS rows$b$);
  d := replace(d, $a$- COALESCE((public._mm_stock_totals(st.rows)->>'in_stock')::numeric, 0))$a$,
    $b$- COALESCE((public._mm_stock_totals(st.rows)->>'in_stock_cuttable')::numeric, 0))$b$);
  IF position('in_stock_cuttable' in d) = 0 OR position('_mm_stock_row_extra(v_factory, rs.roll_id' in d) = 0 THEN RAISE EXCEPTION 'list fabrics replace failed'; END IF;
  EXECUTE d;
END $mig$;

-- summary: side filter + stage groups
CREATE OR REPLACE FUNCTION public.mm_fabric_stock_summary(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_factory uuid;
  v_search text := NULLIF(btrim(COALESCE(p_filter->>'search', '')), '');
  v_type uuid;
  v_fabric uuid;
  v_unlinked boolean := COALESCE((p_filter->>'include_unlinked')::boolean, true);
  v_in_stock_only boolean := COALESCE((p_filter->>'only_with_stock')::boolean, false);
  v_side text := NULLIF(p_filter->>'side', '');
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
  IF v_side IS NOT NULL AND v_side NOT IN ('mill', 'warehouse') THEN
    RETURN public._mm_err('INVALID', 'side must be mill or warehouse');
  END IF;

  RETURN public._mm_ok(jsonb_build_object('groups', COALESCE((
    WITH s0 AS (
      SELECT rs.*, to_jsonb(rs) || public._mm_stock_row_extra(v_factory, rs.roll_id, rs.side, rs.stock_unit_id) AS j
      FROM public._mm_roll_stock(v_factory) rs
    ), s AS (
      SELECT s0.*, s0.j->>'stage_code' AS stage_code, s0.j->>'home' AS home
      FROM s0
      WHERE (v_side IS NULL OR s0.j->>'home' = v_side)
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
    ), stg AS (
      SELECT s.fabric_id, CASE WHEN s.fabric_id IS NULL THEN s.fabric_type_id END AS unlinked_type_id,
             s.stage_code, jsonb_agg(s.j) AS rows
      FROM s
      GROUP BY 1, 2, 3
    ), stgcol AS (
      SELECT s.fabric_id, CASE WHEN s.fabric_id IS NULL THEN s.fabric_type_id END AS unlinked_type_id,
             s.stage_code, COALESCE(s.colour, '') AS colour, jsonb_agg(s.j) AS rows
      FROM s
      GROUP BY 1, 2, 3, 4
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
                    AND col.unlinked_type_id IS NOT DISTINCT FROM grp.unlinked_type_id), '[]'::jsonb),
               'stages', COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                           'stage_code', stg.stage_code,
                           'stage_label', COALESCE(fs.label, stg.stage_code),
                           'can_cut', COALESCE(fs.can_cut, true),
                           'totals', public._mm_stock_totals(stg.rows),
                           'colours', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object('colour', NULLIF(sc.colour, ''), 'totals', public._mm_stock_totals(sc.rows)) ORDER BY sc.colour)
                              FROM stgcol sc
                              WHERE sc.fabric_id IS NOT DISTINCT FROM stg.fabric_id
                                AND sc.unlinked_type_id IS NOT DISTINCT FROM stg.unlinked_type_id
                                AND sc.stage_code IS NOT DISTINCT FROM stg.stage_code), '[]'::jsonb))
                         ORDER BY COALESCE(fs.seq, 999), stg.stage_code)
                  FROM stg
                  LEFT JOIN public.mm_fabric_stages fs ON fs.factory_id = v_factory AND fs.code = stg.stage_code
                  WHERE stg.fabric_id IS NOT DISTINCT FROM grp.fabric_id
                    AND stg.unlinked_type_id IS NOT DISTINCT FROM grp.unlinked_type_id), '[]'::jsonb)
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
END $function$;

-- data fix: mill rolls never processed that were backfilled FINISHED get their batch's initial stage
UPDATE public.mm_rolls r SET stage_code = b.initial_stage_code, updated_at = now()
FROM public.mm_mill_batches b
WHERE r.mill_batch_id = b.id AND r.origin = 'mill' AND COALESCE(r.process_round, 0) = 0
  AND b.initial_stage_code IS NOT NULL AND r.stage_code IS DISTINCT FROM b.initial_stage_code
  AND NOT EXISTS (SELECT 1 FROM public.mm_process_out_lines l WHERE l.roll_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM public.mm_roll_lineage lg WHERE lg.child_roll_id = r.id);
