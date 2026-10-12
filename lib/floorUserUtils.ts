import {
  departmentFloorApps,
  entitledShipmentApps,
  FACTORY_FUNCTION_APPS,
  isShipmentQaCaptureApp,
  labelForCaptureApp,
  labelForDeptApp,
  sortAssignedApps,
  TERMINAL_DEPT_APPS,
  type DeptAppId,
} from './floorApps';
import {
  stripLegacyWorkforceApps,
  SUPERVISOR_APP_ID,
} from './workforceCategories';
import type { FactoryEntitlements } from './factoryEntitlements';
import {
  defaultShipmentFunctionApps,
  isFactoryFunctionEnabled,
  mergeTerminalDepartmentApps,
  sanitizeDepartmentApps,
} from './factoryEntitlements';
import type { OperationRow } from './operationsDb';
import type { DepartmentEntity } from '../types/settings';
import { departmentOperatorFloorExtrasEligible, departmentSupervisorEligible, isPassiveSupervisorOnlyDepartment, resolvePlanningMode } from './departmentFilters';

export const FLOOR_LOGIN_ROLES = ['operator', 'supervisor', 'auditor', 'quality_manager'] as const;
export type FloorLoginRole = (typeof FLOOR_LOGIN_ROLES)[number];

/** Per-user optional floor apps (work center may enable capability; user assignment grants access). */
export type FloorDeptFlag = 'transaction' | 'audit' | 'workforce';

export const FLOOR_DEPT_FLAGS: FloorDeptFlag[] = ['transaction', 'audit', 'workforce'];

export function labelForFloorDeptFlag(flag: FloorDeptFlag): string {
  if (flag === 'transaction') return 'Handover';
  if (flag === 'workforce') return 'Workforce';
  return labelForDeptApp('audit');
}

export const SHIPMENT_QA_LABEL = 'Shipment / QA';

/** Human-readable app role label for lists and filters. */
export function formatUserRoleLabel(role: string): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'viewer':
      return 'Viewer';
    case 'superadmin':
      return 'Superadmin';
    case 'supervisor':
      return 'Supervisor';
    case 'operator':
      return 'Operator';
    case 'auditor':
      return 'Auditor';
    case 'quality_manager':
      return SHIPMENT_QA_LABEL;
    default:
      return role
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

export function isFloorLoginRole(role: string): role is FloorLoginRole {
  return (FLOOR_LOGIN_ROLES as readonly string[]).includes(role);
}

export function isTerminalDepartment(
  dept: Pick<DepartmentEntity, 'role'> | null | undefined,
): boolean {
  return dept?.role === 'terminal';
}

export function dispatchOperationForDepartment(
  operations: OperationRow[],
  departmentId: string,
): OperationRow | undefined {
  return operations.find(
    (op) =>
      op.department_id === departmentId
      && op.is_active !== false
      && (isShipmentQaCaptureApp(op.capture_app) || op.name.trim().toLowerCase() === 'dispatch'),
  );
}

export function defaultTerminalAssignedOperationIds(
  operations: OperationRow[],
  departmentId: string,
): string[] {
  const dispatch = dispatchOperationForDepartment(operations, departmentId);
  return dispatch ? [dispatch.id] : [];
}

export function hasShipmentQaAssignment(
  operationIds: string[],
  operations: Pick<OperationRow, 'id' | 'capture_app'>[],
): boolean {
  return operationIds.some((id) => {
    const op = operations.find((o) => o.id === id);
    return op ? isShipmentQaCaptureApp(op.capture_app) : false;
  });
}

export function hasShipmentQaApps(assigned: DeptAppId[]): boolean {
  return assigned.some((a) => FACTORY_FUNCTION_APPS.includes(a) || TERMINAL_DEPT_APPS.includes(a));
}

export function userIsSupervisorOnly(
  assignedOperationIds: string[],
  assignedApps: DeptAppId[],
): boolean {
  return (
    assignedOperationIds.length === 0
    && assignedApps.includes(SUPERVISOR_APP_ID)
    && !hasShipmentQaApps(assignedApps)
  );
}

export function isSupervisorFloorUser(
  userRole?: string,
  assignedOperationIds?: string[],
  assignedApps?: DeptAppId[],
): boolean {
  if (userRole === 'supervisor' || userRole === 'quality_manager') return true;
  return userIsSupervisorOnly(assignedOperationIds ?? [], assignedApps ?? []);
}

export function clampTerminalShipmentApps(
  assigned: DeptAppId[],
  entitlements?: FactoryEntitlements,
): DeptAppId[] {
  const allowed = new Set(defaultShipmentFunctionApps(entitlements ?? {
    transaction: ['transaction'],
    production: [],
    workforce: ['supervisor'],
    audit: [],
    shipment: [...TERMINAL_DEPT_APPS],
  }));
  return assigned.filter((a) => allowed.has(a));
}

/** Normalize `profiles.assigned_operation_ids` from PostgREST. */
export function parseAssignedOperationIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
      }
    } catch {
      return [];
    }
  }
  return [];
}

/** Normalize `profiles.assigned_apps` from PostgREST (array or legacy string). */
export function parseAssignedApps(raw: unknown): DeptAppId[] {
  let apps: string[] = [];
  if (Array.isArray(raw)) {
    apps = raw.filter((x): x is string => typeof x === 'string');
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        apps = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      return [];
    }
  }
  return stripLegacyWorkforceApps(apps) as DeptAppId[];
}

export function floorDeptFlagsFromAssignedApps(assigned: DeptAppId[]): FloorDeptFlag[] {
  const flags: FloorDeptFlag[] = [];
  if (assigned.includes('transaction')) flags.push('transaction');
  if (assigned.includes('audit')) flags.push('audit');
  if (assigned.includes(SUPERVISOR_APP_ID)) flags.push('workforce');
  return flags;
}

/** Operator table/form extras — audit only (no handover/workforce on operators). */
export function operatorExtraFlagsFromAssignedApps(assigned: DeptAppId[]): FloorDeptFlag[] {
  return floorDeptFlagsFromAssignedApps(assigned).filter((f) => f === 'audit');
}

/** Optional floor apps an operator may be granted on this work center (audit only). */
export function operatorOptionalFloorExtrasForDepartment(
  _deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
  dept?: Pick<DepartmentEntity, 'role' | 'planning_mode'>,
): FloorDeptFlag[] {
  if (!dept) return [];
  const mode = resolvePlanningMode(dept);
  if (mode === 'native_shipment' || mode === 'outsource') return [];
  if (!departmentOperatorFloorExtrasEligible(dept)) return [];
  const auditEntitled = !entitlements || entitlements.audit.includes('audit');
  return auditEntitled ? (['audit'] as FloorDeptFlag[]) : [];
}

/** Floor apps assignable to supervisors (handover everywhere; workforce on production only). */
export function supervisorFloorExtrasForDepartment(
  dept?: Pick<DepartmentEntity, 'role' | 'planning_mode'>,
): FloorDeptFlag[] {
  if (!dept || !departmentSupervisorEligible(dept)) return [];
  const mode = resolvePlanningMode(dept);
  const flags: FloorDeptFlag[] = ['transaction'];
  if (mode === 'production') {
    flags.push('workforce');
  }
  return flags;
}

export function clampSupervisorFloorFlags(
  flags: FloorDeptFlag[],
  dept?: Pick<DepartmentEntity, 'role' | 'planning_mode'>,
): FloorDeptFlag[] {
  const allowed = new Set(supervisorFloorExtrasForDepartment(dept));
  return flags.filter((f) => allowed.has(f));
}

export function operationsSelectableForDepartment(
  operations: OperationRow[],
  departmentId: string,
  opts?: { includeAssignedIds?: string[]; activeOnly?: boolean },
): OperationRow[] {
  const assigned = new Set(opts?.includeAssignedIds ?? []);
  return operations.filter((op) => {
    if (op.department_id !== departmentId) return false;
    if (opts?.activeOnly) return op.is_active !== false;
    return op.is_active || assigned.has(op.id);
  });
}

export interface DeriveAssignedAppsInput {
  operationIds: string[];
  operations: OperationRow[];
  floorFlags?: FloorDeptFlag[];
  deptApps?: string[];
  entitlements?: FactoryEntitlements;
  workforceOnly?: boolean;
  supervisorOnly?: boolean;
  terminalShipmentApps?: DeptAppId[];
  deptRole?: DepartmentEntity['role'];
  dept?: Pick<DepartmentEntity, 'role' | 'planning_mode'>;
}

/** Derive floor capture apps from assignment context. */
export function deriveAssignedAppsForUser(input: DeriveAssignedAppsInput): DeptAppId[] {
  const {
    operationIds,
    operations,
    floorFlags = [],
    deptApps,
    entitlements,
    workforceOnly = false,
    supervisorOnly = false,
    terminalShipmentApps = [],
    deptRole,
    dept,
  } = input;

  const isSupervisorOnly = supervisorOnly || workforceOnly;

  if (deptRole === 'terminal' && operationIds.length === 0 && terminalShipmentApps.length > 0) {
    return sortAssignedApps(clampTerminalShipmentApps(terminalShipmentApps, entitlements));
  }

  if (isSupervisorOnly) {
    const deptRef: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined =
      dept ?? (deptRole ? { role: deptRole } : undefined);
    const defaults = supervisorFloorExtrasForDepartment(deptRef);
    const flags =
      floorFlags.length > 0
        ? clampSupervisorFloorFlags(floorFlags, deptRef)
        : defaults.length > 0
          ? defaults
          : (['transaction', 'workforce'] as FloorDeptFlag[]);
    const apps = new Set<DeptAppId>();
    if (flags.includes('transaction')) apps.add('transaction');
    if (flags.includes('workforce')) apps.add(SUPERVISOR_APP_ID);
    return sortAssignedApps([...apps]);
  }

  return deriveAssignedAppsFromOperations(
    operationIds,
    operations,
    floorFlags,
    deptApps,
    entitlements,
  );
}

/** Derive floor capture apps from assigned operations + optional dept flags. */
export function deriveAssignedAppsFromOperations(
  operationIds: string[],
  operations: OperationRow[],
  floorFlags: FloorDeptFlag[],
  deptApps?: string[],
  entitlements?: FactoryEntitlements,
): DeptAppId[] {
  const apps = new Set<DeptAppId>();

  for (const opId of operationIds) {
    const op = operations.find((o) => o.id === opId);
    if (!op?.capture_app) continue;
    const cap = op.capture_app as DeptAppId;
    if (isShipmentQaCaptureApp(cap)) {
      for (const app of entitledShipmentApps(entitlements)) apps.add(app);
      continue;
    }
    if (cap !== 'transaction') apps.add(cap);
  }

  for (const flag of floorFlags) {
    if (flag === 'transaction') {
      apps.add('transaction');
      continue;
    }
    if (flag === 'audit') {
      if (!entitlements || entitlements.audit.includes('audit')) {
        apps.add('audit');
      }
      continue;
    }
    if (flag === 'workforce') {
      apps.add(SUPERVISOR_APP_ID);
    }
  }

  const order = deptApps ? departmentFloorApps(deptApps, entitlements) : undefined;
  return sortAssignedApps([...apps], order);
}

export function formatAssignedOperationsLabel(
  operationIds: string[],
  operations: OperationRow[],
  floorFlags: FloorDeptFlag[] = [],
  opts?: { workforceOnly?: boolean; supervisorOnly?: boolean },
): string {
  if (opts?.supervisorOnly || opts?.workforceOnly) {
    const opLabels = operationIds.map((id) => {
      const op = operations.find((o) => o.id === id);
      return op?.name ?? 'Unknown operation';
    });
    if (opLabels.length === 0) return 'Supervisor';
    return `Supervisor (${opLabels.join(', ')})`;
  }
  const opLabels = operationIds.map((id) => {
    const op = operations.find((o) => o.id === id);
    if (!op) return 'Unknown operation';
    if (isShipmentQaCaptureApp(op.capture_app)) {
      return `${op.name} (${SHIPMENT_QA_LABEL})`;
    }
    const app = op.capture_app ? labelForCaptureApp(op.capture_app, op.step_type) : '';
    return app ? `${op.name} (${app})` : op.name;
  });
  const flagLabels = floorFlags.map(labelForFloorDeptFlag);
  return [...opLabels, ...flagLabels].join(', ');
}

export function defaultAssignedOperationIds(
  operations: OperationRow[],
  departmentId: string,
): string[] {
  return operations
    .filter((op) => op.department_id === departmentId && op.is_active)
    .map((op) => op.id);
}

export function clampAssignedOperationIds(
  operationIds: string[],
  operations: OperationRow[],
  departmentId: string,
  opts?: { activeOnly?: boolean },
): string[] {
  const allowed = new Set(
    operationsSelectableForDepartment(operations, departmentId, {
      includeAssignedIds: operationIds,
      activeOnly: opts?.activeOnly,
    }).map((o) => o.id),
  );
  return operationIds.filter((id) => allowed.has(id));
}

export function clampFloorDeptFlags(
  flags: FloorDeptFlag[],
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
  dept?: Pick<DepartmentEntity, 'role' | 'planning_mode'>,
): FloorDeptFlag[] {
  const allowed = new Set(operatorOptionalFloorExtrasForDepartment(deptApps, entitlements, dept));
  return flags.filter((f) => allowed.has(f));
}

export function clampAssignedAppsToDepartment(
  assigned: DeptAppId[],
  deptApps: string[] | undefined,
  entitlements?: FactoryEntitlements,
): DeptAppId[] {
  const order = departmentFloorApps(deptApps, entitlements);
  const allowed = new Set(order);
  return sortAssignedApps(assigned.filter((a) => allowed.has(a)), order);
}

/** Canonical `profiles.assigned_apps` payload — strips legacy keys and sorts. */
export function normalizeAssignedAppsForDb(
  assigned: DeptAppId[],
  opts?: { deptRole?: DepartmentEntity['role']; entitlements?: FactoryEntitlements },
): DeptAppId[] {
  const stripped = stripLegacyWorkforceApps(assigned).map((a) =>
    a === 'workforce' ? SUPERVISOR_APP_ID : a,
  ) as DeptAppId[];

  if (opts?.deptRole === 'terminal') {
    return sortAssignedApps(
      clampTerminalShipmentApps(stripped, opts.entitlements),
      [...TERMINAL_DEPT_APPS],
    );
  }

  const floor = stripped.filter(
    (a) => !TERMINAL_DEPT_APPS.includes(a) && !FACTORY_FUNCTION_APPS.includes(a),
  );
  const shipment = stripped.filter(
    (a) => TERMINAL_DEPT_APPS.includes(a) || FACTORY_FUNCTION_APPS.includes(a),
  );
  return sortAssignedApps([...floor, ...shipment]);
}

export function formatAssignedAppsLabel(assigned: DeptAppId[]): string {
  const shipment = assigned.filter((a) =>
    FACTORY_FUNCTION_APPS.includes(a) || TERMINAL_DEPT_APPS.includes(a),
  );
  const floor = sortAssignedApps(
    assigned.filter((a) => !FACTORY_FUNCTION_APPS.includes(a) && !TERMINAL_DEPT_APPS.includes(a)),
  );
  const parts = floor.map(labelForDeptApp);
  if (shipment.length > 0) parts.push(SHIPMENT_QA_LABEL);
  return parts.join(', ');
}

export function departmentAppsWithUserAssignments(
  deptApps: string[] | undefined,
  assigned: DeptAppId[],
  entitlements?: FactoryEntitlements,
  deptRole?: DepartmentEntity['role'],
): string[] {
  if (deptRole === 'terminal') {
    return mergeTerminalDepartmentApps(deptApps, entitlements ?? {
      transaction: ['transaction'],
      production: [],
      workforce: ['supervisor'],
      audit: [],
      shipment: [...TERMINAL_DEPT_APPS],
    });
  }

  const base = sanitizeDepartmentApps(deptApps, entitlements ?? {
    transaction: ['transaction'],
    production: [],
    workforce: ['supervisor'],
    audit: [],
    shipment: [],
  });
  const next = new Set(base);
  for (const app of assigned) {
    if (!FACTORY_FUNCTION_APPS.includes(app) && !TERMINAL_DEPT_APPS.includes(app)) {
      next.add(app);
    }
  }
  return sanitizeDepartmentApps([...next], entitlements ?? {
    transaction: ['transaction'],
    production: [],
    workforce: ['supervisor'],
    audit: [],
    shipment: [],
  });
}

export interface FloorTileAccess {
  productionOperationIds: string[];
  showHandover: boolean;
  showWorkforce: boolean;
  showAudit: boolean;
}

/** Handover is visit/dept-level — only surface on produce capture context, not loading. */
export function handoverAllowedForStep(
  handoverEnabled: boolean,
  stepType: string | null | undefined,
  isPrimaryOutput?: boolean | null,
): boolean {
  if (!handoverEnabled) return false;
  if (stepType === 'loading' || stepType === 'store') return false;
  return stepType === 'produce' || isPrimaryOutput === true;
}

/** Canonical floor home-screen access — prefer over parsing assigned_apps. */
export function resolveFloorTileAccess(input: {
  handoverEnabled?: boolean;
  workforceEnabled?: boolean;
  auditEnabled?: boolean;
  assignedOperationIds?: string[];
  handover_enabled?: boolean;
  workforce_enabled?: boolean;
  audit_enabled?: boolean;
  assigned_operation_ids?: unknown;
}): FloorTileAccess {
  return {
    productionOperationIds: parseAssignedOperationIds(
      input.assignedOperationIds ?? input.assigned_operation_ids,
    ),
    showHandover: input.handoverEnabled === true || input.handover_enabled === true,
    showWorkforce: input.workforceEnabled === true || input.workforce_enabled === true,
    showAudit: input.auditEnabled === true || input.audit_enabled === true,
  };
}

export function validateFloorUserPayload(input: {
  fullName: string;
  email: string;
  floorPin: string;
  departmentId: string | null | undefined;
  assignedOperationIds?: string[];
  floorDeptFlags?: FloorDeptFlag[];
  assignedApps?: DeptAppId[];
  deptApps?: string[] | undefined;
  dept?: Pick<DepartmentEntity, 'role' | 'planning_mode' | 'apps'>;
  deptRole?: DepartmentEntity['role'];
  userRole?: string;
  entitlements?: FactoryEntitlements;
  operations?: OperationRow[];
  workforceOnly?: boolean;
  supervisorOnly?: boolean;
  requirePin?: boolean;
}): string | null {
  if (!input.fullName.trim()) return 'Full name is required';
  if (!input.email.trim() || !input.email.includes('@')) return 'Valid email is required';
  if (input.requirePin !== false && input.floorPin.length !== 4) return 'PIN must be 4 digits';

  if (!input.departmentId) {
    return 'Select a work center — shipment users belong to the terminal work center';
  }

  const deptRole = input.deptRole;
  const deptRef = input.dept ?? (deptRole ? { role: deptRole, planning_mode: undefined } : undefined);
  const workforceOnly = input.workforceOnly ?? input.supervisorOnly ?? false;

  if (isPassiveSupervisorOnlyDepartment(deptRef) && !workforceOnly) {
    return 'Store and outsource work centers require a supervisor floor role';
  }

  const opIds = input.assignedOperationIds ?? [];

  if (deptRole === 'terminal') {
    if (!isFactoryFunctionEnabled(input.entitlements ?? {
      transaction: ['transaction'],
      production: [],
      workforce: ['supervisor'],
      audit: [],
      shipment: [],
    })) {
      return 'Shipment apps are not enabled for this factory';
    }
    if (opIds.length === 0) {
      return 'Assign the Dispatch operation for the terminal work center';
    }
    if (input.operations && !hasShipmentQaAssignment(opIds, input.operations)) {
      return 'Terminal users must be assigned the Dispatch operation';
    }
    return null;
  }

  if (workforceOnly) {
    if (opIds.length === 0) {
      return 'Select at least one operation — handover and workforce are scoped per visit';
    }
    if (!departmentSupervisorEligible(input.dept ?? { role: deptRole, planning_mode: undefined })) {
      return 'Supervisor assignment is not available on this work center';
    }
    if (input.operations) {
      const allowed = new Set(
        operationsSelectableForDepartment(input.operations, input.departmentId, {
          includeAssignedIds: opIds,
          activeOnly: true,
        }).map((o) => o.id),
      );
      if (!opIds.every((id) => allowed.has(id))) {
        return 'Assigned operations must belong to this work center';
      }
    }
    return null;
  }

  if (input.userRole === 'supervisor') {
    return 'Use the supervisor floor role and select supervision operations';
  }

  if (input.operations) {
    const allowed = new Set(
      operationsSelectableForDepartment(input.operations, input.departmentId, {
        includeAssignedIds: opIds,
        activeOnly: true,
      }).map((o) => o.id),
    );
    if (!opIds.every((id) => allowed.has(id))) {
      return 'Assigned operations must belong to this work center';
    }
  }

  if (opIds.length === 0) {
    return 'Select at least one production operation';
  }

  const flags = input.floorDeptFlags ?? [];
  const deptApps = input.deptApps ?? input.dept?.apps;
  const allowed = new Set(operatorOptionalFloorExtrasForDepartment(deptApps, input.entitlements, deptRef));
  if (!flags.every((f) => allowed.has(f))) {
    return 'One or more optional floor apps are not available for this work center type';
  }

  return null;
}
