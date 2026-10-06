import format from 'date-fns/format';
import { supabase } from '../../supabase';
import { allocationSamValue } from '../../allocationUtils';
import { isQcDept } from '../../reportDeptUtils';
import { resolvePlanningMode, dayReportRoleKind } from '../../departmentFilters';
import { getRegularShiftHours } from '../../shiftHours';
import {
  allActiveHourSlots,
  activeHourSlotsForShift,
  isOtShift,
  regularShiftProductiveMins,
} from '../../shiftSlots';
import type { Shift } from '../../../types';
import { qcSessionOutputQty } from '../shared/qcUtils';
import { isMissingRelationError, isMissingColumnError } from '../shared/rpcUtils';
import { colorwayDisplayLabel, resolveColorwayMap, resolveOrderMap, type ColorwayLabel, type ReportMeta, type ReportOrderSummary } from '../reportMeta';
import { fetchDepartmentKpis, type DailyKpiRpcRow } from '../kpiAndProgress';
import { mapShiftRow } from '../shared/shiftLogUtils';
import {
  aggregateDeptDayKpi,
  applyAllocationPlanToDayRows,
  allocRowKey,
  averageDailyHeadcountFromLogs,
  buildResourceWorkforceDetails,
  computeDayDeptMetricsFromRows,
  enrichDayResourceRows,
  listDatesInRange,
  type AllocPlanRow,
} from './deptMetrics.pure';
import { fetchDayDeptHandoverRange, fetchDayDeptHandoverSummary, mergeHandoverSummaries } from './handover';
import {
  buildCuttingOperationSectionsFromRpc,
  fetchDayCuttingSessionsRpc,
  mapCuttingSessionRpcToNativeEntry,
} from './cuttingSessionsRpc';
import {
  fetchDayStandardReportRpc,
  fetchDayTerminalReportRpc,
  mapStandardRpcToBatchEntry,
  mapTerminalRpcToNativeEntry,
} from './standardTerminalRpc';
import type {
  DayNativeEntry,
  DayOperationHourSection,
  DayResourceHourReport,
  DayResourceHourRow,
  DayShiftHourSection,
  DayStyleColorHourReport,
  DayStyleColorHourRow,
  WorkforceCategoryCount,
} from './types';

export async function fetchDayStyleColorHourReport(
  factoryId: string,
  date: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayStyleColorHourReport> {
  const { data, error } = await supabase
    .from('hourly_counts')
    .select('order_id, colorway_id, resource_id, hour_slot, count')
    .eq('factory_id', factoryId)
    .eq('department_id', departmentId)
    .eq('log_date', date);

  if (error) throw error;

  const orderMap = await resolveOrderMap(
    factoryId,
    meta,
    (data || []).map((raw) => raw.order_id as string),
  );
  const colorMap = new Map(colorwayLabels.map((c) => [c.id, c]));
  const resourceMap = new Map(meta.resources.map((r) => [r.id, r]));
  const hourSet = new Set<string>();
  const rowMap = new Map<string, DayStyleColorHourRow>();

  for (const raw of data || []) {
    const orderId = raw.order_id as string;
    const colorwayId = (raw.colorway_id as string) || null;
    const resourceId = (raw.resource_id as string) || null;
    const hourSlot = String(raw.hour_slot ?? '');
    const count = Number(raw.count) || 0;
    if (!hourSlot) continue;
    hourSet.add(hourSlot);
    const key = `${orderId}|${colorwayId ?? ''}|${resourceId ?? ''}`;
    const order = orderMap.get(orderId);
    const resource = resourceId ? resourceMap.get(resourceId) : undefined;
    const row =
      rowMap.get(key) ??
      {
        orderId,
        colorwayId,
        resourceId,
        styleName: order?.styleName || orderId.slice(0, 8),
        poNumber: order?.poNumber || '',
        colorName: colorwayDisplayLabel(colorwayId, colorMap),
        resourceName: resource?.name || '—',
        hours: {},
        total: 0,
      };
    row.hours[hourSlot] = (row.hours[hourSlot] || 0) + count;
    row.total += count;
    rowMap.set(key, row);
  }

  const hourColumns = [...hourSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = [...rowMap.values()]
    .filter((r) => r.total > 0)
    .sort(
      (a, b) =>
        a.styleName.localeCompare(b.styleName) ||
        a.colorName.localeCompare(b.colorName) ||
        a.resourceName.localeCompare(b.resourceName),
    );

  return { hourColumns, rows };
}

async function fetchLineAllocPlanRows(
  factoryId: string,
  orderIds: string[],
): Promise<AllocPlanRow[]> {
  if (orderIds.length === 0) return [];

  const baseSelect =
    'id, order_id, colorway_id, line_id, department_id, sam, kpi_inputs, daily_target, qty, start_date, end_date';

  let { data, error } = await supabase
    .from('line_allocations')
    .select(`${baseSelect}, hourly_target`)
    .eq('factory_id', factoryId)
    .in('order_id', orderIds);

  if (error) {
    const msg = String(error.message ?? '');
    if (msg.includes('hourly_target') || msg.includes('column')) {
      const fallback = await supabase
        .from('line_allocations')
        .select(baseSelect)
        .eq('factory_id', factoryId)
        .in('order_id', orderIds);
      if (fallback.error) throw fallback.error;
      data = (fallback.data ?? []).map((row) => ({ ...row, hourly_target: null }));
    } else {
      throw error;
    }
  }

  return (data || []).map((raw) => ({
    id: raw.id as string,
    order_id: raw.order_id as string,
    colorway_id: (raw.colorway_id as string) || null,
    line_id: (raw.line_id as string) || '',
    department_id: (raw.department_id as string) || null,
    daily_target: Number(raw.daily_target) || 0,
    hourly_target:
      raw.hourly_target != null ? Number(raw.hourly_target as number) : null,
    qty: Number(raw.qty) || 0,
    start_date: (raw.start_date as string) || null,
    end_date: (raw.end_date as string) || null,
    sam: (raw.sam as number) ?? null,
    kpi_inputs: (raw.kpi_inputs as { sam?: number } | null) ?? null,
  }));
}


const UNASSIGNED_SHIFT = '__unassigned__';

function resolveShiftIdForSlot(
  shifts: Shift[],
  hourSlot: string,
  storedShiftId: string | null,
): string {
  if (storedShiftId) return storedShiftId;
  const matches = shifts.filter((s) => activeHourSlotsForShift(s).includes(hourSlot));
  if (matches.length === 0) return UNASSIGNED_SHIFT;
  const nonOt = matches.find((s) => !isOtShift(s));
  return (nonOt ?? matches[0]).id;
}

function shiftDisplayName(shifts: Shift[], shiftId: string): string {
  if (shiftId === UNASSIGNED_SHIFT) return 'Shift';
  return shifts.find((s) => s.id === shiftId)?.name ?? 'Shift';
}

function hourColumnsForShift(
  shifts: Shift[],
  shiftId: string,
  dataSlots: Set<string>,
): string[] {
  const allPlanned = allActiveHourSlots(shifts);
  if (shiftId === UNASSIGNED_SHIFT) {
    const cols = allPlanned.length > 0 ? allPlanned : [...dataSlots];
    return cols.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  const shift = shifts.find((s) => s.id === shiftId);
  const planned = activeHourSlotsForShift(shift);
  const cols =
    planned.length > 0
      ? planned
      : allPlanned.length > 0
        ? allPlanned
        : [...dataSlots];
  return cols.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function sortShiftIds(shifts: Shift[], shiftIds: string[]): string[] {
  return [...shiftIds].sort((a, b) => {
    const shiftA = shifts.find((s) => s.id === a);
    const shiftB = shifts.find((s) => s.id === b);
    const otA = shiftA ? isOtShift(shiftA) : a === UNASSIGNED_SHIFT;
    const otB = shiftB ? isOtShift(shiftB) : b === UNASSIGNED_SHIFT;
    if (otA !== otB) return otA ? 1 : -1;
    return shiftDisplayName(shifts, a).localeCompare(shiftDisplayName(shifts, b));
  });
}

function mergeShiftSectionsFromDailyReports(
  dailyReports: DayResourceHourReport[],
  days: string[],
): DayShiftHourSection[] {
  const byShift = new Map<
    string,
    { shiftName: string; hourColumns: Set<string>; rows: DayResourceHourRow[] }
  >();

  for (let i = 0; i < dailyReports.length; i++) {
    const sections =
      dailyReports[i].shiftSections?.length > 0
        ? dailyReports[i].shiftSections
        : [
            {
              shiftId: UNASSIGNED_SHIFT,
              shiftName: 'Shift',
              hourColumns: dailyReports[i].hourColumns,
              rows: dailyReports[i].rows,
            },
          ];
    for (const sec of sections) {
      const bucket = byShift.get(sec.shiftId) ?? {
        shiftName: sec.shiftName,
        hourColumns: new Set<string>(),
        rows: [],
      };
      for (const col of sec.hourColumns) bucket.hourColumns.add(col);
      for (const row of sec.rows) {
        bucket.rows.push({ ...row, logDate: days[i], shiftId: sec.shiftId });
      }
      byShift.set(sec.shiftId, bucket);
    }
  }

  return [...byShift.entries()].map(([shiftId, bucket]) => ({
    shiftId,
    shiftName: bucket.shiftName,
    hourColumns: [...bucket.hourColumns].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
    rows: bucket.rows,
  }));
}


const CUTTING_OUTPUT_HOUR = 'Output';

type OriginRouteStepRow = {
  id: string;
  order_id: string;
  seq: number;
  operation_name?: string | null;
  dept_name?: string | null;
  is_primary_output?: boolean | null;
  step_type?: string | null;
  operation_def_id?: string | null;
};

function mapOriginRouteStepRow(row: Record<string, unknown>): OriginRouteStepRow {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    seq: Number(row.seq) || 0,
    operation_name: (row.operation_name as string) || null,
    dept_name: (row.dept_name as string) || null,
    is_primary_output: row.is_primary_output as boolean | null,
    step_type: (row.step_type as string) || null,
    operation_def_id: (row.operation_def_id as string) || null,
  };
}

async function fetchRoutingStepsForDepartment(
  factoryId: string,
  departmentId: string,
): Promise<OriginRouteStepRow[]> {
  const columnSets = [
    'id, order_id, seq, dept_id, dept_name, operation_name, operation_def_id, is_primary_output, step_type',
    'id, order_id, seq, dept_id, dept_name, operation_name, operation_def_id, is_primary_output',
  ];

  const merged = new Map<string, OriginRouteStepRow>();
  let workingColumns: string | null = null;

  for (const columns of columnSets) {
    const byDept = await supabase
      .from('order_routing_steps')
      .select(columns)
      .eq('factory_id', factoryId)
      .eq('dept_id', departmentId)
      .order('seq');
    if (byDept.error) {
      if (isMissingColumnError(byDept.error)) continue;
      throw byDept.error;
    }
    workingColumns = columns;
    for (const row of (byDept.data || []) as unknown as Record<string, unknown>[]) {
      if (!row?.id) continue;
      merged.set(String(row.id), mapOriginRouteStepRow(row));
    }
    break;
  }

  if (!workingColumns) return [];

  return [...merged.values()].map((step) => ({
    ...step,
    operation_name: step.operation_name || step.dept_name || 'Cutting',
  }));
}

function operationGroupKeyFromStep(
  step: OriginRouteStepRow | undefined,
  routeId: string,
): string {
  if (step?.operation_def_id) return `def:${step.operation_def_id}`;
  const name = (step?.operation_name || step?.dept_name || '').trim();
  if (name) return `name:${name.toLowerCase()}`;
  return routeId ? `route:${routeId}` : '_default';
}

function operationLabelFromStep(
  step: OriginRouteStepRow | undefined,
  fallback = 'Output',
): string {
  if (step?.operation_name?.trim()) return step.operation_name.trim();
  if (step?.dept_name?.trim()) return step.dept_name.trim();
  return fallback;
}

function sortHourlyRows(a: DayResourceHourRow, b: DayResourceHourRow): number {
  return (
    a.resourceName.localeCompare(b.resourceName)
    || a.styleName.localeCompare(b.styleName)
    || a.colorName.localeCompare(b.colorName)
  );
}

/** Split hourly rows into operation cards when the department routes multiple capture operations. */
function buildHourlyOperationSections(
  rows: DayResourceHourRow[],
  routeSteps: OriginRouteStepRow[],
  hourColumns: string[],
): DayOperationHourSection[] | undefined {
  const routeOpGroups = new Map<
    string,
    { label: string; sortSeq: number; stepType: string | null }
  >();
  for (const step of routeSteps) {
    if (step.step_type !== 'produce' && step.step_type !== 'loading') continue;
    const groupKey = operationGroupKeyFromStep(step, step.id);
    if (!routeOpGroups.has(groupKey)) {
      routeOpGroups.set(groupKey, {
        label: operationLabelFromStep(step),
        sortSeq: step.seq,
        stepType: step.step_type ?? null,
      });
    }
  }

  if (routeOpGroups.size <= 1) return undefined;

  const stepById = new Map(routeSteps.map((s) => [s.id, s]));
  const rowsByGroup = new Map<string, DayResourceHourRow[]>();
  for (const row of rows) {
    const routeId = row.operationId ?? '';
    const step = routeId ? stepById.get(routeId) : undefined;
    const groupKey =
      row.operationGroupId
      ?? operationGroupKeyFromStep(step, routeId || '_default');
    const list = rowsByGroup.get(groupKey) ?? [];
    list.push(row);
    rowsByGroup.set(groupKey, list);
  }

  // A route operation's capture mode can move between hourly output and QC over
  // time, so keep the two kinds in separate cards rather than merging them.
  const sections: DayOperationHourSection[] = [];
  for (const [groupKey, meta] of routeOpGroups) {
    const groupRows = rowsByGroup.get(groupKey) ?? [];
    const hourlyGroupRows = groupRows.filter((r) => r.captureKind !== 'qc').sort(sortHourlyRows);
    const qcGroupRows = groupRows.filter((r) => r.captureKind === 'qc').sort(sortHourlyRows);
    // Loading is a receiving/WIP-start acknowledgement, never QC-inspected in
    // practice, but keep the split mechanical (by captureKind) rather than
    // hard-coding that assumption — if it ever is QC-captured, it still gets
    // its own correctly-labelled card instead of silently merging into produce.
    if (hourlyGroupRows.length > 0 || qcGroupRows.length === 0) {
      sections.push({
        operationId: groupKey,
        operationLabel: meta.label,
        hourColumns,
        rows: hourlyGroupRows,
        captureKind: 'hourly',
        stepType: meta.stepType,
      });
    }
    if (qcGroupRows.length > 0) {
      sections.push({
        operationId: `${groupKey}::qc`,
        operationLabel: meta.label,
        hourColumns,
        rows: qcGroupRows,
        captureKind: 'qc',
        stepType: meta.stepType,
      });
    }
  }

  sections.sort(
    (a, b) =>
      (routeOpGroups.get(a.operationId.replace(/::qc$/, ''))?.sortSeq ?? 0)
      - (routeOpGroups.get(b.operationId.replace(/::qc$/, ''))?.sortSeq ?? 0)
      || a.operationLabel.localeCompare(b.operationLabel),
  );
  return sections;
}

function mergeHourlyOperationSectionsFromDailyReports(
  dailyReports: DayResourceHourReport[],
): DayOperationHourSection[] | undefined {
  const hasSections = dailyReports.some((r) => (r.operationSections?.length ?? 0) > 0);
  if (!hasSections) return undefined;

  const byOp = new Map<string, DayOperationHourSection>();
  for (const report of dailyReports) {
    for (const sec of report.operationSections ?? []) {
      const existing = byOp.get(sec.operationId);
      if (!existing) {
        byOp.set(sec.operationId, {
          ...sec,
          hourColumns: [...sec.hourColumns],
          rows: [...sec.rows],
        });
      } else {
        existing.rows.push(...sec.rows);
        const hourSet = new Set(existing.hourColumns);
        for (const h of sec.hourColumns) hourSet.add(h);
        existing.hourColumns = [...hourSet].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );
      }
    }
  }
  return [...byOp.values()].sort((a, b) => a.operationLabel.localeCompare(b.operationLabel));
}

function resolveCuttingOperationForLay(
  steps: OriginRouteStepRow[],
  orderId: string,
  fabricAspect: string,
): OriginRouteStepRow | null {
  const orderSteps = steps
    .filter((s) => s.order_id === orderId && s.step_type === 'produce')
    .sort((a, b) => a.seq - b.seq);
  if (orderSteps.length === 0) return null;
  const aspect = fabricAspect === 'lining' ? 'lining' : 'shell';
  if (aspect === 'shell') {
    return (
      orderSteps.find((s) => s.is_primary_output)
      ?? orderSteps.find((s) => s.step_type === 'produce')
      ?? orderSteps[0]
    );
  }
  return orderSteps.find((s) => !s.is_primary_output && s.step_type === 'produce') ?? null;
}

type CuttingLayRef = {
  id: string;
  lay_no: string;
  resource_id?: string | null;
  fabric_aspect?: string | null;
  order_id?: string | null;
  colorway_id?: string | null;
  planned_pcs?: number | null;
};

type CuttingSessionRef = {
  id: string;
  order_id: string;
  colorway_id: string | null;
  log_date: string;
  department_id: string;
  order_route_id: string | null;
  resource_id: string | null;
};

type CuttingBundleCaptureRow = {
  id: string;
  order_id: string;
  colorway_id: string | null;
  qty: number;
  lay_id: string | null;
  session_id: string | null;
  fabric_component_id: string | null;
  fabric_aspect?: string | null;
  created_at?: string | null;
};

function workerCategoriesFromCapture(raw: Record<string, unknown>): WorkforceCategoryCount[] {
  const source = raw.headcount_by_category ?? raw.workforce_by_category ?? raw.worker_counts;
  const categories: WorkforceCategoryCount[] = [];
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [category, value] of Object.entries(source as Record<string, unknown>)) {
      const count = Number(value) || 0;
      if (count > 0) categories.push({ category, count });
    }
  }
  if (categories.length === 0) {
    for (const [category, key] of [
      ['Operators', 'operators'],
      ['Helpers', 'helpers'],
      ['Supervisors', 'supervisors'],
      ['Trainees', 'trainees'],
    ] as const) {
      const count = Number(raw[key]) || 0;
      if (count > 0) categories.push({ category, count });
    }
  }
  return categories.sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function fabricAspectFromComponent(
  componentId: string | null,
  primaryComponentId: string | null,
  legacyAspect?: string | null,
): 'shell' | 'lining' {
  if (legacyAspect === 'lining' || legacyAspect === 'shell') {
    return legacyAspect;
  }
  if (!componentId || !primaryComponentId) return 'shell';
  return componentId === primaryComponentId ? 'shell' : 'lining';
}

function resolveCuttingOperationForBundle(
  routeSteps: OriginRouteStepRow[],
  orderId: string,
  orderRouteId: string | null,
  fabricAspect: 'shell' | 'lining',
): OriginRouteStepRow | null {
  if (orderRouteId) {
    const byId = routeSteps.find((s) => s.id === orderRouteId);
    if (byId) return byId;
  }
  return resolveCuttingOperationForLay(routeSteps, orderId, fabricAspect);
}

function appendNativeCuttingDayRow(
  sectionMaps: Map<string, Map<string, DayResourceHourRow>>,
  op: OriginRouteStepRow,
  params: {
    resourceId: string;
    orderId: string;
    colorwayId: string | null;
    layNo: string;
    fabricAspect: 'shell' | 'lining';
    qty: number;
    date: string;
    orderMap: Map<string, ReportMeta['orders'][number]>;
    colorMap: Map<string, ColorwayLabel>;
    resourceMap: Map<string, ReportMeta['resources'][number]>;
  },
): void {
  if (params.qty <= 0) return;

  const rowMap = sectionMaps.get(op.id) ?? new Map<string, DayResourceHourRow>();
  sectionMaps.set(op.id, rowMap);

  const rowKey = `${params.resourceId}|${params.orderId}|${params.colorwayId ?? ''}|${params.layNo}|${params.fabricAspect}`;
  const order = params.orderMap.get(params.orderId);
  const existing = rowMap.get(rowKey);
  if (existing) {
    existing.hours[CUTTING_OUTPUT_HOUR] = (existing.hours[CUTTING_OUTPUT_HOUR] || 0) + params.qty;
    existing.total += params.qty;
    rowMap.set(rowKey, existing);
    return;
  }

  rowMap.set(rowKey, {
    resourceId: params.resourceId,
    resourceName: params.resourceId ? params.resourceMap.get(params.resourceId)?.name || '—' : '—',
    orderId: params.orderId,
    styleName: order?.styleName || params.orderId.slice(0, 8),
    styleRef: order?.styleRef || '',
    buyerName: order?.buyerName || '',
    poNumber: order?.poNumber || '',
    colorwayId: params.colorwayId,
    colorName: colorwayDisplayLabel(params.colorwayId, params.colorMap),
    hours: { [CUTTING_OUTPUT_HOUR]: params.qty },
    hourTargets: {},
    hourlyTarget: 0,
    total: params.qty,
    workforce: null,
    workforceBreakdown: [],
    producedMins: 0,
    resourceAvailableMins: 0,
    daysRunning: null,
    plannedEndDate: null,
    efficiencyPct: null,
    productivity: null,
    operationId: op.id,
    operationLabel: op.operation_name || op.dept_name || 'Cutting',
    fabricAspect: params.fabricAspect,
    layNo: params.layNo,
    logDate: params.date,
  });
}

function buildNativeCuttingSectionsFromMaps(
  sectionMaps: Map<string, Map<string, DayResourceHourRow>>,
  routeSteps: OriginRouteStepRow[],
): DayOperationHourSection[] {
  const opById = new Map(routeSteps.map((s) => [s.id, s]));
  const sections: DayOperationHourSection[] = [];

  for (const [opId, rowMap] of sectionMaps) {
    const op = opById.get(opId);
    const rows = [...rowMap.values()].sort(
      (a, b) =>
        a.resourceName.localeCompare(b.resourceName)
        || a.styleName.localeCompare(b.styleName)
        || String(a.layNo ?? '').localeCompare(String(b.layNo ?? '')),
    );
    sections.push({
      operationId: opId,
      operationLabel: op?.operation_name || op?.dept_name || 'Cutting',
      fabricAspect: op?.is_primary_output ? 'shell' : 'lining',
      hourColumns: [CUTTING_OUTPUT_HOUR],
      rows,
    });
  }

  sections.sort((a, b) => a.operationLabel.localeCompare(b.operationLabel));
  return sections;
}

async function loadCuttingLayRefs(
  factoryId: string,
  layIds: string[],
): Promise<Map<string, CuttingLayRef>> {
  const map = new Map<string, CuttingLayRef>();
  if (layIds.length === 0) return map;

  const { data, error } = await supabase
    .from('cutting_lays')
    .select('id, lay_no, session_id')
    .eq('factory_id', factoryId)
    .in('id', layIds);
  if (error) {
    if (isMissingRelationError(error)) return map;
    if (isMissingColumnError(error)) return map;
    throw error;
  }
  for (const lay of (data || []) as Record<string, unknown>[]) {
    if (!lay?.id) continue;
    map.set(String(lay.id), {
      id: String(lay.id),
      lay_no: (lay.lay_no as string) || '—',
    } as CuttingLayRef);
  }
  return map;
}

const CUTTING_BUNDLE_COLUMN_SETS = [
  'id, order_id, colorway_id, qty, lay_id, session_id, fabric_component_id, fabric_type, created_at',
] as const;

function mapCuttingBundleRow(row: Record<string, unknown>): CuttingBundleCaptureRow {
  return {
    id: String(row.id ?? ''),
    order_id: (row.order_id as string) || '',
    colorway_id: (row.colorway_id as string) || null,
    qty: Number(row.qty) || 0,
    lay_id: (row.lay_id as string) || null,
    session_id: (row.session_id as string) || null,
    fabric_component_id: (row.fabric_component_id as string) || null,
    fabric_aspect: (row.fabric_type as string) || null,
    created_at: (row.created_at as string) || null,
  };
}

async function fetchCuttingBundlesForSessions(
  factoryId: string,
  sessionIds: string[],
): Promise<CuttingBundleCaptureRow[]> {
  if (sessionIds.length === 0) return [];
  for (const columns of CUTTING_BUNDLE_COLUMN_SETS) {
    if (!columns.includes('session_id')) continue;
    const res = await supabase
      .from('cutting_bundles')
      .select(columns)
      .eq('factory_id', factoryId)
      .in('session_id', sessionIds);
    if (!res.error) {
      return ((res.data || []) as unknown as Record<string, unknown>[]).map(mapCuttingBundleRow);
    }
    if (!isMissingColumnError(res.error) && !isMissingRelationError(res.error)) {
      console.warn('[fetchCuttingBundlesForSessions]', res.error.message);
    }
  }
  return [];
}

async function fetchOrphanCuttingBundlesForDate(
  factoryId: string,
  dayStart: string,
  dayEnd: string,
): Promise<CuttingBundleCaptureRow[]> {
  for (const columns of CUTTING_BUNDLE_COLUMN_SETS) {
    if (!columns.includes('session_id')) continue;
    const dateCol = columns.includes('created_at') ? 'created_at' : 'logged_at';
    const res = await supabase
      .from('cutting_bundles')
      .select(columns)
      .eq('factory_id', factoryId)
      .is('session_id', null)
      .gte(dateCol, dayStart)
      .lte(dateCol, dayEnd);
    if (!res.error) {
      return ((res.data || []) as unknown as Record<string, unknown>[]).map(mapCuttingBundleRow);
    }
    if (isMissingColumnError(res.error)) continue;
    if (isMissingRelationError(res.error)) return [];
    console.warn('[fetchOrphanCuttingBundlesForDate]', res.error.message);
    return [];
  }
  return [];
}

/** Session → bundle capture (order_id on bundles / sessions, not lays). */
async function buildNativeCuttingDaySectionsFromSessions(
  factoryId: string,
  date: string,
  departmentId: string,
  routeSteps: OriginRouteStepRow[],
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
  primaryComponentId: string | null,
): Promise<DayOperationHourSection[]> {
  const resourceMap = new Map(meta.resources.map((r) => [r.id, r]));
  const sessionsRes = await supabase
    .from('cutting_sessions')
    .select('id, order_id, colorway_id, log_date, department_id, order_route_id, resource_id')
    .eq('factory_id', factoryId)
    .eq('department_id', departmentId)
    .eq('log_date', date);

  if (sessionsRes.error && !isMissingRelationError(sessionsRes.error)) {
    console.warn('[buildNativeCuttingDaySectionsFromSessions] cutting_sessions:', sessionsRes.error.message);
  }

  const sessions = (!sessionsRes.error ? sessionsRes.data || [] : []) as CuttingSessionRef[];
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const bundleRows: CuttingBundleCaptureRow[] = [];
  if (sessions.length > 0) {
    bundleRows.push(...await fetchCuttingBundlesForSessions(factoryId, sessions.map((s) => s.id)));
  }

  if (bundleRows.length === 0) return [];

  const orderMap = await resolveOrderMap(factoryId, meta, [
    ...sessions.map((s) => s.order_id || ''),
    ...bundleRows.map((b) => b.order_id || ''),
  ]);
  const colorMap = await resolveColorwayMap(
    factoryId,
    colorwayLabels,
    sessions.map((s) => s.colorway_id),
  );

  const layById = await loadCuttingLayRefs(
    factoryId,
    [...new Set(bundleRows.map((b) => b.lay_id).filter(Boolean) as string[])],
  );

  const sectionMaps = new Map<string, Map<string, DayResourceHourRow>>();

  for (const bundle of bundleRows) {
    const qty = Number(bundle.qty) || 0;
    if (qty <= 0) continue;

    const session = bundle.session_id ? sessionById.get(bundle.session_id) : null;
    if (session && session.department_id !== departmentId) continue;

    const lay = bundle.lay_id ? layById.get(bundle.lay_id) : undefined;
    const resourceId = session?.resource_id || lay?.resource_id || '';
    if (resourceId) {
      const resource = resourceMap.get(resourceId);
      if (resource?.departmentId && resource.departmentId !== departmentId) continue;
    }

    const orderId = bundle.order_id || session?.order_id || lay?.order_id || '';
    if (!orderId) continue;

    const colorwayId = bundle.colorway_id ?? session?.colorway_id ?? lay?.colorway_id ?? null;
    const fabricAspect = fabricAspectFromComponent(
      bundle.fabric_component_id,
      primaryComponentId,
      bundle.fabric_aspect ?? lay?.fabric_aspect,
    );
    const op = resolveCuttingOperationForBundle(
      routeSteps,
      orderId,
      session?.order_route_id ?? null,
      fabricAspect,
    );
    if (!op) continue;

    appendNativeCuttingDayRow(sectionMaps, op, {
      resourceId,
      orderId,
      colorwayId,
      layNo: lay?.lay_no || '—',
      fabricAspect,
      qty,
      date,
      orderMap,
      colorMap,
      resourceMap,
    });
  }

  return buildNativeCuttingSectionsFromMaps(sectionMaps, routeSteps);
}

/** Legacy lay-logged_at path when session capture is unavailable. */
async function buildNativeCuttingDaySectionsFromLays(
  factoryId: string,
  date: string,
  departmentId: string,
  routeSteps: OriginRouteStepRow[],
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayOperationHourSection[]> {
  const colorMap = new Map(colorwayLabels.map((c) => [c.id, c]));
  const resourceMap = new Map(meta.resources.map((r) => [r.id, r]));

  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59.999`;

  const laysRes = await supabase
    .from('cutting_lays')
    .select('id, session_id, lay_no, total_qty, created_at')
    .eq('factory_id', factoryId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);
  if (laysRes.error) throw laysRes.error;
  const rawLays = (laysRes.data || []) as Record<string, unknown>[];
  if (rawLays.length === 0) return [];

  const sessionIds = [
    ...new Set(rawLays.map((l) => l.session_id as string | null).filter(Boolean)),
  ] as string[];
  const sessionsRes = sessionIds.length
    ? await supabase
        .from('cutting_sessions')
        .select('id, order_id, colorway_id, resource_id, fabric_type')
        .in('id', sessionIds)
    : { data: [] as Record<string, unknown>[], error: null };
  if (sessionsRes.error) throw sessionsRes.error;
  const sessionById = new Map(
    (sessionsRes.data || []).map((s) => [s.id as string, s] as [string, Record<string, unknown>]),
  );

  const lays: CuttingLayRef[] = rawLays.map((lay) => {
    const session = sessionById.get(lay.session_id as string);
    return {
      id: String(lay.id),
      lay_no: (lay.lay_no as string) || '—',
      order_id: (session?.order_id as string) || undefined,
      colorway_id: (session?.colorway_id as string) ?? undefined,
      resource_id: (session?.resource_id as string) ?? undefined,
      fabric_aspect: (session?.fabric_type as string) ?? undefined,
      planned_pcs: Number(lay.total_qty) || 0,
    };
  });
  if (lays.length === 0) return [];

  const orderMap = await resolveOrderMap(
    factoryId,
    meta,
    lays.map((lay) => lay.order_id || ''),
  );

  const layIds = lays.map((l) => l.id);
  const bundleQtyByLay = new Map<string, number>();
  for (const columns of ['lay_id, qty'] as const) {
    const bundlesRes = await supabase
      .from('cutting_bundles')
      .select(columns)
      .eq('factory_id', factoryId)
      .in('lay_id', layIds);
    if (bundlesRes.error) {
      if (isMissingColumnError(bundlesRes.error)) continue;
      throw bundlesRes.error;
    }
    for (const b of (bundlesRes.data || []) as unknown as Array<Record<string, unknown>>) {
      const layId = String(b.lay_id ?? '');
      if (!layId) continue;
      bundleQtyByLay.set(layId, (bundleQtyByLay.get(layId) ?? 0) + (Number(b.qty) || 0));
    }
    break;
  }

  const sectionMaps = new Map<string, Map<string, DayResourceHourRow>>();

  for (const lay of lays) {
    const resourceId = lay.resource_id || '';
    const resource = resourceId ? resourceMap.get(resourceId) : undefined;
    if (resourceId && resource?.departmentId !== departmentId) continue;

    const op = resolveCuttingOperationForLay(routeSteps, lay.order_id || '', lay.fabric_aspect || 'shell');
    if (!op || !lay.order_id) continue;

    const qty = bundleQtyByLay.get(lay.id) ?? lay.planned_pcs ?? 0;
    appendNativeCuttingDayRow(sectionMaps, op, {
      resourceId,
      orderId: lay.order_id,
      colorwayId: lay.colorway_id || null,
      layNo: lay.lay_no,
      fabricAspect: lay.fabric_aspect === 'lining' ? 'lining' : 'shell',
      qty,
      date,
      orderMap,
      colorMap,
      resourceMap,
    });
  }

  return buildNativeCuttingSectionsFromMaps(sectionMaps, routeSteps);
}

async function buildNativeCuttingSessionEntries(
  factoryId: string,
  date: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayNativeEntry[]> {
  const [sessionsRes, routeSteps] = await Promise.all([
    supabase
      .from('cutting_sessions')
      .select('*')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .eq('log_date', date),
    fetchRoutingStepsForDepartment(factoryId, departmentId),
  ]);
  if (sessionsRes.error) throw sessionsRes.error;
  const sessions = (sessionsRes.data || []) as Array<Record<string, unknown>>;
  if (sessions.length === 0) return [];

  const sessionIds = sessions.map((session) => String(session.id));
  const [bundlesRes, laysRes, fabricsRes] = await Promise.all([
    supabase
      .from('cutting_bundles')
      .select('session_id, qty')
      .eq('factory_id', factoryId)
      .in('session_id', sessionIds),
    supabase
      .from('cutting_lays')
      .select('id, session_id, lay_no, fabric_component_id')
      .eq('factory_id', factoryId)
      .in('session_id', sessionIds),
    supabase
      .from('fabric_components')
      .select('id, code, fabric_type')
      .eq('factory_id', factoryId),
  ]);
  if (bundlesRes.error) throw bundlesRes.error;
  if (laysRes.error) throw laysRes.error;
  if (fabricsRes.error) throw fabricsRes.error;

  const qtyBySession = new Map<string, number>();
  for (const bundle of bundlesRes.data || []) {
    const id = String(bundle.session_id || '');
    qtyBySession.set(id, (qtyBySession.get(id) || 0) + (Number(bundle.qty) || 0));
  }

  const laysBySession = new Map<string, Array<{ lay_no?: number; fabric_component_id?: string }>>();
  for (const lay of laysRes.data || []) {
    const id = String(lay.session_id || '');
    if (!laysBySession.has(id)) laysBySession.set(id, []);
    laysBySession.get(id)!.push({
      lay_no: lay.lay_no as number | undefined,
      fabric_component_id: (lay.fabric_component_id as string) || undefined,
    });
  }
  const fabricById = new Map(
    (fabricsRes.data || []).map((f) => [
      String(f.id),
      { code: (f.code as string) || undefined, fabricType: (f.fabric_type as string) || undefined },
    ]),
  );

  const orderMap = await resolveOrderMap(
    factoryId,
    meta,
    sessions.map((session) => String(session.order_id || '')),
  );
  const colorMap = await resolveColorwayMap(
    factoryId,
    colorwayLabels,
    sessions.map((session) => (session.colorway_id as string) || null),
  );
  const resourceMap = new Map(meta.resources.map((resource) => [resource.id, resource]));
  return sessions.map((session): DayNativeEntry => {
    const sessionId = String(session.id);
    const orderId = String(session.order_id || '');
    const colorwayId = (session.colorway_id as string) || null;
    const order = orderMap.get(orderId);
    const operationId = (session.order_route_id as string) || '';
    const matchedStep = routeSteps.find((step) => step.id === operationId);
    const operationName = matchedStep?.operation_name || matchedStep?.dept_name || 'Cutting';

    const sessionLays = laysBySession.get(sessionId) || [];
    const layNo = sessionLays
      .map((l) => l.lay_no)
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b)
      .join('·');
    const sessionFabricId = (session.fabric_component_id as string) || undefined;
    const layFabricId = sessionLays.find((l) => l.fabric_component_id)?.fabric_component_id;
    const fabricId = sessionFabricId || layFabricId;
    const fabric = fabricId ? fabricById.get(fabricId) : undefined;
    const sessionFabricType = (session.fabric_type as string) || undefined;

    return {
      id: sessionId,
      kind: 'cutting_session',
      logDate: String(session.log_date || date),
      operationName,
      styleName: order?.styleName || orderId.slice(0, 8),
      styleRef: order?.styleRef || '',
      buyerName: order?.buyerName || '',
      poNumber: order?.poNumber || '',
      colorName: colorwayDisplayLabel(colorwayId, colorMap),
      resourceName: resourceMap.get((session.resource_id as string) || '')?.name || '—',
      fabricType: sessionFabricType || fabric?.fabricType,
      fabricReference: undefined,
      fabricCode: fabric?.code,
      sessionNo: (session.session_no as string) || undefined,
      refNo: (session.ref_no as string) || undefined,
      layNo: layNo || undefined,
      startedAt: ((session.started_at ?? session.start_time ?? session.created_at) as string) || undefined,
      endedAt: ((session.ended_at ?? session.end_time ?? session.completed_at ?? session.updated_at) as string) || undefined,
      workerCategories: workerCategoriesFromCapture(session),
      outputQty: qtyBySession.get(sessionId) || 0,
    };
  }).sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));
}

async function buildNativeShipmentDayReport(
  factoryId: string,
  date: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayResourceHourReport> {
  const [shipmentsRes, routeSteps, kpiRows, handover] = await Promise.all([
    supabase
      .from('shipments')
      .select('id, order_id, colorway_id, order_route_id, shipped_qty, shipment_date, shipment_type, destination, invoice_number, awb_number, notes, logged_at')
      .eq('factory_id', factoryId)
      .eq('shipment_date', date)
      .order('logged_at'),
    fetchRoutingStepsForDepartment(factoryId, departmentId),
    fetchDepartmentKpis(factoryId, departmentId, date, date),
    fetchDayDeptHandoverSummary(factoryId, date, departmentId, meta, colorwayLabels),
  ]);
  if (shipmentsRes.error) throw shipmentsRes.error;

  const orderMap = await resolveOrderMap(
    factoryId,
    meta,
    (shipmentsRes.data || []).map((shipment) => String(shipment.order_id || '')),
  );
  const colorMap = new Map(colorwayLabels.map((color) => [color.id, color]));
  const nativeEntries: DayNativeEntry[] = (shipmentsRes.data || []).map((shipment) => {
    const orderId = String(shipment.order_id || '');
    const order = orderMap.get(orderId);
    const colorwayId = (shipment.colorway_id as string) || null;
    const operationId = (shipment.order_route_id as string) || '';
    return {
      id: String(shipment.id),
      kind: 'shipment',
      logDate: String(shipment.shipment_date || date),
      operationName: (() => { const s = routeSteps.find((step) => step.id === operationId); return s?.operation_name || s?.dept_name || 'Dispatch'; })(),
      styleName: order?.styleName || orderId.slice(0, 8),
      styleRef: order?.styleRef || '',
      buyerName: order?.buyerName || '',
      poNumber: order?.poNumber || '',
      colorName: colorwayDisplayLabel(colorwayId, colorMap),
      startedAt: (shipment.logged_at as string) || undefined,
      outputQty: Number(shipment.shipped_qty) || 0,
      shipmentType: (shipment.shipment_type as string) || undefined,
      destination: (shipment.destination as string) || undefined,
      invoiceNumber: (shipment.invoice_number as string) || undefined,
      awbNumber: (shipment.awb_number as string) || undefined,
      notes: (shipment.notes as string) || undefined,
    };
  });
  const kpiBase = aggregateDeptDayKpi((kpiRows || []) as DailyKpiRpcRow[]);
  const output = nativeEntries.reduce((sum, entry) => sum + entry.outputQty, 0);
  return {
    isQcDept: false,
    isNativeShipment: true,
    hourColumns: [],
    rows: [],
    shiftSections: [],
    nativeEntries,
    productiveMinsPerWorker: 480,
    kpi: {
      output,
      target: kpiBase.target,
      efficiency: null,
      productivity: null,
      dhu: kpiBase.dhu,
      wip: kpiBase.wip,
    },
    handover,
    handoverByDay: [{ date, handover }],
  };
}

/** Native cutting day report — lays/bundles grouped by routing operation + fabric aspect. */
async function buildNativeCuttingDaySections(
  factoryId: string,
  date: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayOperationHourSection[]> {
  const routeSteps = await fetchRoutingStepsForDepartment(factoryId, departmentId);
  if (routeSteps.length === 0) return [];

  const componentsRes = await supabase
    .from('fabric_components')
    .select('id, is_primary')
    .eq('factory_id', factoryId);
  if (componentsRes.error) {
    console.warn('[buildNativeCuttingDaySections] fabric_components:', componentsRes.error.message);
  }
  const primaryComponentId =
    (componentsRes.data || []).find((c) => c.is_primary === true)?.id as string | undefined ?? null;

  const fromSessions = await buildNativeCuttingDaySectionsFromSessions(
    factoryId,
    date,
    departmentId,
    routeSteps,
    meta,
    colorwayLabels,
    primaryComponentId,
  );
  if (fromSessions.length > 0) return fromSessions;

  return buildNativeCuttingDaySectionsFromLays(
    factoryId,
    date,
    departmentId,
    routeSteps,
    meta,
    colorwayLabels,
  );
}

async function buildOutsourceDayReport(
  factoryId: string,
  date: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayResourceHourReport> {
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59.999`;

  const [movementsRes, routeSteps, kpiRows, handover, workforceRes, shiftRes] = await Promise.all([
    supabase
      .from('outsource_work_movements')
      .select(
        'id, order_id, colorway_id, order_route_id, vendor_resource_id, movement_type, qty, occurred_at, notes, challan_number',
      )
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .gte('occurred_at', dayStart)
      .lte('occurred_at', dayEnd)
      .order('occurred_at'),
    fetchRoutingStepsForDepartment(factoryId, departmentId),
    fetchDepartmentKpis(factoryId, departmentId, date, date),
    fetchDayDeptHandoverSummary(factoryId, date, departmentId, meta, colorwayLabels),
    supabase
      .from('workforce_logs')
      .select('resource_id, headcount_by_category, log_date')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .eq('log_date', date),
    supabase.from('shifts').select('id, name, type, hours, productive_mins').eq('factory_id', factoryId),
  ]);
  if (movementsRes.error) throw movementsRes.error;

  const orderMap = await resolveOrderMap(
    factoryId,
    meta,
    (movementsRes.data || []).map((raw) => String(raw.order_id || '')),
  );
  const colorMap = new Map(colorwayLabels.map((c) => [c.id, c]));
  const resourceMap = new Map(meta.resources.map((r) => [r.id, r]));

  type AggKey = string;
  const byKey = new Map<
    AggKey,
    {
      id: string;
      orderId: string;
      colorwayId: string | null;
      vendorResourceId: string;
      routeId: string | null;
      sent: number;
      received: number;
      lastOccurred: string;
      notes: string;
      challanNumber: string | null;
    }
  >();

  for (const raw of movementsRes.data || []) {
    const orderId = String(raw.order_id || '');
    const colorwayId = (raw.colorway_id as string) || null;
    const vendorId = String(raw.vendor_resource_id || '');
    const routeId = (raw.order_route_id as string) || null;
    const key: AggKey = `${orderId}|${colorwayId ?? ''}|${vendorId}|${routeId ?? ''}`;
    const existing = byKey.get(key);
    const qty = Number(raw.qty) || 0;
    const movement = String(raw.movement_type || '');
    const occurred = String(raw.occurred_at || '');
    if (existing) {
      if (movement === 'vendor_send') existing.sent += qty;
      if (movement === 'vendor_receive') existing.received += qty;
      if (occurred > existing.lastOccurred) existing.lastOccurred = occurred;
      if (raw.notes) existing.notes = raw.notes as string;
    } else {
      byKey.set(key, {
        id: `${date}-${key}`,
        orderId,
        colorwayId,
        vendorResourceId: vendorId,
        routeId,
        sent: movement === 'vendor_send' ? qty : 0,
        received: movement === 'vendor_receive' ? qty : 0,
        lastOccurred: occurred,
        notes: (raw.notes as string) || '',
        challanNumber: (raw.challan_number as string) || null,
      });
    }
  }

  const entries: DayNativeEntry[] = [...byKey.values()]
    .map((agg): DayNativeEntry => {
      const order = orderMap.get(agg.orderId);
      return {
        id: agg.id,
        kind: 'outsource',
        logDate: date,
        operationName:
          (() => { const s = routeSteps.find((step) => step.id === (agg.routeId ?? '')); return s?.operation_name || s?.dept_name || 'Outsource'; })(),
        styleName: order?.styleName || agg.orderId.slice(0, 8),
        styleRef: order?.styleRef || '',
        buyerName: order?.buyerName || '',
        poNumber: order?.poNumber || '',
        colorName: colorwayDisplayLabel(agg.colorwayId, colorMap),
        resourceName: resourceMap.get(agg.vendorResourceId)?.name || '—',
        startedAt: agg.lastOccurred,
        outputQty: agg.received,
        sentQty: agg.sent,
        receivedQty: agg.received,
        notes: agg.notes || undefined,
      };
    })
    .filter((entry) => (entry.sentQty ?? 0) > 0 || (entry.receivedQty ?? 0) > 0)
    .sort(
      (a, b) =>
        (a.resourceName || '').localeCompare(b.resourceName || '') ||
        (a.startedAt || '').localeCompare(b.startedAt || ''),
    );

  const kpiBase = aggregateDeptDayKpi((kpiRows || []) as DailyKpiRpcRow[]);
  const output = entries.reduce((sum, entry) => sum + (entry.receivedQty || 0), 0);

  if (workforceRes.error) {
    console.warn('[buildOutsourceDayReport] workforce_logs:', workforceRes.error.message);
  }
  if (shiftRes.error) throw shiftRes.error;
  const shifts = (shiftRes.data || []).map((s) => mapShiftRow(s as Record<string, unknown>));
  let productiveMinsPerWorker = regularShiftProductiveMins(shifts);
  if (productiveMinsPerWorker <= 0) productiveMinsPerWorker = 480;

  const metricRows: DayResourceHourRow[] = [...byKey.values()]
    .filter((agg) => agg.received > 0)
    .map((agg) => {
      const order = orderMap.get(agg.orderId);
      return {
        resourceId: agg.vendorResourceId,
        resourceName: resourceMap.get(agg.vendorResourceId)?.name || '—',
        orderId: agg.orderId,
        styleName: order?.styleName || agg.orderId.slice(0, 8),
        styleRef: order?.styleRef || '',
        buyerName: order?.buyerName || '',
        poNumber: order?.poNumber || '',
        colorwayId: agg.colorwayId,
        colorName: colorwayDisplayLabel(agg.colorwayId, colorMap),
        hours: {},
        hourTargets: {},
        hourlyTarget: 0,
        total: agg.received,
        workforce: null,
        workforceBreakdown: [],
        producedMins: 0,
        resourceAvailableMins: 0,
        daysRunning: null,
        plannedEndDate: null,
        efficiencyPct: null,
        productivity: null,
        logDate: date,
      };
    });

  const orderIds = [...new Set(metricRows.map((row) => row.orderId).filter(Boolean))];
  const sewingSamByOrder = new Map<string, number>();
  const samByAllocKey = new Map<string, number>();
  if (orderIds.length > 0) {
    const allocPlanRows = await fetchLineAllocPlanRows(factoryId, orderIds);
    const { data: samRows, error: samErr } = await supabase
      .from('style_orders')
      .select('id, sewing_sam')
      .eq('factory_id', factoryId)
      .in('id', orderIds);
    if (samErr) throw samErr;
    for (const raw of samRows || []) {
      sewingSamByOrder.set(raw.id as string, Number(raw.sewing_sam) || 0);
    }
    for (const alloc of allocPlanRows) {
      const plannedSam = allocationSamValue({ sam: alloc.sam, kpi_inputs: alloc.kpi_inputs });
      if (plannedSam <= 0) continue;
      samByAllocKey.set(allocRowKey(alloc.order_id, alloc.colorway_id, alloc.line_id), plannedSam);
    }
  }

  const resourceWorkforce = buildResourceWorkforceDetails(
    (workforceRes.data || []) as Array<Record<string, unknown>>,
  );
  enrichDayResourceRows(
    metricRows,
    samByAllocKey,
    sewingSamByOrder,
    resourceWorkforce,
    productiveMinsPerWorker,
  );
  for (const [resourceId, wf] of resourceWorkforce) {
    if (metricRows.some((row) => row.resourceId === resourceId)) continue;
    metricRows.push({
      resourceId,
      resourceName: resourceMap.get(resourceId)?.name || '—',
      orderId: '',
      styleName: '',
      styleRef: '',
      buyerName: '',
      poNumber: '',
      colorwayId: null,
      colorName: '',
      hours: {},
      hourTargets: {},
      hourlyTarget: 0,
      total: 0,
      workforce: wf.total,
      workforceBreakdown: wf.breakdown,
      producedMins: 0,
      resourceAvailableMins: wf.total * productiveMinsPerWorker,
      daysRunning: null,
      plannedEndDate: null,
      efficiencyPct: null,
      productivity: null,
      logDate: date,
    });
  }
  const deptMetrics = computeDayDeptMetricsFromRows(metricRows);

  return {
    isQcDept: false,
    isOutsource: true,
    hourColumns: [],
    rows: metricRows,
    shiftSections: [],
    nativeEntries: [],
    outsourceEntries: entries,
    batchEntries: [],
    productiveMinsPerWorker,
    kpi: {
      output,
      target: kpiBase.target,
      efficiency: deptMetrics.efficiency,
      productivity: deptMetrics.productivity,
      dhu: kpiBase.dhu,
      wip: kpiBase.wip,
    },
    handover,
    handoverByDay: [{ date, handover }],
  };
}

async function buildBatchDayReport(
  factoryId: string,
  date: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayResourceHourReport> {
  const [batchRes, routeSteps, kpiRows, handover] = await Promise.all([
    supabase
      .from('batch_production')
      .select(
        'id, order_id, colorway_id, order_route_id, resource_id, log_date, produced_qty, produced_by_size, activity_no, ref_no, start_time, end_time, headcount_by_category, comment, created_at, updated_at',
      )
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .eq('log_date', date)
      .order('start_time'),
    fetchRoutingStepsForDepartment(factoryId, departmentId),
    fetchDepartmentKpis(factoryId, departmentId, date, date),
    fetchDayDeptHandoverSummary(factoryId, date, departmentId, meta, colorwayLabels),
  ]);
  if (batchRes.error) throw batchRes.error;

  const orderMap = await resolveOrderMap(
    factoryId,
    meta,
    (batchRes.data || []).map((raw) => String(raw.order_id || '')),
  );
  const colorMap = new Map(colorwayLabels.map((c) => [c.id, c]));
  const resourceMap = new Map(meta.resources.map((r) => [r.id, r]));

  const entries: DayNativeEntry[] = ((batchRes.data || []) as Array<Record<string, unknown>>)
    .map((raw): DayNativeEntry => {
      const orderId = String(raw.order_id || '');
      const order = orderMap.get(orderId);
      const colorwayId = (raw.colorway_id as string) || null;
      const resourceId = (raw.resource_id as string) || '';
      const routeId = (raw.order_route_id as string) || null;
      const qty = Number(raw.produced_qty) || 0;
      return {
        id: String(raw.id || ''),
        kind: 'batch',
        logDate: String(raw.log_date || date),
        operationName:
          (() => { const s = routeSteps.find((step) => step.id === routeId); return s?.operation_name || s?.dept_name || 'Batch'; })(),
        styleName: order?.styleName || orderId.slice(0, 8),
        styleRef: order?.styleRef || '',
        buyerName: order?.buyerName || '',
        poNumber: order?.poNumber || '',
        colorName: colorwayDisplayLabel(colorwayId, colorMap),
        resourceName: resourceMap.get(resourceId)?.name || '—',
        activityNo: (raw.activity_no as string) || undefined,
        refNo: (raw.ref_no as string) || undefined,
        startedAt: ((raw.start_time as string) || (raw.created_at as string)) || undefined,
        endedAt: ((raw.end_time as string) || (raw.updated_at as string)) || undefined,
        workerCategories: workerCategoriesFromCapture(raw),
        outputQty: qty,
        comment: (raw.comment as string) || undefined,
      };
    })
    .filter((entry) => entry.outputQty > 0)
    .sort(
      (a, b) =>
        (a.resourceName || '').localeCompare(b.resourceName || '') ||
        (a.startedAt || '').localeCompare(b.startedAt || ''),
    );

  const kpiBase = aggregateDeptDayKpi((kpiRows || []) as DailyKpiRpcRow[]);
  const output = entries.reduce((sum, entry) => sum + entry.outputQty, 0);

  return {
    isQcDept: false,
    isBatch: true,
    hourColumns: [],
    rows: [],
    shiftSections: [],
    nativeEntries: [],
    outsourceEntries: [],
    batchEntries: entries,
    productiveMinsPerWorker: 480,
    kpi: {
      output,
      target: kpiBase.target,
      efficiency: null,
      productivity: null,
      dhu: kpiBase.dhu,
      wip: kpiBase.wip,
    },
    handover,
    handoverByDay: [{ date, handover }],
  };
}

/** Native cutting day report for a date or range — one RPC instead of per-day table fan-out. */
async function fetchNativeCuttingDayReportRange(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayResourceHourReport | null> {
  const sessionRows = await fetchDayCuttingSessionsRpc(factoryId, departmentId, dateFrom, dateTo);
  if (sessionRows == null) return null;

  const [kpiRows, shiftRes, workforceRes, handoverRange] = await Promise.all([
    fetchDepartmentKpis(factoryId, departmentId, dateFrom, dateTo),
    supabase.from('shifts').select('id, name, type, hours, productive_mins').eq('factory_id', factoryId),
    supabase
      .from('workforce_logs')
      .select('resource_id, headcount_by_category, log_date')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo),
    fetchDayDeptHandoverRange(factoryId, dateFrom, dateTo, departmentId, meta, colorwayLabels),
  ]);
  if (shiftRes.error) throw shiftRes.error;
  if (workforceRes.error) throw workforceRes.error;

  const nativeEntries = sessionRows.map(mapCuttingSessionRpcToNativeEntry);
  const operationSections = buildCuttingOperationSectionsFromRpc(sessionRows);

  const logsByDate = new Map<string, Array<Record<string, unknown>>>();
  for (const raw of (workforceRes.data || []) as Array<Record<string, unknown>>) {
    const logDate = String(raw.log_date || '').slice(0, 10);
    if (!logDate) continue;
    const list = logsByDate.get(logDate) ?? [];
    list.push(raw);
    logsByDate.set(logDate, list);
  }
  const workforceByDate = new Map<string, ReturnType<typeof buildResourceWorkforceDetails>>();
  for (const [logDate, logs] of logsByDate) {
    workforceByDate.set(logDate, buildResourceWorkforceDetails(logs));
  }
  for (const section of operationSections) {
    for (const row of section.rows) {
      const wf = workforceByDate.get(row.logDate || '')?.get(row.resourceId);
      if (wf) {
        row.workforce = wf.total;
        row.workforceBreakdown = wf.breakdown;
      }
    }
  }

  const shifts = (shiftRes.data || []).map((s) => mapShiftRow(s as Record<string, unknown>));
  let productiveMinsPerWorker = regularShiftProductiveMins(shifts);
  if (productiveMinsPerWorker <= 0) productiveMinsPerWorker = 480;

  const rows = operationSections.flatMap((s) => s.rows);
  const deptMetrics = computeDayDeptMetricsFromRows(rows);
  const nativeOutput = nativeEntries.reduce((sum, e) => sum + e.outputQty, 0);
  const kpiBase = aggregateDeptDayKpi((kpiRows || []) as DailyKpiRpcRow[]);
  // Cutting sessions are often logged without an assigned cutter/resource, so
  // deptMetrics.workforce (row.resourceId-based) frequently comes up empty here —
  // compute the Workforce KPI straight from workforce_logs instead.
  const workforce = averageDailyHeadcountFromLogs(workforceByDate);

  return {
    isQcDept: false,
    isNativeCutting: true,
    hourColumns: [CUTTING_OUTPUT_HOUR],
    rows,
    shiftSections: [],
    operationSections,
    nativeEntries,
    productiveMinsPerWorker,
    kpi: {
      output: nativeOutput,
      target: kpiBase.target,
      efficiency: deptMetrics.efficiency,
      productivity: deptMetrics.productivity,
      dhu: kpiBase.dhu,
      wip: kpiBase.wip,
      workforce,
    },
    handover: handoverRange.handover,
    handoverByDay: handoverRange.handoverByDay,
  };
}

async function fetchStandardDayReportRange(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayResourceHourReport | null> {
  const rpcRows = await fetchDayStandardReportRpc(factoryId, departmentId, dateFrom, dateTo);
  if (rpcRows == null) return null;

  const hourlyRows = rpcRows.filter((row) => row.source === 'hourly' || row.source === 'qc');
  const batchRows = rpcRows.filter((row) => row.source === 'batch' && (Number(row.qty) || 0) > 0);
  const isQcDept = rpcRows.some((row) => row.source === 'qc');
  const isBatch = batchRows.length > 0 && hourlyRows.length === 0;

  const [kpiRows, shiftRes, workforceRes, handoverRange, dbRouteSteps] = await Promise.all([
    fetchDepartmentKpis(factoryId, departmentId, dateFrom, dateTo),
    supabase.from('shifts').select('id, name, type, hours, productive_mins').eq('factory_id', factoryId),
    supabase
      .from('workforce_logs')
      .select('resource_id, headcount_by_category, log_date')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo),
    fetchDayDeptHandoverRange(factoryId, dateFrom, dateTo, departmentId, meta, colorwayLabels),
    // Real order_routing_steps.step_type (loading | produce | ...) — the RPC
    // rows below don't carry it, so this is the only way to tell a "loading"
    // capture (received/WIP-start, no SAM) apart from real production.
    fetchRoutingStepsForDepartment(factoryId, departmentId),
  ]);
  if (shiftRes.error) throw shiftRes.error;
  if (workforceRes.error) throw workforceRes.error;
  const dbRouteStepById = new Map(dbRouteSteps.map((s) => [s.id, s]));

  const kpiBase = aggregateDeptDayKpi((kpiRows || []) as DailyKpiRpcRow[]);
  const batchEntries = batchRows.map(mapStandardRpcToBatchEntry).sort(
    (a, b) =>
      (a.resourceName || '').localeCompare(b.resourceName || '') ||
      (a.startedAt || '').localeCompare(b.startedAt || ''),
  );

  if (isBatch) {
    const output = batchEntries.reduce((sum, entry) => sum + entry.outputQty, 0);
    return {
      isQcDept: false,
      isBatch: true,
      hourColumns: [],
      rows: [],
      shiftSections: [],
      nativeEntries: [],
      batchEntries,
      productiveMinsPerWorker: 480,
      kpi: {
        output,
        target: kpiBase.target,
        efficiency: null,
        productivity: null,
        dhu: kpiBase.dhu,
        wip: kpiBase.wip,
      },
      handover: handoverRange.handover,
      handoverByDay: handoverRange.handoverByDay,
    };
  }

  const shifts = (shiftRes.data || []).map((s) => mapShiftRow(s as Record<string, unknown>));
  const shiftRowMaps = new Map<string, Map<string, DayResourceHourRow>>();
  const qcShiftRowMaps = new Map<string, Map<string, DayResourceHourRow>>();
  const shiftDataSlots = new Map<string, Set<string>>();
  const qcShiftDataSlots = new Map<string, Set<string>>();
  const routeSteps: OriginRouteStepRow[] = [];

  const ingest = (
    targetRowMaps: Map<string, Map<string, DayResourceHourRow>>,
    targetDataSlots: Map<string, Set<string>>,
    captureKind: 'hourly' | 'qc',
    resourceId: string,
    orderId: string,
    colorwayId: string | null,
    hourSlot: string,
    count: number,
    inspectedQty: number,
    storedShiftId: string | null,
    orderRouteId: string | null,
    logDate: string,
    styleName: string,
    styleRef: string,
    buyerName: string,
    poNumber: string,
    colorName: string,
    resourceName: string,
    operationName: string,
    operationDefId: string | null,
  ) => {
    // A QC session can legitimately pass 0 pieces (100% rejected) — only skip
    // when the bucket truly has nothing (no hour slot, or no output/inspected count).
    if (!hourSlot || (count <= 0 && inspectedQty <= 0)) return;
    const shiftId = resolveShiftIdForSlot(shifts, hourSlot, storedShiftId);
    if (!targetDataSlots.has(shiftId)) targetDataSlots.set(shiftId, new Set());
    targetDataSlots.get(shiftId)!.add(hourSlot);
    // Prefer the real routing step (carries step_type) — fall back to a
    // synthetic one built from the RPC row if the step was since deleted.
    const dbStep = orderRouteId ? dbRouteStepById.get(orderRouteId) : undefined;
    const step: OriginRouteStepRow = dbStep ?? {
      id: orderRouteId || '',
      order_id: orderId,
      seq: 0,
      operation_name: operationName,
      operation_def_id: operationDefId,
    };
    if (orderRouteId && !routeSteps.some((s) => s.id === orderRouteId)) routeSteps.push(step);
    const operationGroupId = operationGroupKeyFromStep(step, orderRouteId ?? '');
    if (!targetRowMaps.has(shiftId)) targetRowMaps.set(shiftId, new Map());
    const rowMap = targetRowMaps.get(shiftId)!;
    const key = `${logDate}|${operationGroupId}|${resourceId}|${orderId}|${colorwayId ?? ''}`;
    const defectiveQty = captureKind === 'qc' ? Math.max(0, inspectedQty - count) : 0;
    const existing = rowMap.get(key);
    if (existing) {
      if (count > 0) {
        existing.hours[hourSlot] = (existing.hours[hourSlot] || 0) + count;
        existing.total += count;
      }
      if (captureKind === 'qc') {
        existing.inspectedQty = (existing.inspectedQty || 0) + inspectedQty;
        existing.defectiveQty = (existing.defectiveQty || 0) + defectiveQty;
      }
      return;
    }
    rowMap.set(key, {
      resourceId,
      resourceName: resourceName || '—',
      orderId,
      styleName: styleName || orderId.slice(0, 8),
      styleRef: styleRef || '',
      buyerName: buyerName || '',
      poNumber: poNumber || '',
      colorwayId,
      colorName: colorName || '—',
      hours: count > 0 ? { [hourSlot]: count } : {},
      hourTargets: {},
      hourlyTarget: 0,
      total: count,
      workforce: null,
      workforceBreakdown: [],
      producedMins: 0,
      resourceAvailableMins: 0,
      daysRunning: null,
      plannedEndDate: null,
      efficiencyPct: null,
      productivity: null,
      shiftId,
      logDate,
      operationId: orderRouteId,
      operationGroupId,
      operationLabel: operationLabelFromStep(step),
      captureKind,
      inspectedQty: captureKind === 'qc' ? inspectedQty : undefined,
      defectiveQty: captureKind === 'qc' ? defectiveQty : undefined,
      stepType: step.step_type ?? null,
    });
  };

  for (const row of hourlyRows) {
    const captureKind: 'hourly' | 'qc' = row.source === 'qc' ? 'qc' : 'hourly';
    ingest(
      captureKind === 'qc' ? qcShiftRowMaps : shiftRowMaps,
      captureKind === 'qc' ? qcShiftDataSlots : shiftDataSlots,
      captureKind,
      row.resource_id || '',
      row.order_id,
      row.colorway_id,
      String(row.hour_slot ?? ''),
      Number(row.qty) || 0,
      captureKind === 'qc' ? Number(row.inspected_qty) || 0 : 0,
      row.shift_id,
      row.order_route_id,
      String(row.log_date || '').slice(0, 10),
      row.style_name || '',
      row.style_ref || '',
      row.buyer_name || '',
      row.po_number || '',
      row.color_name || '',
      row.resource_name || '',
      row.operation_name || '',
      row.operation_def_id,
    );
  }

  const hourColumns = allActiveHourSlots(shifts);
  const regularShiftHours = getRegularShiftHours(shifts);
  let productiveMinsPerWorker = regularShiftProductiveMins(shifts);
  if (productiveMinsPerWorker <= 0) productiveMinsPerWorker = 480;

  const buildSections = (
    rowMaps: Map<string, Map<string, DayResourceHourRow>>,
    dataSlots: Map<string, Set<string>>,
    captureKind: 'hourly' | 'qc',
    fallbackWhenEmpty: boolean,
  ): DayShiftHourSection[] => {
    const shiftIds =
      rowMaps.size > 0
        ? sortShiftIds(shifts, [...rowMaps.keys()])
        : fallbackWhenEmpty
          ? [UNASSIGNED_SHIFT]
          : [];
    const sections: DayShiftHourSection[] = [];
    for (const shiftId of shiftIds) {
      const rowMap = rowMaps.get(shiftId) ?? new Map<string, DayResourceHourRow>();
      const sectionHourColumns = hourColumnsForShift(
        shifts,
        shiftId,
        dataSlots.get(shiftId) ?? new Set(),
      );
      const sectionRows = [...rowMap.values()].sort(
        (a, b) =>
          (a.logDate || '').localeCompare(b.logDate || '') ||
          a.resourceName.localeCompare(b.resourceName) ||
          a.styleName.localeCompare(b.styleName) ||
          a.colorName.localeCompare(b.colorName),
      );
      sections.push({
        shiftId,
        shiftName: shiftDisplayName(shifts, shiftId),
        hourColumns: sectionHourColumns,
        rows: sectionRows,
        captureKind,
      });
    }
    return sections;
  };

  const shiftSections = buildSections(shiftRowMaps, shiftDataSlots, 'hourly', true);
  const qcShiftSections = buildSections(qcShiftRowMaps, qcShiftDataSlots, 'qc', false);

  for (const section of qcShiftSections) {
    for (const row of section.rows) {
      const inspected = row.inspectedQty ?? 0;
      const defective = row.defectiveQty ?? 0;
      const pct = inspected > 0 ? (defective / inspected) * 100 : null;
      row.defectivePct = pct;
      row.dhu = pct;
    }
  }

  const rows = [...shiftSections.flatMap((s) => s.rows), ...qcShiftSections.flatMap((s) => s.rows)];
  const displayHourColumns =
    shiftSections.length === 1 ? shiftSections[0].hourColumns : hourColumns;

  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const sewingSamByOrder = new Map<string, number>();
  const samByAllocKey = new Map<string, number>();
  let allocPlanRows: AllocPlanRow[] = [];
  if (orderIds.length > 0) {
    allocPlanRows = await fetchLineAllocPlanRows(factoryId, orderIds);
    const { data: samRows, error: samErr } = await supabase
      .from('style_orders')
      .select('id, sewing_sam')
      .eq('factory_id', factoryId)
      .in('id', orderIds);
    if (samErr) throw samErr;
    for (const raw of samRows || []) {
      sewingSamByOrder.set(raw.id as string, Number(raw.sewing_sam) || 0);
    }
    for (const alloc of allocPlanRows) {
      const plannedSam = allocationSamValue({
        sam: alloc.sam,
        kpi_inputs: alloc.kpi_inputs,
      });
      if (plannedSam <= 0) continue;
      samByAllocKey.set(allocRowKey(alloc.order_id, alloc.colorway_id, alloc.line_id), plannedSam);
    }
  }

  const logsByDate = new Map<string, Array<Record<string, unknown>>>();
  for (const raw of (workforceRes.data || []) as Array<Record<string, unknown>>) {
    const logDate = String(raw.log_date || '').slice(0, 10);
    if (!logDate) continue;
    const list = logsByDate.get(logDate) ?? [];
    list.push(raw);
    logsByDate.set(logDate, list);
  }

  const rowsByDate = new Map<string, DayResourceHourRow[]>();
  for (const row of rows) {
    const logDate = row.logDate || '';
    const list = rowsByDate.get(logDate) ?? [];
    list.push(row);
    rowsByDate.set(logDate, list);
  }
  for (const [logDate, dateRows] of rowsByDate) {
    const resourceWorkforce = buildResourceWorkforceDetails(logsByDate.get(logDate) || []);
    enrichDayResourceRows(
      dateRows,
      samByAllocKey,
      sewingSamByOrder,
      resourceWorkforce,
      productiveMinsPerWorker,
    );
    applyAllocationPlanToDayRows(
      dateRows,
      allocPlanRows,
      logDate,
      displayHourColumns,
      regularShiftHours,
      departmentId,
    );
  }

  // Loading rows are a receiving/WIP-start acknowledgement, not measured
  // production — keep them out of the department's headline Output /
  // Efficiency / Productivity / Workforce KPI (they still show in their own
  // "Loading" operation card below).
  const productionRows = rows.filter((r) => r.stepType !== 'loading');
  const tableOutput = productionRows.reduce((sum, r) => sum + r.total, 0);
  const deptMetrics = computeDayDeptMetricsFromRows(productionRows);
  const kpi: DayResourceHourReport['kpi'] = {
    ...kpiBase,
    output: tableOutput,
    efficiency: deptMetrics.efficiency,
    productivity: deptMetrics.productivity,
    workforce: deptMetrics.workforce,
  };
  if (isQcDept) {
    let inspected = 0;
    let passed = 0;
    for (const row of rpcRows) {
      if (row.source !== 'qc') continue;
      inspected += Number(row.inspected_qty) || 0;
      passed += Number(row.qty) || 0;
    }
    kpi.inspected = inspected;
    kpi.passed = passed;
    kpi.passPct = inspected > 0 ? (passed / inspected) * 100 : null;
    kpi.defectivePct = inspected > 0 ? ((inspected - passed) / inspected) * 100 : null;
  }

  const operationSections = buildHourlyOperationSections(rows, routeSteps, displayHourColumns);

  return {
    isQcDept,
    hourColumns: displayHourColumns,
    rows,
    shiftSections,
    qcShiftSections,
    operationSections,
    batchEntries: batchEntries.length > 0 ? batchEntries : undefined,
    productiveMinsPerWorker,
    kpi,
    handover: handoverRange.handover,
    handoverByDay: handoverRange.handoverByDay,
  };
}

async function fetchTerminalDayReportRange(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayResourceHourReport | null> {
  const rpcRows = await fetchDayTerminalReportRpc(factoryId, departmentId, dateFrom, dateTo);
  if (rpcRows == null) return null;

  const [kpiRows, handoverRange] = await Promise.all([
    fetchDepartmentKpis(factoryId, departmentId, dateFrom, dateTo),
    fetchDayDeptHandoverRange(factoryId, dateFrom, dateTo, departmentId, meta, colorwayLabels),
  ]);
  const nativeEntries = rpcRows.map(mapTerminalRpcToNativeEntry);
  const kpiBase = aggregateDeptDayKpi((kpiRows || []) as DailyKpiRpcRow[]);
  const output = nativeEntries.reduce((sum, entry) => sum + entry.outputQty, 0);
  return {
    isQcDept: false,
    isNativeShipment: true,
    hourColumns: [],
    rows: [],
    shiftSections: [],
    nativeEntries,
    productiveMinsPerWorker: 480,
    kpi: {
      output,
      target: kpiBase.target,
      efficiency: null,
      productivity: null,
      dhu: kpiBase.dhu,
      wip: kpiBase.wip,
    },
    handover: handoverRange.handover,
    handoverByDay: handoverRange.handoverByDay,
  };
}

/** Department day report: hourly_counts or inspection_sessions pivoted by resource × style × color. */
export async function fetchDayResourceHourReport(
  factoryId: string,
  date: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayResourceHourReport> {
  const dept = meta.departments.find((d) => d.id === departmentId);
  const qcDept = isQcDept(dept?.apps ?? null);
  const planningMode = dept ? resolvePlanningMode(dept) : 'production';
  const roleKind = dayReportRoleKind(dept);
  const nativeCutting = roleKind === 'origin' || planningMode === 'native_cutting';
  const nativeShipment = roleKind === 'terminal' || planningMode === 'native_shipment';
  const isOutsource = roleKind === 'outsource' || planningMode === 'outsource';
  const isBatch = dept?.productionPath === 'batch';

  if (isOutsource) {
    return buildOutsourceDayReport(factoryId, date, departmentId, meta, colorwayLabels);
  }

  if (nativeShipment) {
    const ranged = await fetchTerminalDayReportRange(
      factoryId, date, date, departmentId, meta, colorwayLabels,
    );
    if (ranged) return ranged;
    return buildNativeShipmentDayReport(factoryId, date, departmentId, meta, colorwayLabels);
  }

  if (nativeCutting) {
    const ranged = await fetchNativeCuttingDayReportRange(
      factoryId,
      date,
      date,
      departmentId,
      meta,
      colorwayLabels,
    );
    if (ranged) return ranged;
    const operationSections = await buildNativeCuttingDaySections(
      factoryId,
      date,
      departmentId,
      meta,
      colorwayLabels,
    );
    const nativeEntries = await buildNativeCuttingSessionEntries(
      factoryId,
      date,
      departmentId,
      meta,
      colorwayLabels,
    );
    const rows = operationSections.flatMap((s) => s.rows);
      const [kpiRows, shiftRes, workforceRes] = await Promise.all([
        fetchDepartmentKpis(factoryId, departmentId, date, date),
        supabase.from('shifts').select('id, name, type, hours, productive_mins').eq('factory_id', factoryId),
        supabase
          .from('workforce_logs')
          .select('resource_id, headcount_by_category')
          .eq('factory_id', factoryId)
          .eq('department_id', departmentId)
          .eq('log_date', date),
      ]);
      if (shiftRes.error) throw shiftRes.error;
      if (workforceRes.error) throw workforceRes.error;

      const shifts = (shiftRes.data || []).map((s) => mapShiftRow(s as Record<string, unknown>));
      const regularShiftHours = getRegularShiftHours(shifts);
      let productiveMinsPerWorker = regularShiftProductiveMins(shifts);
      if (productiveMinsPerWorker <= 0) productiveMinsPerWorker = 480;

      const resourceWorkforce = buildResourceWorkforceDetails(
        (workforceRes.data || []) as Array<Record<string, unknown>>,
      );
      for (const section of operationSections) {
        for (const row of section.rows) {
          const wf = resourceWorkforce.get(row.resourceId);
          if (wf) {
            row.workforce = wf.total;
            row.workforceBreakdown = wf.breakdown;
          }
          row.logDate = date;
        }
      }

      const deptMetrics = computeDayDeptMetricsFromRows(rows);
      const nativeOutput = nativeEntries.reduce((sum, e) => sum + e.outputQty, 0);
      const kpiBase = aggregateDeptDayKpi((kpiRows || []) as DailyKpiRpcRow[]);
      const handover = await fetchDayDeptHandoverSummary(
        factoryId,
        date,
        departmentId,
        meta,
        colorwayLabels,
      );

    return {
      isQcDept: false,
      isNativeCutting: true,
      hourColumns: [CUTTING_OUTPUT_HOUR],
      rows,
      shiftSections: [],
      operationSections,
      nativeEntries,
      productiveMinsPerWorker,
      kpi: {
        output: nativeOutput,
        target: kpiBase.target,
        efficiency: deptMetrics.efficiency,
        productivity: deptMetrics.productivity,
        dhu: kpiBase.dhu,
        wip: kpiBase.wip,
      },
      handover,
      handoverByDay: [{ date, handover }],
    };
  }

  if (!isOutsource && !nativeCutting && !nativeShipment) {
    const ranged = await fetchStandardDayReportRange(
      factoryId, date, date, departmentId, meta, colorwayLabels,
    );
    if (ranged) return ranged;
  }

  if (isBatch) {
    return buildBatchDayReport(factoryId, date, departmentId, meta, colorwayLabels);
  }

  let orderMap = new Map<string, ReportOrderSummary>();
  const colorMap = new Map(colorwayLabels.map((c) => [c.id, c]));
  const resourceMap = new Map(meta.resources.map((r) => [r.id, r]));
  const routeSteps = await fetchRoutingStepsForDepartment(factoryId, departmentId);
  const routeStepById = new Map(routeSteps.map((s) => [s.id, s]));
  const shiftRowMaps = new Map<string, Map<string, DayResourceHourRow>>();
  const shiftDataSlots = new Map<string, Set<string>>();

  const ensureShiftRowMap = (shiftId: string): Map<string, DayResourceHourRow> => {
    if (!shiftRowMaps.has(shiftId)) shiftRowMaps.set(shiftId, new Map());
    return shiftRowMaps.get(shiftId)!;
  };

  const trackShiftSlot = (shiftId: string, hourSlot: string) => {
    if (!shiftDataSlots.has(shiftId)) shiftDataSlots.set(shiftId, new Set());
    shiftDataSlots.get(shiftId)!.add(hourSlot);
  };

  const emptyRow = (
    resourceId: string,
    orderId: string,
    colorwayId: string | null,
  ): DayResourceHourRow => {
    const order = orderMap.get(orderId);
    const resource = resourceId ? resourceMap.get(resourceId) : undefined;
    return {
      resourceId,
      resourceName: resource?.name || '—',
      orderId,
      styleName: order?.styleName || orderId.slice(0, 8),
      styleRef: order?.styleRef || '',
      buyerName: order?.buyerName || '',
      poNumber: order?.poNumber || '',
      colorwayId,
      colorName: colorwayDisplayLabel(colorwayId, colorMap),
      hours: {},
      hourTargets: {},
      hourlyTarget: 0,
      total: 0,
      workforce: null,
      workforceBreakdown: [],
      producedMins: 0,
      resourceAvailableMins: 0,
      daysRunning: null,
      plannedEndDate: null,
      efficiencyPct: null,
      productivity: null,
    };
  };

  const ingestCapture = (
    shifts: Shift[],
    resourceId: string,
    orderId: string,
    colorwayId: string | null,
    hourSlot: string,
    count: number,
    storedShiftId: string | null,
    orderRouteId: string | null,
  ) => {
    if (!hourSlot) return;
    const shiftId = resolveShiftIdForSlot(shifts, hourSlot, storedShiftId);
    trackShiftSlot(shiftId, hourSlot);
    if (count <= 0) return;
    const routeStep = orderRouteId ? routeStepById.get(orderRouteId) : undefined;
    const operationGroupId = operationGroupKeyFromStep(routeStep, orderRouteId ?? '');
    const rowMap = ensureShiftRowMap(shiftId);
    const key = `${operationGroupId}|${resourceId}|${orderId}|${colorwayId ?? ''}`;
    const row = rowMap.get(key) ?? emptyRow(resourceId, orderId, colorwayId);
    row.shiftId = shiftId;
    row.logDate = date;
    row.operationId = orderRouteId;
    row.operationGroupId = operationGroupId;
    row.operationLabel = operationLabelFromStep(routeStep);
    row.stepType = routeStep?.step_type ?? null;
    row.hours[hourSlot] = (row.hours[hourSlot] || 0) + count;
    row.total += count;
    rowMap.set(key, row);
  };

  let captureRows: Array<Record<string, unknown>> = [];
  if (qcDept) {
    const { data, error } = await supabase
      .from('inspection_sessions')
      .select('order_id, colorway_id, resource_id, hour_slot, shift_id, passed, rework_passed, order_route_id')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .eq('log_date', date);
    if (error) throw error;
    captureRows = data || [];
  } else {
    const { data, error } = await supabase
      .from('hourly_counts')
      .select('order_id, colorway_id, resource_id, hour_slot, shift_id, count, order_route_id')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .eq('log_date', date);
    if (error) throw error;
    captureRows = data || [];
  }

  orderMap = await resolveOrderMap(
    factoryId,
    meta,
    captureRows.map((raw) => raw.order_id as string),
  );

  const [kpiRows, qcRes, shiftRes, workforceRes] = await Promise.all([
    fetchDepartmentKpis(factoryId, departmentId, date, date),
    qcDept
      ? supabase
          .from('inspection_sessions')
          .select('total_inspected, passed, rework_passed')
          .eq('factory_id', factoryId)
          .eq('department_id', departmentId)
          .eq('log_date', date)
      : Promise.resolve({ data: null, error: null }),
    supabase.from('shifts').select('id, name, type, hours, productive_mins').eq('factory_id', factoryId),
    supabase
      .from('workforce_logs')
      .select('resource_id, headcount_by_category')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .eq('log_date', date),
  ]);

  if (qcRes.error) throw qcRes.error;
  if (shiftRes.error) throw shiftRes.error;
  if (workforceRes.error) throw workforceRes.error;

  const kpiRes = { data: kpiRows, error: null as null };

  const shifts = (shiftRes.data || []).map((s) => mapShiftRow(s as Record<string, unknown>));

  for (const raw of captureRows) {
    const orderId = raw.order_id as string;
    const colorwayId = (raw.colorway_id as string) || null;
    const resourceId = (raw.resource_id as string) || '';
    const hourSlot = String(raw.hour_slot ?? '');
    const count = qcDept
      ? qcSessionOutputQty(raw)
      : Number(raw.count) || 0;
    ingestCapture(
      shifts,
      resourceId,
      orderId,
      colorwayId,
      hourSlot,
      count,
      (raw.shift_id as string) || null,
      (raw.order_route_id as string) || null,
    );
  }

  const hourColumns = allActiveHourSlots(shifts);
  const regularShiftHours = getRegularShiftHours(shifts);
  let productiveMinsPerWorker = regularShiftProductiveMins(shifts);
  if (productiveMinsPerWorker <= 0) {
    for (const raw of shiftRes.data || []) {
      const pm = Number((raw as { productive_mins?: number }).productive_mins);
      if (pm > 0) {
        productiveMinsPerWorker = pm;
        break;
      }
    }
  }
  if (productiveMinsPerWorker <= 0) productiveMinsPerWorker = 480;

  const shiftIds =
    shiftRowMaps.size > 0
      ? sortShiftIds(shifts, [...shiftRowMaps.keys()])
      : [UNASSIGNED_SHIFT];

  const shiftSections: DayShiftHourSection[] = [];
  for (const shiftId of shiftIds) {
    const rowMap = shiftRowMaps.get(shiftId) ?? new Map<string, DayResourceHourRow>();
    const sectionHourColumns = hourColumnsForShift(
      shifts,
      shiftId,
      shiftDataSlots.get(shiftId) ?? new Set(),
    );
    const sectionRows = [...rowMap.values()].sort(
      (a, b) =>
        a.resourceName.localeCompare(b.resourceName) ||
        a.styleName.localeCompare(b.styleName) ||
        a.colorName.localeCompare(b.colorName),
    );
    for (const row of sectionRows) {
      row.logDate = date;
    }
    shiftSections.push({
      shiftId,
      shiftName: shiftDisplayName(shifts, shiftId),
      hourColumns: sectionHourColumns,
      rows: sectionRows,
    });
  }

  const rows = shiftSections.flatMap((s) => s.rows);
  const displayHourColumns =
    shiftSections.length === 1 ? shiftSections[0].hourColumns : hourColumns;

  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const sewingSamByOrder = new Map<string, number>();
  const samByAllocKey = new Map<string, number>();
  let allocPlanRows: AllocPlanRow[] = [];

  if (orderIds.length > 0) {
    allocPlanRows = await fetchLineAllocPlanRows(factoryId, orderIds);

    const { data: samRows, error: samErr } = await supabase
      .from('style_orders')
      .select('id, sewing_sam')
      .eq('factory_id', factoryId)
      .in('id', orderIds);
    if (samErr) throw samErr;
    for (const raw of samRows || []) {
      sewingSamByOrder.set(raw.id as string, Number(raw.sewing_sam) || 0);
    }

    for (const alloc of allocPlanRows) {
      const start = alloc.start_date?.split('T')[0] ?? null;
      const end = alloc.end_date?.split('T')[0] ?? null;
      if (start && date < start) continue;
      if (end && date > end) continue;
      const plannedSam = allocationSamValue({
        sam: alloc.sam,
        kpi_inputs: alloc.kpi_inputs,
      });
      if (plannedSam <= 0) continue;
      const key = allocRowKey(alloc.order_id, alloc.colorway_id, alloc.line_id);
      samByAllocKey.set(key, plannedSam);
    }
  }

  const resourceWorkforce = buildResourceWorkforceDetails(
    (workforceRes.data || []) as Array<Record<string, unknown>>,
  );

  // Enrich once across ALL of this day's rows (every shift section combined) so a
  // resource that logs output in more than one shift the same day gets its true
  // full-day totals for efficiency/productivity, not just one section's slice.
  enrichDayResourceRows(
    rows,
    samByAllocKey,
    sewingSamByOrder,
    resourceWorkforce,
    productiveMinsPerWorker,
  );
  for (const section of shiftSections) {
    applyAllocationPlanToDayRows(
      section.rows,
      allocPlanRows,
      date,
      section.hourColumns,
      regularShiftHours,
      departmentId,
    );
  }

  // Loading rows are a receiving/WIP-start acknowledgement, not measured
  // production — keep them out of the headline KPI (see fetchStandardDayReportRange).
  const productionRows = rows.filter((r) => r.stepType !== 'loading');
  const tableOutput = productionRows.reduce((sum, r) => sum + r.total, 0);
  const deptMetrics = computeDayDeptMetricsFromRows(productionRows);

  const kpiBase = aggregateDeptDayKpi((kpiRes.data || []) as DailyKpiRpcRow[]);
  const handover = await fetchDayDeptHandoverSummary(
    factoryId,
    date,
    departmentId,
    meta,
    colorwayLabels,
  );
  const kpi: DayResourceHourReport['kpi'] = {
    ...kpiBase,
    output: tableOutput,
    efficiency: deptMetrics.efficiency,
    productivity: deptMetrics.productivity,
  };

  if (qcDept && qcRes.data) {
    let inspected = 0;
    let passed = 0;
    for (const row of qcRes.data) {
      inspected += Number(row.total_inspected) || 0;
      passed += qcSessionOutputQty(row);
    }
    kpi.inspected = inspected;
    kpi.passed = passed;
    kpi.passPct = inspected > 0 ? (passed / inspected) * 100 : null;
    kpi.defectivePct = inspected > 0 ? ((inspected - passed) / inspected) * 100 : null;
  }

  const operationSections = buildHourlyOperationSections(
    rows,
    routeSteps,
    displayHourColumns,
  );

  return {
    isQcDept: qcDept,
    hourColumns: displayHourColumns,
    rows,
    shiftSections,
    operationSections,
    productiveMinsPerWorker,
    kpi,
    handover,
    handoverByDay: [{ date, handover }],
  };
}

function mergeOperationSectionsFromDailyReports(
  dailyReports: DayResourceHourReport[],
): DayOperationHourSection[] {
  const byOp = new Map<string, DayOperationHourSection>();
  for (const report of dailyReports) {
    for (const sec of report.operationSections ?? []) {
      const existing = byOp.get(sec.operationId);
      if (!existing) {
        byOp.set(sec.operationId, {
          ...sec,
          rows: [...sec.rows],
        });
      } else {
        existing.rows.push(...sec.rows);
      }
    }
  }
  return [...byOp.values()].sort((a, b) => a.operationLabel.localeCompare(b.operationLabel));
}

/** Department day report across a date range (one row set per day with logDate). */
export async function fetchDayResourceHourReportRange(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
  departmentId: string,
  meta: ReportMeta,
  colorwayLabels: ColorwayLabel[],
): Promise<DayResourceHourReport> {
  const days = listDatesInRange(dateFrom, dateTo);
  const dept = meta.departments.find((d) => d.id === departmentId);
  const roleKind = dayReportRoleKind(dept);
  if (roleKind === 'origin') {
    const ranged = await fetchNativeCuttingDayReportRange(
      factoryId, dateFrom, dateTo, departmentId, meta, colorwayLabels,
    );
    if (ranged) return ranged;
  } else if (roleKind === 'standard') {
    const ranged = await fetchStandardDayReportRange(
      factoryId, dateFrom, dateTo, departmentId, meta, colorwayLabels,
    );
    if (ranged) return ranged;
  } else if (roleKind === 'terminal') {
    const ranged = await fetchTerminalDayReportRange(
      factoryId, dateFrom, dateTo, departmentId, meta, colorwayLabels,
    );
    if (ranged) return ranged;
  }
  if (days.length === 0) {
    return fetchDayResourceHourReport(
      factoryId,
      format(new Date(), 'yyyy-MM-dd'),
      departmentId,
      meta,
      colorwayLabels,
    );
  }
  if (days.length === 1) {
    return fetchDayResourceHourReport(
      factoryId,
      days[0],
      departmentId,
      meta,
      colorwayLabels,
    );
  }

  const dailyReports = await Promise.all(
    days.map((date) =>
      fetchDayResourceHourReport(factoryId, date, departmentId, meta, colorwayLabels),
    ),
  );

  const handoverByDay = days.map((date, i) => ({
    date,
    handover: dailyReports[i].handover ?? { received: [], sent: [] },
  }));
  const handover = mergeHandoverSummaries(handoverByDay.map((d) => d.handover));

  const shiftSections = mergeShiftSectionsFromDailyReports(dailyReports, days);
  let rows = shiftSections.flatMap((s) => s.rows);
  if (rows.length === 0) {
    rows = dailyReports.flatMap((report) => report.rows);
  }

  const hourColumns =
    shiftSections.length === 1
      ? shiftSections[0].hourColumns
      : dailyReports[0]?.hourColumns ?? [];
  const isQcDept = dailyReports[0]?.isQcDept ?? false;
  const isNativeCutting = dailyReports.some((r) => r.isNativeCutting);
  const isNativeShipment = dailyReports.some((r) => r.isNativeShipment);
  const isOutsource = dailyReports.some((r) => r.isOutsource);
  const isBatch = dailyReports.some((r) => r.isBatch);
  const nativeEntries = dailyReports.flatMap((report) => report.nativeEntries || []);
  const outsourceEntries = dailyReports.flatMap((report) => report.outsourceEntries || []);
  const batchEntries = dailyReports.flatMap((report) => report.batchEntries || []);
  const operationSections = isNativeCutting
    ? mergeOperationSectionsFromDailyReports(dailyReports)
    : mergeHourlyOperationSectionsFromDailyReports(dailyReports);
  const productiveMinsPerWorker = dailyReports[0]?.productiveMinsPerWorker ?? 480;
  const deptMetrics = computeDayDeptMetricsFromRows(rows);

  let inspected = 0;
  let passed = 0;
  let target = 0;
  let wip = 0;
  let dhuSum = 0;
  let dhuWeight = 0;

  for (const report of dailyReports) {
    target += report.kpi.target || 0;
    wip = report.kpi.wip ?? wip;
    if (report.kpi.dhu != null) {
      const w = report.kpi.output > 0 ? report.kpi.output : 1;
      dhuSum += (report.kpi.dhu || 0) * w;
      dhuWeight += w;
    }
    if (report.isQcDept) {
      inspected += report.kpi.inspected ?? 0;
      passed += report.kpi.passed ?? 0;
    }
  }

  const altOutput = isOutsource
    ? outsourceEntries.reduce((s, e) => s + (e.receivedQty || 0), 0)
    : isBatch
      ? batchEntries.reduce((s, e) => s + e.outputQty, 0)
      : isNativeShipment
        ? nativeEntries.reduce((s, e) => s + e.outputQty, 0)
        : isNativeCutting
          ? nativeEntries.reduce((s, e) => s + e.outputQty, 0)
          : null;

  const kpi: DayResourceHourReport['kpi'] = {
    target,
    wip,
    dhu: dhuWeight > 0 ? Math.round(dhuSum / dhuWeight) : null,
    output: altOutput ?? deptMetrics.output,
    efficiency: isNativeShipment ? null : deptMetrics.efficiency,
    productivity: isNativeShipment ? null : deptMetrics.productivity,
  };

  if (isQcDept) {
    kpi.inspected = inspected;
    kpi.passed = passed;
    kpi.passPct = inspected > 0 ? (passed / inspected) * 100 : null;
    kpi.defectivePct = inspected > 0 ? ((inspected - passed) / inspected) * 100 : null;
  }

  return {
    isQcDept,
    isNativeCutting,
    isNativeShipment,
    isOutsource,
    isBatch,
    hourColumns,
    rows,
    shiftSections,
    operationSections,
    nativeEntries,
    outsourceEntries,
    batchEntries,
    productiveMinsPerWorker,
    kpi,
    handover,
    handoverByDay,
  };
}
