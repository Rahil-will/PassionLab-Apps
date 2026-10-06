/**
 * Legacy → canonical hash aliases.
 * Material config UI is a sidebar page below Work Centers.
 */
export const ROUTE_ALIASES: Readonly<Record<string, string>> = {
  '#/dashboard': '#/dashboard',
  '#/create-order': '#/create-order',
  '#/status-tracker': '#/status-tracker',
  '#/floor-day': '#/floor-day',
  '#/production/order-completion': '#/production/order-completion',
  '#/line-assignment': '#/line-assignment',
  '#/dept-schedule': '#/dept-schedule',
  '#/planning/transaction-report': '#/planning/transaction-report',
  '#/reports': '#/reports',
  '#/reports/day': '#/reports/day',
  '#/reports/style': '#/reports/style',
  '#/reports/department': '#/reports/department',
  '#/admin': '#/admin',
  '#/user-management': '#/user-management',
  '#/settings': '#/settings',
  '#/work-centers': '#/work-centers',
  '#/work-centers/departments': '#/work-centers/departments',
  '#/work-centers/buyers': '#/work-centers/buyers',
  '#/work-centers/process-flows': '#/work-centers/process-flows',
  '#/material-management': '#/material-management',
  '#/work-centers/material': '#/material-management',
  '#/mm': '#/material-management',
  '#/material': '#/material-management',
  '#/mm/settings': '#/settings',
};

export function resolveRouteAlias(hash: string): string {
  const bare = (hash || '').split('?')[0];
  if (ROUTE_ALIASES[bare]) return ROUTE_ALIASES[bare];
  return bare;
}

/** Extra params when resolving a legacy Material hash. */
export function aliasRouteParams(rawHash: string): Record<string, string> {
  const bare = (rawHash || '').split('?')[0];
  // Module toggles live under Factory Settings now
  if (bare === '#/mm/settings') return {};
  return {};
}
