import type { OperationRow } from './operationsDb';
import type { DepartmentEntity, DepartmentPlanningMode } from '../types/settings';
import { resolvePlanningMode } from './departmentFilters';
import { OUTSOURCE_CAPTURE_APP } from './floorApps';

export const STORE_REFERENCE_OPERATION_NAME = 'Store';
export const OUTSOURCE_REFERENCE_OPERATION_NAME = 'Outsource';

export function isStorageDepartment(
  role?: DepartmentEntity['role'],
  planningMode?: DepartmentPlanningMode,
): boolean {
  return role === 'standard' && resolvePlanningMode({ role, planning_mode: planningMode }) === 'storage';
}

export function isPassiveReferenceDepartment(
  role?: DepartmentEntity['role'],
  planningMode?: DepartmentPlanningMode,
): boolean {
  const mode = resolvePlanningMode({ role, planning_mode: planningMode });
  return mode === 'storage' || mode === 'outsource';
}

export function referenceStepTypeForPlanningMode(
  planningMode: DepartmentPlanningMode | undefined,
): 'store' | 'outsource' | null {
  if (planningMode === 'storage') return 'store';
  if (planningMode === 'outsource') return 'outsource';
  return null;
}

export function defaultReferenceOperationName(stepType: 'store' | 'outsource'): string {
  return stepType === 'store' ? STORE_REFERENCE_OPERATION_NAME : OUTSOURCE_REFERENCE_OPERATION_NAME;
}

export function buildReferenceOperationDraft(
  factoryId: string,
  departmentId: string,
  stepType: 'store' | 'outsource',
  name = defaultReferenceOperationName(stepType),
): OperationRow {
  return {
    id: `temp_op_${crypto.randomUUID()}`,
    factory_id: factoryId,
    department_id: departmentId,
    name,
    step_type: stepType,
    capture_app: stepType === 'outsource' ? OUTSOURCE_CAPTURE_APP : null,
    is_active: true,
  };
}

export function referenceOperationForDepartment(
  operations: OperationRow[],
  departmentId: string,
  stepType: 'store' | 'outsource',
): OperationRow | undefined {
  const defaultName = defaultReferenceOperationName(stepType).toLowerCase();
  return operations.find(
    (op) =>
      op.department_id === departmentId
      && op.is_active !== false
      && (op.step_type === stepType || op.name.trim().toLowerCase() === defaultName),
  );
}

export function storeOperationForDepartment(
  operations: OperationRow[],
  departmentId: string,
): OperationRow | undefined {
  return referenceOperationForDepartment(operations, departmentId, 'store');
}

export function outsourceReferenceOperationForDepartment(
  operations: OperationRow[],
  departmentId: string,
): OperationRow | undefined {
  return referenceOperationForDepartment(operations, departmentId, 'outsource');
}
