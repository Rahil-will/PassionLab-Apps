# PRODIGI reporting view action plan

> Generated from live schema fetch on Supabase project `xtfljldeceonqyzgkoyp` (2026-07-23).
> The docs have drifted from the live database; only the app references listed here matter.

## Current live views used by the app

| View | Used in | Grain | Notes |
|------|---------|-------|-------|
| `v_department_progress` | `lib/mesReportsApi.ts` → `fetchOrderDeptProgressRows` | order × colorway × visit dept | Renamed from `v_order_dept_progress`; same expected columns plus `planned_qty`, `remaining_qty`, `available_to_send` |
| `v_daily_audit` | `lib/mesReportsApi.ts` → `fetchFulfillmentAudits`, `fetchStyleDeptAuditMetrics` | resource/shift per audit | Replaces `v_audit_colorway_summary` and `v_audit_summary`; must be aggregated in JS |
| `v_daily_quality` | `lib/mesReportsApi.ts` → `fetchStyleDeptQualitySummary` | resource/shift per QC day | No code change needed; columns match current `.select` |
| `v_department_kpis_by_shift` | `lib/mesReportsApi.ts` → `queryShiftKpiViewRows` | shift per day | No code change needed; current `.select('*')` aggregation works |
| `v_day_floor_board` | `lib/floorBoardApi.ts` → `fetchFloorDayBoard` | day per order/color/dept | No code change needed |

## Required changes

| # | Change | File(s) | Priority | Severity | Status |
|---|--------|---------|----------|----------|--------|
| 1 | Rename `.from('v_order_dept_progress')` → `.from('v_department_progress')` and update comment | `lib/mesReportsApi.ts` (`fetchOrderDeptProgressRows`) | P0 | Critical | Pending |
| 2 | Replace `v_audit_colorway_summary` query with `v_daily_audit` and aggregate resource/shift rows to colorway/department/date for `fetchFulfillmentAudits` | `lib/mesReportsApi.ts` (`fetchFulfillmentAudits`) | P0 | Critical | Pending |
| 3 | Replace `v_audit_colorway_summary` + `v_audit_summary` branch with a single `v_daily_audit` query and aggregate by `log_date` for `fetchStyleDeptAuditMetrics` | `lib/mesReportsApi.ts` (`fetchStyleDeptAuditMetrics`) | P0 | Critical | Pending |
| 4 | Verify `fetchStyleDeptQualitySummary` still works with live `v_daily_quality` columns (`inspected`, `first_time_pass`, `rework_pass`, `total_pass`, `dhu`, `defective_pct`, `top_defects`) | `lib/mesReportsApi.ts` (`fetchStyleDeptQualitySummary`) | P1 | High | Verify only |
| 5 | Verify `queryShiftKpiViewRows` aggregation still works with live `v_department_kpis_by_shift` columns | `lib/mesReportsApi.ts` (`queryShiftKpiViewRows`) | P1 | High | Verify only |
| 6 | Update docs references from `v_order_dept_progress` to `v_department_progress` and from `v_audit_*` to `v_daily_audit` | `docs/VIEW_TABLE_USAGE_REPORT.md`, `docs/STYLE_REPORT_DATA_FLOW.md` | P2 | Medium | Pending |
| 7 | Save the MES Supabase changelog to `docs/CHANGELOG_MES_SUPABASE_2026-07-23.md` | `docs/` | P2 | Medium | Pending |

## Aggregation rules for `v_daily_audit`

- Group by `log_date` (and `colorway_id` / `department_id` where needed).
- `lots` = sum of `lots`
- `lots_passed` = sum of `lots_passed`
- `lots_failed` = sum of `lots_failed`
- `samples_inspected` = sum of `samples_inspected`
- `passed` = sum of `passed`
- `failed` = sum of `failed`
- `major_failed` = sum of `major_failed`
- `minor_failed` = sum of `minor_failed`
- `defective_pct` = weighted average by `samples_inspected` or computed `failed / samples_inspected * 100`
- `passPct` = `passed / samples_inspected * 100`
- `dhu` not present in `v_daily_audit`; approximate from `defective_pct`

## Full codebase audit results (2026-07-23)

Searched `lib/`, `components/`, `pages/`, `hooks/`, `types/`, `utils/`, `services/` for the dropped `handover_slips` columns and the three renamed/dropped views.

| Check | Result |
|---|---|
| `from_order_route_id`, `to_order_route_id`, `to_line_allocation_id` in TS/TSX | **Zero references** |
| `v_order_dept_progress`, `v_audit_colorway_summary`, `v_audit_summary` in TS/TSX | **Zero references** (only `docs/` still has the old names) |
| Direct `.from('handover_slips')` calls | `lib/mesReports.ts:81`, `lib/transactionReportApi.ts:310`, `components/production/OrderCompletionWorkspace.tsx:430` |
| Columns these calls touch | `order_id`, `from_department_id`, `to_department_id`, `sent_qty`, `received_qty`, `qty_by_size`, `received_qty_by_size`, `sent_at`, `received_at`, `status`, `challan_number`, `notes`, `received_notes`, `sent_by`, `received_by` â€” all still exist in `handover_slips` |

**Conclusion:** no other frontend file has the rename/drop class of breakage. `orderDetailBundle.ts` uses the `get_order_detail_bundle` RPC and does not reference dropped columns/views directly. The `get_handover_report` RPC is now the preferred path; the `handover_slips` fallbacks in `transactionReportApi.ts` and `mesReports.ts` are safe because they only read surviving columns.

## Real `v_daily_audit` fields now wired in

`fetchFulfillmentAudits` now uses the genuine `v_daily_audit` columns:
- `aqlLevel` maps from `aql_level`
- `majorFailed` maps from `major_failed`
- `minorFailed` maps from `minor_failed`
- `passed` maps from `passed`
- `failed` maps from `failed`

No more `majorFailed: failedPieces, minorFailed: 0` placeholders.

## Note: `get_audit_report()` RPC

`get_audit_report()` already performs day+department aggregation server-side over `v_daily_audit`. If we later want to reduce client-side aggregation in `fetchStyleDeptAuditMetrics`, calling this RPC is an option. Not switching now because `fetchStyleDeptAuditMetrics` also supports colorway-scoped filtering and a specific `StyleDeptAuditMetrics` shape, but worth flagging for a future refactor.

## Status

- P0 code changes in `lib/mesReportsApi.ts` applied
- P0/P1 schema fixes already applied server-side (covered in `CHANGELOG_MES_SUPABASE_2026-07-23.md`)
- Changelog saved to `docs/CHANGELOG_MES_SUPABASE_2026-07-23.md`
