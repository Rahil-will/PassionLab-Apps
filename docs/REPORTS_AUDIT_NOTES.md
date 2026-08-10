# Reports — Audit Notes (definitions, grains, limitations)

This document is intended to be a **human-auditable reference** for what each report means, what grain it operates at, and known limitations/edge cases.

---

## Canonical definitions

### Output
- **Hourly departments**: output comes from `hourly_counts.count` (sum across captured hour slots).
- **QC departments**: output comes from `inspection_sessions` as (`passed + rework_passed`) aggregated into `v_daily_output`.
- **Day Report KPI strip**: output = sum of visible table row totals (capture data), not `v_daily_kpis` rollup (avoids mismatch with unallocated output).
- **Capture mode XOR** is enforced at the department level (hourly vs qc_log).

### Target
- Targets come from planning allocations (via `v_daily_target`).
- **Day Report**: department target = sum of all styles' `daily_target` for that dept + date.

### Efficiency
- **Day Report (dept KPI)**: `(Σ output × SAM) / (Σ resource WF × shift productive mins) × 100`.
- **Day Report (row)**: `(row output × SAM) / (resource WF × productive mins) × 100`.
- **Department / Style daily charts**: `v_daily_kpis.daily_efficiency_pct` where available; period rollups average daily values.

### Productivity
- **Day Report**: `output / workforce headcount` (dept KPI uses unique resources' logged headcount).
- **v_daily_kpis**: `complete_output / complete_headcount` when workforce is logged.

### Workforce
- Logged in `workforce_logs` per **`resource_id`** + shift + date.
- Headcount = sum of `headcount_by_category` JSON values.
- Day Report: same WF shown on every style row for that resource (summed across shifts for the day).

### DHU / Defective %
- Computed only where QC capture exists.
- Based on `inspection_sessions.defect_summary` and `total_inspected` as rolled up in `v_daily_quality`.

### WIP
- Operational WIP is computed from produced vs handed-over quantities (via WIP views built on `handover_slips` and `v_daily_output`).

---

## Report grains

### Day Report (`#/reports/day`)
- **Filters**: factory, single date, optional style/PO search, deep-link `order` + `colorway`.
- **Row grain**: `assigned_resources` × `style_orders` × `colorways` (resource × style × color).
- **Column grain**: all factory shift active hour slots (from `shifts.hours`), not only slots with data.
- **Extra columns**: WF, Eff %, Productivity, hourly qty, Total.

### Style Report (`#/reports/style`)
- **Filters**: factory, date range, order (search or deep link), optional colorway pills, optional dept filter.
- **Section 1 grain**: cumulative lifecycle per process-flow department (`get_cut_to_ship_journey`).
- **Section 2 grain**: order × department × day (`v_daily_kpis` via `fetchStyleDailyKpis`).
- Default Section 2: all flow departments stacked; dept dropdown filters to one.

### Department Report (`#/reports/department`)
- **Filters**: factory, date range, department, optional shift pill.
- **Row grain**:
  - daily: department × order
  - shift: department × order × shift

### Order Completion (`#/production/order-completion`)
- **Filters**: factory, optional buyer, balanced/unbalanced, search.
- **Row grain**: order × colorway.

### Transaction Report (`#/planning/transaction-report`)
- **Filters**: factory, date range, from/to departments, status, search.
- **Row grain**: one row per handover slip.
- **Limit**: RPC caps results (see DB function for current limit).

---

## Known limitations / edge cases

- **Legacy NULL colorway**: capture rows with `colorway_id IS NULL` display as **Order (legacy)** in Day Report tables and CSV.
- **NULL resource**: output may be captured without selecting a resource; resource column shows **—**.
- **Invalid deep links**: `#/reports/style?order={uuid}` with unknown order shows search prompt (no crash). Day Report ignores invalid `order` / `colorway` URL params.
- **Factory switch**: all report pages reset filters, selection, and cached data when `factoryId` changes.
- **Multi-day Day Report**: hour-slot matrix is meaningful only for a single day (UI uses single-date picker).
- **QC source**: reporting chain is canonicalized to `inspection_sessions`; legacy `inspections` is deprecated.
- **CSV**: Day Report per-dept and export-all use the same wide columns as the on-screen table (WF, Eff %, Productivity, all hour slots, Total).

---

## QA sign-off (Phase 5)

| Check | Status |
|-------|--------|
| Factory switch clears stale filters | Done — reset on `factoryId` change in Day / Dept / Style pages |
| Invalid `order` in URL doesn't crash | Done — UUID validation + meta lookup; Style shows amber banner |
| Legacy NULL colorway label | Done — `Order (legacy)` via `colorwayDisplayLabel` |
| Large date ranges show loading | Done — `TableSkeleton` / `Spinner` while fetching |
| CSV matches on-screen numbers | Done — Day export-all aligned with per-dept wide format |
| Print | Not required for these 3 reports |
