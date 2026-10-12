import type { DepartmentEntity, ProcessFlowStep } from '../types/settings';
import { resolvePlanningMode } from './departmentFilters';

/** How a routing operation appears in departmental planning. */
export type PlanningStepProfile = 'produce' | 'loading' | 'window' | 'terminal';

export function planningProfileForStep(
  step: Pick<ProcessFlowStep, 'step_type'>,
  dept?: Pick<DepartmentEntity, 'role' | 'planning_mode'>,
): PlanningStepProfile {
  if (dept?.role === 'terminal') return 'terminal';
  if (resolvePlanningMode(dept) === 'outsource') return 'window';
  switch (step.step_type) {
    case 'loading':
      return 'loading';
    case 'store':
    case 'outsource':
      return 'window';
    case 'produce':
    default:
      return 'produce';
  }
}

export function isTablePlanStep(profile: PlanningStepProfile): boolean {
  return profile !== 'terminal';
}

export function profileUsesKpis(profile: PlanningStepProfile): boolean {
  return profile === 'produce';
}

/** Summary modal + planning table: store/outsource (window) and loading omit WF, SAM, efficiency, productivity. */

export function profileUsesPlannedQty(profile: PlanningStepProfile): boolean {
  return profile === 'produce' || profile === 'loading' || profile === 'window';
}

export function profileHint(profile: PlanningStepProfile): string {
  switch (profile) {
    case 'produce':
      return 'Full KPI planning — qty, workforce, SAM, dates';
    case 'loading':
      return 'Line loading window — resource, qty, dates (pairs with produce on same line)';
    case 'window':
      return 'Hold or handoff window — resource and dates only';
    case 'terminal':
      return 'Shipment — shown on timeline only';
    default:
      return '';
  }
}
