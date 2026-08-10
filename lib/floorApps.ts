/** Department app IDs stored in `departments.apps` (Settings → Department editor). */

import type { ProcessFlowStep } from '../types/settings';
import {
  DEFAULT_FACTORY_ENTITLEMENTS,
  type FactoryEntitlements,
  departmentEntitledApps,
  isFactoryFunctionEnabled,
} from './factoryEntitlements';
import type { OperationStepType } from './operationsDb';
import { stripLegacyWorkforceApps } from './workforceCategories';
import { productionAppsFromOperations } from './departmentAppsFromOperations';

export type DeptAppId =
  | 'transaction'
  | 'hourly'
  | 'qc_log'
  | 'batch'
  | 'audit'
  | 'supervisor'
  | 'cutting_lay'
  | 'cutting_bundle'
  | 'shipment_log'
  | 'final_rejection_log'
  | 'shipment_audit'
  /** @deprecated Maps to supervisor on read */
  | 'workforce'
  /** @deprecated Removed from department editor — stripped on read/write */
  | 'workforce_log'
  /** @deprecated Removed from department editor — stripped on read/write */
  | 'attendance';

/** Activity apps assignable per operation visit (excludes audit — department-native). */
export const SHIPMENT_QA_CAPTURE_APP = 'shipment_qa' as const;
export const OUTSOURCE_CAPTURE_APP = 'outsource' as const;

export type OperationCaptureAppId =
  | 'transaction'
  | 'hourly'
  | 'qc_log'
  | 'batch'
  | 'cutting_lay'
  | 'shipment_qa'
  | 'outsource';

export const OPERATION_CAPTURE_APP_IDS: OperationCaptureAppId[] = [
  'transaction',
  'hourly',
  'qc_log',
  'batch',
  'cutting_lay',
  'shipment_qa',
  'outsource',
];

/** Department-native apps (not tied to a single catalog operation). */
export type DeptNativeAppId = 'audit' | 'supervisor';

export const DEPT_NATIVE_APP_IDS: DeptNativeAppId[] = ['audit', 'supervisor'];

export type ActivityAppId = 'transaction' | 'hourly' | 'qc_log' | 'audit';

export const ACTIVITY_APP_IDS: ActivityAppId[] = ['transaction', 'hourly', 'qc_log', 'audit'];

/** Shipment apps for terminal work centers. */
export const TERMINAL_DEPT_APPS: DeptAppId[] = ['shipment_log', 'final_rejection_log', 'shipment_audit'];

export function isShipmentQaCaptureApp(id: string | null | undefined): boolean {
  return id === SHIPMENT_QA_CAPTURE_APP;
}

export function entitledShipmentApps(entitlements: FactoryEntitlements = DEFAULT_FACTORY_ENTITLEMENTS): DeptAppId[] {
  return entitlements.shipment.filter((id): id is DeptAppId =>
    TERMINAL_DEPT_APPS.includes(id as DeptAppId),
  );
}

/** Origin cutting native app — bundles are an outcome of lay capture, not a separate app. */
export const ORIGIN_CUTTING_DEPT_APPS: DeptAppId[] = ['cutting_lay'];

/** Assigned on user profile — not tied to a production department. */
export const FACTORY_FUNCTION_APPS: DeptAppId[] = ['shipment_log', 'final_rejection_log'];

export interface DeptAppOption {
  id: DeptAppId;
  label: string;
  description: string;
  group: 'core' | 'output' | 'optional' | 'factory' | 'origin';
}

export const DEPT_APP_OPTIONS: DeptAppOption[] = [
  { id: 'transaction', label: 'Transaction', description: 'Handover challans between departments', group: 'core' },
  { id: 'hourly', label: 'Hourly', description: 'Count capture — output on produce, input on loading', group: 'output' },
  { id: 'qc_log', label: 'QC Log', description: 'Piece-wise quality inspection', group: 'output' },
  { id: 'batch', label: 'Batch', description: 'Batch-wise production count on assigned operations', group: 'output' },
  { id: 'audit', label: 'Audit', description: 'Optional AQL batch audit', group: 'optional' },
  { id: 'supervisor', label: 'Supervisory app', description: 'Supervisors allocate workforce and review style performance', group: 'optional' },
  { id: 'cutting_lay', label: 'Lay report', description: 'Cutting lay report (origin work center)', group: 'origin' },
  { id: 'cutting_bundle', label: 'Bundle report', description: 'Cutting bundle report (origin work center)', group: 'origin' },
  { id: 'shipment_log', label: 'Shipment Log', description: 'Log shipped quantities (terminal work center)', group: 'factory' },
  { id: 'final_rejection_log', label: 'Rejection Log', description: 'Log rejections (factory function)', group: 'factory' },
  { id: 'shipment_audit', label: 'Buyer Audit', description: 'Pre-shipment buyer QA audit (factory function)', group: 'factory' },
];

const SKIP = new Set(['none', 'none_workforce']);
const FACTORY_SET = new Set<string>(FACTORY_FUNCTION_APPS);

export function appsEnabledForDepartment(
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
): DeptAppId[] {
  const raw = stripLegacyWorkforceApps(deptApps?.length ? deptApps : ['transaction']);
  const enabled = new Set<DeptAppId>();
  const entitled = entitlements ? departmentEntitledApps(entitlements) : null;
  for (const id of raw) {
    if (SKIP.has(id)) continue;
    if (!DEPT_APP_OPTIONS.some((o) => o.id === id)) continue;
    if (entitled && !entitled.has(id as DeptAppId) && id !== 'cutting_lay' && id !== 'cutting_bundle') continue;
    enabled.add(id as DeptAppId);
  }
  if (!enabled.has('transaction') && (!entitled || entitled.has('transaction'))) {
    enabled.add('transaction');
  }
  if (!entitled || entitled.has('audit')) {
    enabled.add('audit');
  }
  return DEPT_APP_OPTIONS.map((o) => o.id).filter((id) => enabled.has(id));
}

/** Floor apps for a department — no auto-merge of batch with hourly path. */
export function departmentFloorApps(
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
): DeptAppId[] {
  return appsEnabledForDepartment(deptApps, entitlements).filter((id) => !FACTORY_SET.has(id));
}

/** Activity apps enabled on a department (capability pool; includes audit). */
export function activityAppsForDepartment(
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
): ActivityAppId[] {
  const enabled = new Set(departmentFloorApps(deptApps, entitlements));
  return ACTIVITY_APP_IDS.filter((id) => enabled.has(id));
}

export function operationCaptureAppsForDepartment(
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
): OperationCaptureAppId[] {
  const enabled = new Set(departmentFloorApps(deptApps, entitlements));
  const out = OPERATION_CAPTURE_APP_IDS.filter((id) => {
    if (id === 'shipment_qa') return enabled.has('shipment_audit') || enabled.has('shipment_log');
    return enabled.has(id as DeptAppId);
  });
  if (enabled.has('cutting_lay') && !out.includes('cutting_lay')) {
    out.push('cutting_lay');
  }
  return out;
}

export function departmentHasAudit(
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
): boolean {
  if (!entitlements) return true;
  return departmentEntitledApps(entitlements).has('audit');
}

export function defaultCaptureAppForDepartment(
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
  role?: 'origin' | 'standard' | 'terminal',
): OperationCaptureAppId {
  if (role === 'origin') return 'cutting_lay';
  if (role === 'terminal') return SHIPMENT_QA_CAPTURE_APP;
  const enabled = new Set(departmentFloorApps(deptApps, entitlements));
  if (enabled.has('cutting_lay')) return 'cutting_lay';
  const activity = operationCaptureAppsForDepartment(deptApps, entitlements);
  if (activity.includes('hourly')) return 'hourly';
  if (activity.includes('qc_log')) return 'qc_log';
  if (activity.includes('batch')) return 'batch';
  return 'transaction';
}

/** Resolve capture_app when building or validating a process-flow / routing step. */
export function resolveRouteStepCaptureApp(
  captureApp: string | null | undefined,
  stepType: OperationStepType,
  dept?: { apps?: string[]; role?: 'origin' | 'standard' | 'terminal' },
  entitlements?: FactoryEntitlements,
): OperationCaptureAppId {
  if (stepType === 'store') {
    return 'transaction';
  }
  if (stepType === 'outsource') {
    return OUTSOURCE_CAPTURE_APP;
  }
  if (captureApp && captureApp !== 'transaction') {
    return captureApp as OperationCaptureAppId;
  }
  return defaultCaptureAppForDepartment(dept?.apps, entitlements, dept?.role);
}

export interface CatalogOpCaptureSource {
  step_type: OperationStepType;
  capture_app: string | null;
}

/** Prefer catalog operation fields over stale flow-step values. */
export function effectiveRouteStepFromCatalog(
  step: {
    step_type?: OperationStepType;
    capture_app?: string;
    step_label?: string;
    dept_id?: string;
    operation_def_id?: string;
  },
  catalogOp?: CatalogOpCaptureSource | null,
  dept?: { apps?: string[]; role?: 'origin' | 'standard' | 'terminal' },
  entitlements?: FactoryEntitlements,
): { stepType: OperationStepType; captureApp: OperationCaptureAppId } {
  const stepType = (catalogOp?.step_type ?? step.step_type ?? 'produce') as OperationStepType;
  const captureApp = resolveRouteStepCaptureApp(
    catalogOp?.capture_app ?? step.capture_app,
    stepType,
    dept,
    entitlements,
  );
  return { stepType, captureApp };
}

function captureAppsAllowedForStep(
  stepType: OperationStepType,
  deptApps: string[],
  entitlements: FactoryEntitlements,
  role?: 'origin' | 'standard' | 'terminal',
): string[] {
  if (!stepTypeUsesCaptureApp(stepType)) return [];
  if (role === 'origin') {
    return deptApps.includes('cutting_lay') ? ['cutting_lay'] : [];
  }
  if (role === 'terminal') {
    return [SHIPMENT_QA_CAPTURE_APP];
  }
  const factoryApps = factoryAllowedAppsFromEntitlements(entitlements)[stepType] ?? [];
  if (deptApps.length === 0) return factoryApps;
  return factoryApps.filter((a) => deptApps.includes(a));
}

function stepTypeUsesCaptureApp(stepType: OperationStepType): boolean {
  return stepType === 'loading' || stepType === 'produce';
}

export function factoryAllowedAppsFromEntitlements(
  entitlements: FactoryEntitlements = DEFAULT_FACTORY_ENTITLEMENTS,
): Record<OperationStepType, string[]> {
  const entitled = departmentEntitledApps(entitlements);
  const production = entitlements.production.filter((id) => entitled.has(id as DeptAppId));
  return {
    loading: ['hourly'].filter((id) => entitled.has(id as DeptAppId)),
    produce: [...production, 'cutting_lay', ...(entitlements.shipment.length > 0 ? [SHIPMENT_QA_CAPTURE_APP] : [])].filter(
      (id) => entitled.has(id as DeptAppId) || id === 'cutting_lay' || id === SHIPMENT_QA_CAPTURE_APP,
    ),
    store: [],
    outsource: [OUTSOURCE_CAPTURE_APP],
  };
}

function departmentAppsForCaptureCheck(
  dept?: {
    apps?: string[];
    productionApps?: string[];
    id?: string;
    role?: 'origin' | 'standard' | 'terminal';
    isNative?: boolean;
  },
  catalogOperations?: Array<{
    department_id: string;
    step_type: OperationStepType;
    capture_app: string | null;
    is_active?: boolean;
  }>,
): string[] {
  const fromColumns = [...new Set([...(dept?.productionApps ?? []), ...(dept?.apps ?? [])])];
  if (!dept?.id || !catalogOperations?.length) {
    return fromColumns;
  }
  const deptOps = catalogOperations
    .filter((o) => o.department_id === dept.id)
    .map((o) => ({ ...o, is_active: o.is_active ?? true }));
  const derived = productionAppsFromOperations(deptOps, dept.role, dept.isNative);
  const native = fromColumns.filter((id) =>
    id === 'transaction' || id === 'audit' || id === 'supervisor',
  );
  if (deptOps.length > 0) {
    return [...new Set([...derived, ...native])];
  }
  if (derived.length > 0) return [...new Set([...derived, ...native])];
  return fromColumns;
}

export function findCatalogOpForFlowStep<
  T extends { id: string; department_id: string; name: string },
>(
  step: { operation_def_id?: string; dept_id?: string; dept_name?: string; operation_name?: string; step_label?: string; step_type?: string },
  catalogOperations: T[],
  departments?: Array<{ id: string; name: string }>,
): T | undefined {
  if (step.operation_def_id) {
    return catalogOperations.find((o) => o.id === step.operation_def_id);
  }
  let deptId = step.dept_id;
  if (!deptId && step.dept_name && departments?.length) {
    const needle = step.dept_name.trim().toLowerCase();
    deptId = departments.find((d) => d.name.trim().toLowerCase() === needle)?.id;
  }
  const label = (step.operation_name || step.step_label || step.dept_name || '').trim().toLowerCase();
  if (!label || !deptId) return undefined;
  return catalogOperations.find(
    (o) => o.department_id === deptId && o.name.trim().toLowerCase() === label,
  );
}

function catalogOperationCaptureAllowed(
  catalogOp: CatalogOpCaptureSource,
  _entitlements: FactoryEntitlements,
): boolean {
  const cap = catalogOp.capture_app;
  if (!cap || cap === 'transaction') return true;
  const stepType = catalogOp.step_type;
  if (stepType === 'store' || stepType === 'outsource') return true;
  if (!stepTypeUsesCaptureApp(stepType)) return true;
  if (stepType === 'produce') {
    return OPERATION_CAPTURE_APP_IDS.includes(cap as OperationCaptureAppId);
  }
  if (stepType === 'loading') {
    return cap === 'hourly';
  }
  return false;
}

export function captureAppValidForRouteStep(
  step: Pick<ProcessFlowStep, 'capture_app' | 'step_type'>,
  dept?: {
    apps?: string[];
    productionApps?: string[];
    role?: 'origin' | 'standard' | 'terminal';
    id?: string;
    isNative?: boolean;
  },
  entitlements?: FactoryEntitlements,
  catalogOp?: CatalogOpCaptureSource | null,
  catalogOperations?: Array<{
    department_id: string;
    step_type: OperationStepType;
    capture_app: string | null;
    is_active?: boolean;
  }>,
): boolean {
  const stepType = (catalogOp?.step_type ?? step.step_type ?? 'produce') as OperationStepType;
  if (stepType === 'store' || stepType === 'outsource') {
    return true;
  }
  // If a catalog operation is found, its capture_app is authoritative —
  // the operation existing in the department's catalog is itself the validation.
  if (catalogOp) {
    if (catalogOp.capture_app && catalogOp.capture_app !== 'transaction') {
      return catalogOperationCaptureAllowed(catalogOp, entitlements ?? DEFAULT_FACTORY_ENTITLEMENTS);
    }
    // null / 'transaction' capture_app on a catalog op is always valid
    return true;
  }
  if ((step.capture_app as string) === 'audit') {
    return departmentHasAudit(dept?.apps, entitlements);
  }
  const captureApp = resolveRouteStepCaptureApp(
    step.capture_app,
    stepType,
    dept,
    entitlements,
  );
  const deptApps = departmentAppsForCaptureCheck(dept, catalogOperations);
  const allowed = captureAppsAllowedForStep(
    stepType,
    deptApps,
    entitlements ?? DEFAULT_FACTORY_ENTITLEMENTS,
    dept?.role,
  );
  if (allowed.includes(captureApp)) return true;
  return false;
}

export function explainCaptureAppValidationFailure(
  step: Pick<ProcessFlowStep, 'capture_app' | 'step_type' | 'operation_name' | 'dept_name'>,
  dept?: {
    apps?: string[];
    productionApps?: string[];
    role?: 'origin' | 'standard' | 'terminal';
    name?: string;
    id?: string;
    isNative?: boolean;
  },
  entitlements?: FactoryEntitlements,
  catalogOp?: CatalogOpCaptureSource | null,
  catalogOperations?: Array<{
    department_id: string;
    step_type: OperationStepType;
    capture_app: string | null;
    is_active?: boolean;
  }>,
): string {
  const stepType = (catalogOp?.step_type ?? step.step_type ?? 'produce') as OperationStepType;
  const captureApp = resolveRouteStepCaptureApp(
    catalogOp?.capture_app ?? step.capture_app,
    stepType,
    dept,
    entitlements,
  );
  const deptName = step.dept_name || dept?.name || 'work center';
  const deptApps = departmentAppsForCaptureCheck(dept, catalogOperations);
  const enabled = captureAppsAllowedForStep(
    stepType,
    deptApps,
    entitlements ?? DEFAULT_FACTORY_ENTITLEMENTS,
    dept?.role,
  );
  if (stepType === 'store' || stepType === 'outsource') {
    return `Operation "${step.operation_name || step.dept_name}" could not be validated for ${deptName}.`;
  }
  if (catalogOp?.capture_app && catalogOp.capture_app !== 'transaction') {
    if (!catalogOperationCaptureAllowed(catalogOp, entitlements ?? DEFAULT_FACTORY_ENTITLEMENTS)) {
      return `Operation "${step.operation_name || step.dept_name}" uses ${labelForCaptureApp(captureApp, stepType)} — that capture mode is not valid for step type ${stepType}.`;
    }
  }
  if (!enabled.length) {
    if (catalogOp?.capture_app) {
      return `Operation "${step.operation_name || step.dept_name}" uses ${labelForCaptureApp(captureApp, stepType)} — add an operation with that capture app in the ${deptName} catalog.`;
    }
    return `Operation "${step.operation_name || step.dept_name}" uses ${labelForCaptureApp(captureApp, stepType)} but ${deptName} has no matching capture in its operations catalog — add an operation with that capture app.`;
  }
  return `Operation "${step.operation_name || step.dept_name}" uses ${labelForCaptureApp(captureApp, stepType)} but ${deptName} only has ${enabled.map((a) => labelForCaptureApp(a, stepType)).join(', ')} in its catalog. Match the operation capture app to the work center operations.`;
}

export function findDepartmentForFlowStep<
  T extends { id: string; name: string },
>(step: Pick<ProcessFlowStep, 'dept_id' | 'dept_name'>, departments: T[]): T | undefined {
  if (step.dept_id) {
    return departments.find((d) => d.id === step.dept_id);
  }
  const needle = (step.dept_name || '').trim().toLowerCase();
  if (!needle) return undefined;
  return departments.find((d) => d.name.trim().toLowerCase() === needle);
}

export function defaultAssignedApps(
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
): DeptAppId[] {
  return departmentFloorApps(deptApps, entitlements);
}

const CANONICAL_APP_ORDER = DEPT_APP_OPTIONS.map((o) => o.id);

/** Preserve department / catalog order when persisting `profiles.assigned_apps`. */
export function sortAssignedApps(
  assigned: DeptAppId[],
  referenceOrder: readonly DeptAppId[] = CANONICAL_APP_ORDER,
): DeptAppId[] {
  const rank = new Map(referenceOrder.map((id, i) => [id, i]));
  return [...assigned].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
}

export function deptAppOptionsForFactory(entitlements: FactoryEntitlements): DeptAppOption[] {
  const entitled = departmentEntitledApps(entitlements);
  return DEPT_APP_OPTIONS.filter((o) => {
    if (FACTORY_SET.has(o.id)) return isFactoryFunctionEnabled(entitlements);
    if (o.group === 'origin') return true;
    return entitled.has(o.id);
  });
}

/** Department editor only — excludes shipment/rejection (factory functions). */
export function departmentEditorAppOptions(entitlements: FactoryEntitlements): DeptAppOption[] {
  return deptAppOptionsForFactory(entitlements).filter((o) => o.group !== 'factory');
}

export function labelForDeptApp(id: string): string {
  if (id === 'workforce') return 'Supervisory app';
  return DEPT_APP_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

/** Capture-app label in operation catalog / routing (hourly reads as input on loading steps). */
export function labelForCaptureApp(
  id: string,
  stepType?: 'loading' | 'produce' | 'store' | 'outsource',
): string {
  if (id === 'hourly' && stepType === 'loading') return 'Hourly (input)';
  if (id === 'hourly') return 'Hourly';
  if (id === 'cutting_lay') return 'Lay report';
  if (id === SHIPMENT_QA_CAPTURE_APP) return 'Shipment / QA';
  if (id === OUTSOURCE_CAPTURE_APP) return 'Outsource';
  return labelForDeptApp(id);
}

export function canCaptureOnDesktop(role: string | undefined): boolean {
  return role === 'admin' || role === 'superadmin' || role === 'quality_manager';
}
