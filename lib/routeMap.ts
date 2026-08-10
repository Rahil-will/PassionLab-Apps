import { RoutePath } from '../types';

export interface RouteMapEntry {
  path: string;
  displayName: string;
  parent: string | null;
  section: 'Main' | 'Production' | 'Manufacturing' | 'Reports' | 'System';
  subtitle?: string;
  isParameterized?: boolean;
}

export const ROUTE_MAP: Record<string, RouteMapEntry> = {
  [RoutePath.DASHBOARD]: {
    path: RoutePath.DASHBOARD,
    displayName: 'Dashboard',
    parent: null,
    section: 'Main',
    subtitle: 'PRODIGI home',
  },
  [RoutePath.CREATE_ORDER]: {
    path: RoutePath.CREATE_ORDER,
    displayName: 'Create Order',
    parent: RoutePath.DASHBOARD,
    section: 'Main',
    subtitle: 'Create a new production order',
  },
  [RoutePath.STATUS_TRACKER]: {
    path: RoutePath.STATUS_TRACKER,
    displayName: 'Status Tracker',
    parent: RoutePath.DASHBOARD,
    section: 'Production',
    subtitle: 'Real-time order progress & pipeline',
  },
  [RoutePath.FLOOR_DAY]: {
    path: RoutePath.FLOOR_DAY,
    displayName: 'Floor Day Board',
    parent: RoutePath.DASHBOARD,
    section: 'Production',
    subtitle: 'Received, produced, and sent by department for one day',
  },
  [RoutePath.STYLE_DETAILS]: {
    path: RoutePath.STYLE_DETAILS,
    displayName: 'Order Details',
    parent: RoutePath.STATUS_TRACKER,
    section: 'Main',
    subtitle: 'Order production overview',
    isParameterized: true,
  },
  [RoutePath.STYLE_COLOR_DETAILS]: {
    path: RoutePath.STYLE_COLOR_DETAILS,
    displayName: 'Order Colorway Details',
    parent: RoutePath.STYLE_DETAILS,
    section: 'Main',
    subtitle: 'Colorway production details',
    isParameterized: true,
  },
  [RoutePath.REPORTS]: {
    path: RoutePath.REPORTS,
    displayName: 'Reports',
    parent: RoutePath.DASHBOARD,
    section: 'Reports',
    subtitle: 'Production performance analytics',
  },
  [RoutePath.REPORTS_DAY]: {
    path: RoutePath.REPORTS_DAY,
    displayName: 'Day Report',
    parent: RoutePath.REPORTS,
    section: 'Reports',
    subtitle: 'All departments · hourly output by resource and style',
  },
  [RoutePath.REPORTS_STYLE]: {
    path: RoutePath.REPORTS_STYLE,
    displayName: 'Style Report',
    parent: RoutePath.REPORTS,
    section: 'Reports',
    subtitle: 'Full production lifecycle for a style and colorway',
  },
  [RoutePath.ORDER_COMPLETION]: {
    path: RoutePath.ORDER_COMPLETION,
    displayName: 'Order Completion',
    parent: RoutePath.DASHBOARD,
    section: 'Production',
    subtitle: 'Size balance, rejections, and shipment logging by colorway',
  },
  [RoutePath.LINE_ASSIGNMENT]: {
    path: RoutePath.LINE_ASSIGNMENT,
    displayName: 'Planning Board',
    parent: RoutePath.DASHBOARD,
    section: 'Manufacturing',
    subtitle: 'Production planning',
  },
  [RoutePath.PLANNING_DETAIL]: {
    path: RoutePath.PLANNING_DETAIL,
    displayName: 'Production Planning',
    parent: RoutePath.LINE_ASSIGNMENT,
    section: 'Manufacturing',
    subtitle: 'Master schedule & allocation',
  },
  [RoutePath.DEPT_SCHEDULE]: {
    path: RoutePath.DEPT_SCHEDULE,
    displayName: 'Department Schedule',
    parent: RoutePath.DASHBOARD,
    section: 'Manufacturing',
    subtitle: 'Consolidated visual timeline',
  },
  [RoutePath.TRANSACTION_REPORT]: {
    path: RoutePath.TRANSACTION_REPORT,
    displayName: 'Transaction Report',
    parent: RoutePath.LINE_ASSIGNMENT,
    section: 'Manufacturing',
    subtitle: 'Department handover ledger by date and shift hour',
  },
  [RoutePath.ADMIN]: {
    path: RoutePath.ADMIN,
    displayName: 'Admin',
    parent: RoutePath.DASHBOARD,
    section: 'System',
    subtitle: 'System administration',
  },
  [RoutePath.SETTINGS]: {
    path: RoutePath.SETTINGS,
    displayName: 'Settings',
    parent: RoutePath.DASHBOARD,
    section: 'System',
    subtitle: 'Factory configuration & master data',
  },
  [RoutePath.WORK_CENTERS]: {
    path: RoutePath.WORK_CENTERS,
    displayName: 'Work Centers',
    parent: RoutePath.DASHBOARD,
    section: 'System',
    subtitle: 'Buyers, departments, and process flow templates',
  },
  [RoutePath.WORK_CENTER_DEPARTMENTS]: {
    path: RoutePath.WORK_CENTER_DEPARTMENTS,
    displayName: 'Departments',
    parent: RoutePath.WORK_CENTERS,
    section: 'System',
    subtitle: 'Work centers, operations, apps, and resources',
  },
  [RoutePath.WORK_CENTER_BUYERS]: {
    path: RoutePath.WORK_CENTER_BUYERS,
    displayName: 'Buyers',
    parent: RoutePath.WORK_CENTERS,
    section: 'System',
    subtitle: 'Buyer profiles, shipment defaults, and size groups',
  },
  [RoutePath.WORK_CENTER_PROCESS_FLOWS]: {
    path: RoutePath.WORK_CENTER_PROCESS_FLOWS,
    displayName: 'Process Flows',
    parent: RoutePath.WORK_CENTERS,
    section: 'System',
    subtitle: 'Routing templates — operation sequence per style',
  },
  [RoutePath.USER_MANAGEMENT]: {
    path: RoutePath.USER_MANAGEMENT,
    displayName: 'User Management',
    parent: RoutePath.DASHBOARD,
    section: 'System',
    subtitle: 'Manage users & access control',
  },
};

const WORK_CENTER_ROUTES: ReadonlySet<string> = new Set([
  RoutePath.WORK_CENTERS,
  RoutePath.WORK_CENTER_BUYERS,
  RoutePath.WORK_CENTER_DEPARTMENTS,
  RoutePath.WORK_CENTER_PROCESS_FLOWS,
]);

export function isWorkCenterRoute(route: string): boolean {
  return WORK_CENTER_ROUTES.has(route);
}

export function getRouteEntry(currentRoute: string): RouteMapEntry | null {
  if (WORK_CENTER_ROUTES.has(currentRoute)) {
    return ROUTE_MAP[RoutePath.WORK_CENTERS];
  }

  if (ROUTE_MAP[currentRoute]) return ROUTE_MAP[currentRoute];

  for (const entry of Object.values(ROUTE_MAP)) {
    if (!entry.isParameterized) continue;
    const prefix = entry.path.replace(/\/:[^/]+/g, '/');
    if (currentRoute.startsWith(prefix.slice(0, -1))) {
      return entry;
    }
  }
  return null;
}

export function buildBreadcrumbTrail(
  currentRoute: string,
  titleOverride?: string,
): Array<{ displayName: string; path: string; isCurrentPage: boolean }> {
  const trail: Array<{ displayName: string; path: string; isCurrentPage: boolean }> = [];
  let entry = getRouteEntry(currentRoute);

  if (!entry) return [{ displayName: 'Dashboard', path: RoutePath.DASHBOARD, isCurrentPage: true }];

  const visited = new Set<string>();
  let isFirst = true;

  while (entry && !visited.has(entry.path)) {
    visited.add(entry.path);
    trail.unshift({
      displayName: isFirst && titleOverride ? titleOverride : entry.displayName,
      path: entry.path,
      isCurrentPage: isFirst,
    });
    isFirst = false;
    entry = entry.parent ? getRouteEntry(entry.parent) ?? ROUTE_MAP[entry.parent] ?? null : null;
  }

  return trail;
}
