CREATE OR REPLACE FUNCTION public.mm_rpt_quality_by_machine(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_factory uuid; v_rows jsonb;
BEGIN
  BEGIN v_factory := public._mm_require_ops('mm_qc_ops');
  EXCEPTION WHEN OTHERS THEN RETURN public._mm_err('ERROR', SQLERRM); END;
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.facility, s.machine_code), '[]'::jsonb) INTO v_rows FROM (
    SELECT f.name AS facility, m.code AS machine_code, m.machine_kind,
           count(DISTINCT r.id) AS rolls,
           count(DISTINCT i.id) AS inspections,
           count(DISTINCT i.id) FILTER (WHERE i.result = 'fail') AS inspections_failed,
           round(avg(DISTINCT i.points_per_100_sqyd), 2) AS avg_points_per_100_sqyd
    FROM public.mm_rolls r JOIN public.mm_machines m ON m.id = r.machine_id JOIN public.mm_facilities f ON f.id = m.facility_id
    LEFT JOIN public.mm_qc_inspections i ON i.roll_id IN (SELECT r.id UNION SELECT l.child_roll_id FROM public.mm_roll_lineage l WHERE l.parent_roll_id = r.id)
         AND i.voided_at IS NULL AND (p_from IS NULL OR i.inspected_at::date >= p_from) AND (p_to IS NULL OR i.inspected_at::date <= p_to)
    WHERE r.factory_id = v_factory
    GROUP BY 1, 2, 3) s;
  RETURN public._mm_ok(jsonb_build_object('rows', v_rows));
END $$;;
