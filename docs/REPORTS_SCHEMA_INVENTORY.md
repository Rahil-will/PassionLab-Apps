# Reports — Schema Inventory (from code + migrations)

This document is an **audit-friendly** inventory of what the app currently uses for reporting, based on:
- client code (`pages/Reports.tsx`, `lib/mesReportsApi.ts`, `pages/planning/TransactionReport.tsx`)
- Supabase migrations under `supabase/migrations/*`

For an authoritative, live DB snapshot, run [`docs/REPORTS_SCHEMA_SNAPSHOT.sql`](docs/REPORTS_SCHEMA_SNAPSHOT.sql) in the Supabase SQL editor.

---

## Report routes (current app)

- `#/reports/day` (Day Report)
- `#/reports/style` (Style Report)
- `#/reports/department` (Department Report)
- `#/production/order-completion` (Order Completion)
- `#/planning/transaction-report` (Transaction Report / handover ledger)

Legacy `#/reports/cut-to-ship` redirects to Order Completion.

---

## Supabase objects used by reports

### Master/dimension tables (filters + labels)
- `public.departments` (sequence ordering; apps; is_production)
- `public.style_orders` (style_name, po_number)
- `public.colorways` (name, color_code, order_id)
- `public.buyers`
- `public.shifts` (shift hours JSONB used to derive hour slots)
- `public.profiles` (names in Transaction Report)
- `public.factories`
- `public.resources` (implied by `hourly_counts.resource_id`; confirm exact table/shape in snapshot)

### Capture / transactional tables
- `public.hourly_counts` (Day Report; also feeds output views)
- QC capture table: **must be confirmed** (`inspections` vs `inspection_sessions`)
- `public.handover_slips` (Transaction Report; also feeds WIP logic)
- `public.shipments` (Cut-to-Ship)
- `public.rejections` (Cut-to-Ship)

### Reporting views (KPI chain)
Used directly via PostgREST reads and indirectly via RPCs.
- `public.v_daily_output`
- `public.v_daily_target`
- `public.v_daily_workforce`
- `public.v_daily_quality`
- `public.v_daily_kpis_by_shift`
- `public.v_daily_kpis`

### Reporting RPCs
KPI RPCs (also backed by the KPI views):
- `public.get_factory_kpis(uuid, date, date)`
- `public.get_department_kpis(uuid, uuid, date, date)`
- `public.get_department_kpis_by_shift(uuid, uuid, date, date)`
- `public.get_style_kpis(uuid, uuid)`

Cut-to-Ship:
- `public.get_cut_to_ship_report(...)`
- `public.get_cut_to_ship_detail(...)`

Transaction Report:
- `public.get_handover_report(...)`
- `public.infer_hour_slot_for_timestamp(uuid, timestamptz)`

### Grants / access
Reporting view chain grants (authenticated) are in:
- `supabase/migrations/20260618120000_reporting_views_grants.sql`
- `supabase/migrations/20260621100000_kpi_reporting_access.sql`

