import { TERMINAL_DEPT_APPS } from './floorApps';
import { ORIGIN_CUTTING_APPS } from './departmentProductionPath';

const PRODUCTION_APP_IDS = new Set([
  'hourly',
  'qc_log',
  'batch',
  'cutting_lay',
  ...TERMINAL_DEPT_APPS,
]);

export interface DepartmentAppColumns {
  productionApps: string[];
  transactionEnabled: boolean;
  auditEnabled: boolean;
  supervisorEnabled: boolean;
}

export function productionAppsFromList(apps: string[] | undefined): string[] {
  return (apps ?? []).filter((id) => PRODUCTION_APP_IDS.has(id));
}

/** Build runtime app columns from DB flags + operations-derived production apps. */
export function parseDepartmentAppColumns(
  row: Record<string, unknown>,
  productionAppsOverride?: string[],
): DepartmentAppColumns {
  const productionApps = productionAppsOverride ?? [];

  return {
    productionApps,
    transactionEnabled: row.transaction_enabled !== false,
    auditEnabled: true,
    supervisorEnabled: row.supervisor_enabled === true,
  };
}

/** Composed floor app list for runtime / profiles (audit always on). */
export function composeDepartmentApps(columns: DepartmentAppColumns): string[] {
  const out = new Set<string>(columns.productionApps);
  if (columns.transactionEnabled) out.add('transaction');
  out.add('audit');
  if (columns.supervisorEnabled) out.add('supervisor');
  return [...out];
}

export function serializeDepartmentFlagsForDb(
  opts: Partial<DepartmentAppColumns> & { productionApps?: string[] },
): {
  transaction_enabled: boolean;
  supervisor_enabled: boolean;
} {
  return {
    transaction_enabled: opts.transactionEnabled !== false,
    supervisor_enabled: opts.supervisorEnabled === true,
  };
}

/** @deprecated Use serializeDepartmentFlagsForDb */
export function serializeDepartmentAppsForDb(
  _composedApps: string[],
  opts?: Partial<DepartmentAppColumns>,
): {
  transaction_enabled: boolean;
  supervisor_enabled: boolean;
} {
  return serializeDepartmentFlagsForDb(opts ?? {});
}

export function departmentRowToEntityApps(
  row: Record<string, unknown>,
  productionApps?: string[],
): string[] {
  return composeDepartmentApps(parseDepartmentAppColumns(row, productionApps));
}
