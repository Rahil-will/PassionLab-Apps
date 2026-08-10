/** Derived work-center capture path from operations catalog (`capture_app`), not stored on departments. */

export type DepartmentProductionPath =
  | 'hourly'
  | 'batch'
  | 'native_cutting'
  | 'native_shipment'
  | 'passive'
  | 'none';

export const PRODUCTION_PATH_LABELS: Record<DepartmentProductionPath, string> = {
  hourly: 'Hourly',
  batch: 'Batch',
  native_cutting: 'Cutting',
  native_shipment: 'Shipment',
  passive: 'Handover',
  none: 'Route only',
};

const CAPTURE_APP_IDS = ['hourly', 'qc_log', 'batch', 'cutting_lay'] as const;

export function departmentHasProductionCapture(apps: string[] | undefined): boolean {
  const set = new Set(apps ?? []);
  return CAPTURE_APP_IDS.some((id) => set.has(id));
}

/** Supervisor assignment applies to hourly, batch, and native cutting (origin = handover only on floor). */
export function supervisorAppliesToPath(path: DepartmentProductionPath): boolean {
  return path === 'hourly' || path === 'batch' || path === 'native_cutting';
}

export function normalizeProductionPath(
  raw: unknown,
  apps?: string[],
  role?: string,
  isNative?: boolean,
): DepartmentProductionPath {
  if (
    raw === 'batch'
    || raw === 'native_cutting'
    || raw === 'native_shipment'
    || raw === 'hourly'
    || raw === 'passive'
    || raw === 'none'
  ) {
    return raw;
  }
  if (apps !== undefined) {
    return productionPathFromApps(apps, role, isNative);
  }
  return 'none';
}

export function productionPathFromApps(
  apps: string[] | undefined,
  role?: string,
  isNative?: boolean,
): DepartmentProductionPath {
  if (role === 'terminal') return 'native_shipment';
  if (role === 'origin' && isNative) return 'native_cutting';
  const enabled = new Set(apps ?? []);
  if (!departmentHasProductionCapture([...enabled])) return 'none';
  if (enabled.has('batch') && !enabled.has('hourly') && !enabled.has('qc_log')) return 'batch';
  return 'hourly';
}

/** Lay report only — bundles are generated as an outcome of a lay session. */
export const ORIGIN_CUTTING_APPS = ['cutting_lay'] as const;

export const TERMINAL_PRODUCTION_APPS = [
  'shipment_log',
  'final_rejection_log',
  'shipment_audit',
] as const;

export function productionAppsForPath(
  path: DepartmentProductionPath,
  hourlyEnabled: boolean,
  qcEnabled: boolean,
): string[] {
  if (path === 'native_shipment') return [...TERMINAL_PRODUCTION_APPS];
  if (path === 'native_cutting') return [...ORIGIN_CUTTING_APPS];
  if (path === 'none') return [];
  if (path === 'batch') return ['batch'];
  const apps: string[] = [];
  if (hourlyEnabled) apps.push('hourly');
  if (qcEnabled) apps.push('qc_log');
  return apps;
}

export function appsMatchProductionPath(
  apps: string[],
  path: DepartmentProductionPath,
): boolean {
  const set = new Set(apps);
  if (path === 'none') {
    return !CAPTURE_APP_IDS.some((id) => set.has(id))
      && !TERMINAL_PRODUCTION_APPS.some((id) => set.has(id));
  }
  if (path === 'native_shipment') {
    return TERMINAL_PRODUCTION_APPS.some((id) => set.has(id))
      && !set.has('hourly')
      && !set.has('qc_log')
      && !set.has('batch');
  }
  if (path === 'native_cutting') {
    return set.has('cutting_lay') && !set.has('hourly') && !set.has('qc_log') && !set.has('batch');
  }
  if (path === 'batch') {
    return set.has('batch') && !set.has('hourly') && !set.has('qc_log');
  }
  return (set.has('hourly') || set.has('qc_log')) && !set.has('batch');
}

export function reconcileAppsForProductionPath(
  currentApps: string[],
  path: DepartmentProductionPath,
  opts: { hourly: boolean; qc: boolean; batch: boolean; supervisor: boolean; audit: boolean },
): string[] {
  const preserved = new Set(['transaction', 'audit', 'supervisor', 'cutting_lay']);
  const next = currentApps.filter((a) => preserved.has(a));
  if (!next.includes('transaction')) next.unshift('transaction');
  if (opts.audit && !next.includes('audit')) next.push('audit');
  if (opts.supervisor && !next.includes('supervisor')) next.push('supervisor');

  if (path === 'native_shipment') {
    for (const id of TERMINAL_PRODUCTION_APPS) {
      if (!next.includes(id)) next.push(id);
    }
    return next.filter((id) => id !== 'transaction');
  }

  if (path === 'none') {
    return next.filter((id) => !['hourly', 'qc_log', 'batch', 'cutting_lay'].includes(id));
  }

  if (path === 'native_cutting') {
    if (!next.includes('cutting_lay')) next.push('cutting_lay');
    return next;
  }

  if (path === 'batch') {
    if (opts.batch) next.push('batch');
    return next;
  }

  if (opts.hourly) next.push('hourly');
  if (opts.qc) next.push('qc_log');
  return next;
}
