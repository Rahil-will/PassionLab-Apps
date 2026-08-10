import type { AssignedResource, LineAllocation } from '../../../types';
import type { DepartmentEntity, ProcessFlowStep } from '../../../types/settings';
import { allocationsForColorway } from '../../../lib/allocationUtils';
import type { PlanningRow } from '../types';
import { calculateDailyAverage, calculateWorkingDays } from './planningCalculations';
import {
  buildPlanningVisitGroups,
  rowsForVisit,
  visitLoadingStep,
  visitPlanRouteStep,
} from '../../../lib/visitPlanning';

function colorAllocationsForPlanning(
  allocations: LineAllocation[],
  colorwayId: string,
  orderId?: string,
): LineAllocation[] {
  const byColor = allocationsForColorway(allocations, colorwayId).filter(
    (a) => !a.id?.startsWith('temp-'),
  );
  if (byColor.length > 0) return byColor;
  if (!orderId) return [];
  return allocations.filter(
    (a) => a.orderId === orderId && !a.colorwayId && !a.id?.startsWith('temp-'),
  );
}

function allocMatchesVisit(
  alloc: LineAllocation,
  visit: ReturnType<typeof buildPlanningVisitGroups>[number],
): boolean {
  if (alloc.visitId && visit.visitId && alloc.visitId === visit.visitId) return true;

  const planId = visit.planRouteStep.id;
  if (planId && alloc.operationId === planId) return true;

  const stepIds = new Set(visit.steps.map((s) => s.id).filter(Boolean));
  if (alloc.operationId && stepIds.has(alloc.operationId)) return true;

  if (visit.loadingStep?.id && alloc.loadingRouteId === visit.loadingStep.id) return true;

  return false;
}

function allocationToRow(
  a: LineAllocation,
  visit: ReturnType<typeof buildPlanningVisitGroups>[number],
  assignedResources: AssignedResource[],
): PlanningRow {
  const resource = assignedResources.find((r) => r.id === a.lineId);
  const planStep = visitPlanRouteStep(visit.steps);
  const loadingStep = visitLoadingStep(visit.steps);
  const workingDays =
    a.startDate && a.endDate
      ? Math.max(1, calculateWorkingDays(a.startDate, a.endDate))
      : 1;
  const qty = a.qty || 0;
  const autoDaily =
    qty > 0 && a.startDate && a.endDate ? calculateDailyAverage(qty, workingDays) : 0;
  const storedDaily = a.dailyTarget || 0;
  return {
    id: a.id,
    department: visit.label,
    visitId: a.visitId || visit.visitId,
    operationId: planStep?.id || a.operationId,
    loadingRouteId: a.loadingRouteId || loadingStep?.id,
    flowStep: planStep?.flow_step,
    resourceId: a.lineId,
    resourceName: resource?.resourceName || '',
    plannedQty: qty,
    startDate: a.startDate || '',
    endDate: a.endDate || '',
    dailyTarget: storedDaily > 0 ? storedDaily : autoDaily,
    dailyTargetOverridden:
      storedDaily > 0 && autoDaily > 0 && storedDaily !== autoDaily,
    workforce: a.kpiInputs?.workforce,
    workforceByShift: (a.kpiInputs as { workforceByShift?: Record<string, number> } | undefined)?.workforceByShift,
    planningShiftId: (a.kpiInputs as { planningShiftId?: string } | undefined)?.planningShiftId,
    sam: a.sam ?? a.kpiInputs?.sam,
  };
}

function legacyAllocationToRow(
  a: LineAllocation,
  flowSteps: ProcessFlowStep[],
  assignedResources: AssignedResource[],
  departments: DepartmentEntity[],
): PlanningRow {
  const resource = assignedResources.find((r) => r.id === a.lineId);
  const step = flowSteps.find((s) => s.id === a.operationId);
  const dept = step?.dept_id ? departments.find((d) => d.id === step.dept_id) : undefined;
  const visits = buildPlanningVisitGroups(flowSteps, new Map(departments.map((d) => [d.id, d])));
  const visit = visits.find((v) => allocMatchesVisit(a, v));
  const workingDays =
    a.startDate && a.endDate
      ? Math.max(1, calculateWorkingDays(a.startDate, a.endDate))
      : 1;
  const qty = a.qty || 0;
  const autoDaily =
    qty > 0 && a.startDate && a.endDate ? calculateDailyAverage(qty, workingDays) : 0;
  const storedDaily = a.dailyTarget || 0;
  return {
    id: a.id,
    department: visit?.label || step?.operation_name || step?.dept_name || resource?.departmentName || '',
    visitId: a.visitId || step?.visit_id || visit?.visitId,
    operationId: step?.id || a.operationId,
    loadingRouteId: a.loadingRouteId,
    flowStep: step?.flow_step,
    resourceId: a.lineId,
    resourceName: resource?.resourceName || '',
    plannedQty: qty,
    startDate: a.startDate || '',
    endDate: a.endDate || '',
    dailyTarget: storedDaily > 0 ? storedDaily : autoDaily,
    dailyTargetOverridden:
      storedDaily > 0 && autoDaily > 0 && storedDaily !== autoDaily,
    workforce: a.kpiInputs?.workforce,
    workforceByShift: (a.kpiInputs as { workforceByShift?: Record<string, number> } | undefined)?.workforceByShift,
    planningShiftId: (a.kpiInputs as { planningShiftId?: string } | undefined)?.planningShiftId,
    sam: a.sam ?? a.kpiInputs?.sam,
  };
}

export function allocationsToPlanningRows(
  colorwayId: string,
  allocations: LineAllocation[],
  assignedResources: AssignedResource[],
  flowSteps: ProcessFlowStep[] = [],
  departments: DepartmentEntity[] = [],
  orderId?: string,
): PlanningRow[] {
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const visits = buildPlanningVisitGroups(flowSteps, deptById);
  const colorAllocs = colorAllocationsForPlanning(allocations, colorwayId, orderId);

  const usedAllocIds = new Set<string>();
  const rows: PlanningRow[] = [];

  for (const visit of visits) {
    const matched = colorAllocs.filter(
      (a) => a.id && !usedAllocIds.has(a.id) && allocMatchesVisit(a, visit),
    );
    for (const a of matched) {
      if (a.id) usedAllocIds.add(a.id);
      rows.push(allocationToRow(a, visit, assignedResources));
    }
  }

  for (const a of colorAllocs) {
    if (a.id && usedAllocIds.has(a.id)) continue;
    rows.push(legacyAllocationToRow(a, flowSteps, assignedResources, departments));
  }

  return rows;
}

export { rowsForVisit };
