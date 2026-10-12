-- Reports schema snapshot (audit)
-- Run in Supabase SQL editor to inventory the exact schema used by reports.

-- 1) All public tables & views
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;

-- 2) Columns for report-relevant objects (update list if needed)
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'hourly_counts',
    'handover_slips',
    'shipments',
    'rejections',
    'style_orders',
    'colorways',
    'departments',
    'buyers',
    'shifts',
    'profiles',
    'v_daily_output',
    'v_daily_target',
    'v_daily_workforce',
    'v_daily_quality',
    'v_daily_kpis',
    'v_daily_kpis_by_shift'
  )
order by table_name, ordinal_position;

-- 3) RPC identity signatures (report API surface)
select
  n.nspname as schema,
  p.proname as function,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_factory_kpis',
    'get_department_kpis',
    'get_department_kpis_by_shift',
    'get_style_kpis',
    'get_cut_to_ship_report',
    'get_cut_to_ship_detail',
    'get_handover_report'
  )
order by p.proname;

