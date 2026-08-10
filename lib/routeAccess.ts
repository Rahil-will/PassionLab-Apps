import { RoutePath } from '../types';

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
]);

/** Prefix routes (hash params) that inherit admin access. */
const ADMIN_ROUTE_PREFIXES = [
  '#/style-details/',
  '#/style-color-details/',
  '#/planning-detail',
  '#/create-order',
] as const;

const VIEWER_ROUTE_PREFIXES = [
  '#/style-details/',
  '#/style-color-details/',
  '#/planning-detail',
] as const;

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
  );
}

export function canAccessRoute(role: string | null | undefined, route: string): boolean {
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

/** Shell gate: signed-in desktop roles may load the app shell. */
export function canAccessAppShell(role: string | null | undefined): boolean {
  return isDesktopAppRole(role);
}
