import { allocationDepartmentId, allocationsForColorway } from './allocationUtils';
import type { PlanningVisitGroup } from './visitPlanning';
import type { LineAllocation, StyleOrder } from '../types';

export function allocationMatchesVisit(
  alloc: LineAllocation,
  visit: Pick<PlanningVisitGroup, 'visitId' | 'deptId' | 'planRouteStep' | 'loadingStep' | 'steps'>,
  order?: StyleOrder,
): boolean {
  if (visit.visitId && alloc.visitId && alloc.visitId === visit.visitId) return true;
  if (alloc.operationId && alloc.operationId === visit.planRouteStep.id) return true;
  const stepIds = new Set((visit.steps ?? []).map((s) => s.id).filter(Boolean));
  if (alloc.operationId && stepIds.has(alloc.operationId)) return true;
  if (visit.loadingStep?.id && alloc.loadingRouteId === visit.loadingStep.id) return true;
  if (visit.deptId && alloc.departmentId && alloc.departmentId === visit.deptId) return true;
  if (order && visit.deptId) {
    return allocationDepartmentId(alloc, [order]) === visit.deptId;
  }
  return false;
}

export function plannedQtyForColorwayVisit(
  allocations: LineAllocation[],
  colorwayId: string,
  visit: PlanningVisitGroup,
  order?: StyleOrder,
): number {
  return allocationsForColorway(allocations, colorwayId)
    .filter((a) => allocationMatchesVisit(a, visit, order))
    .reduce((sum, a) => sum + (a.qty || 0), 0);
}
