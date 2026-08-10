import type { DeptAppId } from './floorApps';
import { stripLegacyWorkforceApps } from './workforceCategories';

/** Per-category floor app entitlements stored on `public.factories`. */
export interface FactoryEntitlements {
  transaction: DeptAppId[];
  production: DeptAppId[];
  workforce: DeptAppId[];
  audit: DeptAppId[];
  shipment: DeptAppId[];
}

export const DEFAULT_FACTORY_ENTITLEMENTS: FactoryEntitlements = {
  transaction: ['transaction'],
  production: ['hourly', 'qc_log', 'batch'],
  workforce: ['supervisor'],
  audit: ['audit'],
  shipment: ['shipment_log', 'final_rejection_log', 'shipment_audit'],
};

function parseAppList(raw: unknown, fallback: DeptAppId[]): DeptAppId[] {
  if (raw === null || raw === undefined) return fallback;
  if (!Array.isArray(raw)) return fallback;
  return raw.filter((x): x is DeptAppId => typeof x === 'string');
}

function mergeProductionApps(parsed: DeptAppId[]): DeptAppId[] {
  const merged = new Set(parsed);
  return DEFAULT_FACTORY_ENTITLEMENTS.production.filter((id) => merged.has(id));
}

export function factoryEntitlementsFromDb(row: Record<string, unknown> | null): FactoryEntitlements {
  if (!row) return { ...DEFAULT_FACTORY_ENTITLEMENTS };
  return {
    transaction: parseAppList(row.transaction_apps, DEFAULT_FACTORY_ENTITLEMENTS.transaction),
    production: mergeProductionApps(
      parseAppList(row.production_apps, DEFAULT_FACTORY_ENTITLEMENTS.production),
    ),
    workforce: parseAppList(row.workforce_apps, DEFAULT_FACTORY_ENTITLEMENTS.workforce).map(
      (id) => (id === 'workforce' ? 'supervisor' : id),
    ) as DeptAppId[],
    audit: parseAppList(row.audit_apps, DEFAULT_FACTORY_ENTITLEMENTS.audit),
    shipment: parseAppList(row.shipment_apps, DEFAULT_FACTORY_ENTITLEMENTS.shipment),
  };
}

/** Department-assignable apps allowed for this factory (excludes shipment / rejection). */
export function departmentEntitledApps(e: FactoryEntitlements): Set<DeptAppId> {
  return new Set([
    ...e.transaction,
    ...e.production,
    ...e.workforce,
    ...e.audit,
  ]);
}

export function isFactoryFunctionEnabled(e: FactoryEntitlements): boolean {
  return e.shipment.length > 0;
}

export function defaultShipmentFunctionApps(e: FactoryEntitlements): DeptAppId[] {
  return [...e.shipment];
}

/** Terminal work centers always expose entitled shipment apps in departments.apps (no transaction). */
export function mergeTerminalDepartmentApps(
  apps: string[] | undefined,
  e: FactoryEntitlements,
): string[] {
  const base = new Set(sanitizeDepartmentApps(apps, e));
  for (const app of e.shipment) {
    base.add(app);
  }
  base.delete('transaction');
  return sanitizeDepartmentApps([...base], e).filter((id) => id !== 'transaction');
}

const SKIP_TOKENS = new Set(['none', 'none_workforce']);

/** Strip apps the factory is not entitled to; remove legacy workforce apps; keep transaction when entitled. */
export function sanitizeDepartmentApps(apps: string[] | undefined, e: FactoryEntitlements): string[] {
  const allowed = departmentEntitledApps(e);
  const raw = stripLegacyWorkforceApps(apps?.length ? apps : ['transaction']);
  const filtered = raw.filter((id) => SKIP_TOKENS.has(id) || allowed.has(id as DeptAppId));
  if (allowed.has('transaction') && !filtered.includes('transaction')) {
    return ['transaction', ...filtered];
  }
  return filtered.length > 0 ? filtered : ['transaction'];
}

export function entitlementsToDbPayload(e: FactoryEntitlements): Record<string, DeptAppId[]> {
  return {
    transaction_apps: e.transaction,
    production_apps: e.production,
    workforce_apps: e.workforce,
    audit_apps: e.audit,
    shipment_apps: e.shipment,
  };
}
