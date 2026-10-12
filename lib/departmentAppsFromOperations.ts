import type { OperationRow } from './operationsDb';
import {
  ORIGIN_CUTTING_APPS,
  productionPathFromApps,
  supervisorAppliesToPath,
  type DepartmentProductionPath,
} from './departmentProductionPath';
import type { DepartmentAppColumns } from './departmentAppColumns';
import { departmentSupervisorEligible } from './departmentFilters';
import type { DepartmentEntity } from '../types/settings';

const CAPTURE_FROM_OPS = new Set(['hourly', 'qc_log', 'batch', 'cutting_lay', 'shipment_qa', 'outsource']);

export function productionAppsFromOperations(
  operations: Pick<OperationRow, 'step_type' | 'capture_app' | 'is_active'>[],
  role?: string,
  isNative?: boolean,
): string[] {
  if (role === 'terminal') {
    const hasDispatch = operations.some(
      (op) => op.is_active !== false && op.capture_app === 'shipment_qa',
    );
    return hasDispatch ? ['shipment_qa'] : [];
  }
  const hasOutsource = operations.some(
    (op) => op.is_active !== false && op.step_type === 'outsource' && op.capture_app === 'outsource',
  );
  if (hasOutsource) return ['outsource'];
  if (role === 'origin' && isNative) return [...ORIGIN_CUTTING_APPS];
  const apps = new Set<string>();
  for (const op of operations) {
    if (op.is_active === false) continue;
    if (op.step_type !== 'loading' && op.step_type !== 'produce') continue;
    const cap = op.capture_app;
    if (cap && CAPTURE_FROM_OPS.has(cap)) apps.add(cap);
  }
  return [...apps];
}

/** Store / outsource — transaction + supervisor (handover); outsource also exposes vendor capture. */
export function derivePassiveDepartmentAppColumns(opts: {
  transactionEnabled?: boolean;
  planning_mode?: string;
  operations?: Pick<OperationRow, 'step_type' | 'capture_app' | 'is_active'>[];
}): DepartmentAppColumns & { productionPath: DepartmentProductionPath } {
  const productionApps =
    opts.planning_mode === 'outsource'
    && opts.operations?.some(
      (op) => op.is_active !== false && op.step_type === 'outsource' && op.capture_app === 'outsource',
    )
      ? ['outsource']
      : [];
  return {
    productionApps,
    productionPath: 'none',
    transactionEnabled: opts.transactionEnabled !== false,
    auditEnabled: true,
    supervisorEnabled: true,
  };
}

export function deriveDepartmentAppColumnsForSave(
  operations: Pick<OperationRow, 'step_type' | 'capture_app' | 'is_active'>[],
  opts: {
    role?: string;
    isNative?: boolean;
    planning_mode?: string;
    transactionEnabled?: boolean;
  },
): DepartmentAppColumns & { productionPath: DepartmentProductionPath } {
  if (
    opts.role === 'standard'
    && (opts.planning_mode === 'storage' || opts.planning_mode === 'outsource')
  ) {
    return derivePassiveDepartmentAppColumns({ ...opts, operations });
  }
  return deriveDepartmentAppColumnsFromOperations(operations, opts);
}

export function deriveDepartmentAppColumnsFromOperations(
  operations: Pick<OperationRow, 'step_type' | 'capture_app' | 'is_active'>[],
  opts: {
    role?: string;
    isNative?: boolean;
    planning_mode?: string;
    transactionEnabled?: boolean;
  },
): DepartmentAppColumns & { productionPath: DepartmentProductionPath } {
  const productionApps = productionAppsFromOperations(
    operations,
    opts.role,
    opts.isNative,
  );
  const productionPath = productionPathFromApps(productionApps, opts.role, opts.isNative);
  const deptRef: Pick<DepartmentEntity, 'role' | 'planning_mode'> = {
    role: (opts.role as DepartmentEntity['role']) || 'standard',
    planning_mode: opts.planning_mode as DepartmentEntity['planning_mode'],
  };
  const supervisorEligible = departmentSupervisorEligible(deptRef);
  return {
    productionApps,
    productionPath,
    transactionEnabled: opts.transactionEnabled !== false,
    auditEnabled: true,
    supervisorEnabled: supervisorEligible && supervisorAppliesToPath(productionPath),
  };
}
