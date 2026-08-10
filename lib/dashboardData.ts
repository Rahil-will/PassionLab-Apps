import { supabase } from './supabase';
import type { DailyKpiRpcRow } from './mesReportsApi';

export interface DayOutputRow {
  logDate: string;
  target: number;
  output: number;
  efficiency: number | null;
}

export interface ResourceOutputRow {
  resourceId: string | null;
  resourceName: string;
  output: number;
}

export interface DeptAggregateRow {
  departmentId: string;
  name: string;
  target: number;
  output: number;
  wip: number;
  efficiency: number | null;
}

const EXCLUDED_ORDER_STATUSES = new Set(['Completed', 'Cancelled']);

export function isOrderInProduction(status: string | undefined | null): boolean {
  if (!status) return true;
  return !EXCLUDED_ORDER_STATUSES.has(status);
}

export function latestLogDate(rows: DailyKpiRpcRow[]): string {
  return rows.reduce((max, r) => (r.log_date > max ? r.log_date : max), '');
}

/** End-of-day WIP for the latest date in the filtered KPI set (avoid summing snapshots across days). */
export function wipForLatestDay(rows: DailyKpiRpcRow[]): number {
  const latest = latestLogDate(rows);
  if (!latest) return 0;
  return rows
    .filter((r) => r.log_date === latest)
    .reduce((sum, r) => sum + (r.wip_qty || 0), 0);
}

/**
 * Sum WIP using each key's latest log_date within `rows` (end-of-day snapshot semantics).
 */
export function wipByKeyLatestDay(
  rows: DailyKpiRpcRow[],
  keyFn: (row: DailyKpiRpcRow) => string,
): Map<string, number> {
  const latestByKey = new Map<string, string>();
  for (const row of rows) {
    const key = keyFn(row);
    const cur = latestByKey.get(key);
    if (!cur || row.log_date > cur) latestByKey.set(key, row.log_date);
  }
  const wip = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    if (row.log_date !== latestByKey.get(key)) continue;
    wip.set(key, (wip.get(key) || 0) + (row.wip_qty || 0));
  }
  return wip;
}

export function aggregateByDepartment(
  rows: DailyKpiRpcRow[],
  deptNameById: Map<string, string>,
  sortedDeptIds: string[],
): DeptAggregateRow[] {
  const byDept = new Map<string, DeptAggregateRow>();
  for (const row of rows) {
    const cur = byDept.get(row.department_id) ?? {
      departmentId: row.department_id,
      name: deptNameById.get(row.department_id) || row.department_id,
      target: 0,
      output: 0,
      wip: 0,
      efficiency: null,
    };
    cur.target += row.daily_target || 0;
    cur.output += row.daily_output || 0;
    byDept.set(row.department_id, cur);
  }

  const latest = latestLogDate(rows);
  if (latest) {
    for (const row of rows.filter((r) => r.log_date === latest)) {
      const cur = byDept.get(row.department_id);
      if (cur) cur.wip += row.wip_qty || 0;
    }
  }

  for (const dept of byDept.values()) {
    dept.efficiency = dept.target > 0 ? Math.round((dept.output / dept.target) * 100) : null;
  }

  const order = sortedDeptIds.length > 0 ? sortedDeptIds : [...byDept.keys()];
  return order
    .map((id) => byDept.get(id))
    .filter((d): d is DeptAggregateRow => Boolean(d));
}

export function aggregateByDay(rows: DailyKpiRpcRow[]): DayOutputRow[] {
  const byDay = new Map<string, { target: number; output: number; eff: number[] }>();
  for (const row of rows) {
    const cur = byDay.get(row.log_date) ?? { target: 0, output: 0, eff: [] };
    cur.target += row.daily_target || 0;
    cur.output += row.daily_output || 0;
    if (row.daily_efficiency_pct != null) cur.eff.push(row.daily_efficiency_pct);
    byDay.set(row.log_date, cur);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([logDate, v]) => ({
      logDate,
      target: v.target,
      output: v.output,
      efficiency: v.eff.length ? Math.round(v.eff.reduce((a, b) => a + b, 0) / v.eff.length) : null,
    }));
}

export async function fetchDeptResourceOutput(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  resourceNameById: Map<string, string>,
): Promise<ResourceOutputRow[]> {
  const { data, error } = await supabase
    .from('hourly_counts')
    .select('resource_id, count')
    .eq('factory_id', factoryId)
    .eq('department_id', departmentId)
    .gte('log_date', dateFrom)
    .lte('log_date', dateTo);

  if (error) throw error;

  const totals = new Map<string | null, number>();
  for (const raw of data || []) {
    const resourceId = (raw.resource_id as string) || null;
    totals.set(resourceId, (totals.get(resourceId) || 0) + (Number(raw.count) || 0));
  }

  return [...totals.entries()]
    .map(([resourceId, output]) => ({
      resourceId,
      resourceName: resourceId ? (resourceNameById.get(resourceId) || 'Resource') : 'Unassigned',
      output,
    }))
    .filter((r) => r.output > 0)
    .sort((a, b) => b.output - a.output);
}
