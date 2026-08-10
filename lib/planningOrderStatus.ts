import { allocationsForColorway } from './allocationUtils';
import { sizeAdjQty } from './colorwaySizesUtils';
import { mapRoutingRowsToFlowSteps } from './orderRoutingEditor';
import { activeShipmentDeliveryDates } from './orderShipmentPlan';
import { buildPlanningVisitGroups } from './visitPlanning';
import type { DepartmentEntity, LineAllocation, OrderPriority, StyleOrder } from '../types';
import { plannedQtyForColorwayVisit } from './planningVisitAllocations';

export type PlanningRowStatus = 'Planning Pending' | 'Unplanned' | 'Partial' | 'Planned';

/** Unplanned and partial surface first; fully planned rows sink to the bottom. */
export const PLANNING_STATUS_RANK: Record<PlanningRowStatus, number> = {
  Unplanned: 0,
  Partial: 1,
  'Planning Pending': 2,
  Planned: 3,
};

export interface PlanningColorwayRow {
  id: string;
  orderId: string;
  styleName: string;
  priority: OrderPriority;
  styleRef: string;
  poNumber: string;
  buyer: string;
  deliveryDates: string[];
  colorway: string;
  routingSet: boolean;
  totalQty: number;
  plannedQty: number;
  hasAllocations: boolean;
  allocationCount: number;
  status: PlanningRowStatus;
}

export function deliverySortKey(dates: string[]): string {
  if (!dates.length) return '9999-12-31';
  return dates.slice().sort()[0].split('T')[0];
}

export function computeColorwayPlanningStatus(
  routingReady: boolean,
  isPlanned: boolean,
  plannedQty: number,
  totalReq: number,
  visitsToPlan: { visitId: string }[],
  allVisitsMet: boolean,
): PlanningRowStatus {
  if (!routingReady) {
    return isPlanned ? 'Partial' : 'Planning Pending';
  }
  if (!isPlanned) return 'Unplanned';
  if (visitsToPlan.length === 0) {
    return plannedQty >= totalReq ? 'Planned' : 'Partial';
  }
  return allVisitsMet ? 'Planned' : 'Partial';
}

export function buildPlanningColorwayRows(
  orders: StyleOrder[],
  allocations: LineAllocation[],
  departments: DepartmentEntity[],
): PlanningColorwayRow[] {
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const rows: PlanningColorwayRow[] = [];

  for (const order of orders) {
    const routingSteps = order.routingSteps ?? [];
    const routingReady = routingSteps.length > 0;
    const flowSteps = mapRoutingRowsToFlowSteps(routingSteps);
    const visits = buildPlanningVisitGroups(flowSteps, deptById).filter((v) => v.profile !== 'terminal');
    const visitsToPlan = visits.filter((v) => v.usesQty);
    const lastWorkableVisit = visits[visits.length - 1];

    for (const cw of order.colorways ?? []) {
      const totalReq = cw.sizes.reduce((acc, s) => acc + sizeAdjQty(s), 0);
      const colorAllocs = allocationsForColorway(allocations, cw.id);

      const visitPlannedQty =
        visitsToPlan.length > 0
          ? Math.min(
              ...visitsToPlan.map((visit) =>
                plannedQtyForColorwayVisit(allocations, cw.id, visit, order),
              ),
            )
          : lastWorkableVisit
            ? plannedQtyForColorwayVisit(allocations, cw.id, lastWorkableVisit, order)
            : 0;
      const colorwayPlannedTotal = colorAllocs.reduce((sum, a) => sum + (a.qty || 0), 0);
      const plannedQty =
        visitPlannedQty > 0
          ? visitPlannedQty
          : colorwayPlannedTotal > 0
            ? colorwayPlannedTotal
            : colorAllocs.reduce((max, a) => Math.max(max, a.qty || 0), 0);

      const isPlanned = plannedQty > 0 || colorAllocs.length > 0;
      const allVisitsMet =
        visitsToPlan.length > 0
        && visitsToPlan.every(
          (visit) => plannedQtyForColorwayVisit(allocations, cw.id, visit, order) >= totalReq,
        );

      const status = computeColorwayPlanningStatus(
        routingReady,
        isPlanned,
        plannedQty,
        totalReq,
        visitsToPlan,
        allVisitsMet,
      );

      rows.push({
        id: `${order.id}-${cw.id}`,
        orderId: order.id,
        styleName: order.styleName,
        priority: order.priority ?? 'normal',
        styleRef: order.styleRef ?? '',
        poNumber: order.poNumber,
        buyer: order.buyer,
        deliveryDates: activeShipmentDeliveryDates(order.shipmentPlan, cw.id),
        colorway: cw.name,
        routingSet: routingReady,
        totalQty: totalReq,
        plannedQty,
        hasAllocations: isPlanned,
        allocationCount: colorAllocs.length,
        status,
      });
    }
  }

  return rows;
}

export function sortPlanningRows(rows: PlanningColorwayRow[]): PlanningColorwayRow[] {
  return rows.slice().sort((a, b) => {
    const rankA = PLANNING_STATUS_RANK[a.status] ?? 9;
    const rankB = PLANNING_STATUS_RANK[b.status] ?? 9;
    if (rankA !== rankB) return rankA - rankB;
    return deliverySortKey(a.deliveryDates).localeCompare(deliverySortKey(b.deliveryDates));
  });
}

export function filterPlanningRows(
  rows: PlanningColorwayRow[],
  filterStatus: string,
): PlanningColorwayRow[] {
  if (!filterStatus) return rows;
  return rows.filter((row) => row.status === filterStatus);
}
