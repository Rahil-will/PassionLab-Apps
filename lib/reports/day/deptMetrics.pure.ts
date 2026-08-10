import eachDayOfInterval from 'date-fns/eachDayOfInterval';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { hourlyTargetFromDaily } from '../../shiftHours';
import type { DailyKpiRpcRow } from '../kpiAndProgress';
import type {
  DayResourceHourReport,
  DayResourceHourRow,
  DeptResourceStyleRow,
  DeptStyleSummaryRow,
  WorkforceCategoryCount,
} from './types';

export interface AllocPlanRow {
  id: string;
  order_id: string;
  colorway_id: string | null;
  line_id: string;
  department_id: string | null;
  daily_target: number;
  hourly_target: number | null;
  qty: number;
  start_date: string | null;
  end_date: string | null;
  sam: number | null;
  kpi_inputs: { sam?: number } | null;
}

export function listDatesInRange(dateFrom: string, dateTo: string): string[] {
  const from = dateFrom <= dateTo ? dateFrom : dateTo;
  const to = dateFrom <= dateTo ? dateTo : dateFrom;
  return eachDayOfInterval({ start: parseISO(from), end: parseISO(to) }).map((d) =>
    format(d, 'yyyy-MM-dd'),
  );
}

/** Sum headcount per resource_id across shift logs for the day. */
export function buildResourceWorkforceDetails(
  logs: Array<Record<string, unknown>>,
): Map<string, { total: number; breakdown: WorkforceCategoryCount[] }> {
  const catMaps = new Map<string, Map<string, number>>();
  for (const raw of logs) {
    const resourceId = raw.resource_id as string | null;
    if (!resourceId) continue;
    const cats = catMaps.get(resourceId) ?? new Map<string, number>();
    const headcount = raw.headcount_by_category as Record<string, number> | null;
    if (headcount && typeof headcount === 'object') {
      for (const [cat, count] of Object.entries(headcount)) {
        const n = Number(count) || 0;
        if (n <= 0) continue;
        cats.set(cat, (cats.get(cat) || 0) + n);
      }
    }
    catMaps.set(resourceId, cats);
  }
  const result = new Map<string, { total: number; breakdown: WorkforceCategoryCount[] }>();
  for (const [resourceId, cats] of catMaps) {
    const breakdown = [...cats.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
    const total = breakdown.reduce((sum, row) => sum + row.count, 0);
    if (total > 0) result.set(resourceId, { total, breakdown });
  }
  return result;
}

export function allocRowKey(orderId: string, colorwayId: string | null, resourceId: string): string {
  return `${orderId}|${colorwayId ?? ''}|${resourceId}`;
}

function lineIdMatches(allocLineId: string, resourceId: string): boolean {
  if (!resourceId) return true;
  if (!allocLineId) return true;
  return allocLineId === resourceId;
}

function colorwayMatches(allocColorwayId: string | null, rowColorwayId: string | null): boolean {
  if (!rowColorwayId) return true;
  if (!allocColorwayId) return true;
  return allocColorwayId === rowColorwayId;
}

function allocInPlanWindow(
  alloc: AllocPlanRow,
  logDate: string,
  strict: boolean,
): boolean {
  const start = alloc.start_date?.split('T')[0] ?? null;
  const end = alloc.end_date?.split('T')[0] ?? null;
  if (start && logDate < start) return false;
  if (strict && end && logDate > end) return false;
  return true;
}

function scoreAllocationMatch(
  alloc: AllocPlanRow,
  orderId: string,
  colorwayId: string | null,
  resourceId: string,
  logDate: string,
  departmentId: string,
): number {
  if (alloc.order_id !== orderId) return -1;
  if (!lineIdMatches(alloc.line_id, resourceId)) return -1;
  if (!colorwayMatches(alloc.colorway_id, colorwayId)) return -1;

  let score = 0;
  if (resourceId && alloc.line_id === resourceId) score += 80;
  if (colorwayId && alloc.colorway_id === colorwayId) score += 60;
  if (departmentId && alloc.department_id === departmentId) score += 40;
  else if (!alloc.department_id) score += 10;
  if (allocInPlanWindow(alloc, logDate, true)) score += 50;
  else if (allocInPlanWindow(alloc, logDate, false)) score += 20;
  if (alloc.end_date) score += 5;
  if (alloc.hourly_target != null && alloc.hourly_target > 0) score += 5;
  return score;
}

/** Match line_allocations.end_date + hourly_target to a floor capture row. */
function findAllocationForDayRow(
  allocs: AllocPlanRow[],
  orderId: string,
  colorwayId: string | null,
  resourceId: string,
  logDate: string,
  departmentId: string,
): AllocPlanRow | null {
  let best: AllocPlanRow | null = null;
  let bestScore = -1;
  for (const alloc of allocs) {
    const score = scoreAllocationMatch(
      alloc,
      orderId,
      colorwayId,
      resourceId,
      logDate,
      departmentId,
    );
    if (score > bestScore) {
      bestScore = score;
      best = alloc;
    }
  }
  return best;
}

function allocWorkingDays(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 0;
  const start = startDate.split('T')[0];
  const end = endDate.split('T')[0];
  let days = 0;
  for (let d = new Date(start); d <= new Date(end); d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) days++;
  }
  return days;
}

function impliedDailyTarget(alloc: AllocPlanRow): number {
  const stored = Number(alloc.daily_target) || 0;
  if (stored > 0) return stored;
  const qty = Number(alloc.qty) || 0;
  const wd = allocWorkingDays(alloc.start_date, alloc.end_date);
  return wd > 0 && qty > 0 ? Math.ceil(qty / wd) : 0;
}

export function applyAllocationPlanToDayRows(
  rows: DayResourceHourRow[],
  allocs: AllocPlanRow[],
  logDate: string,
  hourColumns: string[],
  regularShiftHours: number,
  departmentId: string,
): void {
  for (const row of rows) {
    const rowDate = row.logDate ?? logDate;
    const alloc = findAllocationForDayRow(
      allocs,
      row.orderId,
      row.colorwayId,
      row.resourceId,
      rowDate,
      departmentId,
    );
    if (!alloc) continue;

    const dailyTarget = impliedDailyTarget(alloc);
    const storedHr = alloc.hourly_target != null ? Number(alloc.hourly_target) : 0;
    const hrTarget =
      storedHr > 0
        ? storedHr
        : dailyTarget > 0
          ? hourlyTargetFromDaily(dailyTarget, regularShiftHours)
          : 0;
    row.hourlyTarget = hrTarget;
    row.hourTargets = {};
    for (const h of hourColumns) {
      row.hourTargets[h] = hrTarget;
    }
    row.daysRunning = daysRunningFromStart(alloc.start_date, rowDate);
    row.plannedEndDate = alloc.end_date ? alloc.end_date.split('T')[0] : null;
    row.allocationId = alloc.id;
  }
}

function daysRunningFromStart(startDate: string | null, logDate: string): number | null {
  if (!startDate) return null;
  const start = startDate.split('T')[0];
  if (logDate < start) return null;
  const diff = new Date(logDate).getTime() - new Date(start).getTime();
  return Math.floor(diff / 86_400_000) + 1;
}

export function enrichDayResourceRows(
  rows: DayResourceHourRow[],
  samByAllocKey: Map<string, number>,
  sewingSamByOrder: Map<string, number>,
  resourceWorkforce: Map<string, { total: number; breakdown: WorkforceCategoryCount[] }>,
  productiveMinsPerWorker: number,
): void {
  const resourceAgg = new Map<string, { output: number; producedMins: number }>();

  for (const row of rows) {
    const wf = resourceWorkforce.get(row.resourceId);
    row.workforce = wf && wf.total > 0 ? wf.total : null;
    row.workforceBreakdown = wf?.breakdown ?? [];
    const key = allocRowKey(row.orderId, row.colorwayId, row.resourceId);
    const sam = samByAllocKey.get(key) ?? sewingSamByOrder.get(row.orderId) ?? 0;
    row.producedMins = row.total * sam;
    const agg = resourceAgg.get(row.resourceId) ?? { output: 0, producedMins: 0 };
    agg.output += row.total;
    agg.producedMins += row.producedMins;
    resourceAgg.set(row.resourceId, agg);
  }

  for (const row of rows) {
    const workforce = row.workforce;
    const agg = resourceAgg.get(row.resourceId);
    const availableMins =
      workforce != null && workforce > 0 && productiveMinsPerWorker > 0
        ? workforce * productiveMinsPerWorker
        : 0;
    row.resourceAvailableMins = availableMins;
    if (!workforce || workforce <= 0 || !agg) {
      row.efficiencyPct = null;
      row.productivity = null;
      continue;
    }
    row.efficiencyPct =
      agg.producedMins > 0 && availableMins > 0
        ? (agg.producedMins / availableMins) * 100
        : null;
    row.productivity = agg.output > 0 ? agg.output / workforce : null;
  }
}

export function computeDayDeptMetricsFromRows(
  rows: DayResourceHourRow[],
): { output: number; workforce: number; efficiency: number | null; productivity: number | null } {
  let output = 0;
  let producedMins = 0;
  let availableMins = 0;
  let workforce = 0;
  const seenResources = new Set<string>();

  for (const row of rows) {
    output += row.total;
    producedMins += row.producedMins;
    if (!row.resourceId || seenResources.has(row.resourceId)) continue;
    seenResources.add(row.resourceId);
    workforce += row.workforce || 0;
    availableMins += row.resourceAvailableMins;
  }

  return {
    output,
    workforce,
    efficiency:
      producedMins > 0 && availableMins > 0 ? (producedMins / availableMins) * 100 : null,
    productivity: workforce > 0 && output > 0 ? output / workforce : null,
  };
}

export function aggregateDeptDayKpi(
  rows: DailyKpiRpcRow[],
): Pick<
  DayResourceHourReport['kpi'],
  'target' | 'dhu' | 'wip'
> {
  let target = 0;
  let wip = 0;
  let dhuSum = 0;
  let dhuWeight = 0;

  for (const row of rows) {
    target += row.daily_target || 0;
    wip += row.wip_qty || 0;
    if (row.dhu != null) {
      const weight = row.daily_output > 0 ? row.daily_output : 1;
      dhuSum += Number(row.dhu) * weight;
      dhuWeight += weight;
    }
  }

  return {
    target,
    wip,
    dhu: dhuWeight > 0 ? Math.round(dhuSum / dhuWeight) : null,
  };
}

const CUTTING_OUTPUT_HOUR = 'Output';

export function flattenDeptResourceStyleRows(
  styleRows: DeptStyleSummaryRow[],
): DeptResourceStyleRow[] {
  const out: DeptResourceStyleRow[] = [];
  for (const style of styleRows) {
    if (style.resourceBreakdown.length === 0) {
      out.push({
        resourceId: '',
        resourceName: '—',
        orderId: style.orderId,
        styleName: style.styleName,
        poNumber: style.poNumber,
        output: style.totalOutput,
        styleEfficiency: style.avgEfficiency,
      });
      continue;
    }
    for (const res of style.resourceBreakdown) {
      out.push({
        resourceId: res.resourceId,
        resourceName: res.resourceName,
        orderId: style.orderId,
        styleName: style.styleName,
        poNumber: style.poNumber,
        output: res.output,
        styleEfficiency: style.avgEfficiency,
      });
    }
  }
  return out.sort(
    (a, b) =>
      b.output - a.output ||
      a.resourceName.localeCompare(b.resourceName) ||
      a.styleName.localeCompare(b.styleName),
  );
}