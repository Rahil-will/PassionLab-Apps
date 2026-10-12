-- Mill declared vs warehouse measured accuracy. Read-only views + mill RPC.
-- No new tables. Does not touch inspection write-once behavior.

CREATE OR REPLACE FUNCTION public._mm_safe_numeric(p_text text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_text)::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public._mm_safe_numeric(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._mm_safe_numeric(text) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.mm_v_mill_field_accuracy
WITH (security_invoker = true) AS
SELECT
  x.factory_id,
  x.stock_unit_id,
  x.unit_code,
  x.mill_batch_id,
  x.key,
  x.declared,
  x.measured,
  x.measured - x.declared AS delta,
  CASE
    WHEN x.declared = 0 THEN NULL
    ELSE round(100 * (x.measured - x.declared) / abs(x.declared), 1)
  END AS delta_pct,
  x.inspected_at
FROM (
  SELECT
    u.factory_id,
    u.id AS stock_unit_id,
    u.unit_code,
    u.mill_batch_id,
    mill.key,
    public._mm_safe_numeric(mill.value) AS declared,
    public._mm_safe_numeric(wh.value) AS measured,
    i.inspected_at
  FROM public.mm_stock_units u
  JOIN public.mm_warehouse_inspections i ON i.stock_unit_id = u.id
  CROSS JOIN LATERAL jsonb_each_text(
    CASE
      WHEN jsonb_typeof(u.mill_snapshot->'attributes') = 'object' THEN u.mill_snapshot->'attributes'
      ELSE '{}'::jsonb
    END
  ) AS mill(key, value)
  JOIN LATERAL jsonb_each_text(
    CASE
      WHEN jsonb_typeof(i.field_values) = 'object' THEN i.field_values
      ELSE '{}'::jsonb
    END
  ) AS wh(key, value) ON wh.key = mill.key
  WHERE u.source = 'mill'
    AND u.mill_batch_id IS NOT NULL
) x
WHERE x.declared IS NOT NULL
  AND x.measured IS NOT NULL;

CREATE OR REPLACE VIEW public.mm_v_mill_accuracy_summary
WITH (security_invoker = true) AS
SELECT
  a.factory_id,
  a.mill_batch_id,
  a.key,
  count(*)::integer AS sample_count,
  round(avg(abs(a.delta_pct)) FILTER (WHERE a.delta_pct IS NOT NULL), 1) AS avg_abs_delta_pct,
  max(abs(a.delta_pct)) AS max_abs_delta_pct,
  min(a.declared) AS min_declared,
  max(a.declared) AS max_declared,
  min(a.measured) AS min_measured,
  max(a.measured) AS max_measured
FROM public.mm_v_mill_field_accuracy a
GROUP BY a.factory_id, a.mill_batch_id, a.key;

COMMENT ON VIEW public.mm_v_mill_field_accuracy IS
  'Per-roll mill_snapshot.attributes vs warehouse inspection field_values. Both keys must numeric-cast.';
COMMENT ON VIEW public.mm_v_mill_accuracy_summary IS
  'Per mill batch + test-field accuracy rollup from mm_v_mill_field_accuracy.';

REVOKE ALL ON TABLE public.mm_v_mill_field_accuracy FROM PUBLIC;
REVOKE ALL ON TABLE public.mm_v_mill_accuracy_summary FROM PUBLIC;
GRANT SELECT ON TABLE public.mm_v_mill_field_accuracy TO authenticated, service_role;
GRANT SELECT ON TABLE public.mm_v_mill_accuracy_summary TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mm_get_mill_accuracy(p_mill_batch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_factory uuid;
  v_by_batch jsonb;
  v_overall jsonb;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_roll_entry');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;

  IF p_mill_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mm_mill_batches b
    WHERE b.id = p_mill_batch_id AND b.factory_id = v_factory
  ) THEN
    RETURN public._mm_err('NOT_FOUND', 'Mill batch not found');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  INTO v_by_batch
  FROM (
    SELECT
      s.mill_batch_id,
      b.batch_no,
      b.mill_ref,
      b.production_date,
      s.key,
      COALESCE((
        SELECT f.label
        FROM public.mm_type_test_fields f
        WHERE f.factory_id = v_factory AND f.is_active AND f.key = s.key
        ORDER BY f.seq, f.label
        LIMIT 1
      ), s.key) AS label,
      s.sample_count,
      s.avg_abs_delta_pct,
      s.max_abs_delta_pct,
      s.min_declared,
      s.max_declared,
      s.min_measured,
      s.max_measured
    FROM public.mm_v_mill_accuracy_summary s
    JOIN public.mm_mill_batches b ON b.id = s.mill_batch_id
    WHERE s.factory_id = v_factory
      AND (p_mill_batch_id IS NULL OR s.mill_batch_id = p_mill_batch_id)
    ORDER BY b.production_date DESC NULLS LAST, b.created_at DESC, s.key
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(y)::jsonb), '[]'::jsonb)
  INTO v_overall
  FROM (
    SELECT
      a.key,
      COALESCE((
        SELECT f.label
        FROM public.mm_type_test_fields f
        WHERE f.factory_id = v_factory AND f.is_active AND f.key = a.key
        ORDER BY f.seq, f.label
        LIMIT 1
      ), a.key) AS label,
      count(*)::integer AS sample_count,
      round(avg(abs(a.delta_pct)) FILTER (WHERE a.delta_pct IS NOT NULL), 1) AS avg_abs_delta_pct,
      max(abs(a.delta_pct)) AS max_abs_delta_pct,
      min(a.declared) AS min_declared,
      max(a.declared) AS max_declared,
      min(a.measured) AS min_measured,
      max(a.measured) AS max_measured
    FROM public.mm_v_mill_field_accuracy a
    WHERE a.factory_id = v_factory
      AND a.inspected_at >= (now() - interval '30 days')
    GROUP BY a.key
    ORDER BY a.key
  ) y;

  RETURN public._mm_ok(jsonb_build_object(
    'by_batch', COALESCE(v_by_batch, '[]'::jsonb),
    'by_key_overall', COALESCE(v_overall, '[]'::jsonb)
  ));
END;
$fn$;

COMMENT ON FUNCTION public.mm_get_mill_accuracy(uuid) IS
  'Mill-side declared vs warehouse-measured accuracy. by_batch is factory or one batch; by_key_overall is last 30 days.';

REVOKE ALL ON FUNCTION public.mm_get_mill_accuracy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mm_get_mill_accuracy(uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';;
