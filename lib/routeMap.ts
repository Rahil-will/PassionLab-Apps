import { RoutePath } from '../types';

export interface RouteMapEntry {
  path: string;
  displayName: string;
  parent: string | null;
  section: 'Main' | 'Production' | 'Manufacturing' | 'Reports' | 'System' | 'Material';
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
  [RoutePath.CREATE_ORDER_COLOR]: {
    path: RoutePath.CREATE_ORDER_COLOR,
    displayName: 'Colorwise Details',
    parent: RoutePath.CREATE_ORDER,
    section: 'Main',
    subtitle: 'Quantities and materials for each color',
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
  [RoutePath.PRODUCTION_CUTTING]: {
    path: RoutePath.PRODUCTION_CUTTING,
    displayName: 'Cutting',
    parent: RoutePath.DASHBOARD,
    section: 'Production',
    subtitle: 'Store receive, fabric at cutting, and today’s cutting sessions',
  },
  [RoutePath.PRODUCTION_CUTTING_INBOUND]: {
    path: RoutePath.PRODUCTION_CUTTING_INBOUND,
    displayName: 'Cutting inbound',
    parent: RoutePath.PRODUCTION_CUTTING,
    section: 'Production',
    subtitle: 'Warehouse store challans waiting at cutting. Open a row to receive.',
  },
  [RoutePath.PRODUCTION_CUTTING_INBOUND_DETAIL]: {
    path: RoutePath.PRODUCTION_CUTTING_INBOUND_DETAIL,
    displayName: 'Receive store challan',
    parent: RoutePath.PRODUCTION_CUTTING_INBOUND,
    section: 'Production',
    subtitle: 'Tick arrived rolls. Unticked rolls are written off as missing.',
    isParameterized: true,
  },
  [RoutePath.PRODUCTION_CUTTING_STOCK]: {
    path: RoutePath.PRODUCTION_CUTTING_STOCK,
    displayName: 'Fabric at cutting',
    parent: RoutePath.PRODUCTION_CUTTING,
    section: 'Production',
    subtitle: 'Rolls currently at the cutting store',
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
  [RoutePath.MATERIAL_MANAGEMENT]: {
    path: RoutePath.MATERIAL_MANAGEMENT,
    displayName: 'Material Management',
    parent: RoutePath.DASHBOARD,
    section: 'System',
    subtitle: 'Fabric categories, types, parameters, and testing',
  },
  [RoutePath.MATERIAL_MILL_BATCHES]: {
    path: RoutePath.MATERIAL_MILL_BATCHES,
    displayName: 'Mill batches',
    parent: RoutePath.MATERIAL_MILL,
    section: 'Material',
    subtitle: 'Style and general mill batches with rolls, custody, and stage mix.',
  },
  [RoutePath.MATERIAL_MILL_BATCH_NEW]: {
    path: RoutePath.MATERIAL_MILL_BATCH_NEW,
    displayName: 'New mill batch',
    parent: RoutePath.MATERIAL_MILL_BATCHES,
    section: 'Material',
    subtitle: 'Create a style or general mill batch and enter rolls.',
  },
  [RoutePath.MATERIAL_MILL_BATCH_DETAIL]: {
    path: RoutePath.MATERIAL_MILL_BATCH_DETAIL,
    displayName: 'Mill batch',
    parent: RoutePath.MATERIAL_MILL_BATCHES,
    section: 'Material',
    isParameterized: true,
    subtitle: 'Batch rolls, custody, tests, and process challans.',
  },
  [RoutePath.MATERIAL_MILL_QC]: {
    path: RoutePath.MATERIAL_MILL_QC,
    displayName: 'Mill QC queue',
    parent: RoutePath.MATERIAL_MILL,
    section: 'Material',
    subtitle: 'Rolls at the mill that still need test or inspection.',
  },
  [RoutePath.MATERIAL_MILL]: {
    path: RoutePath.MATERIAL_MILL,
    displayName: 'Fabric Mill',
    parent: RoutePath.DASHBOARD,
    section: 'Material',
    subtitle: 'Make mill batches, attach them to a style, or send them to the warehouse.',
  },
  [RoutePath.MATERIAL_MILL_STYLES]: {
    path: RoutePath.MATERIAL_MILL_STYLES,
    displayName: 'Allocated fabrics',
    parent: RoutePath.MATERIAL_MILL,
    section: 'Material',
    subtitle: 'One row per style, color, and fabric. Open a row for fabric details.',
  },
  [RoutePath.MATERIAL_MILL_HISTORY]: {
    path: RoutePath.MATERIAL_MILL_HISTORY,
    displayName: 'Sent mill challans',
    parent: RoutePath.MATERIAL_MILL,
    section: 'Material',
    subtitle: 'Mill challans already sent to the warehouse. Style and general PO together.',
  },
  [RoutePath.MATERIAL_PROCESS]: {
    path: RoutePath.MATERIAL_PROCESS,
    displayName: 'Process history',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Process challans already sent. Open a row for returns and loss.',
  },
  [RoutePath.MATERIAL_PROCESS_DETAIL]: {
    path: RoutePath.MATERIAL_PROCESS_DETAIL,
    displayName: 'Process challan',
    parent: RoutePath.MATERIAL_PROCESS,
    section: 'Material',
    subtitle: 'Rolls sent out, rolls that came back, and optional 4-point after return',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_MILL_STOCK]: {
    path: RoutePath.MATERIAL_MILL_STOCK,
    displayName: 'Mill stock',
    parent: RoutePath.MATERIAL_MILL,
    section: 'Material',
    subtitle: 'Fabric and rolls still at the mill, allocated or not. Read-only.',
  },
  [RoutePath.MATERIAL_MILL_LINE]: {
    path: RoutePath.MATERIAL_MILL_LINE,
    displayName: 'Style fabric details',
    parent: RoutePath.MATERIAL_MILL_STYLES,
    section: 'Material',
    subtitle: 'Batches and rolls for this allocated fabric. Allocate more rolls, or dispatch to the warehouse.',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_MILL_ASSIGN]: {
    path: RoutePath.MATERIAL_MILL_ASSIGN,
    displayName: 'Allocate rolls',
    parent: RoutePath.MATERIAL_MILL_LINE,
    section: 'Material',
    subtitle: 'Generate mill rolls, or assign unallocated mill stock to this fabric.',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_MILL_DISPATCH]: {
    path: RoutePath.MATERIAL_MILL_DISPATCH,
    displayName: 'Dispatch to warehouse',
    parent: RoutePath.MATERIAL_MILL_LINE,
    section: 'Material',
    subtitle: 'Select rolls still at the mill and send a mill challan for this fabric.',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_MILL_CHALLAN]: {
    path: RoutePath.MATERIAL_MILL_CHALLAN,
    displayName: 'Mill challan',
    parent: RoutePath.MATERIAL_MILL_LINE,
    section: 'Material',
    subtitle: 'Sent to the warehouse. Receive happens on Fabric Warehouse.',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_MILL_UNALLOCATED]: {
    path: RoutePath.MATERIAL_MILL_UNALLOCATED,
    displayName: 'General PO',
    parent: RoutePath.MATERIAL_MILL,
    section: 'Material',
    subtitle: 'Mill batches with no style yet. Open a row for fabric details.',
  },
  [RoutePath.MATERIAL_MILL_UNALLOCATED_DISPATCH]: {
    path: RoutePath.MATERIAL_MILL_UNALLOCATED_DISPATCH,
    displayName: 'Dispatch General PO',
    parent: RoutePath.MATERIAL_MILL_UNALLOCATED,
    section: 'Material',
    subtitle: 'Send General PO rolls to the warehouse. Assign to a style from fabric details.',
  },
  [RoutePath.MATERIAL_MILL_UNALLOCATED_ALLOCATE]: {
    path: RoutePath.MATERIAL_MILL_UNALLOCATED_ALLOCATE,
    displayName: 'Allocate rolls',
    parent: RoutePath.MATERIAL_MILL_UNALLOCATED,
    section: 'Material',
    subtitle: 'Create a General PO mill batch. Rolls stay at the mill until dispatch.',
  },
  [RoutePath.MATERIAL_MILL_UNALLOCATED_LINE]: {
    path: RoutePath.MATERIAL_MILL_UNALLOCATED_LINE,
    displayName: 'General PO fabric details',
    parent: RoutePath.MATERIAL_MILL_UNALLOCATED,
    section: 'Material',
    subtitle: 'Rolls on this General PO batch. Allocate more, assign to a style, or dispatch.',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE]: {
    path: RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE,
    displayName: 'Allocate rolls',
    parent: RoutePath.MATERIAL_MILL_UNALLOCATED_LINE,
    section: 'Material',
    subtitle: 'Add or edit rolls on this General PO mill batch.',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_WAREHOUSE]: {
    path: RoutePath.MATERIAL_WAREHOUSE,
    displayName: 'Fabric Warehouse',
    parent: RoutePath.DASHBOARD,
    section: 'Material',
    subtitle: 'Inbound, putaway, racks, and dispatch to cutting',
  },
  [RoutePath.MATERIAL_WAREHOUSE_EXPECTED]: {
    path: RoutePath.MATERIAL_WAREHOUSE_EXPECTED,
    displayName: 'Expected receipts',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Fabric still due or already incoming against style requirement',
  },
  [RoutePath.MATERIAL_WAREHOUSE_RECEIVE_UNALLOCATED]: {
    path: RoutePath.MATERIAL_WAREHOUSE_RECEIVE_UNALLOCATED,
    displayName: 'Receive unallocated',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Floor-app receive for vendor rolls without a style. Not shown on the warehouse hub.',
  },
  [RoutePath.MATERIAL_WAREHOUSE_INTERNAL]: {
    path: RoutePath.MATERIAL_WAREHOUSE_INTERNAL,
    displayName: 'Internal inbound',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Inbound challans waiting for warehouse receive',
  },
  [RoutePath.MATERIAL_WAREHOUSE_EXTERNAL]: {
    path: RoutePath.MATERIAL_WAREHOUSE_EXTERNAL,
    displayName: 'External inbound',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Vendor GRNs and roll tests',
  },
  [RoutePath.MATERIAL_WAREHOUSE_ROLL]: {
    path: RoutePath.MATERIAL_WAREHOUSE_ROLL,
    displayName: 'Inbound challan',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Receive mill rolls or save vendor test results',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_WAREHOUSE_STYLES]: {
    path: RoutePath.MATERIAL_WAREHOUSE_STYLES,
    displayName: 'Style-wise fabrics summary',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'One row per style. Expand to see each fabric with its own qty. Meters are never added across fabrics.',
  },
  [RoutePath.MATERIAL_WAREHOUSE_STYLE]: {
    path: RoutePath.MATERIAL_WAREHOUSE_STYLE,
    displayName: 'Style warehouse',
    parent: RoutePath.MATERIAL_WAREHOUSE_STYLES,
    section: 'Material',
    subtitle: 'Fabric, color, challans, and production readiness for one style',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_WAREHOUSE_RACKS]: {
    path: RoutePath.MATERIAL_WAREHOUSE_RACKS,
    displayName: 'Rack',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Browse racks, putaway, move, red label, and allocate from one action panel',
  },
  [RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE]: {
    path: RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE,
    displayName: 'Move rolls',
    parent: RoutePath.MATERIAL_WAREHOUSE_RACKS,
    section: 'Material',
    subtitle: 'Redirects to Rack',
  },
  [RoutePath.MATERIAL_WAREHOUSE_STORE]: {
    path: RoutePath.MATERIAL_WAREHOUSE_STORE,
    displayName: 'Dispatch history',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Warehouse to cutting challans already sent',
  },
  [RoutePath.MATERIAL_WAREHOUSE_DISPATCH]: {
    path: RoutePath.MATERIAL_WAREHOUSE_DISPATCH,
    displayName: 'Dispatch',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Each row is one style, color, and fabric. Open it to see dispatches or send more.',
  },
  [RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE]: {
    path: RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE,
    displayName: 'Fabric dispatch',
    parent: RoutePath.MATERIAL_WAREHOUSE_DISPATCH,
    section: 'Material',
    subtitle: 'All warehouse to cutting challans for this style, color, and fabric',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_WAREHOUSE_DISPATCH_SEND]: {
    path: RoutePath.MATERIAL_WAREHOUSE_DISPATCH_SEND,
    displayName: 'Dispatch rolls',
    parent: RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE,
    section: 'Material',
    subtitle: 'Select racked rolls waiting to go to cutting, then dispatch',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL]: {
    path: RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL,
    displayName: 'Dispatch challan',
    parent: RoutePath.MATERIAL_WAREHOUSE_DISPATCH,
    section: 'Material',
    subtitle: 'Rolls already sent to cutting. Receive status updates from the floor app.',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_WAREHOUSE_TESTING]: {
    path: RoutePath.MATERIAL_WAREHOUSE_TESTING,
    displayName: 'Testing',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Enter test results for inbound mill challans and vendor GRNs.',
  },
  [RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL]: {
    path: RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL,
    displayName: 'Test challan',
    parent: RoutePath.MATERIAL_WAREHOUSE_TESTING,
    section: 'Material',
    subtitle: 'Enter test values, then pass or fail each roll',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_WAREHOUSE_QC]: {
    path: RoutePath.MATERIAL_WAREHOUSE_QC,
    displayName: 'Warehouse QC queue',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Redirects to Testing.',
  },
  [RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND]: {
    path: RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND,
    displayName: 'Send to processing',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Pick warehouse rolls and create a process challan.',
  },
  [RoutePath.MATERIAL_WAREHOUSE_RETURNS]: {
    path: RoutePath.MATERIAL_WAREHOUSE_RETURNS,
    displayName: 'Supplier returns',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Rejected rolls sent back to the mill or vendor',
  },
  [RoutePath.MATERIAL_WAREHOUSE_RETURNS_DETAIL]: {
    path: RoutePath.MATERIAL_WAREHOUSE_RETURNS_DETAIL,
    displayName: 'Supplier return',
    parent: RoutePath.MATERIAL_WAREHOUSE_RETURNS,
    section: 'Material',
    subtitle: 'Rolls on this return',
    isParameterized: true,
  },
  [RoutePath.MATERIAL_WAREHOUSE_END_BITS]: {
    path: RoutePath.MATERIAL_WAREHOUSE_END_BITS,
    displayName: 'End-bit returns',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'Remnants returned from cutting lays',
  },
  [RoutePath.MATERIAL_WAREHOUSE_STOCK]: {
    path: RoutePath.MATERIAL_WAREHOUSE_STOCK,
    displayName: 'Stock on hand',
    parent: RoutePath.MATERIAL_WAREHOUSE,
    section: 'Material',
    subtitle: 'View-only list of rolls and where they sit. Putaway and allocate from Rack.',
  },
  [RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS]: {
    path: RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS,
    displayName: 'Recent movements',
    parent: RoutePath.MATERIAL_WAREHOUSE_STOCK,
    section: 'Material',
    subtitle: 'Time-wise roll counts. Open a row for the batch, or the challan when there is one.',
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
