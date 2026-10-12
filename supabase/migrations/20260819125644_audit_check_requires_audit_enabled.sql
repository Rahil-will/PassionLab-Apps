CREATE OR REPLACE FUNCTION public.profile_dept_has_app(
  p_user_id    uuid,
  p_factory_id uuid,
  p_app        text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT CASE p_app
      WHEN 'lay_report'    THEN 'cutting_lay'
      WHEN 'workforce_log' THEN 'supervisor'
      WHEN 'workforce'     THEN 'supervisor'
      ELSE p_app
    END AS app
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    CROSS JOIN resolved r
    WHERE p.id = p_user_id
      AND p.factory_id = p_factory_id
      AND p.status = 'Active'
      AND (
        p.user_role IN ('admin', 'superadmin')

        OR (r.app = 'transaction' AND p.handover_enabled IS TRUE)

        OR (r.app IN ('supervisor', 'workforce', 'workforce_log')
            AND p.workforce_enabled IS TRUE)

        OR (r.app = 'audit' AND p.audit_enabled IS TRUE AND p.can_produce IS TRUE)

        OR (
          r.app IN ('shipment_log', 'final_rejection_log', 'shipment_audit')
          AND p.shipment_qa_enabled IS TRUE
          AND EXISTS (
            SELECT 1
            FROM public.factories f
            WHERE f.id = p_factory_id
              AND COALESCE(f.shipment_apps, '[]'::jsonb) @> jsonb_build_array(r.app)
          )
        )

        OR (
          p.can_produce IS TRUE
          AND EXISTS (
            SELECT 1
            FROM public.floor_user_access fa
            JOIN public.operations op
              ON op.id = fa.operation_id
             AND op.factory_id = fa.factory_id
            WHERE fa.profile_id = p.id
              AND fa.factory_id = p_factory_id
              AND op.is_active IS NOT FALSE
              AND (
                EXISTS (
                  SELECT 1
                  FROM public.order_routing_steps ors
                  WHERE ors.factory_id = fa.factory_id
                    AND ors.operation_def_id = fa.operation_id
                    AND (
                      ors.capture_app = r.app
                      OR (r.app = 'cutting_lay' AND ors.capture_app IN ('cutting_lay', 'lay_report'))
                    )
                )
                OR (
                  NOT EXISTS (
                    SELECT 1
                    FROM public.order_routing_steps ors
                    WHERE ors.factory_id = fa.factory_id
                      AND ors.operation_def_id = fa.operation_id
                      AND NULLIF(ors.capture_app, '') IS NOT NULL
                  )
                  AND (
                    op.capture_app = r.app
                    OR (r.app = 'cutting_lay' AND op.capture_app IN ('cutting_lay', 'lay_report'))
                  )
                )
              )
          )
        )
      )
  );
$$;

COMMENT ON FUNCTION public.profile_dept_has_app(uuid, uuid, text) IS
  'True when profile may use capture app. Audit requires audit_enabled and can_produce.';

GRANT EXECUTE ON FUNCTION public.profile_dept_has_app(uuid, uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';;
