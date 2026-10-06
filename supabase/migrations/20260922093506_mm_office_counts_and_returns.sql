DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.oid = 'public._mm_challan_header(public.mm_in_challans)'::regprocedure;
  IF position('received_roll_count' in d) = 0 THEN
    d := replace(d,
      '''roll_count'', (' || chr(10) || '      SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = p_ch.id' || chr(10) || '    ),',
      '''roll_count'', (' || chr(10) || '      SELECT count(*) FROM public.mm_in_challan_lines l WHERE l.challan_id = p_ch.id' || chr(10) || '    ),' || chr(10) ||
      '    ''received_roll_count'', (' || chr(10) || '      SELECT count(*) FROM public.mm_stock_units u' || chr(10) || '      WHERE u.in_challan_id = p_ch.id AND public._mm_counts_as_received(u.status)' || chr(10) || '    ),');
  END IF;
  IF position('received_roll_count' in d) = 0 THEN
    RAISE EXCEPTION 'header count patch missed';
  END IF;
  EXECUTE d;

  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  WHERE p.oid = 'public.mm_floor_call(uuid,uuid,text,jsonb)'::regprocedure;
  IF position('mm_short_close_in_challan' in d) = 0 THEN
    d := replace(d,
      'ELSIF p_fn = ''mm_receive_mill_bundle'' THEN' || chr(10) || '    RETURN public.mm_receive_mill_bundle(v_args);' || chr(10) || '  END IF;',
      'ELSIF p_fn = ''mm_receive_mill_bundle'' THEN' || chr(10) || '    RETURN public.mm_receive_mill_bundle(v_args);' || chr(10) ||
      '  ELSIF p_fn = ''mm_short_close_in_challan'' THEN' || chr(10) ||
      '    RETURN public.mm_short_close_in_challan((v_args->>''id'')::uuid, v_args->>''reason'');' || chr(10) || '  END IF;');
  END IF;
  IF position('mm_short_close_in_challan' in d) = 0 THEN
    RAISE EXCEPTION 'floor allowlist patch missed';
  END IF;
  EXECUTE d;
END
$do$;

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
GRANT EXECUTE ON FUNCTION public.mm_list_supplier_returns() TO authenticated, service_role;;
