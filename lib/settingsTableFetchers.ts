import { supabase } from './supabase';
import { sortDepartmentsForDisplay, resolvePlanningMode } from './departmentFilters';
import {
  composeDepartmentApps,
  parseDepartmentAppColumns,
} from './departmentAppColumns';
import { productionPathFromApps } from './departmentProductionPath';
import { sequenceForRole } from './departmentSequence';
import { mapDepartmentDefectFromDb } from './defectDb';
import { mapFabricComponentFromDb } from './fabricComponentDb';
import { mapProcessFlowFromDbInline } from './processFlowDb';
import { fetchAppConfiguration, type OperationRow } from './operationsDb';
import { ensureAssignedResources } from './queries/resources';
import {
  ratesToVersionDrafts,
  type WorkforceRateVersionDraft,
} from './departmentWorkforceRates';
import {
  DEFAULT_FACTORY_ENTITLEMENTS,
  factoryEntitlementsFromDb,
  type FactoryEntitlements,
} from './factoryEntitlements';
import {
  normalizeWorkerRoles,
  workerRolesForDepartment,
} from './workforceCategories';
import { mapDepartmentResourceFromDb } from './departmentResourceSync';
import type {
  Buyer,
  DepartmentEntity,
  Shift,
  ProcessFlow,
  SizeGroup,
  SupportDropdown,
  DepartmentDefectRecord,
  FabricComponent,
  FactorySettings,
  DepartmentResource,
} from '../types/settings';
import type { OperationStepType } from './operationsDb';

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(Boolean);
}

function mapBuyerFromDb(b: Record<string, unknown>): Buyer {
  return {
    id: b.id as string,
    factory_id: b.factory_id as string,
    name: b.name as string,
    code: (b.code as string) ?? null,
    country: (b.country as string) ?? null,
    type: (b.type as string) ?? null,
    status: (b.status as string) ?? null,
    contactName: (b.contact_name as string) ?? null,
    contactEmail: (b.contact_email as string) ?? null,
    contactPhone: (b.contact_phone as string) ?? null,
    contactRole: (b.contact_role as string) ?? null,
    overShipmentAllowance: (b.over_shipment_pct as number) ?? null,
    underShipmentAllowance: (b.under_shipment_pct as number) ?? null,
    packingRule: (b.packing_rule as string) ?? null,
    shipMode: (b.ship_mode as string) ?? null,
    destination: (b.destination as string) ?? null,
    currency: (b.currency as string) ?? null,
    shipModeOptions: parseStringArray(b.ship_mode_options),
    shipmentTypeOptions: parseStringArray(b.shipment_type_options),
    destinationCountries: parseStringArray(b.destination_countries),
  };
}

function normalizeSizes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function mapSizeGroupFromDb(sg: Record<string, unknown>): SizeGroup {
  return {
    id: sg.id as string,
    factory_id: sg.factory_id as string,
    buyerId: (sg.buyer_id as string) ?? null,
    name: sg.name as string,
    sizes: normalizeSizes(sg.sizes),
  };
}

function mapDepartmentsFromRows(
  rows: Record<string, unknown>[],
  rolesByDept: Map<string, string[]>,
): DepartmentEntity[] {
  return sortDepartmentsForDisplay(
    rows.map((d) => {
      const appCols = parseDepartmentAppColumns(d);
      const apps = composeDepartmentApps(appCols);
      return {
        ...d,
        apps,
        productionApps: appCols.productionApps,
        transactionEnabled: appCols.transactionEnabled,
        auditEnabled: appCols.auditEnabled,
        supervisorEnabled: appCols.supervisorEnabled,
        sequence:
          typeof d.sequence === 'number'
            ? d.sequence
            : sequenceForRole((d.role as DepartmentEntity['role']) || 'standard'),
        workerRoles: rolesByDept.has(d.id as string)
          ? workerRolesForDepartment(rolesByDept.get(d.id as string))
          : workerRolesForDepartment(normalizeWorkerRoles(d.worker_roles)),
        role: (d.role as DepartmentEntity['role']) || 'standard',
        productionPath: productionPathFromApps(
          appCols.productionApps,
          d.role as string,
          Boolean(d.is_native),
        ),
        planning_mode: resolvePlanningMode({
          role: (d.role as DepartmentEntity['role']) || 'standard',
          planning_mode: d.planning_mode as DepartmentEntity['planning_mode'],
        }),
        isNative: Boolean(d.is_native),
        created_at: (d.created_at as string) || undefined,
        updated_at: (d.updated_at as string) || undefined,
      } as DepartmentEntity;
    }),
  );
}

async function fetchWorkforceRolesByDept(
  factoryId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('department_workforce_rates')
    .select('department_id, label, is_current')
    .eq('factory_id', factoryId)
    .eq('is_current', true);
  if (error) throw error;
  const rolesByDept = new Map<string, string[]>();
  for (const row of data ?? []) {
    const deptId = row.department_id as string;
    const list = rolesByDept.get(deptId) ?? [];
    list.push(row.label as string);
    rolesByDept.set(deptId, list);
  }
  return rolesByDept;
}

export async function fetchBuyersTable(factoryId: string): Promise<Buyer[]> {
  const { data, error } = await supabase
    .from('buyers')
    .select('*')
    .eq('factory_id', factoryId)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((b) => mapBuyerFromDb(b as Record<string, unknown>));
}

export async function fetchDepartmentsTable(factoryId: string): Promise<DepartmentEntity[]> {
  const [deptRes, rolesByDept] = await Promise.all([
    supabase
      .from('departments')
      .select('*')
      .eq('factory_id', factoryId)
      .order('sequence')
      .order('name'),
    fetchWorkforceRolesByDept(factoryId),
  ]);
  if (deptRes.error) throw deptRes.error;
  return mapDepartmentsFromRows(
    (deptRes.data ?? []) as Record<string, unknown>[],
    rolesByDept,
  );
}

export async function fetchShiftsTable(factoryId: string): Promise<Shift[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('factory_id', factoryId)
    .order('name');
  if (error) throw error;
  return (data ?? []) as Shift[];
}

export async function fetchProcessFlowsTable(factoryId: string): Promise<ProcessFlow[]> {
  const [flowsRes, operations, departments] = await Promise.all([
    supabase
      .from('process_flows')
      .select('*')
      .eq('factory_id', factoryId)
      .order('name'),
    fetchOperationsTable(factoryId),
    fetchDepartmentsTable(factoryId),
  ]);
  if (flowsRes.error) throw flowsRes.error;
  return (flowsRes.data ?? []).map((row) =>
    mapProcessFlowFromDbInline(
      row as Record<string, unknown>,
      operations,
      departments,
    ),
  );
}

export async function fetchSizeGroupsTable(factoryId: string): Promise<SizeGroup[]> {
  const { data, error } = await supabase
    .from('size_groups')
    .select('*')
    .eq('factory_id', factoryId);
  if (error) throw error;
  return (data ?? []).map((row) => mapSizeGroupFromDb(row as Record<string, unknown>));
}

export async function fetchSupportDropdownsTable(
  factoryId: string,
): Promise<SupportDropdown[]> {
  const { data, error } = await supabase
    .from('support_dropdowns')
    .select('*')
    .eq('factory_id', factoryId)
    .order('category');
  if (error) throw error;
  return (data ?? []) as SupportDropdown[];
}

export async function fetchDefectsTable(
  factoryId: string,
): Promise<DepartmentDefectRecord[]> {
  const { data, error } = await supabase
    .from('defects')
    .select('*')
    .eq('factory_id', factoryId);
  if (error) throw error;
  return (data ?? []).map((row) =>
    mapDepartmentDefectFromDb(row as Record<string, unknown>),
  );
}

export async function fetchFabricComponentsTable(
  factoryId: string,
): Promise<FabricComponent[]> {
  const { data, error } = await supabase
    .from('fabric_components')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) =>
    mapFabricComponentFromDb(row as Record<string, unknown>),
  );
}

export async function fetchOperationsTable(factoryId: string): Promise<OperationRow[]> {
  const { data, error } = await supabase
    .from('operations')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('is_active', true)
    .order('department_id')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    factory_id: row.factory_id as string,
    department_id: row.department_id as string,
    name: row.name as string,
    step_type: (row.step_type as OperationStepType) || 'produce',
    capture_app: (row.capture_app as string) || null,
    is_active: row.is_active !== false,
  }));
}

export async function fetchFactoryProfileTable(
  factoryId: string,
): Promise<{ factory: FactorySettings | null; entitlements: FactoryEntitlements }> {
  const { data, error } = await supabase
    .from('factories')
    .select(
      'id, name, code, country, timezone, default_shift_id, transaction_apps, production_apps, workforce_apps, audit_apps, shipment_apps',
    )
    .eq('id', factoryId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { factory: null, entitlements: { ...DEFAULT_FACTORY_ENTITLEMENTS } };
  }
  const row = data as Record<string, unknown>;
  const entitlements = factoryEntitlementsFromDb(row);
  return {
    entitlements,
    factory: {
      id: String(row.id ?? factoryId),
      name: String(row.name ?? ''),
      code: String(row.code ?? ''),
      country: String(row.country ?? ''),
      timezone: String(row.timezone ?? 'UTC'),
      defaultShiftId: (row.default_shift_id as string | null) ?? null,
      entitlements,
    },
  };
}

export async function fetchCatalogResourcesByDept(
  factoryId: string,
  departments: DepartmentEntity[],
): Promise<Record<string, DepartmentResource[]>> {
  const { rows } = await ensureAssignedResources(factoryId);
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
  const catalogResourcesByDept: Record<string, DepartmentResource[]> = {};
  for (const row of rows) {
    const deptId = (row as { department_id?: string | null }).department_id;
    if (!deptId) continue;
    if (!catalogResourcesByDept[deptId]) catalogResourcesByDept[deptId] = [];
    catalogResourcesByDept[deptId].push(
      mapDepartmentResourceFromDb(
        row as Record<string, unknown>,
        deptId,
        deptNameById.get(deptId) ?? '',
      ),
    );
  }
  return catalogResourcesByDept;
}

export async function fetchWorkforceRatesByDept(
  factoryId: string,
): Promise<Record<string, WorkforceRateVersionDraft[]>> {
  const { data, error } = await supabase
    .from('department_workforce_rates')
    .select(
      'id, factory_id, department_id, label, shift_id, cost_per_hour, effective_month, is_current, sort_order',
    )
    .eq('factory_id', factoryId)
    .order('department_id')
    .order('effective_month', { ascending: false })
    .order('sort_order')
    .order('label');
  if (error) throw error;
  const workforceRowsByDept = new Map<string, Parameters<typeof ratesToVersionDrafts>[0]>();
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const deptId = row.department_id as string;
    const bucket = workforceRowsByDept.get(deptId) ?? [];
    bucket.push({
      id: row.id as string,
      factoryId: row.factory_id as string,
      departmentId: deptId,
      label: row.label as string,
      shiftId: row.shift_id as string,
      costPerHour: Number(row.cost_per_hour) || 0,
      effectiveFrom: String(row.effective_month).slice(0, 10),
      isCurrent: row.is_current !== false,
      sortOrder: Number(row.sort_order) || 0,
    });
    workforceRowsByDept.set(deptId, bucket);
  }
  const departmentWorkforceByDept: Record<string, WorkforceRateVersionDraft[]> = {};
  for (const [deptId, rows] of workforceRowsByDept) {
    departmentWorkforceByDept[deptId] = ratesToVersionDrafts(rows);
  }
  return departmentWorkforceByDept;
}

export async function fetchAppConfigurationTable(
  factoryId: string,
): Promise<Record<OperationStepType, string[]> | null> {
  return fetchAppConfiguration(factoryId);
}

export type SettingsTableSlice =
  | 'buyers'
  | 'departments'
  | 'shifts'
  | 'processFlows'
  | 'sizeGroups'
  | 'supportDropdowns'
  | 'defects'
  | 'fabricComponents'
  | 'operations'
  | 'factoryProfile'
  | 'workforceRates'
  | 'appConfiguration'
  | 'catalogResources';

export const SETTINGS_SLICES_BY_SCOPE = {
  core: ['buyers', 'departments', 'shifts', 'workforceRates', 'factoryProfile'] as const,
  'order-form': [
    'buyers',
    'departments',
    'shifts',
    'workforceRates',
    'factoryProfile',
    'sizeGroups',
    'supportDropdowns',
    'operations',
    'appConfiguration',
  ] as const,
  full: [
    'buyers',
    'departments',
    'shifts',
    'workforceRates',
    'factoryProfile',
    'sizeGroups',
    'supportDropdowns',
    'operations',
    'appConfiguration',
    'processFlows',
    'defects',
    'fabricComponents',
    'catalogResources',
  ] as const,
};

export async function fetchSettingsSlice(
  factoryId: string,
  slice: SettingsTableSlice,
  context?: { departments?: DepartmentEntity[] },
): Promise<unknown> {
  switch (slice) {
    case 'buyers':
      return fetchBuyersTable(factoryId);
    case 'departments':
      return fetchDepartmentsTable(factoryId);
    case 'shifts':
      return fetchShiftsTable(factoryId);
    case 'processFlows':
      return fetchProcessFlowsTable(factoryId);
    case 'sizeGroups':
      return fetchSizeGroupsTable(factoryId);
    case 'supportDropdowns':
      return fetchSupportDropdownsTable(factoryId);
    case 'defects':
      return fetchDefectsTable(factoryId);
    case 'fabricComponents':
      return fetchFabricComponentsTable(factoryId);
    case 'operations':
      return fetchOperationsTable(factoryId);
    case 'factoryProfile':
      return fetchFactoryProfileTable(factoryId);
    case 'workforceRates':
      return fetchWorkforceRatesByDept(factoryId);
    case 'appConfiguration':
      return fetchAppConfigurationTable(factoryId);
    case 'catalogResources': {
      const depts =
        context?.departments ?? (await fetchDepartmentsTable(factoryId));
      return fetchCatalogResourcesByDept(factoryId, depts);
    }
    default:
      return null;
  }
}

export function settingsSliceQueryKey(
  factoryId: string,
  slice: SettingsTableSlice,
): readonly [string, string, string, SettingsTableSlice] {
  return ['settings', factoryId, 'slice', slice] as const;
}
