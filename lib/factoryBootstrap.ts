import { RoutePath } from '../types';

/** How much factory order/allocation data a route needs. */
export type FactoryDataScope = 'none' | 'catalog' | 'planning' | 'full';

/** Settings load depth for a route. */
export type SettingsScope = 'core' | 'order-form' | 'full';

const SETTINGS_ONLY_ROUTES: ReadonlySet<string> = new Set([
  RoutePath.SETTINGS,
  RoutePath.USER_MANAGEMENT,
  RoutePath.ADMIN,
  RoutePath.WORK_CENTERS,
  RoutePath.WORK_CENTER_BUYERS,
  RoutePath.WORK_CENTER_DEPARTMENTS,
  RoutePath.WORK_CENTER_PROCESS_FLOWS,
  RoutePath.MATERIAL_MANAGEMENT,
]);

const ORDERS_LIST_PREFETCH_ROUTES: ReadonlySet<string> = new Set([
  RoutePath.STATUS_TRACKER,
  RoutePath.LINE_ASSIGNMENT,
  RoutePath.MATERIAL_MILL_STYLES,
  RoutePath.MATERIAL_WAREHOUSE_STYLES,
]);

function isStyleDetailRoute(route: string): boolean {
  return route.startsWith('#/style-details/') || route.startsWith('#/style-color-details/');
}

function isCreateOrderRoute(route: string): boolean {
  return route === RoutePath.CREATE_ORDER || route.startsWith('#/create-order');
}

/**
 * @deprecated All list pages own paginated TanStack queries — returns `none` for every route.
 */
export function routeFactoryDataScope(_route: string): FactoryDataScope {
  return 'none';
}

/** Warm orders list cache when entering paginated list pages. */
export function routeNeedsOrdersListPrefetch(route: string): boolean {
  return ORDERS_LIST_PREFETCH_ROUTES.has(route);
}

export function routeNeedsProductionSummary(route: string): boolean {
  if (isStyleDetailRoute(route)) return true;
  if (route === RoutePath.STATUS_TRACKER) return true;
  return false;
}

export function routeSettingsScope(route: string): SettingsScope {
  if (SETTINGS_ONLY_ROUTES.has(route)) return 'full';
  if (isCreateOrderRoute(route)) return 'order-form';
  return 'core';
}

/** @deprecated Use routeSettingsScope — kept for callers passing boolean enabled. */
export function routeNeedsSettings(_route: string): boolean {
  return true;
}

/** @deprecated Use routeFactoryDataScope for bootstrap logic. */
export function routeNeedsOrders(route: string): boolean {
  return routeNeedsOrdersListPrefetch(route);
}
