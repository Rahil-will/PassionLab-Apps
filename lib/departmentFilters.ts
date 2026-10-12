import type { DepartmentEntity, DepartmentPlanningMode } from '../types/settings';
import { effectiveDepartmentSequence } from './departmentSequence';

/** Planning / schedule lists — excludes non-floor pseudo work centers (legacy name match). */
export const PSEUDO_DEPT_NAMES = new Set(['Shipment', 'Quality Audit']);

const STANDARD_PLANNING_MODES = new Set<DepartmentPlanningMode>([
  'production',
  'storage',
  'outsource',
]);

/** Effective planning_mode from DB (with legacy role fallbacks). */
export function resolvePlanningMode(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): DepartmentPlanningMode {
  const role = dept?.role || 'standard';
  const mode = dept?.planning_mode;
  if (mode === 'native_cutting' || mode === 'native_shipment') return mode;
  if (mode === 'storage' || mode === 'outsource') return mode;
  if (mode === 'production') return 'production';
  if (mode === 'none') return 'native_shipment';
  if (role === 'terminal') return 'native_shipment';
  if (role === 'origin') return 'native_cutting';
  return 'production';
}

/** Value persisted to departments.planning_mode on save. */
export function planningModeForDepartment(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): DepartmentPlanningMode {
  const role = dept?.role || 'standard';
  if (role === 'origin') return 'native_cutting';
  if (role === 'terminal') return 'native_shipment';
  const mode = resolvePlanningMode(dept);
  if (STANDARD_PLANNING_MODES.has(mode)) return mode;
  return 'production';
}

/** Day Report RPC family: origin / standard / terminal (outsource stays on its own capture path). */
export type DayReportRoleKind = 'origin' | 'standard' | 'terminal' | 'outsource';

export function dayReportRoleKind(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): DayReportRoleKind {
  const mode = resolvePlanningMode(dept);
  if (mode === 'outsource') return 'outsource';
  const role = dept?.role || 'standard';
  if (role === 'origin') return 'origin';
  if (role === 'terminal') return 'terminal';
  return 'standard';
}

export function effectivePlanningMode(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): DepartmentPlanningMode {
  return resolvePlanningMode(dept);
}

/** Full KPI + operations work centers. */
export function departmentOrderPlanningEligible(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  const mode = resolvePlanningMode(dept);
  return mode === 'production' || mode === 'native_cutting';
}

/** Appears in order planning table (production KPI, native cutting, or outsource window). */
export function departmentPlanningTableEligible(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  const mode = resolvePlanningMode(dept);
  return mode === 'production' || mode === 'outsource' || mode === 'native_cutting';
}

export function isStoragePlanningDepartment(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  return resolvePlanningMode(dept) === 'storage';
}

export function isOutsourcePlanningDepartment(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  return resolvePlanningMode(dept) === 'outsource';
}

/** Day Report audits — outsource window planning has no floor AQL (shipment desk still uses shipment_audits). */
export function departmentDayReportAuditsEligible(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  return !isOutsourcePlanningDepartment(dept);
}

/** Store and outsource — supervisor-only on the floor (no operators). */
export function isPassiveSupervisorOnlyDepartment(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  return isStoragePlanningDepartment(dept) || isOutsourcePlanningDepartment(dept);
}

export function isNativeCuttingDepartment(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  return resolvePlanningMode(dept) === 'native_cutting';
}

export function isNativeShipmentDepartment(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  return resolvePlanningMode(dept) === 'native_shipment';
}

/** Supervisors on all floor work centers except terminal (shipment/QA). */
export function departmentSupervisorEligible(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  if (!dept || isNativeShipmentDepartment(dept)) return false;
  const mode = resolvePlanningMode(dept);
  return mode === 'production' || mode === 'native_cutting' || mode === 'storage' || mode === 'outsource';
}

/** Operators may be assigned optional audit on production and native cutting work centers. */
export function departmentOperatorFloorExtrasEligible(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  const mode = resolvePlanningMode(dept);
  return mode === 'production' || mode === 'native_cutting';
}

/** Handover (transaction) is always included for operators on these work centers. */
export function departmentOperatorHandoverAlwaysOn(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  if (!dept || isNativeShipmentDepartment(dept)) return false;
  const mode = resolvePlanningMode(dept);
  return mode === 'production' || mode === 'native_cutting' || mode === 'storage';
}

export function departmentScheduleEligible(
  dept: Pick<DepartmentEntity, 'role' | 'productionPath' | 'planning_mode'> | undefined,
): boolean {
  if (!dept) return false;
  const mode = resolvePlanningMode(dept);
  if (mode === 'native_shipment' || mode === 'storage') return false;
  if (mode === 'outsource') return true;
  // Any active production or native cutting department should appear in the schedule,
  // regardless of whether its capture path has been derived yet.
  if (mode === 'production' || mode === 'native_cutting') return true;
  const path = dept.productionPath ?? 'none';
  return path === 'hourly' || path === 'batch' || path === 'native_cutting';
}

export function isProductionDepartment(
  dept: Pick<DepartmentEntity, 'name' | 'role' | 'productionPath' | 'planning_mode'>,
): boolean {
  return departmentScheduleEligible(dept);
}

export function filterProductionDepartments<
  T extends Pick<DepartmentEntity, 'name' | 'role' | 'productionPath' | 'planning_mode'>,
>(departments: T[]): T[] {
  return departments.filter((d) => isProductionDepartment(d));
}

/** Day report — production, native cutting, and outsource (floor output). */
export function filterDayReportDepartments<
  T extends Pick<DepartmentEntity, 'name' | 'role' | 'planning_mode'>,
>(departments: T[]): T[] {
  return departments.filter((d) => {
    if (PSEUDO_DEPT_NAMES.has(d.name) && d.role !== 'terminal') return false;
    const mode = resolvePlanningMode(d);
    return (
      mode === 'production'
      || mode === 'native_cutting'
      || mode === 'native_shipment'
      || mode === 'outsource'
    );
  });
}

export function departmentRoleLabel(role: DepartmentEntity['role'] = 'standard'): string {
  if (role === 'origin') return 'Origin';
  if (role === 'terminal') return 'Terminal';
  return 'Standard';
}

export function planningModeLabel(mode: DepartmentPlanningMode): string {
  if (mode === 'storage') return 'Store';
  if (mode === 'outsource') return 'Outsource';
  if (mode === 'native_cutting') return 'Native cutting';
  if (mode === 'native_shipment') return 'Native shipment';
  if (mode === 'none') return 'Native shipment';
  return 'Production';
}

/** Sidebar / list chips — hide generic production label. */
export function planningModeShowsInList(
  dept: Pick<DepartmentEntity, 'role' | 'planning_mode'> | undefined,
): boolean {
  const mode = resolvePlanningMode(dept);
  return mode !== 'production';
}

export function departmentRolePillClass(role: DepartmentEntity['role'] = 'standard'): string {
  if (role === 'origin') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (role === 'terminal') return 'bg-violet-50 text-violet-700 border-violet-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function planningModePillClass(mode: DepartmentPlanningMode): string {
  if (mode === 'storage') return 'bg-amber-50 text-amber-800 border-amber-100';
  if (mode === 'outsource') return 'bg-sky-50 text-sky-800 border-sky-100';
  if (mode === 'native_cutting') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (mode === 'native_shipment') return 'bg-violet-50 text-violet-700 border-violet-100';
  return 'bg-blue-50 text-blue-800 border-blue-100';
}

const ROLE_DISPLAY_ORDER: Record<NonNullable<DepartmentEntity['role']>, number> = {
  origin: 0,
  standard: 1,
  terminal: 2,
};

export function compareDepartmentsForDisplay(
  a: Pick<DepartmentEntity, 'role' | 'sequence' | 'name'>,
  b: Pick<DepartmentEntity, 'role' | 'sequence' | 'name'>,
): number {
  const roleA = a.role || 'standard';
  const roleB = b.role || 'standard';
  const roleCmp = ROLE_DISPLAY_ORDER[roleA] - ROLE_DISPLAY_ORDER[roleB];
  if (roleCmp !== 0) return roleCmp;

  const seqCmp = effectiveDepartmentSequence(a) - effectiveDepartmentSequence(b);
  if (seqCmp !== 0) return seqCmp;

  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export function sortDepartmentsForDisplay<T extends Pick<DepartmentEntity, 'role' | 'sequence' | 'name'>>(
  departments: T[],
): T[] {
  return [...departments].sort(compareDepartmentsForDisplay);
}
