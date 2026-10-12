-- Supplier return list for the warehouse home. Idempotent.
CREATE OR REPLACE FUNCTION public.mm_list_supplier_returns()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_factory uuid;
BEGIN
  BEGIN
    v_factory := public._mm_require_ops('mm_inventory');
  EXCEPTION WHEN OTHERS THEN
    RETURN public._mm_err('ERROR', SQLERRM);
  END;
  RETURN public._mm_ok(COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
    FROM (
      SELECT r.id, r.return_no, r.supplier_name, r.reason, r.debit_note_ref, r.created_at,
             count(l.id)::int AS roll_count,
             COALESCE(sum(l.qty), 0) AS qty
      FROM public.mm_supplier_returns r
      LEFT JOIN public.mm_supplier_return_lines l ON l.return_id = r.id
      WHERE r.factory_id = v_factory
      GROUP BY r.id
      ORDER BY r.created_at DESC
      LIMIT 200
    ) x
  ), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.mm_list_supplier_returns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mm_list_supplier_returns() TO authenticated, service_role;
