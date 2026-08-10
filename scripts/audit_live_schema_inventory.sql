-- Live schema inventory (single result set) — npx supabase db query --linked --file scripts/audit_live_schema_inventory.sql

WITH tables AS (
  SELECT 1 AS sort, 'TABLE' AS kind, c.relname AS name,
         c.reltuples::bigint::text AS col1,
         pg_size_pretty(pg_total_relation_size(c.oid)) AS col2
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
),
views AS (
  SELECT 2, 'VIEW', c.relname, '', ''
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
),
functions AS (
  SELECT 3, 'FUNCTION', p.proname,
         pg_get_function_identity_arguments(p.oid),
         CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
),
no_rls AS (
  SELECT 4, 'NO_RLS', c.relname, '', ''
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
),
for_all AS (
  SELECT 5, 'FOR_ALL_POLICY', c.relname || '.' || pol.polname,
         coalesce(pg_get_expr(pol.polqual, pol.polrelid), ''),
         coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND pol.polcmd = '*'
),
write_no_admin AS (
  SELECT 6, 'WRITE_NO_ADMIN', c.relname || '.' || pol.polname,
         CASE pol.polcmd WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END,
         coalesce(pg_get_expr(pol.polqual, pol.polrelid), coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''))
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND pol.polcmd IN ('a', 'w', 'd', '*')
    AND coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') NOT LIKE '%is_factory_admin%'
    AND coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') NOT LIKE '%is_factory_admin%'
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'factory_id' AND NOT a.attisdropped
    )
),
migrations AS (
  SELECT 7, 'MIGRATION', version, name, ''
  FROM supabase_migrations.schema_migrations
),
orphan_rpc AS (
  SELECT 8, 'ORPHAN_RPC', p.proname, '', ''
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_orders_pipeline_page', 'save_factory_user', 'update_factory_user')
),
missing_rpc AS (
  SELECT 9, 'MISSING_RPC', expected.name, '', ''
  FROM (
    VALUES
      ('save_buyer'), ('save_department'), ('save_line_plan'), ('save_order_routing'),
      ('save_process_flow'), ('save_resource'), ('save_shift'), ('save_size_group'),
      ('save_style_order'), ('save_support_dropdown'), ('save_factory_settings'),
      ('save_fabric_components'), ('save_operation'), ('save_colorway_planning_remarks'),
      ('log_desktop_shipment'), ('log_desktop_rejection'), ('delete_desktop_shipment'),
      ('create_factory_floor_user'), ('replace_floor_user_access'),
      ('get_my_profile'), ('hash_floor_pin'), ('verify_floor_pin'), ('delete_style_order')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = expected.name
  )
),
audit_event_exposed AS (
  SELECT 10, 'AUDIT_EVENT_EXPOSED', 'log_audit_event', grantee.rolname, ''
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  JOIN pg_roles grantee ON grantee.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND p.proname = 'log_audit_event'
    AND acl.privilege_type = 'EXECUTE'
    AND (
      grantee.oid <> p.proowner
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
    )
)
SELECT kind, name, col1, col2
FROM (
  SELECT * FROM tables
  UNION ALL SELECT * FROM views
  UNION ALL SELECT * FROM functions
  UNION ALL SELECT * FROM no_rls
  UNION ALL SELECT * FROM for_all
  UNION ALL SELECT * FROM write_no_admin
  UNION ALL SELECT * FROM migrations
  UNION ALL SELECT * FROM orphan_rpc
  UNION ALL SELECT * FROM missing_rpc
  UNION ALL SELECT * FROM audit_event_exposed
) u
ORDER BY sort, name;
