import type { StyleDeptDailyRow, StyleJourneyDept } from './mesReportsApi';
import { dailyRowsForVisit } from './reportVisitDailyRows';
import { buildVisitOperationBarPoints } from '../components/reports/ReportCharts';
import { isDeptPerformanceEligible } from './reportDeptUtils';

/** Style Report only — console trace for department performance chart data. */
export function logStyleReportDailyKpisDebug(
  orderId: string,
  colorwayId: string | null,
  dailyRows: StyleDeptDailyRow[],
  flowDepts: StyleJourneyDept[] | undefined,
  dateFrom: string,
  dateTo: string,
): void {
  if (!import.meta.env.DEV) return;
  const label = `[StyleReport] daily KPIs — order ${orderId}, colorway ${colorwayId ?? 'all'}`;
  console.group(label);
  console.log(
    'Source: fetchStyleDailyKpis() → fetchStyleDailyKpisForColorway()',
    'tables: hourly_counts, inspection_sessions, cutting_sessions, cutting_bundles, workforce_logs, line_allocations, order_routing_steps, shifts',
  );
  console.log(`Raw rows from API: ${dailyRows.length}`, dailyRows);

  const byDept = new Map<string, StyleDeptDailyRow[]>();
  for (const row of dailyRows) {
    const list = byDept.get(row.deptId) ?? [];
    list.push(row);
    byDept.set(row.deptId, list);
  }

  console.log('By department (all operations, day-wise):');
  for (const [deptId, deptRows] of byDept) {
    const byOp = new Map<string, StyleDeptDailyRow[]>();
    for (const r of deptRows) {
      const opKey = r.operationId || '(no route)';
      const list = byOp.get(opKey) ?? [];
      list.push(r);
      byOp.set(opKey, list);
    }
    console.group(`Dept ${deptRows[0]?.deptName ?? deptId} (${deptId}) — ${deptRows.length} rows`);
    for (const [opId, opRows] of byOp) {
      const opName = opRows[0]?.operationName ?? opId;
      const daywise = opRows
        .filter((r) => r.date >= dateFrom && r.date <= dateTo)
        .map((r) => ({
          date: r.date,
          output: r.output,
          target: r.target,
          exitOp: r.isExitOperation ?? false,
          eff: r.efficiency,
          prod: r.productivity,
        }));
      console.log(`Operation ${opName} [${opId}]:`, daywise);
    }
    console.groupEnd();
  }

  if (flowDepts?.length) {
    const rowsByDept = byDept;
    console.log('Per visit card (dailyRowsForVisit → VisitOperationOutputChart):');
    for (const dept of flowDepts.filter(isDeptPerformanceEligible)) {
      const visitRows = dailyRowsForVisit(dept, flowDepts, rowsByDept);
      const inRange = visitRows.filter((r) => r.date >= dateFrom && r.date <= dateTo);
      const opBars = buildVisitOperationBarPoints(inRange);
      console.log(
        `${dept.deptName} visit ${dept.visitId.slice(0, 8)}…`,
        {
          routeIds: dept.routeIds?.length ?? 0,
          visitRows: visitRows.length,
          inDateRange: inRange.length,
          chartBars: opBars.map((p) => ({
            date: p.dateLabel,
            operation: p.operationName,
            output: p.output,
            target: p.target,
          })),
        },
      );
    }
  }

  console.log(
    'Per-card QC: fetchStyleDeptQualitySummary() → v_daily_quality',
    'Audit: fetchStyleDeptAuditMetrics() → v_audit_summary',
    'Resource filter: fetchStyleDeptResourceDailyRows() → hourly_counts + inspection_sessions scoped by resource_id',
  );
  console.groupEnd();
}
