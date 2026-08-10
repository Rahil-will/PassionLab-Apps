import type { StyleOrder } from '../types';
import { sizeAdjQty } from './colorwaySizesUtils';
import { activeShipmentDeliveryDates } from './orderShipmentPlan';
import type { VisitPipelineCell } from './orderRoutingFlow';

export type PipelineStatusFilter = '' | 'Completed' | 'Active' | 'Delayed';

export function orderMatchesPipelineStatusFilter(
  order: StyleOrder,
  filterStatus: PipelineStatusFilter,
  pipelineVisits: VisitPipelineCell[],
  visitCounts: Record<string, number>,
): boolean {
  if (!filterStatus) return true;

  const totalAdj = order.colorways.reduce(
    (acc, cw) => acc + cw.sizes.reduce((sAcc, s) => sAcc + sizeAdjQty(s), 0),
    0,
  );
  const terminalVisit = pipelineVisits[pipelineVisits.length - 1];
  const terminalProduced = terminalVisit ? (visitCounts[terminalVisit.visitId] ?? 0) : 0;
  const allDone = pipelineVisits.length > 0 && terminalProduced >= totalAdj;
  const anyActive = pipelineVisits.some((cell) => (visitCounts[cell.visitId] ?? 0) > 0);
  const activeDates = activeShipmentDeliveryDates(order.shipmentPlan);
  const earliestDate = activeDates[0];
  const daysLeft = earliestDate
    ? Math.floor((new Date(earliestDate).getTime() - Date.now()) / 86400000)
    : 1;
  const isOverdue = daysLeft < 0;

  if (filterStatus === 'Completed') return allDone;
  if (filterStatus === 'Active') return anyActive && !allDone;
  if (filterStatus === 'Delayed') return isOverdue && !allDone;
  return true;
}

export function filterOrdersByPipelineStatus(
  orders: StyleOrder[],
  filterStatus: PipelineStatusFilter,
  pipelineVisitsByOrderId: Map<string, VisitPipelineCell[]>,
  orderVisitCounts: Record<string, Record<string, number>>,
  searchQuery: string,
  filterBuyer: string,
): StyleOrder[] {
  const q = searchQuery.trim().toLowerCase();
  return orders.filter((o) => {
    const matchesSearch =
      !q
      || o.styleName.toLowerCase().includes(q)
      || o.poNumber.toLowerCase().includes(q)
      || (o.styleRef || '').toLowerCase().includes(q)
      || o.buyer.toLowerCase().includes(q);
    const matchesBuyer = !filterBuyer || o.buyer === filterBuyer;
    const visits = pipelineVisitsByOrderId.get(o.id) ?? [];
    const visitCounts = orderVisitCounts[o.id] ?? {};
    const matchesStatus = orderMatchesPipelineStatusFilter(
      o,
      filterStatus,
      visits,
      visitCounts,
    );
    return matchesSearch && matchesBuyer && matchesStatus;
  });
}
