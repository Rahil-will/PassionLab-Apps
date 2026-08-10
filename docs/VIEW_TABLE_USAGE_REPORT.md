# PRODIGI — Supabase view-table usage by page

> Generated from the live `public` schema on Supabase project `xtfljldeceonqyzgkoyp` plus the Vite + React + TS front-end source.
> If you need to update a view, the tables below list the exact columns/functions the app expects.

## 1. All `public` views currently in the database

| # | View name |
|---|-----------|
| 1 | `v_audit_colorway_summary` |
| 2 | `v_audit_summary` |
| 3 | `v_batch_operation_totals` |
| 4 | `v_daily_efficiency_allocation` |
| 5 | `v_daily_output_allocation` |
| 6 | `v_daily_quality` |
| 7 | `v_daily_target` |
| 8 | `v_daily_workforce_allocation` |
| 9 | `v_daily_workforce_resource` |
| 10 | `v_day_floor_board` |
| 11 | `v_department_kpis_by_shift` |
| 12 | `v_operation_progress` |
| 13 | `v_order_dept_progress` |
| 14 | `v_order_rejected_qty_by_size` |
| 15 | `v_outsource_vendor_balances` |
| 16 | `v_shift_minutes` |

Only the **bold** views in the rest of this doc are actually hit with `.from('<view>')` in the front-end source. The others are either used inside RPCs only, or are currently unused.

---

## 2. Direct `.from()` view references (summary)

| Supabase view | Direct querying function | Top-level function | Page / component that calls it |
|---|---|---|---|
| `v_department_kpis_by_shift` | `lib/mesReportsApi.ts` → `queryShiftKpiViewRows` | `fetchFactoryKpis` | `pages/Dashboard.tsx` |
| `v_department_kpis_by_shift` | `lib/mesReportsApi.ts` → `queryShiftKpiViewRows` | `fetchDepartmentKpis` | `pages/reports/DayReport.tsx` (via `fetchDayResourceHourReport`) |
| `v_order_dept_progress` | `lib/mesReportsApi.ts` → `fetchOrderDeptProgressRows` | `fetchStyleJourneyReport` | `pages/reports/StyleReport.tsx`, `pages/production/OrderCompletion.tsx` |
| `v_audit_colorway_summary` | `lib/mesReportsApi.ts` → `fetchFulfillmentAudits` | `fetchStyleJourneyReport` | `pages/reports/StyleReport.tsx`, `pages/production/OrderCompletion.tsx` |
| `v_audit_colorway_summary` | `lib/mesReportsApi.ts` → `fetchStyleDeptAuditMetrics` | `fetchStyleDeptAuditMetrics` | `components/reports/StyleDeptAnalysisSection.tsx` (used by `pages/reports/StyleReport.tsx`) |
| `v_audit_summary` | `lib/mesReportsApi.ts` → `fetchStyleDeptAuditMetrics` | `fetchStyleDeptAuditMetrics` | `components/reports/StyleDeptAnalysisSection.tsx` |
| `v_daily_quality` | `lib/mesReportsApi.ts` → `fetchStyleDeptQualitySummary` | `fetchStyleDeptQualitySummary` | `components/reports/StyleDeptAnalysisSection.tsx` |
| `v_day_floor_board` | `lib/floorBoardApi.ts` → `fetchFloorDayBoard` | `fetchFloorDayBoard` | `pages/production/FloorDayBoard.tsx` |

---

## 3. Per-page detailed breakdown

### 3.1 `pages/reports/DayReport.tsx`

| What it calls | File/Function | Underlying view / RPC | Why it matters for view updates |
|---|---|---|---|
| `fetchDayResourceHourReportRange(factoryId, dateFrom, dateTo, activeDeptId, meta, colorwayLabels)` | `lib/mesReportsApi.ts` | For the **KPI block** it calls `fetchDepartmentKpis`, which falls back to `v_department_kpis_by_shift` | This is the only view the Day Report reads directly (via fallback) |
| `fetchReportMeta(factoryId)` | `lib/mesReportsApi.ts` | `departments`, `orders`, `buyers`, `resources` tables | Not a view |
| `fetchColorwayLabels(factoryId)` | `lib/mesReportsApi.ts` | `style_orders` + `colorways` tables | Not a view |
| `fetchDayDeptHandoverSummary(...)` | `lib/mesReportsApi.ts` | `transactionReportApi.ts` → `handover_slips` table | Not a view |

#### `fetchDepartmentKpis` fallback path

```ts
// lib/mesReportsApi.ts
export async function fetchDepartmentKpis(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DailyKpiRpcRow[]> {
  const viewRows = await queryDailyKpiViewRows(factoryId, { departmentId, dateFrom, dateTo });
  if (viewRows) return viewRows;
  // else falls back to RPC get_department_kpis
}

async function queryDailyKpiViewRows(...): Promise<DailyKpiRpcRow[] | null> {
  const shiftRows = await queryShiftKpiViewRows(factoryId, departmentId, dateFrom, dateTo);
  return aggregateShiftRowsToDaily(shiftRows);
}

async function queryShiftKpiViewRows(...):
  supabase
    .from('v_department_kpis_by_shift')
    .select('*')
    .eq('factory_id', factoryId)
    .gte('log_date', dateFrom)
    .lte('log_date', dateTo)
    .order('log_date')
    .order('shift_name')
    .order('order_id');
  if (departmentId) q = q.eq('department_id', departmentId);
```

#### What `v_department_kpis_by_shift` must return

The view is read with `select('*')`. `aggregateShiftRowsToDaily` turns shift-grain rows into `DailyKpiRpcRow[]`. Make sure the view exposes at least:

| Column | Purpose |
|---|---|
| `factory_id` | filter / grouping |
| `order_id` | grouping |
| `department_id` | filter / grouping |
| `log_date` | filter / grouping |
| `shift_name` | ordering, breakdown |
| `daily_target` | daily target per shift (used as `row.daily_target`) |
| `shift_output` | summed into `daily_output` |
| `shift_headcount` | used for productivity |
| `shift_available_mins` | used for efficiency denominator |
| `dhu` | null or number, rolled up weighted by `shift_output` |
| `defective_pct` | null or number, rolled up weighted by `shift_output` |
| `wip_qty` | summed into `wip_qty` |
| `data_completeness` OR `day_completeness` | string; if any row == `'complete'`, the day is marked complete |

#### What `DayReport.tsx` expects back

`fetchDayResourceHourReportRange` resolves to `DayResourceHourReport`:

```ts
export interface DayResourceHourReport {
  isQcDept: boolean;
  isNativeCutting?: boolean;
  isNativeShipment?: boolean;
  isOutsource?: boolean;
  isBatch?: boolean;
  hourColumns: string[];
  rows: DayResourceHourRow[];
  shiftSections?: DayShiftHourSection[];
  operationSections?: DayOperationHourSection[];
  nativeEntries?: DayNativeEntry[];
  productiveMinsPerWorker?: number;
  kpi: {
    target: number;
    output: number;
    efficiency: number | null;
    productivity: number | null;
    dhu: number | null;
    wip: number;
    passPct?: number | null;
  };
  handover?: DayHandoverSummary;
  handoverByDay?: Array<{ date: string; handover: DayHandoverSummary }>;
}
```

The `kpi` block comes from `fetchDepartmentKpis` (or its RPC fallback) and is weighted by `daily_output`.

---

### 3.2 `pages/Dashboard.tsx`

| What it calls | File/Function | Underlying view / RPC | Why it matters for view updates |
|---|---|---|---|
| `fetchFactoryKpis(factoryId, dateFrom, dateTo)` | `lib/mesReportsApi.ts` | First tries `get_factory_kpis` RPC; falls back to `v_department_kpis_by_shift` | This is the only view the Dashboard may read |
| `fetchCutToShipReport(...)` | `lib/mesReportsApi.ts` | `get_cut_to_ship_report` RPC | Not a view |

#### `fetchFactoryKpis` fallback path

```ts
// lib/mesReportsApi.ts
export async function fetchFactoryKpis(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DailyKpiRpcRow[]> {
  const { data, error } = await supabase.rpc('get_factory_kpis', {
    p_factory_id: factoryId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (!error) return (data || []) as DailyKpiRpcRow[];

  const viewRows = await queryDailyKpiViewRows(factoryId, { dateFrom, dateTo });
  if (viewRows) return viewRows;
  throw error;
}
```

`queryDailyKpiViewRows` uses the same `v_department_kpis_by_shift` view described in the Day Report section.

#### What `Dashboard.tsx` expects back

```ts
const [kpiRows, setKpiRows] = useState<Awaited<ReturnType<typeof fetchFactoryKpis>>>([]);
// where fetchFactoryKpis returns Promise<DailyKpiRpcRow[]>
```

`DailyKpiRpcRow` fields (from `lib/mesReportsApi.ts`):

```ts
export interface DailyKpiRpcRow {
  factory_id: string;
  order_id: string;
  department_id: string;
  log_date: string;
  daily_target: number;
  daily_output: number;
  daily_available_mins?: number;
  daily_efficiency_pct: number | null;
  day_completeness: string;
  dhu: number | null;
  defective_pct: number | null;
  wip_qty: number;
  shift_breakdown?: unknown;
}
```

---

### 3.3 `pages/reports/StyleReport.tsx`

This page is the heaviest user of views. It calls `fetchStyleJourneyReport` and renders `StyleDeptAnalysisSection`.

| What it calls | File/Function | Underlying view / RPC | Why it matters for view updates |
|---|---|---|---|
| `fetchStyleJourneyReport(...)` | `lib/mesReportsApi.ts` | Uses `fetchOrderDeptProgressRows` → `v_order_dept_progress` AND `fetchFulfillmentAudits` → `v_audit_colorway_summary` | Two views are read |
| `StyleDeptAnalysisSection` | `components/reports/StyleDeptAnalysisSection.tsx` | `fetchStyleDeptAuditMetrics` → `v_audit_colorway_summary` + `v_audit_summary`; `fetchStyleDeptQualitySummary` → `v_daily_quality` | Three more views inside the component |

#### 3.3.1 `fetchStyleJourneyReport` → `v_order_dept_progress`

```ts
// lib/mesReportsApi.ts
export async function fetchOrderDeptProgressRows(
  factoryId: string,
  orderId: string,
  colorwayId?: string | null,
): Promise<CutToShipJourneyRow[]> {
  const res = await supabase
    .from('v_order_dept_progress')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .order('flow_step');
  // optional colorwayId filter applied in-memory
}
```

##### What `v_order_dept_progress` must return

Because the function uses `.select('*')`, the view should expose every `CutToShipJourneyRow` field:

```ts
export interface CutToShipJourneyRow {
  factory_id: string;
  order_id: string;
  colorway_id: string | null;
  visit_id?: string | null;
  dept_id: string;
  dept_name: string;
  flow_step: number | null;
  is_in_flow: boolean;
  qty_received: number | null;
  qty_produced: number | null;
  qty_sent: number | null;
  qty_rejected: number | null;
  wip_qty: number | null;
  wip_qty_by_size?: SizeMap | null;
  qty_received_by_size?: SizeMap | null;
  qty_produced_by_size?: SizeMap | null;
  qty_sent_by_size?: SizeMap | null;
  qty_rejected_by_size?: SizeMap | null;
  status: string;
}
```

`flow_step` ordering is required. The `*_by_size` columns should be JSONB objects keyed by size label.

#### 3.3.2 `fetchStyleJourneyReport` → `v_audit_colorway_summary` (via `fetchFulfillmentAudits`)

```ts
// lib/mesReportsApi.ts
export async function fetchFulfillmentAudits(
  factoryId: string,
  orderId: string,
  colorwayId?: string | null,
): Promise<FulfillmentAuditRow[]> {
  let colorwayQuery = supabase
    .from('v_audit_colorway_summary')
    .select(
      `colorway_id, department_id, log_date,
       lots_run, lots_passed, lots_failed, lots_pass_pct,
       samples_inspected, failed_pieces, defective_pct`,
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .order('log_date', { ascending: false });
  if (colorwayId) colorwayQuery = colorwayQuery.eq('colorway_id', colorwayId);
}
```

If the view errors, it falls back to the `shipment_audits` table. The function maps into `FulfillmentAuditRow`:

```ts
export interface FulfillmentAuditRow {
  id: string;
  date: string;
  auditType: string;
  colorwayName: string;
  lotSize: number;
  sampleSize: number;
  aqlLevel: string | null;
  passed: number;
  failed: number;
  majorFailed: number;
  minorFailed: number;
  result: string | null;
  status: string;
  notes: string | null;
}
```

So `v_audit_colorway_summary` must return the exact selected columns, all numbers, plus `colorway_id` and `department_id`.

#### 3.3.3 `StyleDeptAnalysisSection` → `fetchStyleDeptQualitySummary` → `v_daily_quality`

```ts
// lib/mesReportsApi.ts
export async function fetchStyleDeptQualitySummary(
  factoryId: string,
  orderId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  colorwayId?: string | null,
  resourceId?: string | null,
): Promise<StyleDeptQualitySummary> {
  const { data, error } = await supabase
    .from('v_daily_quality')
    .select('log_date, inspected, first_time_pass, rework_pass, total_pass, dhu, defective_pct, top_defects')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('department_id', departmentId)
    .gte('log_date', dateFrom)
    .lte('log_date', dateTo);
}
```

##### What `v_daily_quality` must return

| Column | Type | Purpose |
|---|---|---|
| `log_date` | string/date | day label |
| `inspected` | number | total inspected pieces |
| `first_time_pass` | number | first-pass OK pieces |
| `rework_pass` | number | rework OK pieces |
| `total_pass` | number | all passed pieces |
| `dhu` | number / null | DHU |
| `defective_pct` | number / null | defective % |
| `top_defects` | JSON / array / object | top defects (optional, merged if missing) |

The function returns `StyleDeptQualitySummary`:

```ts
export interface StyleDeptQualitySummary {
  inspected: number;
  firstTimePass: number;
  reworkPass: number;
  ftrPct: number | null;
  avgDhu: number | null;
  avgDefectivePct: number | null;
  topDefects: StyleDeptDefectRow[];
  dailyDefective: Array<{ date: string; label: string; pct: number | null }>;
}
```

#### 3.3.4 `StyleDeptAnalysisSection` → `fetchStyleDeptAuditMetrics` → `v_audit_colorway_summary` / `v_audit_summary`

```ts
// lib/mesReportsApi.ts
export async function fetchStyleDeptAuditMetrics(
  factoryId: string,
  orderId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  colorwayId?: string | null,
): Promise<StyleDeptAuditMetrics | null> {
  if (colorwayId) {
    const { data, error } = await supabase
      .from('v_audit_colorway_summary')
      .select(
        'log_date, lots_run, lots_passed, lots_failed, lots_pass_pct, samples_inspected, failed_pieces, defective_pct',
      )
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .eq('department_id', departmentId)
      .eq('colorway_id', colorwayId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo);
  }

  const { data, error } = await supabase
    .from('v_audit_summary')
    .select('log_date, lots, total_samples, total_passed, total_failed, aql_pass_pct')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('department_id', departmentId)
    .gte('log_date', dateFrom)
    .lte('log_date', dateTo)
    .order('log_date');
}
```

##### What the two audit views must return

`v_audit_colorway_summary` (colorway-scoped) columns:
- `log_date`, `lots_run`, `lots_passed`, `lots_failed`, `lots_pass_pct`, `samples_inspected`, `failed_pieces`, `defective_pct`

`v_audit_summary` (department-scoped when no colorway) columns:
- `log_date`, `lots`, `total_samples`, `total_passed`, `total_failed`, `aql_pass_pct`

Return type:

```ts
export interface StyleDeptAuditMetrics {
  totalAudits: number;
  passedAudits: number;
  failedAudits: number;
  passPct: number | null;
  defectivePct: number | null;
  majorDefectivePct: number | null;
  dhu: number | null;
  daily: Array<{
    label: string;
    passPct: number | null;
    defectivePct: number | null;
    majorDefectivePct: number | null;
    auditCount: number;
    passedCount: number;
    failedCount: number;
  }>;
}
```

---

### 3.4 `pages/production/OrderCompletion.tsx`

The page imports `OrderCompletionWorkspace.tsx` which calls `fetchStyleJourneyReport` exactly like `StyleReport.tsx` does.

| What it calls | File/Function | Underlying view / RPC |
|---|---|---|
| `fetchStyleJourneyReport(factoryId, selectedOrderId, activeColorwayId)` | `lib/mesReportsApi.ts` | `v_order_dept_progress` + `v_audit_colorway_summary` |

The same `StyleJourneyReport` shape and `CutToShipJourneyRow` / `FulfillmentAuditRow` fields apply.

---

### 3.5 `pages/production/FloorDayBoard.tsx`

```ts
// lib/floorBoardApi.ts
export async function fetchFloorDayBoard(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<FloorBoardData> {
  const [rsRes, prodRes] = await Promise.all([
    supabase
      .from('v_day_floor_board')
      .select('factory_id, department_id, order_id, colorway_id, log_date, received, produced, sent')
      .eq('factory_id', factoryId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo),
    supabase.rpc('get_factory_production_summary', { p_factory_id: factoryId }),
  ]);
}
```

#### What `v_day_floor_board` must return

| Column | Purpose |
|---|---|
| `factory_id` | filter |
| `department_id` | grouping/department filter |
| `order_id` | order lookup |
| `colorway_id` | color lookup (nullable) |
| `log_date` | filter/range |
| `received` | received qty |
| `produced` | produced qty |
| `sent` | sent qty |

Return type:

```ts
export interface FloorBoardData {
  receivedSent: FloorBoardReceivedSentRow[];
  produced: FloorBoardProducedRow[];
  operationNames: Record<string, string>;
  operationsByDepartment: Record<string, { id: string; name: string }[]>;
}

export interface FloorBoardReceivedSentRow {
  factory_id: string;
  department_id: string;
  order_id: string;
  colorway_id: string | null;
  log_date: string;
  received: number;
  produced: number;
  sent: number;
}
```

---

## 4. Functions that touch views but are NOT currently called by any page

These exist in `lib/mesReportsApi.ts` and are safe to keep, but no page imports them right now:

| Function | View it touches | Status |
|---|---|---|
| `fetchDepartmentKpisByShift` | `v_department_kpis_by_shift` | Not imported by any page |

---

## 5. Views that are NOT directly referenced by `.from()` in the front-end

The following `public` views exist but are not queried directly from the React source. They may be consumed only inside Supabase RPCs, or may be unused:

- `v_batch_operation_totals`
- `v_daily_efficiency_allocation`
- `v_daily_output_allocation`
- `v_daily_target`
- `v_daily_workforce_allocation`
- `v_daily_workforce_resource`
- `v_operation_progress`
- `v_order_rejected_qty_by_size`
- `v_outsource_vendor_balances`
- `v_shift_minutes`

If you are changing one of these, grep the migrations and RPC definitions (`supabase/migrations/**/*.sql`) to find the actual consumers.

---

## 6. Quick checklist before editing a view

1. **Do not rename columns** unless you also update the `.select(...)` strings in `lib/mesReportsApi.ts` and `lib/floorBoardApi.ts`.
2. **Keep nullable columns nullable.** The code does `Number(row.xxx) || 0` for most numeric fields; `null` is expected for `dhu`, `defective_pct`, etc.
3. **Maintain the grain of the view.** `v_department_kpis_by_shift` must be one row per shift so `aggregateShiftRowsToDaily` can sum correctly. `v_order_dept_progress` must be one row per order/colorway/visit dept.
4. **Keep JSONB size maps as objects**, not arrays: `{ "S": 10, "M": 20 }`.
5. After changing a view, run `NOTIFY pgrst, 'reload schema';` in Supabase to refresh the PostgREST schema cache, otherwise `.from('view')` may return stale column errors.
