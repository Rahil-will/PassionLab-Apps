import { RoutePath } from '../types';
import { findModuleRoute, moduleKeyForRoute } from '../core/modules/registry';

/** Desktop roles with full read/write access in this app. */
export const DESKTOP_ADMIN_ROLES = ['admin', 'superadmin'] as const;
export type DesktopAdminRole = (typeof DESKTOP_ADMIN_ROLES)[number];

export const DESKTOP_VIEWER_ROLE = 'viewer' as const;

/** Roles that may sign in to this Vite admin app. */
export const DESKTOP_APP_ROLES = [...DESKTOP_ADMIN_ROLES, DESKTOP_VIEWER_ROLE] as const;
export type DesktopAppRole = (typeof DESKTOP_APP_ROLES)[number];

/**
 * Routes allowed for admin / superadmin.
 * UX-only — RLS / RPCs remain the real security boundary.
 */
const ADMIN_ROUTES: ReadonlySet<string> = new Set([
  RoutePath.DASHBOARD,
  RoutePath.CREATE_ORDER,
  RoutePath.CREATE_ORDER_COLOR,
  RoutePath.STATUS_TRACKER,
  RoutePath.FLOOR_DAY,
  RoutePath.ORDER_COMPLETION,
  RoutePath.REPORTS,
  RoutePath.REPORTS_DAY,
  RoutePath.REPORTS_STYLE,
  RoutePath.REPORTS_DEPARTMENT,
  RoutePath.LINE_ASSIGNMENT,
  RoutePath.DEPT_SCHEDULE,
  RoutePath.TRANSACTION_REPORT,
  RoutePath.ADMIN,
  RoutePath.USER_MANAGEMENT,
  RoutePath.SETTINGS,
  RoutePath.WORK_CENTERS,
  RoutePath.WORK_CENTER_BUYERS,
  RoutePath.WORK_CENTER_DEPARTMENTS,
  RoutePath.WORK_CENTER_PROCESS_FLOWS,
  RoutePath.MATERIAL_MANAGEMENT,
  RoutePath.WORK_CENTER_MATERIAL,
  RoutePath.MATERIAL_MILL,
  RoutePath.MATERIAL_MILL_BATCHES,
  RoutePath.MATERIAL_MILL_BATCH_NEW,
  RoutePath.MATERIAL_MILL_BATCH_DETAIL,
  RoutePath.MATERIAL_MILL_QC,
  RoutePath.MATERIAL_MILL_STYLES,
  RoutePath.MATERIAL_MILL_HISTORY,
  RoutePath.MATERIAL_MILL_STOCK,
  RoutePath.MATERIAL_MILL_LINE,
  RoutePath.MATERIAL_MILL_ASSIGN,
  RoutePath.MATERIAL_MILL_DISPATCH,
  RoutePath.MATERIAL_MILL_CHALLAN,
  RoutePath.MATERIAL_MILL_UNALLOCATED,
  RoutePath.MATERIAL_MILL_UNALLOCATED_DISPATCH,
  RoutePath.MATERIAL_MILL_UNALLOCATED_ALLOCATE,
  RoutePath.MATERIAL_MILL_UNALLOCATED_LINE,
  RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE,
  RoutePath.MATERIAL_PROCESS,
  RoutePath.MATERIAL_PROCESS_DETAIL,
  RoutePath.MATERIAL_WAREHOUSE,
  RoutePath.MATERIAL_WAREHOUSE_EXPECTED,
  RoutePath.MATERIAL_WAREHOUSE_RECEIVE_UNALLOCATED,
  RoutePath.MATERIAL_WAREHOUSE_INTERNAL,
  RoutePath.MATERIAL_WAREHOUSE_EXTERNAL,
  RoutePath.MATERIAL_WAREHOUSE_ROLL,
  RoutePath.MATERIAL_WAREHOUSE_STYLE,
  RoutePath.MATERIAL_WAREHOUSE_STYLES,
  RoutePath.MATERIAL_WAREHOUSE_RACKS,
  RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE,
  RoutePath.MATERIAL_WAREHOUSE_STORE,
  RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL,
  RoutePath.MATERIAL_WAREHOUSE_DISPATCH,
  RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE,
  RoutePath.MATERIAL_WAREHOUSE_DISPATCH_SEND,
  RoutePath.MATERIAL_WAREHOUSE_TESTING,
  RoutePath.MATERIAL_WAREHOUSE_QC,
  RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL,
  RoutePath.MATERIAL_WAREHOUSE_STOCK,
  RoutePath.MATERIAL_WAREHOUSE_RETURNS,
  RoutePath.MATERIAL_WAREHOUSE_RETURNS_DETAIL,
  RoutePath.MATERIAL_WAREHOUSE_END_BITS,
  RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS,
  RoutePath.MM_HOME,
]);

/** Read-only routes for viewer accounts (no settings, users, or order creation). */
const VIEWER_ROUTES: ReadonlySet<string> = new Set([
  RoutePath.DASHBOARD,
  RoutePath.STATUS_TRACKER,
  RoutePath.FLOOR_DAY,
  RoutePath.ORDER_COMPLETION,
  RoutePath.REPORTS,
  RoutePath.REPORTS_DAY,
  RoutePath.REPORTS_STYLE,
  RoutePath.REPORTS_DEPARTMENT,
  RoutePath.LINE_ASSIGNMENT,
  RoutePath.DEPT_SCHEDULE,
  RoutePath.TRANSACTION_REPORT,
  RoutePath.MM_HOME,
]);

/** Prefix routes (hash params) that inherit admin access. */
const ADMIN_ROUTE_PREFIXES = [
  '#/style-details/',
  '#/style-color-details/',
  '#/planning-detail',
  '#/create-order',
  '#/material/',
  '#/mm/',
] as const;

const VIEWER_ROUTE_PREFIXES = [
  '#/style-details/',
  '#/style-color-details/',
  '#/planning-detail',
  '#/mm/',
] as const;

export interface RouteAccessContext {
  /** factory_modules.enabled by key */
  modulesEnabled?: Partial<Record<string, boolean>>;
  /** profiles.assigned_apps permission keys */
  assignedApps?: readonly string[];
}

export function isDesktopAdminRole(role: string | null | undefined): role is DesktopAdminRole {
  return role === 'admin' || role === 'superadmin';
}

export function isDesktopViewerRole(role: string | null | undefined): boolean {
  return role === DESKTOP_VIEWER_ROLE;
}

export function isDesktopAppRole(role: string | null | undefined): role is DesktopAppRole {
  return isDesktopAdminRole(role) || isDesktopViewerRole(role);
}

/** Mutation UIs (forms, editors, save buttons) — admin only. */
export function isDesktopWriteRole(role: string | null | undefined): boolean {
  return isDesktopAdminRole(role);
}

export function rolesForRoute(route: string): readonly string[] {
  if (VIEWER_ROUTES.has(route) || VIEWER_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix))) {
    return DESKTOP_APP_ROLES;
  }
  return DESKTOP_ADMIN_ROLES;
}

export function isKnownAppRoute(route: string): boolean {
  return (
    ADMIN_ROUTES.has(route)
    || VIEWER_ROUTES.has(route)
    || ADMIN_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix))
    || VIEWER_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix))
    || Boolean(findModuleRoute(route))
  );
}

function hasAssignedPermission(
  assignedApps: readonly string[] | undefined,
  permission: string | undefined,
): boolean {
  if (!permission) return true;
  if (!assignedApps || assignedApps.length === 0) return false;
  return assignedApps.includes(permission);
}

function passesModuleGates(route: string, ctx?: RouteAccessContext): boolean {
  const moduleHit = findModuleRoute(route);
  if (!moduleHit) return true;

  const key = moduleHit.manifest.key;
  if (moduleHit.manifest.entitlement) {
    const enabled = ctx?.modulesEnabled?.[key];
    if (!enabled) return false;
  }

  // Admin bypasses assigned_apps keys; everyone else needs the route permission.
  // DONE WHEN: assigned_apps=[] sees nothing under Material even when module is on
  // (non-admin). Admins see Material when module is toggled on.
  return true;
}

function passesPermissionGate(
  role: string | null | undefined,
  route: string,
  ctx?: RouteAccessContext,
): boolean {
  const moduleHit = findModuleRoute(route);
  if (!moduleHit) return true;
  if (isDesktopAdminRole(role)) return true;
  return hasAssignedPermission(ctx?.assignedApps, moduleHit.permission);
}

function passesLegacyRoleCheck(role: string | null | undefined, route: string): boolean {
  if (isDesktopAdminRole(role)) {
    if (ADMIN_ROUTES.has(route)) return true;
    return ADMIN_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix));
  }
  if (isDesktopViewerRole(role)) {
    if (VIEWER_ROUTES.has(route)) return true;
    return VIEWER_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix));
  }
  return false;
}

/**
 * Route access = existing role checks (untouched for legacy routes)
 * AND module entitlement (when route belongs to an entitled module)
 * AND (for module/mm_* routes) admin OR permission key in assigned_apps.
 *
 * desk_user role is NOT added in Phase 1 — flag back to product (profiles_user_role_check).
 */
export function canAccessRoute(
  role: string | null | undefined,
  route: string,
  ctx?: RouteAccessContext,
): boolean {
  if (!passesLegacyRoleCheck(role, route)) return false;
  if (!passesModuleGates(route, ctx)) return false;
  if (!passesPermissionGate(role, route, ctx)) return false;
  return true;
}

/** Shell gate: signed-in desktop roles may load the app shell. */
export function canAccessAppShell(role: string | null | undefined): boolean {
  return isDesktopAppRole(role);
}

export function isModuleRoute(route: string): boolean {
  return moduleKeyForRoute(route) !== null;
}
