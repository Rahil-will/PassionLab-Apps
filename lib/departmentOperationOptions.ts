import type { OperationStepType } from './operationsDb';
import type { DepartmentEntity, DepartmentPlanningMode } from '../types/settings';
import { isStoragePlanningDepartment, resolvePlanningMode } from './departmentFilters';
import { OUTSOURCE_CAPTURE_APP, SHIPMENT_QA_CAPTURE_APP } from './floorApps';

export function isTerminalDepartment(role?: DepartmentEntity['role']): boolean {
  return role === 'terminal';
}

export function isOriginDepartment(role?: DepartmentEntity['role']): boolean {
  return role === 'origin';
}

export function isOutsourceDepartment(
  role?: DepartmentEntity['role'],
  planningMode?: DepartmentPlanningMode,
): boolean {
  return role === 'standard' && resolvePlanningMode({ role, planning_mode: planningMode }) === 'outsource';
}

/** Step types available when defining operations for this work center. */
export function stepTypesForDepartment(
  role?: DepartmentEntity['role'],
  planningMode?: DepartmentPlanningMode,
): OperationStepType[] {
  if (isOriginDepartment(role)) {
    return ['produce'];
  }
  if (isTerminalDepartment(role)) {
    return ['produce'];
  }
  if (isOutsourceDepartment(role, planningMode)) {
    return ['outsource'];
  }
  if (isStoragePlanningDepartment({ role, planning_mode: planningMode })) {
    return ['store'];
  }
  return ['loading', 'produce'];
}

export function stepTypeUsesCaptureApp(stepType: OperationStepType): boolean {
  return stepType === 'loading' || stepType === 'produce';
}

export function defaultCaptureAppForDepartment(
  role?: DepartmentEntity['role'],
  departmentApps: string[] = [],
  planningMode?: DepartmentPlanningMode,
): string {
  if (isOriginDepartment(role)) return 'cutting_lay';
  if (isTerminalDepartment(role)) return SHIPMENT_QA_CAPTURE_APP;
  if (isOutsourceDepartment(role, planningMode)) return OUTSOURCE_CAPTURE_APP;
  return '';
}

export function captureAppsForOperation(
  stepType: OperationStepType,
  departmentApps: string[],
  factoryAllowed: Record<OperationStepType, string[]>,
  role?: DepartmentEntity['role'],
): string[] {
  if (!stepTypeUsesCaptureApp(stepType)) return [];
  if (isOriginDepartment(role)) {
    return ['cutting_lay'];
  }
  if (isTerminalDepartment(role)) {
    return [SHIPMENT_QA_CAPTURE_APP];
  }
  return factoryAllowed[stepType] ?? [];
}

export function operationFieldsLocked(
  role?: DepartmentEntity['role'],
  planningMode?: DepartmentPlanningMode,
): {
  stepType: boolean;
  captureApp: boolean;
} {
  if (isOriginDepartment(role)) {
    return { stepType: true, captureApp: true };
  }
  if (isTerminalDepartment(role)) {
    return { stepType: true, captureApp: true };
  }
  if (isOutsourceDepartment(role, planningMode)) {
    return { stepType: true, captureApp: true };
  }
  if (isStoragePlanningDepartment({ role, planning_mode: planningMode })) {
    return { stepType: true, captureApp: true };
  }
  return { stepType: false, captureApp: false };
}
