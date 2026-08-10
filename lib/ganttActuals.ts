import type { ProductionSummaryRow, StyleOrder } from '../types';
import type { LineAllocation, LineAllocationActual } from '../types/production';
import type { GanttAlloc } from '../components/production/GanttResourceRows';
import type { CutToShipJourneyRow } from './mesReportsApi';
import {
  allocationColorwayName,
  allocationDepartmentId,
  allocationDepartmentName,
  allocationOperationName,
  allocationOperationNames,
  allocationPoNumber,
  allocationStyleName,
} from './allocationUtils';

function allocationActualsMap(
  lineAllocationActuals: LineAllocationActual[],
): Map<string, LineAllocationActual> {
  return new Map(lineAllocationActuals.map((row) => [row.line_allocation_id, row]));
}

function summaryMatchesAllocation(
  row: ProductionSummaryRow,
  alloc: LineAllocation,
  deptName: string,
  deptId: string,
): boolean {
  if (row.order_id !== alloc.orderId) return false;
  const cwId = alloc.colorwayId || '';
  if (cwId && row.colorway_id && row.colorway_id !== cwId) return false;

  // Prefer route-step / visit grain so multiple visits of the same department
  // don't share each other's actuals.
  if (alloc.operationId && row.operation_id) {
    return row.operation_id === alloc.operationId;
  }
  if (alloc.visitId && row.visit_id) {
    return row.visit_id === alloc.visitId;
  }

  if (deptId && row.department_id === deptId) return true;
  if (row.department === deptName) return true;
  return (
    Boolean(deptName)
    && row.department?.toLowerCase() === deptName.toLowerCase()
  );
}

function actualFromProductionSummary(
  alloc: LineAllocation,
  deptName: string,
  deptId: string,
  productionSummary: ProductionSummaryRow[],
): { qty: number; startDate?: string; endDate?: string } {
  if (!deptName && !deptId) return { qty: 0 };
  const rows = productionSummary.filter((r) =>
    summaryMatchesAllocation(r, alloc, deptName, deptId),
  );
  const qty = rows.reduce((sum, r) => sum + (r.total_passed || r.total_scanned || 0), 0);
  let startDate: string | undefined;
  let endDate: string | undefined;
  for (const r of rows) {
    if (r.first_output_date) {
      if (!startDate || r.first_output_date < startDate) startDate = r.first_output_date;
    }
    if (r.last_output_date) {
      if (!endDate || r.last_output_date > endDate) endDate = r.last_output_date;
    }
  }
  return { qty, startDate, endDate };
}

function actualFromLineAllocation(
  alloc: LineAllocation,
  byAllocId: Map<string, LineAllocationActual>,
): { qty: number; startDate?: string; endDate?: string } {
  const row = byAllocId.get(alloc.id);
  if (!row) return { qty: 0 };
  return {
    qty: row.qty,
    startDate: row.first_output_date,
    endDate: row.last_output_date,
  };
}

function journeyForAllocation(
  alloc: LineAllocation,
  deptName: string,
  deptId: string,
  orderDeptProgress: CutToShipJourneyRow[],
): CutToShipJourneyRow | undefined {
  const cwId = alloc.colorwayId || '';
  const candidates = orderDeptProgress.filter(
    (r) =>
      r.order_id === alloc.orderId
      && (cwId ? r.colorway_id === cwId : true),
  );
  if (alloc.visitId) {
    const byVisit = candidates.find((r) => r.visit_id === alloc.visitId);
    if (byVisit) return byVisit;
  }
  if (deptId) {
    const byDeptId = candidates.find((r) => r.dept_id === deptId);
    if (byDeptId) return byDeptId;
  }
  if (deptName) {
    const normalized = deptName.toLowerCase();
    return candidates.find((r) => r.dept_name?.toLowerCase() === normalized);
  }
  return undefined;
}

function actualFromJourney(journey: CutToShipJourneyRow | undefined): { qty: number } {
  if (!journey) return { qty: 0 };
  const produced = journey.qty_produced ?? 0;
  const sent = journey.qty_sent ?? 0;
  return { qty: Math.max(produced, sent) };
}

function statusFromActual(actualQty: number, plannedQty: number, prev?: string): string {
  if (actualQty <= 0) return prev || 'planned';
  if (plannedQty > 0 && actualQty >= plannedQty) return 'completed';
  return 'running';
}

function resolveDeptName(
  alloc: LineAllocation,
  orders: StyleOrder[],
  deptNameByLineId: Map<string, string>,
): string {
  const fromLine = deptNameByLineId.get(alloc.lineId);
  if (fromLine) return fromLine;
  return allocationDepartmentName(alloc, orders) || '';
}

/** Attach cumulative MES output as `actualQty` for gantt running rows. */
export function enrichAllocationsWithActuals<T extends LineAllocation>(
  allocations: T[],
  productionSummary: ProductionSummaryRow[],
  orders: StyleOrder[],
  deptNameByLineId: Map<string, string>,
  orderDeptProgress: CutToShipJourneyRow[] = [],
  lineAllocationActuals: LineAllocationActual[] = [],
): Array<T & GanttAlloc> {
  const byAllocId = allocationActualsMap(lineAllocationActuals);

  return allocations.map((alloc) => {
    const deptName = resolveDeptName(alloc, orders, deptNameByLineId);
    const deptId = alloc.departmentId || allocationDepartmentId(alloc, orders);
    const fromAlloc = actualFromLineAllocation(alloc, byAllocId);
    const fromSummary = actualFromProductionSummary(alloc, deptName, deptId, productionSummary);
    const journey = journeyForAllocation(alloc, deptName, deptId, orderDeptProgress);
    const fromJourney = actualFromJourney(journey);
    const qty = Math.max(fromAlloc.qty, fromSummary.qty, fromJourney.qty);
    return {
      ...alloc,
      actualQty: qty,
      actualStartDate: fromAlloc.startDate ?? fromSummary.startDate,
      actualEndDate: fromAlloc.endDate ?? fromSummary.endDate,
      status: statusFromActual(qty, alloc.qty || 0, alloc.status),
      styleName: allocationStyleName(alloc, orders),
      poNumber: allocationPoNumber(alloc, orders),
      colorway: allocationColorwayName(alloc, orders),
      operationName: allocationOperationName(alloc, orders),
      operationNames: allocationOperationNames(alloc, orders),
    };
  });
}

export function buildDeptNameByLineId(
  lines: Array<{ id: string; departmentName?: string; departmentId?: string }>,
  deptNameById?: Map<string, string>,
): Map<string, string> {
  return new Map(
    lines.map((l) => {
      const name =
        l.departmentName ||
        (l.departmentId && deptNameById?.get(l.departmentId)) ||
        '';
      return [l.id, name];
    }),
  );
}
