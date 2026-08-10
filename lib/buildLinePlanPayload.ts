import type { AssignedResource, StyleOrder } from '../types';
import type { PlanningRow } from '../pages/planning/types';
import { calculateDailyAverage, calculateWorkingDays } from '../pages/planning/utils/planningCalculations';
import { referenceSewingSam } from './orderPriority';
import { hourlyTargetFromDaily } from './shiftHours';
import type { ColorwayPlanPayload, LinePlanAllocationPayload } from './saveLinePlan';
import { findRoutingStepForPlanningRow, type OrderRoutingStepLike } from './orderRoutingFlow';
import type { OrderRoutingStepRow } from './orderRoutingEditor';
import { parseCaptureApp } from './orderRoutingEditor';
import { profileUsesKpis } from './planningStepProfile';
import { visitPlanningProfile } from './visitPlanning';

function isUuid(value: string | undefined | null): boolean {
  if (!value) return false;
  return /^[0-9a-fA-F-]{36}$/.test(value.trim());
}

export interface ColorwayPlanningRows {
  colorId: string;
  colorName: string;
  rows: PlanningRow[];
}

export interface BuildLinePlanResult {
  colorwayPlans: ColorwayPlanPayload[];
  totalSaved: number;
  colorsSaved: number;
}

export function buildColorwayPlanPayloads(
  order: Pick<StyleOrder, 'styleName' | 'poNumber' | 'sewingSam' | 'sam' | 'routingSteps'>,
  colorRows: ColorwayPlanningRows[],
  assignedResources: AssignedResource[],
  regularShiftHours: number,
  regularShiftMinsPerDay: number,
  routingSteps?: OrderRoutingStepLike[],
): BuildLinePlanResult {
  const steps = routingSteps ?? order.routingSteps ?? [];
  const colorwayPlans: ColorwayPlanPayload[] = [];
  let totalSaved = 0;
  let colorsSaved = 0;
  const referenceSam = referenceSewingSam(order);

  for (const { colorId, colorName, rows } of colorRows) {
    const validRows = rows.filter(
      (r) => r.resourceId && r.startDate && r.endDate && r.plannedQty > 0,
    );

    const allocations: LinePlanAllocationPayload[] = [];

    for (const row of validRows) {
      const resource = assignedResources.find((r) => r.id === row.resourceId);
      const rowWorkforce = row.workforce || (resource as { avgWF?: number })?.avgWF || 1;
      const rowSam = row.sam ?? referenceSam;
      const workingDays =
        row.startDate && row.endDate
          ? Math.max(1, calculateWorkingDays(row.startDate, row.endDate))
          : 1;
      const dailyTarget = row.dailyTargetOverridden
        ? row.dailyTarget
        : calculateDailyAverage(row.plannedQty, workingDays);
      const hourlyTarget = hourlyTargetFromDaily(dailyTarget, regularShiftHours);
      const totalMins = rowWorkforce * regularShiftMinsPerDay * workingDays;
      const efficiency = totalMins > 0 ? ((row.plannedQty * rowSam) / totalMins) * 100 : 0;
      const productivity =
        rowWorkforce > 0 && workingDays > 0 ? row.plannedQty / (rowWorkforce * workingDays) : 0;

      const allocId = row.id?.startsWith('temp-') ? crypto.randomUUID() : (row.id || crypto.randomUUID());
      const routingStep = findRoutingStepForPlanningRow(steps, row);
      const routingRows = steps as OrderRoutingStepRow[];
      const visitSteps = row.visitId
        ? routingRows.filter((s) => s.visit_id === row.visitId)
        : routingStep
          ? [routingStep as OrderRoutingStepRow]
          : [];
      const visitStepLikes = visitSteps.map((s) => ({
        id: s.id,
        step_type: s.step_type,
        dept_id: s.dept_id || '',
        dept_name: s.dept_name,
        step_label: s.operation_name,
        flow_step: s.flow_step ?? s.seq,
        visit_id: s.visit_id || undefined,
        capture_app: parseCaptureApp(s.capture_app),
      }));
      const usesKpis = profileUsesKpis(visitPlanningProfile(visitStepLikes));
      const visitId = row.visitId || (routingStep as OrderRoutingStepRow)?.visit_id || null;
      if (!visitId) continue;

      const departmentId =
        (routingStep && isUuid(routingStep.dept_id) ? routingStep.dept_id : null) ||
        (resource?.departmentId && isUuid(resource.departmentId) ? resource.departmentId : null);
      const departmentName =
        routingStep?.dept_name ||
        resource?.departmentName ||
        null;

      allocations.push({
        id: allocId,
        line_id: row.resourceId,
        visit_id: visitId,
        department_id: departmentId,
        department_name: departmentName,
        start_date: row.startDate,
        end_date: row.endDate,
        qty: row.plannedQty,
        daily_target: usesKpis ? dailyTarget : 0,
        hourly_target: usesKpis ? hourlyTarget : null,
        sam: usesKpis ? rowSam : null,
        kpi_inputs: usesKpis
          ? {
              workforce: rowWorkforce,
              efficiency: Math.round(efficiency * 10) / 10,
              productivity: Math.round(productivity * 10) / 10,
            }
          : null,
        completed_is_true: false,
      });
      totalSaved++;
    }

    colorwayPlans.push({ colorway_id: colorId, allocations });
    colorsSaved++;
  }

  return { colorwayPlans, totalSaved, colorsSaved };
}
