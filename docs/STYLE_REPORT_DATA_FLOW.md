# Style Report data flow

Document for the `Style Report` page (`pages/reports/StyleReport.tsx`) and the components it owns.
It describes every network/data function called, what it returns, the plain-human logic, and the Supabase tables, views or RPCs each function touches.

## Entry point

`pages/reports/StyleReport.tsx` renders the page. It keeps local state for the selected order, colorway, journey report, daily KPI rows and report metadata. It calls several `lib/…` fetch helpers and hooks; the production matrix is delegated to `components/reports/StyleProductionMatrixSection.tsx`.

## Fetch call sequence

When the user selects a factory and a style, the page fires these calls:

1. `useReportMeta(factoryId)` → `fetchReportMeta` (`lib/reports/reportMeta.ts`)
2. `useStyleJourneyReport(...)` → `fetchStyleJourneyReport`
3. `useStyleDailyKpis(...)` → `fetchStyleDailyKpis`
4. `useOrderDetailMetrics(...)` → `fetchOrderDetailBundle(...)` → `get_order_detail_bundle` RPC
5. `useOrderCutFabricByRoute(factoryId, orderId)` (only for the matrix)

Journey and daily KPI data are cached in TanStack Query (IndexedDB persist when offline). Order metadata (buyer, PO, delivery, etc.) is also read from `useDataStore().orders` when the order is already hydrated.

---

## Read-boundary convention

| Layer | Location | Rule |
|-------|----------|------|
| Report fetch API | `lib/reports/` | All Supabase reads for reports live here (or `lib/transactionReportApi.ts` for handovers). Pages/components do not call `supabase` directly. |
| Query cache | `lib/queries/reports.ts` | Report pages use TanStack Query hooks (`useReportMeta`, `useStyleJourneyReport`, …) — not raw `useEffect` + fetch. |
| Legacy shim | `lib/mesReportsApi.ts` | Re-exports `lib/reports` for existing imports; new code should import from `lib/reports`. |

### Module layout (`lib/reports/`)

- `reportMeta.ts` — `fetchReportMeta`, colorway labels
- `kpiAndProgress.ts` — KPI RPCs, cut-to-ship, order/operation progress
- `dayReport.ts` — day dept/handover/resource-hour reports
- `styleReport.ts` — style journey, daily KPIs, quality/audit sections
- `shared/qcUtils.ts`, `shared/rpcUtils.ts`, `shared/shiftLogUtils.ts` — shared helpers
- `mesReportsCore.ts` — barrel re-export (legacy name)

---

## 1. `fetchReportMeta`

**File:** `lib/reports/reportMeta.ts` (was `lib/mesReportsApi.ts`)

**Purpose:** Builds the searchable list of styles / POs and the department metadata needed for the report header and dropdowns.

**Tables / views / RPCs it reads:**

| Source | Why it is read |
|--------|----------------|
| `departments` | Department list with `role`, `planning_mode`, `is_native`, `transaction_enabled`, `supervisor_enabled`. |
| `style_orders` | All orders for the factory (`id`, `style_name`, `style_ref`, `buyer_name`, `po_number`, `created_at`). |
| `buyers` | Buyer names. |
| `assigned_resources` | Active factory resources and their department. |
| `operations` | Capture apps per department (used to build `productionPath`). |

**Plain logic:**
- Load departments. Try a wider select first; if it fails (old DB without extra columns), fall back to a slimmer select.
- Load orders, buyers, resources and operations in parallel.
- Merge the department settings with the capture apps from `operations` to compute each department's `productionPath` (`native_cutting`, `hourly`, etc.).
- Return `departments`, `orders`, `buyers`, `resources`.

---

## 2. `fetchStyleJourneyReport`

**File:** `lib/mesReportsApi.ts`

**Purpose:** The main lifecycle report. It returns one `StyleJourneyReport` containing the order header, colorways, flow departments, per-department produced/received/sent numbers, shipment summary and audit history.

**Tables / views / RPCs it reads (top-level):**

| Source | Why it is read |
|--------|----------------|
| `style_orders` | Order header (style, PO, qty, allowances, dates, etc.). |
| `colorways` | Colorway list with `qty`. |
| `departments` | Department list for routing and apps. |
| `order_delivery_targets` | Latest delivery target date. |
| `v_order_dept_progress` | Per-department flow numbers (`fetchOrderDeptProgressRows`). |
| `order_routing_steps` | Routing steps (`fetchOrderRoutingSteps`). |
| `line_allocations` | Line allocation rows per order (and optionally colorway). |
| `hourly_counts` | Hourly output counts per resource/department. |
| `shipments` | Shipment records. |
| `rejections` | Rejection records. |
| `assigned_resources` | Resource names for line output grouping. |
| `audit_sessions` | Floor AQL audit sessions per department (`fetchStyleOrderDeptAudits`). |
| `v_audit_colorway_summary` | Colorway QA audit summary (`fetchFulfillmentAudits`, falls back to `shipment_audits`). |
| `shipment_audits` | Fallback audit data if the view is unavailable. |

**Plain logic:**
1. Load order, colorways, departments, delivery target, routing steps and `v_order_dept_progress` in parallel.
2. Convert routing steps into `visitCells` (one per work-center visit; a department visited twice becomes two visits).
3. Load line allocations, hourly counts, shipments, rejections, resource names, AQL audits and fulfillment audits in parallel.
4. Compute `flowDepts` from `visitCells` plus the progress data: for each visit, sum `produced`, `received`, `sent`, `wip` and build a per-visit `lineBreakdown`.
5. Return a `journey` object with `order`, `colorways`, `flowDepts`, `shipmentSummary`, `deptAudits`, and other lifecycle fields.

### 2a. `fetchOrderDeptProgressRows`

**File:** `lib/mesReportsApi.ts`

**Reads:** `v_order_dept_progress` (view)

**Logic:** Select all rows for the order, ordered by `flow_step`. If a colorway filter is passed, remove rows that belong to a different colorway.

### 2b. `fetchOrderRoutingSteps`

**File:** `lib/orderRoutingEditor.ts`

**Reads:** `order_routing_steps`

**Logic:** Try a few column sets (slim v3, slim legacy) to stay compatible with different DB versions. Order by `seq`. If `factoryId` is supplied, fetch catalog operations for `operation_def_id`s and enrich step labels.

### 2c. `fetchStyleOrderDeptAudits`

**File:** `lib/mesReportsApi.ts`

**Reads:** `audit_sessions`

**Logic:** Load completed `audit_sessions` for the order. Filter to departments whose apps include an AQL/inspection app. Group sessions by department and sort by date.

### 2d. `fetchFulfillmentAudits`

**File:** `lib/mesReportsApi.ts`

**Reads:** `v_audit_colorway_summary` (preferred), `shipment_audits` (fallback)

**Logic:** First try the `v_audit_colorway_summary` view, colorway-scoped. If that fails or returns nothing, fall back to `shipment_audits`. Map the columns to a common `FulfillmentAuditRow` shape.

---

## 3. `fetchStyleDailyKpis`

**File:** `lib/mesReportsApi.ts`

**Purpose:** Per-department daily KPI rows used in the `StyleDeptAnalysisSection` charts and tables.

**Tables / views / RPCs it reads:**

| Source | Why it is read |
|--------|----------------|
| `get_style_kpis` (RPC) | Whole-order daily KPI rows (`fetchStyleKpis`). |
| `hourly_counts` | Daily output per department/date for colorway-scoped mode. |
| `inspection_sessions` | QC pass/fail numbers for colorway-scoped mode. |
| `workforce_logs` | Headcount for colorway-scoped mode. |
| `line_allocations` | SAM / target data for colorway-scoped mode. |
| `shifts` | Shift definitions for colorway-scoped mode. |

**Plain logic:**
- If no `meta` is passed, call `fetchReportMeta` first to build a `department id → name` map.
- If a `colorwayId` is passed, run `fetchStyleDailyKpisForColorway`: query `hourly_counts`, `inspection_sessions`, `workforce_logs`, `line_allocations` and `shifts` for that colorway (with a null-colorway tolerance for single-color orders), then aggregate shift data into daily KPI rows.
- If no colorway is selected, call `fetchStyleKpis` which invokes the `get_style_kpis` RPC and maps the returned rows to `StyleDeptDailyRow`.

---

## 4. `useOrderDetailMetrics` → `fetchOrderDetailBundle`

**Files:** `hooks/useOrderDetailMetrics.ts`, `lib/orderDetailBundle.ts`

**Purpose:** Single consolidated bundle used for the reconciliation row, the production matrix size counts, and the cut-to-ship numbers.

**Tables / views / RPCs it reads:**

| Source | Why it is read |
|--------|----------------|
| `get_order_detail_bundle` (RPC) | One RPC call; the DB function internally joins the order, colorways, routing steps, produced quantities, shipments, rejections, etc. |

**What the RPC returns (parsed into `OrderDetailBundle`):**

- `routing_cells` — per-visit routing cells with `route_ids`, `operations`, `capture_apps`, `is_qc`.
- `journey` — `CutToShipJourneyRow[]` flow data.
- `size_produced` — produced quantities per colorway / route / size.
- `planned_by_colorway` — planned (order/adjusted) quantities per colorway by size.
- `reconciliation` — `CutToShipRow[]` with `cut_qty`, `shipped_qty`, `rejected_qty`, `cut_qty_by_size`, `cut_qty_by_component`, etc.
- `shipments` — raw shipment rows.
- `rejections` — raw rejection rows.
- `flowMetrics` / `flowByColor` — derived visit flow metrics per colorway.
- `sizeProgress` — a `SizeProgressLookup` object that can answer `getVisitSizeCount(colorwayId, visitId, size)` and `getRouteSizeCount(colorwayId, routeStepId, size)`.

**Plain logic:**
- Build a cache key from `factoryId + orderId + routingSteps`.
- If not cached, call `get_order_detail_bundle` once. De-duplicate concurrent calls for the same order.
- After the payload is parsed, `enrichBundle` filters/re-shapes it for the requested `colorwayIds`.
- `sizeProgressFromBundle` normalizes the `size_produced` rows and exposes `getRouteSizeCount` and `getVisitSizeCount` helpers.

---

## 5. `useOrderCutFabricByRoute`

**File:** `hooks/useOrderCutFabricByRoute.ts`

**Purpose:** Provides the per-routing-step, per-fabric-component cut quantity breakdown shown in the origin-department matrix cells.

**Tables / views / RPCs it reads:**

| Source | Why it is read |
|--------|----------------|
| `cutting_bundles` | Each bundle links a cutting session, colorway, fabric component and size to a qty. |
| `cutting_sessions` | Maps session to `order_route_id` (the routing step). |
| `fabric_components` | Fabric type and `is_primary` flag. |

**Plain logic:**
1. Load bundles, sessions and components for the order in parallel.
2. Group bundles by `order_route_id` (or session id if missing), then by colorway, then by fabric component.
3. Sum quantities per size (`by_size`) and total per component.
4. Also build an aggregate "all colors" breakdown for each route.
5. Return `fabricByRoute` (`Map<routeId, Map<colorwayId | 'aggregate', FabricCutQtyComponentRow[]>>`) and `fabricActuals` for gantt.

`getFabricComponentsForRoute(fabricByRoute, routeId, colorwayId?)` reads the already-in-memory map. If `colorwayId` is omitted, it returns the aggregate for that route.

---

## 6. Key helper functions used in `StyleReport.tsx` and `StyleProductionMatrixSection.tsx`

### `scopedOrderQuantities`

**File:** `lib/orderQtyScope.ts`

**Logic:** Computes the order qty and adjusted qty for either a whole order or a single colorway. Prefers summing the colorway size rows; falls back to the order header `orderQty` / `adjQty` if the size rows are empty.

### `resolveOriginCutQty`

**File:** `lib/cutToShipOrigin.ts`

**Logic:**
1. Find the first origin-department step in route order. Prefer `is_primary_output`; exclude lining-only `output_aspect`.
2. Try to get the produced qty from `flowMetrics`, then from `journey`, then from `flowDepts`, then from `productionSummary`.
3. If `cutQtySource === 'captured'` and a captured cut qty exists, use that first.

### `mergeCutToShipRows`

**File:** `lib/orderCompletionScope.ts`

**Logic:** Sums a list of `CutToShipRow` objects into one aggregate row. Adds `cut_qty`, `shipped_qty`, `rejected_qty`, `order_qty`, `wip_qty`, merges `cut_qty_by_size`, `shipped_qty_by_size`, `rejected_qty_by_size` and `cut_qty_by_component`. Computes `reconciliation_gap = cut - shipped - rejected` and the latest `last_shipment_date`.

### `buildFulfillmentSnapshot`

**File:** `lib/fulfillmentMetrics.ts`

**Logic:**
- `orderToCutPct` = `firstOperationProduced / orderQty` or `cutQty / adjQty`.
- `orderToShipPct` = `lastOperationProduced / orderQty` or `shippedQty / orderQty`.
- `cutToShipPct` = `lastOperationProduced / firstOperationProduced` or `shippedQty / cutQty`.
- `onTime`, `inFull`, `onTimeInFull` only computed when the colorway status is `closed`.

### `formatFulfillmentPct`

**File:** `lib/fulfillmentMetrics.ts`

**Logic:** Formats `value.toFixed(1) + '%'`; returns `—` for null/NaN.

### `sumMatrixColumnSize` / `sumMatrixColumnTotal`

**File:** `lib/productionMatrixHeaders.ts`

**Logic:**
- If `sizeProgress.getRouteSizeCount` exists, sum `getRouteSizeCount(colorwayId, col.stepId, size)` for all requested colorways.
- Otherwise, find the primary step of the visit and use `getVisitSizeCount(colorwayId, visitId, size)`.
- `sumMatrixColumnTotal` simply sums `sumMatrixColumnSize` across all sizes.

### `matrixColumnsFromRoutingSteps`

**File:** `lib/productionMatrixHeaders.ts`

**Logic:** One column per routing step (`stepId = routing step id`, `visitId = shared visit id`); a department with multiple operations gets one column per operation.

### `getFabricComponentsForRoute`

**File:** `hooks/useOrderCutFabricByRoute.ts`

**Logic:** Looks up `fabricByRoute` by `routeId`, then by `colorwayId` or the aggregate key. Returns `[]` if nothing is found.

### `balanceToShipBySize`

**File:** `lib/cutToShipOps.ts`

**Logic:** For each size: `balance = max(lastDeptQty - rejected - shipped, 0)`.

### `orderedSizeKeys` / `sizeOrderQty` / `sizeAdjQty`

**Files:** `lib/colorwaySizesUtils.ts`

**Logic:**
- `sizeOrderQty` reads `order_qty` or legacy `qty`.
- `sizeAdjQty` reads `adj_qty` or legacy `plannedQty`.
- `orderedSizeKeys` preserves the order from the colorway size rows and appends any extra keys from maps at the end.

### `formatFabricCutQtyTooltip`

**File:** `lib/fabricCutQtyDisplay.ts`

**Logic:** Joins component names and totals, marking the primary component.

### `fabricCutQtyComponentsForVisit` (not used after the latest fix)

**File:** `lib/fabricCutQtyDisplay.ts`

**Status:** Replaced by `getFabricComponentsForRoute` in `StyleProductionMatrixSection.tsx`. It used to apportion an order-level `cut_qty_by_component` to a specific visit using `sizeProgress` ratios.

---

## 7. Tables and views touched by the Style Report page

| Table / View | Used in |
|--------------|---------|
| `departments` | `fetchReportMeta`, `fetchStyleJourneyReport` |
| `style_orders` | `fetchReportMeta`, `fetchStyleJourneyReport` |
| `colorways` | `fetchStyleJourneyReport` |
| `buyers` | `fetchReportMeta` |
| `assigned_resources` | `fetchReportMeta`, `fetchStyleJourneyReport` |
| `operations` | `fetchReportMeta` |
| `order_delivery_targets` | `fetchStyleJourneyReport` |
| `order_routing_steps` | `fetchStyleJourneyReport` (`fetchOrderRoutingSteps`) |
| `line_allocations` | `fetchStyleJourneyReport`, `fetchStyleDailyKpisForColorway` |
| `hourly_counts` | `fetchStyleJourneyReport`, `fetchStyleDailyKpisForColorway` |
| `shipments` | `fetchStyleJourneyReport` |
| `rejections` | `fetchStyleJourneyReport` |
| `audit_sessions` | `fetchStyleJourneyReport` (`fetchStyleOrderDeptAudits`) |
| `shipment_audits` | `fetchStyleJourneyReport` (`fetchFulfillmentAudits` fallback) |
| `inspection_sessions` | `fetchStyleDailyKpisForColorway` |
| `workforce_logs` | `fetchStyleDailyKpisForColorway` |
| `shifts` | `fetchStyleDailyKpisForColorway` |
| `v_order_dept_progress` | `fetchStyleJourneyReport` (`fetchOrderDeptProgressRows`) |
| `v_audit_colorway_summary` | `fetchStyleJourneyReport` (`fetchFulfillmentAudits`) |
| `cutting_bundles` | `useOrderCutFabricByRoute` |
| `cutting_sessions` | `useOrderCutFabricByRoute` |
| `fabric_components` | `useOrderCutFabricByRoute` |
| `get_style_kpis` (RPC) | `fetchStyleDailyKpis` (`fetchStyleKpis`) |
| `get_order_detail_bundle` (RPC) | `useOrderDetailMetrics` (`fetchOrderDetailBundle`) |

---

## 8. Mental model summary

- The **header / search** comes from `fetchReportMeta` and `useDataStore.orders`.
- The **journey (flow, shipments, audits)** comes from `fetchStyleJourneyReport`.
- The **daily charts** come from `fetchStyleDailyKpis` (RPC for all colors, direct tables for one color).
- The **cut/ship reconciliation and the matrix size counts** come from one `get_order_detail_bundle` RPC via `useOrderDetailMetrics`.
- The **origin-department fabric popover** in the matrix comes from `useOrderCutFabricByRoute`, which reads `cutting_bundles`, `cutting_sessions` and `fabric_components` directly.
