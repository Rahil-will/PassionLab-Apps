# Reports — Data Sources & Visualization Plan

This document inventories what production data is available in Supabase and how each report screen uses (or will use) it. **Cut to Ship** is documented for completeness but is out of scope for the toolbar/chart redesign.

---

## Data sources (database)

### Capture tables (raw floor input)

| Table | Grain | Key fields | Used for |
|-------|-------|------------|----------|
| `hourly_counts` | factory × order × colorway × department × date × hour_slot | `count`, `count_by_size` | Day report hour matrix; `v_daily_output` |
| `inspection_sessions` | factory × order × colorway × department × date × shift | inspected/pass/fail + defect summary | QC departments; `v_daily_output`, DHU |
| `handover_slips` | piece flow between departments | qty sent/received, size maps | WIP integrity spine; Transaction Report; cut-to-ship journey |
| `shipments` / `rejections` | order/colorway shipment & rejection events | qty by size | Cut to Ship only |

### Planning & master

| Table / view | Purpose |
|--------------|---------|
| `line_allocations` | Daily target per order × department (via `v_daily_target`) |
| `style_orders`, `colorways`, `buyers`, `departments` | Labels, filters, PO/style names |
| `process_flows` + `process_flow_steps` | Department sequence per order (Status Tracker, cut-to-ship journey) |

### Aggregated views

| View | Grain | Metrics |
|------|-------|---------|
| `v_daily_target` | factory × order × dept × date | `daily_target` from line allocations |
| `v_daily_output` | factory × order × colorway × dept × date × shift | `daily_output`, capture mode (hourly vs QC) |
| `v_daily_workforce` | factory × dept × date × shift | headcount, available minutes |
| `v_daily_quality` | factory × order × dept × date | DHU, defect % |
| `v_order_cut_qty` | order × colorway | cut quantities for reconciliation |

### RPC functions (report API)

| RPC | Parameters | Returns |
|-----|------------|---------|
| `get_factory_kpis` | factory, date_from, date_to | Per order × dept × day: output, target, efficiency, DHU, WIP, `shift_breakdown` JSON |
| `get_department_kpis` | factory, department, date range | Same shape, scoped to one department |
| `get_department_kpis_by_shift` | factory, department, date range | Shift-level KPI breakdown |
| `get_style_kpis` | factory, order_id | Style lifetime / range KPIs |
| `get_cut_to_ship_report` | factory, dates, buyer, balanced filter | Order/color reconciliation rows |
| `get_cut_to_ship_detail` | factory, order_id | Journey, shipments, rejections, WIP by dept |
| `get_order_dept_progress` | order, factory | Pipeline progress (Status Tracker) |

Client wrappers live in `lib/mesReportsApi.ts` and `lib/orderProgressApi.ts`.

---

## Report screens

### 1. Day Report (`#/reports/day`)

**Question:** For one date, how much was produced each hour across all departments, broken down by **resource, style, color, and PO**?

| Source | How |
|--------|-----|
| `hourly_counts` | `fetchDayResourceHourReport()` — hourly departments |
| `inspection_sessions` | `fetchDayResourceHourReport()` — QC departments (`passed + rework_passed`) |
| `v_daily_kpis` | KPI strip per department |

**UI**

- Toolbar: search, single date, refresh
- One collapsible card per production department (sequence order)
- Per-dept KPI strip; hourly or QC table with resource × style × color hour matrix

---

### 2. Style Report (`#/reports/style`)

**Question:** What is the full production lifecycle for a style/colorway, and how did daily KPIs trend per department?

| Source | How |
|--------|-----|
| `get_cut_to_ship_journey` | `fetchStyleJourneyReport()` — Section 1 process flow |
| `get_style_kpis` / `v_daily_kpis` | `fetchStyleDailyKpis()` — Section 2 charts |
| `shipments` / `rejections` | Shipment block in journey section |

**UI**

- Style/PO search; colorway pills
- Section 1: header, process flow cards, shipment table
- Section 2: date range + dept selector, 2×2 chart grid

---

### 3. Department Report (`#/reports/department`)

**Question:** For one department over a date range, how did output, efficiency, and DHU trend, and which styles contributed?

| Source | How |
|--------|-----|
| `get_department_kpis` | `fetchDeptPeriodReport()` — daily trend + style rows |
| `get_department_kpis_by_shift` | Shift pills — filter charts by shift |
| `hourly_counts` | Resource breakdown on expandable style rows |

**UI**

- Toolbar: dept selector, 14-day default range, refresh
- KPI strip, daily trend chart, efficiency + DHU charts, shift pills
- Sortable expandable style table

---

### 4. Order Completion (`#/production/order-completion`)

**Question:** Does cut quantity reconcile with shipped, rejected, and WIP through the process flow?

| Source | How |
|--------|-----|
| `get_cut_to_ship_report` | Summary list with balance flag |
| `get_cut_to_ship_detail` | Per-order journey, shipments, rejections |

Standalone production page: `pages/production/OrderCompletion.tsx` + `components/production/OrderCompletionWorkspace.tsx`. Buyer/balance/search filters on the page toolbar.

Legacy `#/reports/cut-to-ship` redirects here.

---

## Dimension matrix

| Dimension | Day | Style | Department | Order Completion |
|-----------|-----|-------|------------|------------------|
| Hourly | Primary (table) | Via shift breakdown | Via shift RPC | — |
| Daily | Date picker | Date picker | Date picker | Optional date range |
| Style / order | Search + table rows | Dropdown + search | Search + table | Per order drill-down |
| Colorway | Table column | Planned | Planned | Primary grain |
| Department | Dropdown | Per card | Dropdown | Journey steps |
| Buyer | — | — | — | Filter |
| Shift | Hour slots | `shift_breakdown` | `get_department_kpis_by_shift` | — |

---

## Gaps & dependencies

1. **Migrations not yet on remote** (as of last check): `20260617100000`, `20260617120000` — QC-produced attribution affects output totals in views.
2. **`style_orders.progress` JSONB** — deprecated in UI; reports use views/RPCs only.
3. **No multi-day range** on Day/Style/Dept yet — RPCs support `date_from` / `date_to`; UI is single-day.
4. **DHU on hourly departments** — only meaningful where QC capture exists; Day report KPI strip uses factory KPI RPC which blends both modes correctly per dept.

---

## File map

| File | Role |
|------|------|
| `pages/reports/ReportsLanding.tsx` | Reports hub — nav cards to Day / Dept / Style |
| `pages/reports/DayReport.tsx` | All departments · hourly/QC matrix by resource and style |
| `pages/reports/DepartmentReport.tsx` | One department · trends, shift pills, style table |
| `pages/reports/StyleReport.tsx` | Style lifecycle journey + daily performance charts |
| `components/reports/ReportToolbar.tsx` | Shared filter bar (search, date, dropdowns) |
| `components/reports/ReportCharts.tsx` | Recharts wrappers (trend, efficiency, DHU, KPI strip) |
| `components/reports/DayDeptCard.tsx` | Collapsible per-department day card |
| `components/reports/DeptStyleTable.tsx` | Department report style table with resource expand |
| `components/reports/StyleJourneySection.tsx` | Style report Section 1 — process flow + shipment |
| `components/reports/StyleDailyChartsSection.tsx` | Style report Section 2 — daily chart grid |
| `pages/production/OrderCompletion.tsx` | Order Completion page shell + toolbar |
| `components/production/OrderCompletionWorkspace.tsx` | Order Completion workspace |
| `lib/mesReportsApi.ts` | Fetch + build helpers |
| `lib/reportDeptUtils.ts` | `isQcDept`, `parseDeptApps` |
| `lib/mesReports.ts` | Legacy client-side builders (prefer API module for new work) |
