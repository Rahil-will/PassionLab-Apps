-- Phase 3 remainder. Applied as mm_phase3_fpt_summary_and_length.
-- Scoring, defect rows, and the inspection save already exist on MES.
-- This adds the summary read, the mill length accuracy line, and the score
-- on the stock list and style warehouse roll payload.

CREATE OR REPLACE FUNCTION public.mm_get_fpt_summary(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_group_by text DEFAULT 'fabric_type'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $fn$
DECLARE
  v_factory uuid;
  v_group text;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  v_group := lower(COALESCE(NULLIF(btrim(p_group_by), ''), 'fabric_type'));
  IF v_group NOT IN ('mill', 'supplier', 'fabric_type') THEN
    RETURN public._mm_err('INVALID', 'Group by mill, supplier, or fabric_type');
  END IF;

  RETURN public._mm_ok((
    WITH scored AS (
      SELECT
        i.result,
        i.points_per_100_sqyd,
        i.inspected_length,
        COALESCE(u.qty_declared, u.length_m) AS declared,
        CASE v_group
          WHEN 'mill' THEN COALESCE(NULLIF(btrim(b.mill_ref), ''), 'No mill')
          WHEN 'supplier' THEN COALESCE(NULLIF(btrim(c.supplier_name), ''), NULLIF(btrim(b.mill_ref), ''), 'Unknown')
          ELSE COALESCE(NULLIF(btrim(ft.name), ''), 'Unspecified')
        END AS group_name
      FROM public.mm_warehouse_inspections i
      JOIN public.mm_stock_units u ON u.id = i.stock_unit_id AND u.factory_id = v_factory
      LEFT JOIN public.mm_mill_batches b ON b.id = u.mill_batch_id
      LEFT JOIN public.mm_in_challans c ON c.id = u.in_challan_id
      LEFT JOIN public.mm_fabric_types ft ON ft.id = u.fabric_type_id
      WHERE i.factory_id = v_factory
        AND (p_from IS NULL OR (i.inspected_at AT TIME ZONE 'UTC')::date >= p_from)
        AND (p_to IS NULL OR (i.inspected_at AT TIME ZONE 'UTC')::date <= p_to)
    ),
    grouped AS (
      SELECT
        group_name,
        count(*)::int AS rolls_inspected,
        round(avg(points_per_100_sqyd), 2) AS avg_points,
        round(100.0 * count(*) FILTER (WHERE result = 'fail') / NULLIF(count(*), 0), 1) AS fail_pct,
        round(
          100.0 * sum(GREATEST(declared - inspected_length, 0))
            FILTER (WHERE inspected_length IS NOT NULL AND declared IS NOT NULL)
          / NULLIF(sum(declared) FILTER (WHERE inspected_length IS NOT NULL AND declared IS NOT NULL), 0),
          1
        ) AS length_shortfall_pct
      FROM scored
      GROUP BY group_name
    )
    SELECT jsonb_build_object(
      'group_by', v_group,
      'rows', COALESCE(jsonb_agg(jsonb_build_object(
        'group_name', g.group_name,
        'rolls_inspected', g.rolls_inspected,
        'avg_points', g.avg_points,
        'fail_pct', g.fail_pct,
        'length_shortfall_pct', g.length_shortfall_pct
      ) ORDER BY g.group_name), '[]'::jsonb)
    )
    FROM grouped g
  ));
END;
$fn$;

REVOKE ALL ON FUNCTION public.mm_get_fpt_summary(date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mm_get_fpt_summary(date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mm_get_fpt_summary(date, date, text) TO authenticated, service_role;

DO $mm$
DECLARE
  v_body text;
  v_sql text;
  v_def text;
  v_next text;
  v_hits int;
BEGIN
  v_body := pg_get_viewdef('public.mm_v_mill_field_accuracy'::regclass, true);
  v_body := regexp_replace(btrim(v_body), ';[[:space:]]*$', '');
  IF position('inspected_length' IN v_body) > 0 THEN
    RAISE EXCEPTION 'accuracy view already has a length line';
  END IF;
  v_sql := format(
    'CREATE OR REPLACE VIEW public.mm_v_mill_field_accuracy WITH (security_invoker = true) AS %s UNION ALL %s',
    v_body,
    $length$
    SELECT
      u.factory_id,
      u.id AS stock_unit_id,
      u.unit_code,
      u.mill_batch_id,
      'length'::text AS key,
      COALESCE(u.qty_declared, u.length_m) AS declared,
      i.inspected_length AS measured,
      i.inspected_length - COALESCE(u.qty_declared, u.length_m) AS delta,
      CASE
        WHEN COALESCE(u.qty_declared, u.length_m) IS NULL
          OR COALESCE(u.qty_declared, u.length_m) = 0 THEN NULL::numeric
        ELSE round(
          100.0 * (i.inspected_length - COALESCE(u.qty_declared, u.length_m))
          / abs(COALESCE(u.qty_declared, u.length_m)),
          1
        )
      END AS delta_pct,
      i.inspected_at
    FROM public.mm_stock_units u
    JOIN public.mm_warehouse_inspections i ON i.stock_unit_id = u.id
    WHERE u.source = 'mill'
      AND u.mill_batch_id IS NOT NULL
      AND i.inspected_length IS NOT NULL
      AND COALESCE(u.qty_declared, u.length_m) IS NOT NULL
    $length$
  );
  EXECUTE v_sql;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_list_warehouse_stock';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_list_warehouse_stock missing';
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, 'u.lot_no,', ''))) / length('u.lot_no,');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'stock lot_no hits %', v_hits;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, '''qty_uom'', s.qty_uom,', ''))) / length('''qty_uom'', s.qty_uom,');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'stock qty_uom hits %', v_hits;
  END IF;
  v_next := replace(v_def, 'u.lot_no,',
    E'u.lot_no,\n        (SELECT i.points_per_100_sqyd FROM public.mm_warehouse_inspections i WHERE i.stock_unit_id = u.id ORDER BY i.inspected_at DESC NULLS LAST LIMIT 1) AS points_per_100_sqyd,');
  v_next := replace(v_next, '''qty_uom'', s.qty_uom,',
    E'''qty_uom'', s.qty_uom,\n          ''points_per_100_sqyd'', s.points_per_100_sqyd,');
  EXECUTE v_next;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mm_get_style_warehouse';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'mm_get_style_warehouse missing';
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, '''qc_result'', u.qc_result, ''in_challan_id''', '')))
    / length('''qc_result'', u.qc_result, ''in_challan_id''');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'style qc_result hits %', v_hits;
  END IF;
  v_next := replace(
    v_def,
    '''qc_result'', u.qc_result, ''in_challan_id''',
    '''qc_result'', u.qc_result, ''points_per_100_sqyd'', (SELECT i.points_per_100_sqyd FROM public.mm_warehouse_inspections i WHERE i.stock_unit_id = u.id ORDER BY i.inspected_at DESC NULLS LAST LIMIT 1), ''in_challan_id'''
  );
  EXECUTE v_next;

  IF position('inspected_length' IN pg_get_viewdef('public.mm_v_mill_field_accuracy'::regclass, true)) = 0 THEN
    RAISE EXCEPTION 'length line missing after replace';
  END IF;
  IF position('points_per_100_sqyd' IN (
    SELECT prosrc FROM pg_proc WHERE proname = 'mm_list_warehouse_stock' AND pronamespace = 'public'::regnamespace
  )) = 0 THEN
    RAISE EXCEPTION 'stock list score missing';
  END IF;
  IF position('points_per_100_sqyd' IN (
    SELECT prosrc FROM pg_proc WHERE proname = 'mm_get_style_warehouse' AND pronamespace = 'public'::regnamespace
  )) = 0 THEN
    RAISE EXCEPTION 'style warehouse score missing';
  END IF;
  IF to_regprocedure('public.mm_get_fpt_summary(date,date,text)') IS NULL THEN
    RAISE EXCEPTION 'summary missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.mm_stock_units u
    WHERE u.qty_available IS DISTINCT FROM (
      SELECT COALESCE(sum(l.qty_delta), 0)
      FROM public.mm_stock_ledger l
      WHERE l.stock_unit_id = u.id
    )
  ) THEN
    RAISE EXCEPTION 'balance mismatch';
  END IF;
END
$mm$;

NOTIFY pgrst, 'reload schema';
