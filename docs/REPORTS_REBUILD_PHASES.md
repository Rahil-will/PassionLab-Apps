# Reports Rebuild — Phased Implementation Guide

> **Purpose:** Single handoff doc for rebuilding the 3 analytics reports (Day, Department, Style).  
> **Design spec:** [`NEW PLAN/PLAN.MD`](../NEW%20PLAN/PLAN.MD)  
> **Schema reference:** [`docs/REPORTS_SCHEMA_INVENTORY.md`](REPORTS_SCHEMA_INVENTORY.md)  
> **Out of scope:** Order Completion (`#/production/order-completion`) — already standalone. Do not touch unless a phase explicitly says so.

---

## How to use this in a new chat

1. Say: **“Implement Phase N from `docs/REPORTS_REBUILD_PHASES.md` only.”**
2. The agent must read **this file + only the files listed under that phase’s “Files to touch”.**
3. Do **not** refactor unrelated pages, plapps, or Order Completion.
4. Mark phase checkboxes in this file when done (or note completion in the PR/commit message).
5. Run `npm run build` at the end of every phase.

**Recommended order:** Phase 0 → 1 → 2 → 3 → 4 → 5 (skip nothing in 0).

---

## Current state (baseline)

| Item | Today |
|------|--------|
| Routing | One component `pages/Reports.tsx` switches on `currentRoute` tab (`day` \| `style` \| `department`) |
| Routes | `#/reports`, `#/reports/day`, `#/reports/style`, `#/reports/department` (unchanged — reuse these) |
| Day report | Single dept dropdown; hourly table from `fetchDayStyleColorHourReport` (hourly_counts only — **no QC dept path**) |
| Style report | Date range + style filter; cards from `buildStyleReportFromRpc` + charts |
| Dept report | Date range + dept filter; table + shift pills + bar chart |
| API | `lib/mesReportsApi.ts` — KPI RPCs + day hour report exist; **no** `fetchDayResourceHourReport`, `fetchDeptPeriodReport`, `fetchStyleJourneyReport` |
| Charts | `components/reports/ReportCharts.tsx` — `KpiStrip`, `OutputTargetBarChart`, `ShiftLineChart`, `HourlyBarChart` only |
| `ReportMeta.departments` | `{ id, name }` only — **missing `apps` JSONB** needed for `isQcDept` |
| `fetchCutToShipJourney` | `(factoryId, orderId)` — **no `colorwayId` param** yet |

---

## Target state (end of Phase 4)

| Report | Route | Page file |
|--------|-------|-----------|
| Landing | `#/reports` | `pages/reports/ReportsLanding.tsx` |
| Day | `#/reports/day` | `pages/reports/DayReport.tsx` |
| Department | `#/reports/department` | `pages/reports/DepartmentReport.tsx` |
| Style | `#/reports/style` | `pages/reports/StyleReport.tsx` |

Monolithic `pages/Reports.tsx` is **deleted** after Phase 4.

---

## Shared rules (all phases)

- **No mock data** — every number from Supabase.
- **Multi-tenant:** every query filters `factory_id` (RLS + explicit `.eq('factory_id', factoryId)`).
- **`isQcDept`:** `departments.apps` JSONB array includes `'qc_log'` — never hardcode dept names.
- **Efficiency colors:** ≥100% `text-emerald-600`, 75–99% `text-amber-600`, &lt;75% `text-red-600`.
- **Numbers:** `tabular-nums` on all count cells.
- **Empty states:** keep card/chart containers; show muted placeholder text inside.
- **Tables:** sticky `thead` → `sticky top-0 bg-slate-50 z-10`.
- **TypeScript strict** — no `any`; export new interfaces from `lib/mesReportsApi.ts`.
- **Reuse:** `ReportToolbar`, `PageShell`, `Card`, `SelectDropdown`, `TableSkeleton`, `downloadCsv`.

---

## Phase 0 — Foundation (API + routes shell)

**Goal:** New page files wired in App; shared API + DB ready. **No UI redesign yet** — pages can render “Phase N” placeholder or minimal shell.

### Files to touch

| File | Action |
|------|--------|
| `supabase/migrations/YYYYMMDDHHMMSS_journey_colorway_filter.sql` | **CREATE** — add `p_colorway_id uuid DEFAULT NULL` to `get_cut_to_ship_journey` |
| `lib/mesReportsApi.ts` | **EXTEND** — see APIs below |
| `lib/reportDeptUtils.ts` | **CREATE** (optional) — `isQcDept(apps: string[] \| null): boolean` |
| `pages/reports/ReportsLanding.tsx` | **CREATE** — 3 nav cards |
| `pages/reports/DayReport.tsx` | **CREATE** — shell + `PageShell` |
| `pages/reports/DepartmentReport.tsx` | **CREATE** — shell |
| `pages/reports/StyleReport.tsx` | **CREATE** — shell |
| `pages/reports/index.ts` | **CREATE** — barrel exports |
| `App.tsx` | **EDIT** — lazy-load 4 report pages; route `#/reports/*` to correct page |
| `lib/routeMap.ts` | **EDIT** — subtitles only if needed (routes already exist) |

### Do NOT touch in Phase 0

- `pages/Reports.tsx` (removed in Phase 4)
- `components/production/*`, Order Completion
- `plapps/*`

### DB migration spec

```sql
-- Extend get_cut_to_ship_journey(factory_id, order_id)
-- Add: p_colorway_id uuid DEFAULT NULL
-- Where hourly_counts, handover_slips, inspection_sessions are filtered:
--   AND (p_colorway_id IS NULL OR colorway_id = p_colorway_id)
```

Confirm QC table name in migrations: **`inspection_sessions`** (canonical; not legacy `inspections`).

### Extend `ReportMeta`

```ts
departments: Array<{
  id: string;
  name: string;
  apps: string[] | null;  // ADD — select apps from departments
  sequence: number;       // ADD — for ordering dept cards
}>;
```

Update `fetchReportMeta` select: `id, name, apps, sequence`.

### New API functions (`lib/mesReportsApi.ts`)

Copy interfaces from [`NEW PLAN/PLAN.MD`](../NEW%20PLAN/PLAN.MD) Steps 0C–0C (full TypeScript blocks). Summary:

| Function | Used in phase |
|----------|----------------|
| `fetchDayResourceHourReport(factoryId, date, departmentId, meta, colorwayLabels)` | Phase 1 |
| `fetchDeptPeriodReport(factoryId, departmentId, dateFrom, dateTo, meta)` | Phase 2 |
| `fetchStyleJourneyReport(factoryId, orderId, colorwayId)` | Phase 3 |
| `fetchStyleDailyKpis(factoryId, orderId, meta?)` | Phase 3 |
| `fetchCutToShipJourney(..., colorwayId?)` | Phase 0 migration + Phase 3 |

#### `fetchDayResourceHourReport` logic

1. Load dept row → `isQcDept = apps?.includes('qc_log')`.
2. **Hourly dept:** query `hourly_counts` where `factory_id`, `department_id`, `log_date = date`. Group by `resource_id + order_id + colorway_id`, pivot `hour_slot → count`.
3. **QC dept:** query `inspection_sessions` same filters; count = `passed + rework_passed` per hour slot (confirm column names in schema).
4. KPI row: `v_daily_kpis` for dept+date → `output`, `target`, `efficiency`, `dhu`, optional `inspected`/`passed` for QC.
5. Enrich from `meta.orders`, `meta.resources`, `colorwayLabels`.
6. Sort: resourceName → styleName → colorName.

#### `fetchDeptPeriodReport` logic

1. `fetchDepartmentKpis` or read `v_daily_kpis` filtered by dept + date range.
2. `dailyTrend[]` — group by `log_date`.
3. `styleRows[]` — group by `order_id`; `resourceBreakdown` from `hourly_counts` grouped by `resource_id + order_id`.
4. `kpiSummary` — totals/averages; `currentWip` from latest day in range.

#### `fetchStyleJourneyReport` logic

1. `style_orders` header fields.
2. `colorways` for order.
3. `fetchCutToShipJourney(factoryId, orderId, colorwayId)`.
4. `departments.apps` per dept in journey.
5. `line_allocations` / `assigned_resources` for line breakdown + `production_completed_at`.
6. `shipments` + `rejections` filtered by order + colorway → `shipmentSummary`.

### App routing change

Replace single `Reports` lazy import with:

```ts
// App.tsx — pattern
case RoutePath.REPORTS: return <ReportsLanding />;
case RoutePath.REPORTS_DAY: return <DayReport />;
case RoutePath.REPORTS_DEPARTMENT: return <DepartmentReport />;
case RoutePath.REPORTS_STYLE: return <StyleReport />;
```

Remove `if (currentRoute.startsWith('#/reports')) return <Reports />` catch-all.

### Phase 0 acceptance

- [x] Migration applied (or file committed for user to run)
- [x] `fetchCutToShipJourney` accepts optional `colorwayId`
- [x] `fetchReportMeta` returns `apps` + `sequence` per department
- [x] Four new pages render without error
- [x] `npm run build` passes
- [x] Old `pages/Reports.tsx` still works OR is unreachable (acceptable until Phase 4)

---

## Phase 1 — Day Report

**Goal:** Replace Day tab UI. **All departments** on one page, collapsible cards, hourly **or** QC table per dept.

### Files to touch

| File | Action |
|------|--------|
| `pages/reports/DayReport.tsx` | **IMPLEMENT** full UI |
| `components/reports/DayDeptCard.tsx` | **CREATE** — one card per department |
| `lib/mesReportsApi.ts` | **ONLY IF** Phase 0 left gaps in `fetchDayResourceHourReport` |
| `components/reports/ReportToolbar.tsx` | **EDIT** — ensure single-date mode works (`date` + `onDateChange`, not range) |

### Do NOT touch in Phase 1

- `DepartmentReport.tsx`, `StyleReport.tsx`, `ReportsLanding.tsx` (beyond imports)
- `pages/Reports.tsx`
- Order Completion, plapps

### UI spec (from PLAN Step 2)

```
ReportToolbar: [single date — default today] [refresh]

For each department (sequence order) → DayDeptCard:
  Header: DEPT NAME · hourly|qc          [collapse ▲]
  KpiStrip: Output, Target, Efficiency, WIP
    QC extra: Inspected, Passed, Pass%, DHU
  Table columns:
    Resource | Style | PO | Color | {hour slots…} | Total
  Sticky: Resource column (left)
  Zeros: show "—" in text-slate-300
  Totals row: bg-slate-50 font-bold border-t-2
  No activity: one muted row (card still visible)
```

### Data loading

```ts
const results = await Promise.allSettled(
  meta.departments.map((d) =>
    fetchDayResourceHourReport(factoryId, date, d.id, meta, colorwayLabels)
  )
);
```

Per-dept `TableSkeleton` while loading; `allSettled` so one dept failure doesn’t kill the page.

### CSV export

Per-dept or whole-page export via `downloadCsv` — columns match table.

### Deep links

Support `routeParams.order` / `routeParams.colorway` — filter rows client-side (same pattern as old `Reports.tsx`).

### Phase 1 acceptance

- [x] All production departments show as cards (sequence order)
- [x] Hourly depts use `hourly_counts`; QC depts use `inspection_sessions`
- [x] KPI strip differs for QC vs hourly
- [x] Collapse/expand per dept works
- [x] Single-day only for hour matrix (show hint if user somehow passes range — Day page uses single date only)
- [x] `npm run build` passes

---

## Phase 2 — Department Report

**Goal:** Replace Department tab. One dept, date range, trend charts, expandable style table.

### Files to touch

| File | Action |
|------|--------|
| `pages/reports/DepartmentReport.tsx` | **IMPLEMENT** |
| `components/reports/ReportCharts.tsx` | **ADD** `DailyTrendChart`, `EfficiencyLineChart`, `DhuLineChart` |
| `components/reports/DeptStyleTable.tsx` | **CREATE** (optional) — sortable + expandable rows |
| `lib/mesReportsApi.ts` | **ONLY IF** `fetchDeptPeriodReport` incomplete |

### Do NOT touch in Phase 2

- `DayReport.tsx`, `StyleReport.tsx`
- `pages/Reports.tsx`

### UI spec (from PLAN Step 3)

```
ReportToolbar:
  [dept selector — default lowest sequence]
  [date range — default last 14 days]
  [refresh]

KPI strip (4): Total Output | Avg Daily Output | Avg Efficiency | Avg DHU

DailyTrendChart — output bars + target dashed line (height 240)

Efficiency & Quality row (md+ side by side):
  EfficiencyLineChart | DhuLineChart

Shift pills (optional enhancement):
  All | Shift A | Shift B → re-fetch fetchDepartmentKpisByShift, recompute charts

Style table:
  Style | PO | Output | Target | Eff% | DHU | WIP | Days
  Expand row → resource breakdown sub-rows
  Sortable: Output, Efficiency, DHU, WIP
  WIP badge: amber if WIP > 0 and no output today
```

### Chart design tokens

See PLAN Step 5 — use palette `#3b82f6`, `#10b981`, `#f59e0b`, `#ef4444`, card wrapper `rounded-2xl border border-slate-100`.

### Default dates

```ts
dateTo = format(new Date(), 'yyyy-MM-dd')
dateFrom = format(subDays(new Date(), 13), 'yyyy-MM-dd')
```

### Phase 2 acceptance

- [x] Dept selector drives all data
- [x] Daily trend + efficiency + DHU charts render with real data
- [x] Empty chart → placeholder text inside card (not collapsed)
- [x] Style table expands to resource rows
- [x] Shift pills work if implemented (or defer to Phase 5 with TODO noted)
- [x] `npm run build` passes

---

## Phase 3 — Style Report

**Goal:** Replace Style tab. Two sections: lifecycle (cumulative) + daily performance charts.

### Files to touch

| File | Action |
|------|--------|
| `pages/reports/StyleReport.tsx` | **IMPLEMENT** |
| `components/reports/StyleJourneySection.tsx` | **CREATE** — Section 1 |
| `components/reports/StyleDailyChartsSection.tsx` | **CREATE** — Section 2 |
| `components/reports/ReportCharts.tsx` | **ADD** `DefectivePctLineChart` if not done in Phase 2 |
| `lib/mesReportsApi.ts` | **ONLY IF** journey/daily KPI fetchers incomplete |

### Do NOT touch in Phase 3

- `DayReport.tsx`, `DepartmentReport.tsx`
- `pages/Reports.tsx`

### UI spec (from PLAN Step 4)

**Top**
- Search input → filter `meta.orders` by style_name + po_number (max 8 results dropdown)
- On select → `selectedOrderId`
- Colorway pills from journey report; “All colorways” = `colorwayId null`

**Section 1 — Lifecycle (no date filter)**
- Header card: image, style, buyer, PO, order/adj qty, SAM, job card, delivery, status badge
- Process flow cards per dept: produced/sent/received/remaining, progress bar, collapsible line breakdown
- QC dept: label “Passed” not “Produced”
- First dept (`flow_step === 0`): hide Received
- Last dept (`flow_step === max`): hide Sent
- Shipment block: order/shipped/rejected/balance + shipment table

**Section 2 — Daily performance**
- Date range (default full order lifecycle or last 30 days — pick one and document in code)
- Dept selector (default first dept in process flow)
- 2×2 grid: DailyTrendChart, EfficiencyLineChart, DhuLineChart, DefectivePctLineChart
- Non-QC dept: DHU + Defective show placeholder message

### Deep links

`#/reports/style?order={uuid}&colorway={uuid}` from `StyleColorDetails` — read `routeParams` on mount.

### Phase 3 acceptance

- [x] Search + colorway pills work
- [x] Section 1 loads from `fetchStyleJourneyReport`
- [x] Section 2 loads from `fetchStyleDailyKpis`
- [x] Progress bars and status badges match flow step rules
- [x] QC vs hourly chart visibility correct
- [x] `npm run build` passes

---

## Phase 4 — Landing + cleanup

**Goal:** Remove monolith; wire landing; finalize nav.

### Files to touch

| File | Action |
|------|--------|
| `pages/reports/ReportsLanding.tsx` | **IMPLEMENT** — 3 large nav cards |
| `pages/Reports.tsx` | **DELETE** |
| `App.tsx` | **VERIFY** — no import of old Reports |
| `components/Layout.tsx` | **VERIFY** — sidebar links still correct (no change expected) |
| `pages/production/StyleColorDetails.tsx` | **VERIFY** — deep links point to `RoutePath.REPORTS_STYLE` with order/colorway params |
| `docs/REPORTS_DATA_PLAN.md` | **UPDATE** — file map + route descriptions |

### Do NOT touch in Phase 4

- Report page logic (unless bugfix)
- plapps, Order Completion

### Landing cards

| Card | Route | Subtitle |
|------|-------|----------|
| Day Report | `REPORTS_DAY` | All departments · hourly output by resource and style |
| Department Report | `REPORTS_DEPARTMENT` | Trends & KPIs for one department |
| Style Report | `REPORTS_STYLE` | Full lifecycle + daily charts per colorway |

`#/reports` → landing (not auto-redirect to Day).

### Phase 4 acceptance

- [x] `pages/Reports.tsx` deleted
- [x] All three reports reachable from landing + sidebar
- [x] No dead imports / `REPORTS_CUT_TO_SHIP` references in reports code
- [x] `npm run build` passes

---

## Phase 5 — QA + polish

**Goal:** Cross-cutting hardening. No new features unless listed.

### Files to touch

| File | Action |
|------|--------|
| Any of the 3 report pages | Bugfixes only |
| `lib/mesReportsApi.ts` | Performance tweaks (parallel fetch, dedupe) |
| `docs/REPORTS_AUDIT_NOTES.md` | Update grains/limitations |

### QA checklist

- [x] Factory switch clears stale filters
- [x] Invalid `order` id in URL doesn’t crash — falls back to search
- [x] Legacy NULL `colorway_id` rows show sensible label (“Order (legacy)”)
- [x] Large date ranges don’t freeze UI (loading states)
- [x] CSV exports match on-screen numbers
- [x] Print not required for these 3 reports (single-page optional later)

---

## File map (after rebuild)

```
pages/reports/
  ReportsLanding.tsx      # Phase 4
  DayReport.tsx           # Phase 1
  DepartmentReport.tsx    # Phase 2
  StyleReport.tsx         # Phase 3
  index.ts

components/reports/
  ReportToolbar.tsx       # shared
  ReportCharts.tsx        # Phase 2–3 additions
  DayDeptCard.tsx         # Phase 1
  DeptStyleTable.tsx      # Phase 2 (optional)
  StyleJourneySection.tsx # Phase 3
  StyleDailyChartsSection.tsx # Phase 3

lib/
  mesReportsApi.ts        # Phase 0 APIs + Phase 1–3 fixes
  mesReports.ts           # legacy builders — do not extend; migrate callers off build*FromRpc over time
  reportDeptUtils.ts      # Phase 0 optional helper
  csvExport.ts            # reuse

types/shared.ts           # routes unchanged
App.tsx                   # Phase 0 + 4
```

---

## Supabase objects reference

### Tables / views (read)

| Object | Day | Dept | Style |
|--------|-----|------|-------|
| `hourly_counts` | ✓ | ✓ (resource breakdown) | — |
| `inspection_sessions` | ✓ (QC depts) | — | — |
| `v_daily_kpis` | ✓ (KPI strip) | ✓ | ✓ (Section 2) |
| `v_daily_kpis_by_shift` | — | ✓ (shift pills) | — |
| `departments` | ✓ apps | ✓ | ✓ |
| `style_orders` | via meta | via meta | ✓ header |
| `colorways` | via labels | — | ✓ |
| `assigned_resources` | via meta | ✓ | ✓ line breakdown |
| `shipments` / `rejections` | — | — | ✓ |
| `get_cut_to_ship_journey` | — | — | ✓ Section 1 |

### RPCs already wired in `mesReportsApi.ts`

- `get_factory_kpis` → `fetchFactoryKpis`
- `get_department_kpis` → `fetchDepartmentKpis`
- `get_department_kpis_by_shift` → `fetchDepartmentKpisByShift`
- `get_style_kpis` → `fetchStyleKpis`

---

## What to tell the agent each phase

| Phase | Prompt |
|-------|--------|
| 0 | “Implement Phase 0 from `docs/REPORTS_REBUILD_PHASES.md`. Only touch files listed there. Run build.” |
| 1 | “Implement Phase 1 Day Report from `docs/REPORTS_REBUILD_PHASES.md`. Only touch Phase 1 files.” |
| 2 | “Implement Phase 2 Department Report from `docs/REPORTS_REBUILD_PHASES.md`. Only touch Phase 2 files.” |
| 3 | “Implement Phase 3 Style Report from `docs/REPORTS_REBUILD_PHASES.md`. Only touch Phase 3 files.” |
| 4 | “Implement Phase 4 cleanup from `docs/REPORTS_REBUILD_PHASES.md`. Delete old Reports.tsx.” |
| 5 | “Run Phase 5 QA from `docs/REPORTS_REBUILD_PHASES.md` checklist.” |

---

## Progress tracker

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Foundation | ✅ Done | API + routes shell |
| 1 Day Report | ✅ Done | DayDeptCard + all-dept parallel load |
| 2 Department Report | ✅ Done | Charts + DeptStyleTable + shift pills |
| 3 Style Report | ✅ Done | Journey + daily charts sections |
| 4 Landing + cleanup | ✅ Done | Deleted Reports.tsx; fixed lazy imports |
| 5 QA | ✅ Done | Factory reset, deep-link guard, legacy labels, CSV parity |

---

*Last updated: 2026-06-22 — generated for Prodigi Vite app (not plapps).*
