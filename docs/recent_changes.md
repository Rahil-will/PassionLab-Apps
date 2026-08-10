# Recent changes summary

> Generated after the Department Performance graph investigation / fix pass.

## 1. Department Performance KPIs

- `lib/mesReportsApi.ts`
  - `fetchStyleKpis` now calls `get_style_kpis(...)` RPC and rolls the returned shift-grain rows up to day-grain using the existing `aggregateShiftRowsToDaily` helper.
  - This makes output / target / efficiency / productivity / DHU / defective-% all come from the live `v_department_kpis_by_shift` based source instead of the old stub that only summed `hourly_counts`.
  - The no-colorway path in `fetchStyleDailyKpis` naturally sums every colorway because `v_department_kpis_by_shift` has no `colorway_id` column and `aggregateShiftRowsToDaily` groups by `factory_id | order_id | department_id | log_date` only.

## 2. Per-order journey / progress now uses RPCs, not views

- `lib/mesReportsApi.ts`
  - `fetchOrderDeptProgressRows` switched from `.from('v_department_progress')` to `supabase.rpc('order_dept_progress_rows', { p_factory_id, p_order_id })` and sorts the result client-side.
  - `fetchOperationProgressRows` (used by the Production Matrix) switched from `.from('v_operation_progress')` to `supabase.rpc('operation_progress_rows', { p_factory_id, p_order_id })`.
  - This scopes every CTE to one order/factory from the start, instead of computing the whole factory and filtering after the fact.

## 3. Routing / visit alignment

- `lib/orderRoutingFlow.ts`
  - `visitPipelineCellsFromRouting` now uses the primary step's `visit_id` for `sharedVisit`, and exposes `primaryRouteId`.
- `components/reports/StyleProductionMatrixSection.tsx`
  - Matrix cutting hover popover now uses `primaryRouteId` for route-scoped size/fabric breakdown keys.
- `lib/mesReportsApi.ts`
  - `buildSizeProgressFromJourney` builds route-level (`byColorwayRoute`) size progress lookups from `OperationProgressRow` data and exposes `getRouteSizeCount` / `getRouteTotal`.

## 4. Earlier fixes still in place

- `lib/transactionReportApi.ts` TypeScript errors fixed.
- `lib/mesReportsApi.ts` `cutting_bundles` / `cutting_lays` column mismatch handling fixed and verified across other files.
- Fallbacks added for missing KPI RPCs (`PGRST202` / `PGRST203` no longer throw).
- `useOrderDetailMetrics` investigation / replacements aligned with `get_order_detail_bundle`.

## 5. Console cleanup

- Removed the two `console.error(err);` statements from `pages/reports/StyleReport.tsx`.
- `components/production/OrderCompletionWorkspace.tsx` had no remaining `console.*` calls.

## 6. Direct view references still in the app as of now

No `pages/`, `components/`, or `hooks/` files directly query a `v_*` view.

`lib/` still has a few direct `.from('v_...')` calls:

| File | View | Purpose |
|------|------|---------|
| `lib/mesReportsApi.ts` | `v_department_kpis_by_shift` | `queryDailyKpiViewRows` fallback when the `get_department_kpis` RPC is missing |
| `lib/mesReportsApi.ts` | `v_daily_audit` | `fetchStyleAuditMetrics` resource/shift-grain audit data |
| `lib/mesReportsApi.ts` | `v_daily_quality` | `fetchStyleDeptQualitySummary` QC/quality data |
| `lib/floorBoardApi.ts` | `v_day_floor_board` | Floor board received/produced/sent aggregates |

Everything else now goes through RPCs or direct table queries.

## 7. Fabric output popover uses per-operation cutting component progress

- `lib/mesReportsApi.ts`
  - Added `CuttingComponentProgressRow` interface and `fetchCuttingComponentProgressRows` calling the `cutting_component_progress_rows(p_factory_id, p_order_id)` RPC.
  - Added `cuttingComponentsForOperation` helper to convert the per-route/per-colorway RPC rows into the `FabricCutQtyComponentRow[]` used by `FabricOutputBreakdownPopover`.
- `components/reports/StyleProductionMatrixSection.tsx`
  - Replaced `useOrderCutFabricByRoute` + `getFabricComponentsForRoute` with `fetchCuttingComponentProgressRows` and `cuttingComponentsForOperation`.
  - The popover now reads the real per-operation breakdown instead of approximating from an order-wide `cut_qty_by_component`.
- `components/production/OrderCompletionWorkspace.tsx`
  - Replaced `fabricCutQtyComponentsForVisit` ratio apportionment with `cuttingComponentsForOperation` filtered by `column.stepId`.
  - This fixes e.g. Fixed Cutting showing a Secondary fabric row when only Block Cutting actually produced Secondary bundles.

## 8. Shared fabric progress hook and loading skeleton alignment

- `hooks/useCuttingComponentProgress.ts`
  - New shared hook that fetches `cutting_component_progress_rows` once and exposes `componentsFor(operationId, colorwayId?, size?)`.
  - Replaces duplicated `useEffect` + `useState` blocks in the matrix consumers and wires `loading` consistently.
- `components/reports/StyleProductionMatrixSection.tsx`
  - Refactored to use `useCuttingComponentProgress`.
  - Empty-state fallback (`No size breakdown...`) now waits for `cuttingProgressLoading` to finish.
- `components/production/OrderCompletionWorkspace.tsx`
  - Refactored to use `useCuttingComponentProgress` with the existing `detailRefreshKey`.
  - `detailPanelLoading` and `ProductionMatrixTable loading` both wait for `cuttingProgressLoading` so the detail skeleton stays up and the popover cannot be empty.
- `pages/production/StyleDetails.tsx` and `pages/production/StyleColorDetails.tsx`
  - Matrix fabric popovers now use `useCuttingComponentProgress` for the exact per-operation breakdown.
  - `useOrderCutFabricByRoute` is kept for gantt fabric actuals only.
