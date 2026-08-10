import type { StyleDeptDailyRow } from './mesReportsApi';

type FlowDeptRef = { deptId: string; visitId: string; flowStep: number };

function mergeDailyRow(base: StyleDeptDailyRow, add: StyleDeptDailyRow): StyleDeptDailyRow {
  const output = base.output + add.output;
  const dailyAvailableMins = Math.max(base.dailyAvailableMins, add.dailyAvailableMins);
  const producedMins =
    (base.efficiency != null && base.dailyAvailableMins > 0
      ? (base.efficiency / 100) * base.dailyAvailableMins
      : 0) +
    (add.efficiency != null && add.dailyAvailableMins > 0
      ? (add.efficiency / 100) * add.dailyAvailableMins
      : 0);
  const efficiency =
    producedMins > 0 && dailyAvailableMins > 0 ? (producedMins / dailyAvailableMins) * 100 : null;

  let dhu: number | null = null;
  if (base.dhu != null || add.dhu != null) {
    const w1 = base.output > 0 ? base.output : 1;
    const w2 = add.output > 0 ? add.output : 1;
    dhu = ((base.dhu ?? 0) * w1 + (add.dhu ?? 0) * w2) / (w1 + w2);
  }

  let defectivePct: number | null = null;
  if (base.defectivePct != null || add.defectivePct != null) {
    const w1 = base.output > 0 ? base.output : 1;
    const w2 = add.output > 0 ? add.output : 1;
    defectivePct =
      ((base.defectivePct ?? 0) * w1 + (add.defectivePct ?? 0) * w2) / (w1 + w2);
  }

  let productivity: number | null = null;
  if (base.productivity != null || add.productivity != null) {
    const w1 = base.output > 0 ? base.output : 1;
    const w2 = add.output > 0 ? add.output : 1;
    productivity =
      ((base.productivity ?? 0) * w1 + (add.productivity ?? 0) * w2) / (w1 + w2);
  }

  return {
    ...base,
    output,
    target: Math.max(base.target, add.target),
    dailyAvailableMins,
    efficiency,
    productivity,
    dhu,
    defectivePct,
    operationId: undefined,
    operationName: undefined,
    isExitOperation: true,
  };
}

/** Dept-level chart rows: prefer exit-operation capture; otherwise sum all ops by date. */
export function deptChartDailyRows(rows: StyleDeptDailyRow[]): StyleDeptDailyRow[] {
  const exitRows = rows.filter((r) => !r.operationId || r.isExitOperation);
  if (exitRows.length > 0) return exitRows;

  const byDate = new Map<string, StyleDeptDailyRow>();
  for (const row of rows) {
    const cur = byDate.get(row.date);
    byDate.set(row.date, cur ? mergeDailyRow(cur, row) : { ...row, isExitOperation: true });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** First route visit per department — daily KPIs are department-scoped in capture tables. */
export function firstVisitIdByDept(flowDepts: FlowDeptRef[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of [...flowDepts].sort((a, b) => a.flowStep - b.flowStep)) {
    if (!map.has(d.deptId)) map.set(d.deptId, d.visitId);
  }
  return map;
}

/**
 * Daily rows for a visit cell: filter capture to this visit's route steps when possible.
 * Daily KPI tables are department-scoped; route filter splits ops within the visit.
 */
export function dailyRowsForVisit(
  dept: { deptId: string; visitId: string; routeIds?: string[] },
  flowDepts: FlowDeptRef[],
  rowsByDept: Map<string, StyleDeptDailyRow[]>,
): StyleDeptDailyRow[] {
  const rows = rowsByDept.get(dept.deptId) ?? [];
  if (dept.routeIds && dept.routeIds.length > 0) {
    const routeSet = new Set(dept.routeIds);
    const routeRows = rows.filter((r) => !r.operationId || routeSet.has(r.operationId));
    if (routeRows.length > 0) return routeRows;
  }
  const first = firstVisitIdByDept(flowDepts);
  if (first.get(dept.deptId) === dept.visitId) return rows;
  if (flowDepts.length === 1 && flowDepts[0]?.visitId === dept.visitId) return rows;
  return rows;
}
