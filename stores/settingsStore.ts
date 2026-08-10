import { create } from 'zustand';
import { bumpSettingsSlices, DEPARTMENT_SETTINGS_SLICES } from '../lib/settingsQuerySync';
import { saveSupportDropdownRpc, saveFactorySettingsRpc } from '../lib/settingsRpc';
import { useNavigationStore } from "./navigationStore";
import { useNotificationStore } from "./notificationStore";
import { supabase } from "../lib/supabase";
import { ensureSupportDropdownsIfNeeded } from "../lib/ensureSupportDropdowns";
import {
  mapDepartmentResourceFromDb,
  syncDepartmentResourcesToDb,
} from "../lib/departmentResourceSync";
import { syncDepartmentOperationsToDb } from "../lib/departmentOperationsSync";
import {
  mapProcessFlowFromDbInline,
  processFlowToDbRow,
  processFlowUpdatePayload,
} from "../lib/processFlowDb";
import {
  mapDepartmentDefectFromDb,
  defectsToDb,
  parseDefectsJson,
} from "../lib/defectDb";
import {
  fetchFabricComponentsForFactory,
  ensureFactoryFabricComponents,
  saveFabricComponentsForFactory,
  mapFabricComponentFromDb,
} from "../lib/fabricComponentDb";
import { defaultDefectsForDepartment } from "../lib/defectSeeds";
import { sortDepartmentsForDisplay, resolvePlanningMode, planningModeForDepartment } from "../lib/departmentFilters";
import {
  effectiveDepartmentSequence,
  sequenceForNewDepartment,
  sequenceForRole,
} from "../lib/departmentSequence";
import {
  DEFAULT_FACTORY_ENTITLEMENTS,
  entitlementsToDbPayload,
  factoryEntitlementsFromDb,
  mergeTerminalDepartmentApps,
  sanitizeDepartmentApps,
  type FactoryEntitlements,
} from "../lib/factoryEntitlements";
import type { FactorySettings } from "../types/settings";
import {
  referenceStepTypeForPlanningMode,
  defaultReferenceOperationName,
} from '../lib/departmentReferenceOperations';
import { OUTSOURCE_CAPTURE_APP } from '../lib/floorApps';
import { productionAppsFromOperations } from '../lib/departmentAppsFromOperations';
import {
  fetchAppConfiguration,
  type OperationRow,
  type OperationStepType,
} from "../lib/operationsDb";
import { ensureAssignedResources } from "../lib/queries/resources";
import type {
  Buyer,
  DepartmentEntity,
  Shift,
  ProcessFlow,
  Rack,
  SizeGroup,
  SupportDropdown,
  DepartmentResource,
  DepartmentResourceSession,
  DepartmentOperationsSession,
  DefectItem,
  DepartmentDefectRecord,
  FabricComponent,
} from "../types/settings";
import type { DeptPlanningInput, DeptPlanningOutput } from "../types/production";
import {
  normalizeWorkerRoles,
  workerRolesForDepartment,
} from "../lib/workforceCategories";
import { productionPathFromApps, ORIGIN_CUTTING_APPS, TERMINAL_PRODUCTION_APPS, supervisorAppliesToPath } from "../lib/departmentProductionPath";
import {
  composeDepartmentApps,
  parseDepartmentAppColumns,
  productionAppsFromList,
  serializeDepartmentFlagsForDb,
} from "../lib/departmentAppColumns";
import type { SettingsScope } from "../lib/factoryBootstrap";
import {
  fetchDepartmentWorkforceRates,
  ratesToVersionDrafts,
  versionDraftsToRateRows,
  type WorkforceRateRow,
  type WorkforceRateVersionDraft,
} from "../lib/departmentWorkforceRates";

let muteSettingsSaveToasts = false;

function resolveFactoryId(preferred?: string | null): string {
  const id = preferred ?? useNavigationStore.getState().factoryId;
  if (!id) throw new Error('No factory selected');
  return id;
}

/** Work Centers batch save: one summary toast instead of per-entity toasts. */
export async function withMutedSettingsSaveToasts<T>(fn: () => Promise<T>): Promise<T> {
  muteSettingsSaveToasts = true;
  try {
    return await fn();
  } finally {
    muteSettingsSaveToasts = false;
  }
}

function notifySettingsSaved(message: string): void {
  if (muteSettingsSaveToasts) return;
  useNotificationStore.getState().showNotification(message);
}

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

let departmentResourceLoadSeq = 0;

function mapSizeGroupFromDb(sg: Record<string, unknown>): SizeGroup {
  return {
    id: sg.id as string,
    factory_id: sg.factory_id as string,
    buyerId: (sg.buyer_id as string) ?? null,
    name: sg.name as string,
    sizes: normalizeSizes(sg.sizes),
  };
}

// --- SETTINGS STORE (Supabase-backed, multi-tenant) ---

interface SettingsState {
  buyers: Buyer[];
  departments: DepartmentEntity[];
  shifts: Shift[];
  processFlows: ProcessFlow[];
  racks: Rack[];
  sizeGroups: SizeGroup[];
  deptPlanningInputs: DeptPlanningInput[];
  deptPlanningOutputs: DeptPlanningOutput[];
  supportDropdowns: SupportDropdown[];
  departmentDefects: DepartmentDefectRecord[];
  /** Factory operations catalog — preloaded with settings for work-center editors. */
  catalogOperations: OperationRow[];
  /** Assigned resources keyed by department — preloaded with settings (lines / vendors). */
  catalogResourcesByDept: Record<string, DepartmentResource[]>;
  appConfiguration: Record<OperationStepType, string[]> | null;
  departmentResourceSession: DepartmentResourceSession | null;
  departmentOperationsSession: DepartmentOperationsSession | null;
  factoryEntitlements: FactoryEntitlements;
  /** Current factory profile (name, timezone, default shift, entitlements). */
  factory: FactorySettings | null;
  /** Versioned workforce rate drafts keyed by department id — preloaded with settings. */
  departmentWorkforceByDept: Record<string, WorkforceRateVersionDraft[]>;
  loading: boolean;
  /** Last factory settings were loaded for — skip refetch when revisiting tabs. */
  settingsFactoryId: string | null;
  /** Deepest settings slice loaded for the current factory (core < order-form < full). */
  settingsScopeLoaded: SettingsScope | null;
  updateFactory: (data: FactorySettings) => Promise<void>;
  getDepartmentWorkforceRates: (deptId: string) => WorkforceRateVersionDraft[] | null;
  setDepartmentWorkforceDrafts: (deptId: string, drafts: WorkforceRateVersionDraft[]) => void;
  refreshDepartmentWorkforceRates: (deptId: string) => Promise<void>;
  selectDepartmentForEdit: (deptId: string) => void;
  loadDepartmentResources: (deptId: string, departmentName: string) => Promise<void>;
  loadDepartmentOperations: (deptId: string) => void;
  setDepartmentResourceDraft: (resources: DepartmentResource[]) => void;
  setDepartmentOperationsDraft: (operations: OperationRow[]) => void;
  promoteDepartmentResourceSession: (newDeptId: string) => void;
  promoteDepartmentOperationsSession: (newDeptId: string) => void;
  clearDepartmentResourceSession: () => void;
  clearDepartmentOperationsSession: () => void;
  syncDepartmentResources: (
    deptId: string,
    factoryId: string,
    opts?: { resourceType?: 'inhouse' | 'outsourced' },
  ) => Promise<DepartmentResource[]>;
  syncDepartmentOperations: (
    deptId: string,
    factoryId: string,
  ) => Promise<OperationRow[]>;
  addBuyer: (buyer: Partial<Buyer> & { factory_id: string; name: string }) => Promise<string>;
  updateBuyer: (id: string, buyer: Partial<Buyer>) => Promise<void>;
  deleteBuyer: (id: string) => Promise<void>;
  addDepartment: (dept: DepartmentEntity, defects?: DefectItem[], rates?: WorkforceRateVersionDraft[]) => Promise<string>;
  updateDepartment: (id: string, dept: Partial<DepartmentEntity>, defects?: DefectItem[], rates?: WorkforceRateVersionDraft[]) => Promise<void>;
  deleteDepartment: (id: string) => Promise<void>;
  addShift: (shift: Omit<Shift, 'id'>) => Promise<void>;
  updateShift: (id: string, shift: Partial<Shift>) => Promise<void>;
  deleteShift: (id: string) => Promise<void>;
  addProcessFlow: (flow: Partial<ProcessFlow> & { factory_id?: string; name: string }) => Promise<string>;
  versionCurrentProcessFlow: (oldId: string, newFlow: ProcessFlow) => Promise<void>;
  updateProcessFlow: (id: string, flow: Partial<ProcessFlow>) => Promise<void>;
  deleteProcessFlow: (id: string) => Promise<void>;
  addRack: (rack: Rack) => Promise<void>;
  deleteRack: (id: string) => Promise<void>;
  addSizeGroup: (group: SizeGroup) => Promise<void>;
  updateSizeGroup: (id: string, group: Partial<SizeGroup>) => Promise<void>;
  deleteSizeGroup: (id: string) => Promise<void>;
  addSupportDropdown: (sd: SupportDropdown) => Promise<void>;
  updateSupportDropdown: (id: string, sd: Partial<SupportDropdown>) => Promise<void>;
  deleteSupportDropdown: (id: string) => Promise<void>;
  getDepartmentDefects: (departmentId: string) => DefectItem[];
  ensureDepartmentDefects: (departmentId: string, departmentName: string) => Promise<boolean>;
  fabricComponents: FabricComponent[];
  ensureFabricComponentsForOrigin: (
    factoryId: string,
    originDepartmentId: string,
  ) => Promise<FabricComponent[]>;
  loadFabricComponents: (factoryId: string, originDepartmentId: string) => Promise<FabricComponent[]>;
  saveFabricComponents: (
    factoryId: string,
    originDepartmentId: string,
    draft: FabricComponent[],
    baseline?: FabricComponent[],
  ) => Promise<FabricComponent[]>;
  getOperationsForDepartment: (departmentId: string) => OperationRow[];
  refreshCatalogOperations: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  buyers: [],
  departments: [],
  shifts: [],
  processFlows: [],
  racks: [],
  sizeGroups: [],
  deptPlanningInputs: [],
  deptPlanningOutputs: [],
  supportDropdowns: [],
  departmentDefects: [],
  fabricComponents: [],
  catalogOperations: [],
  catalogResourcesByDept: {},
  appConfiguration: null,
  departmentResourceSession: null,
  departmentOperationsSession: null,
  factoryEntitlements: { ...DEFAULT_FACTORY_ENTITLEMENTS },
  factory: null,
  departmentWorkforceByDept: {},
  loading: false,
  settingsFactoryId: null,
  settingsScopeLoaded: null,

  getDepartmentWorkforceRates: (deptId) => get().departmentWorkforceByDept[deptId] ?? null,

  setDepartmentWorkforceDrafts: (deptId, drafts) => {
    set((s) => ({
      departmentWorkforceByDept: { ...s.departmentWorkforceByDept, [deptId]: drafts },
    }));
  },

  refreshDepartmentWorkforceRates: async (deptId) => {
    if (!deptId || deptId.startsWith('temp_')) return;
    try {
      const rows = await fetchDepartmentWorkforceRates(deptId, { currentOnly: false });
      get().setDepartmentWorkforceDrafts(deptId, ratesToVersionDrafts(rows));
    } catch (err) {
      console.warn('[settings] workforce refresh:', err);
    }
  },

  selectDepartmentForEdit: (deptId) => {
    departmentResourceLoadSeq += 1;
    const dept = get().departments.find((d) => d.id === deptId);
    const departmentName = dept?.name ?? '';
    const catalogReady = get().settingsFactoryId !== null && !get().loading;
    const cached = catalogReady ? (get().catalogResourcesByDept[deptId] ?? []) : [];
    const resourceSnapshot = cached.map((r) => ({ ...r, departmentName: departmentName || r.departmentName }));

    set({
      departmentResourceSession: {
        deptId,
        draft: resourceSnapshot.map((r) => ({ ...r })),
        baseline: resourceSnapshot.map((r) => ({ ...r })),
        status: deptId.startsWith('temp_') || catalogReady ? 'ready' : 'loading',
        draftTouched: false,
      },
      departmentOperationsSession: {
        deptId,
        draft: [],
        baseline: [],
        status: deptId.startsWith('temp_') ? 'ready' : 'loading',
        draftTouched: false,
      },
    });
  },

  loadDepartmentResources: async (deptId, departmentName) => {
    if (deptId.startsWith('temp_')) return;
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return;
    const seq = ++departmentResourceLoadSeq;

    const { data, error } = await supabase
      .from('assigned_resources')
      .select('*')
      .eq('factory_id', factoryId)
      .eq('department_id', deptId)
      .order('resource_name');

    if (departmentResourceLoadSeq !== seq) return;
    if (error) throw error;

    const session = get().departmentResourceSession;
    if (session?.deptId !== deptId) return;

    const resources = (data || []).map((row) =>
      mapDepartmentResourceFromDb(row as Record<string, unknown>, deptId, departmentName),
    );
    const snapshot = resources.map((r) => ({ ...r }));

    if (session.draftTouched) {
      set({
        departmentResourceSession: {
          ...session,
          baseline: resources.map((r) => ({ ...r })),
          status: 'ready',
        },
        catalogResourcesByDept: {
          ...get().catalogResourcesByDept,
          [deptId]: resources.map((r) => ({ ...r })),
        },
      });
      return;
    }

    set({
      departmentResourceSession: {
        deptId,
        draft: snapshot,
        baseline: resources.map((r) => ({ ...r })),
        status: 'ready',
        draftTouched: false,
      },
      catalogResourcesByDept: {
        ...get().catalogResourcesByDept,
        [deptId]: resources.map((r) => ({ ...r })),
      },
    });
  },

  loadDepartmentOperations: (deptId) => {
    if (deptId.startsWith('temp_')) return;
    const ops = get().catalogOperations
      .filter((o) => o.department_id === deptId)
      .map((o) => ({ ...o }));
    const session = get().departmentOperationsSession;
    if (session?.deptId !== deptId) return;

    if (session.draftTouched) {
      set({
        departmentOperationsSession: {
          ...session,
          baseline: ops.map((o) => ({ ...o })),
          status: 'ready',
        },
      });
      return;
    }

    set({
      departmentOperationsSession: {
        deptId,
        draft: ops.map((o) => ({ ...o })),
        baseline: ops.map((o) => ({ ...o })),
        status: 'ready',
        draftTouched: false,
      },
    });
  },

  setDepartmentOperationsDraft: (operations) => {
    const session = get().departmentOperationsSession;
    if (!session) return;
    set({
      departmentOperationsSession: {
        ...session,
        draft: operations.map((o) => ({ ...o })),
        draftTouched: true,
      },
    });
  },

  promoteDepartmentOperationsSession: (newDeptId) => {
    const session = get().departmentOperationsSession;
    if (!session) return;
    set({
      departmentOperationsSession: {
        deptId: newDeptId,
        draft: session.draft.map((o) => ({ ...o, department_id: newDeptId })),
        baseline: [],
        status: 'ready',
        draftTouched: session.draftTouched,
      },
    });
  },

  clearDepartmentOperationsSession: () => {
    set({ departmentOperationsSession: null });
  },

  syncDepartmentOperations: async (deptId, factoryId) => {
    const session = get().departmentOperationsSession;
    if (!session || session.deptId !== deptId) {
      return [];
    }
    if (session.status === 'loading') {
      throw new Error('Department operations are still loading — try again in a moment');
    }

    const saved = await syncDepartmentOperationsToDb({
      factoryId,
      departmentId: deptId,
      draft: session.draft,
      baseline: session.baseline,
    });

    const snapshot = saved.map((o) => ({ ...o }));
    set((s) => ({
      catalogOperations: [
        ...s.catalogOperations.filter((o) => o.department_id !== deptId),
        ...snapshot,
      ],
      departmentOperationsSession: {
        deptId,
        draft: snapshot,
        baseline: saved.map((o) => ({ ...o })),
        status: 'ready',
        draftTouched: false,
      },
    }));

    bumpSettingsSlices(factoryId, ['operations', 'appConfiguration', 'processFlows']);
    return saved;
  },

  setDepartmentResourceDraft: (resources) => {
    const session = get().departmentResourceSession;
    if (!session) return;
    set({
      departmentResourceSession: {
        ...session,
        draft: resources.map((r) => ({ ...r })),
        draftTouched: true,
      },
    });
  },

  promoteDepartmentResourceSession: (newDeptId) => {
    const session = get().departmentResourceSession;
    if (!session) return;
    set({
      departmentResourceSession: {
        deptId: newDeptId,
        draft: session.draft.map((r) => ({ ...r, departmentId: newDeptId })),
        baseline: [],
        status: 'ready',
        draftTouched: session.draftTouched,
      },
    });
  },

  clearDepartmentResourceSession: () => {
    departmentResourceLoadSeq += 1;
    set({ departmentResourceSession: null });
  },

  syncDepartmentResources: async (deptId, factoryId, opts) => {
    const session = get().departmentResourceSession;
    if (!session || session.deptId !== deptId) {
      return [];
    }
    if (session.status === 'loading') {
      throw new Error('Department resources are still loading — try again in a moment');
    }

    const dept = get().departments.find((d) => d.id === deptId);
    const resourceType = opts?.resourceType
      ?? (dept?.planning_mode === 'outsource' ? 'outsourced' : 'inhouse');

    const saved = await syncDepartmentResourcesToDb(supabase, {
      departmentId: deptId,
      factoryId,
      draft: session.draft,
      baseline: session.baseline,
      resourceType,
    });

    const snapshot = saved.map((r) => ({ ...r }));
    set({
      departmentResourceSession: {
        deptId,
        draft: snapshot,
        baseline: saved.map((r) => ({ ...r })),
        status: 'ready',
        draftTouched: false,
      },
      catalogResourcesByDept: {
        ...get().catalogResourcesByDept,
        [deptId]: snapshot,
      },
    });

    bumpSettingsSlices(factoryId, ['catalogResources']);
    return saved;
  },

  updateFactory: async (data) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const ent = entitlementsToDbPayload(data.entitlements);
    await saveFactorySettingsRpc(factoryId, {
      name: data.name,
      code: data.code,
      country: data.country,
      timezone: data.timezone,
      defaultShiftId: data.defaultShiftId ?? null,
      transaction_apps: ent.transaction_apps,
      production_apps: ent.production_apps,
      workforce_apps: ent.workforce_apps,
      audit_apps: ent.audit_apps,
      shipment_apps: ent.shipment_apps,
    });
    set((s) => ({ factory: data, factoryEntitlements: data.entitlements }));
    bumpSettingsSlices(factoryId, ['factoryProfile']);
  },

  // --- BUYER CRUD ---
  addBuyer: async (b) => {
    const { data, error } = await supabase.rpc('save_buyer', {
      p_action: 'insert',
      p_factory_id: b.factory_id,
      p_id: b.id || null,
      p_name: b.name,
      p_code: b.code ?? null,
      p_country: b.country ?? null,
      p_type: b.type ?? 'Retail',
      p_status: b.status ?? 'Active',
      p_contact_name: b.contactName ?? null,
      p_contact_email: b.contactEmail ?? null,
      p_contact_phone: b.contactPhone ?? null,
      p_contact_role: b.contactRole ?? null,
      p_over_shipment_pct: b.overShipmentAllowance ?? 0,
      p_under_shipment_pct: b.underShipmentAllowance ?? 0,
      p_packing_rule: b.packingRule ?? 'Ratio',
      p_ship_mode: b.shipMode ?? null,
      p_destination: b.destination ?? null,
      p_currency: b.currency ?? null,
      p_ship_mode_options: b.shipModeOptions ?? [],
      p_shipment_type_options: b.shipmentTypeOptions ?? [],
      p_destination_countries: b.destinationCountries ?? [],
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No buyer returned');
    const mapped = mapBuyerFromDb(row);
    set((s) => ({ buyers: [...s.buyers, mapped] }));
    bumpSettingsSlices(b.factory_id, ['buyers']);
    return mapped.id;
  },
  updateBuyer: async (id, b) => {
    const factoryId = b.factory_id || useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const { data, error } = await supabase.rpc('save_buyer', {
      p_action: 'update',
      p_factory_id: factoryId,
      p_id: id,
      p_name: b.name ?? null,
      p_code: b.code ?? null,
      p_country: b.country ?? null,
      p_type: b.type ?? null,
      p_status: b.status ?? null,
      p_contact_name: b.contactName ?? null,
      p_contact_email: b.contactEmail ?? null,
      p_contact_phone: b.contactPhone ?? null,
      p_contact_role: b.contactRole ?? null,
      p_over_shipment_pct: b.overShipmentAllowance ?? null,
      p_under_shipment_pct: b.underShipmentAllowance ?? null,
      p_packing_rule: b.packingRule ?? null,
      p_ship_mode: b.shipMode ?? null,
      p_destination: b.destination ?? null,
      p_currency: b.currency ?? null,
      p_ship_mode_options: b.shipModeOptions ?? null,
      p_shipment_type_options: b.shipmentTypeOptions ?? null,
      p_destination_countries: b.destinationCountries ?? null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No buyer returned');
    const mapped = mapBuyerFromDb(row);
    set((s) => ({ buyers: s.buyers.map((x) => (x.id === id ? mapped : x)) }));
    bumpSettingsSlices(factoryId, ['buyers']);
  },
  deleteBuyer: async (id) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const { error } = await supabase.rpc('save_buyer', {
      p_action: 'delete',
      p_factory_id: factoryId,
      p_id: id,
    });
    if (error) throw error;
    set((s) => ({
      buyers: s.buyers.filter((x) => x.id !== id),
      sizeGroups: s.sizeGroups.map((x) => (x.buyerId === id ? { ...x, buyerId: null } : x)),
    }));
    bumpSettingsSlices(factoryId, ['buyers', 'sizeGroups']);
  },

  // --- DEPARTMENT CRUD ---
  addDepartment: async (dept, defects?, rates?) => {
    const { factoryEntitlements, departments } = get();
    const newDept = { ...dept, id: dept.id || crypto.randomUUID() };
    const role = newDept.role || 'standard';
    const composed = role === 'terminal'
      ? mergeTerminalDepartmentApps(newDept.apps, factoryEntitlements)
      : sanitizeDepartmentApps(newDept.apps, factoryEntitlements);
    const productionAppsForSave = role === 'terminal'
      ? [...TERMINAL_PRODUCTION_APPS]
      : role === 'origin' && newDept.isNative
        ? [...ORIGIN_CUTTING_APPS]
        : (newDept.productionApps ?? productionAppsFromList(composed));
    const productionPath = role === 'terminal'
      ? 'native_shipment'
      : role === 'origin' && newDept.isNative
        ? 'native_cutting'
        : productionPathFromApps(productionAppsForSave, role, newDept.isNative);
    const planningMode = planningModeForDepartment({
      role,
      planning_mode: newDept.planning_mode,
    });
    const appPayload = serializeDepartmentFlagsForDb({
      productionApps: productionAppsForSave,
      transactionEnabled: newDept.transactionEnabled ?? true,
      supervisorEnabled: newDept.supervisorEnabled ?? (
        role !== 'terminal' && supervisorAppliesToPath(productionPath)
      ),
    });
    const sequence = sequenceForNewDepartment(role, departments);

    const seedLabels = workerRolesForDepartment(newDept.workerRoles);
    const { data: factoryShifts } = await supabase.from('shifts').select('id').eq('factory_id', newDept.factory_id);
    const month = new Date();
    const effectiveMonth = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
    const workforceRates = factoryShifts?.length && role !== 'terminal'
      ? seedLabels.flatMap((label, i) =>
          factoryShifts.map((sh: Record<string, unknown>) => ({
            label,
            shift_id: sh.id,
            cost_per_hour: 0,
            effective_month: effectiveMonth,
            is_current: true,
            sort_order: i,
          })),
        )
      : null;
    const defectsPayload = defects
      ? defectsToDb(defects)
      : (planningMode === 'production' || planningMode === 'native_cutting')
        ? defaultDefectsForDepartment(newDept.name)
        : null;
    const stepType = referenceStepTypeForPlanningMode(planningMode);
    const operationsPayload = stepType
      ? [{
          name: defaultReferenceOperationName(stepType),
          step_type: stepType,
          capture_app: stepType === 'outsource' ? OUTSOURCE_CAPTURE_APP : null,
          is_active: true,
        }]
      : null;

    const { data, error } = await supabase.rpc('save_department', {
      p_action: 'insert',
      p_factory_id: newDept.factory_id,
      p_id: newDept.id,
      p_department: {
        name: newDept.name,
        role,
        is_native: newDept.isNative ?? false,
        sequence,
        planning_mode: planningMode,
        transaction_enabled: appPayload.transaction_enabled,
        supervisor_enabled: appPayload.supervisor_enabled,
      },
      p_defects: defectsPayload,
      p_workforce_rates: rates ? versionDraftsToRateRows(rates) : workforceRates,
      p_operations: operationsPayload,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No department returned');
    const deptId = row.id as string;

    const created: DepartmentEntity = {
      ...newDept,
      id: deptId,
      apps: composeDepartmentApps({
        productionApps: productionAppsForSave,
        transactionEnabled: appPayload.transaction_enabled,
        auditEnabled: true,
        supervisorEnabled: appPayload.supervisor_enabled,
      }),
      productionApps: productionAppsForSave,
      transactionEnabled: appPayload.transaction_enabled,
      auditEnabled: true,
      supervisorEnabled: appPayload.supervisor_enabled,
      sequence: (row.sequence as number) ?? sequence,
      workerRoles: seedLabels,
      role: (row.role as DepartmentEntity['role']) || role,
      planning_mode: (row.planning_mode as DepartmentEntity['planning_mode']) || planningMode,
      productionPath,
      isNative: Boolean(row.is_native),
      created_at: (row.created_at as string) || undefined,
      updated_at: (row.updated_at as string) || undefined,
    };
    set((s) => {
      const nextDefects = defectsPayload
        ? [...s.departmentDefects.filter((d) => d.department_id !== deptId), {
            id: crypto.randomUUID(),
            factory_id: newDept.factory_id,
            department_id: deptId,
            defects: defectsPayload,
          }]
        : s.departmentDefects;
      return {
        departments: sortDepartmentsForDisplay([...s.departments, created]),
        departmentDefects: nextDefects,
      };
    });
    if (operationsPayload) {
      await get().refreshCatalogOperations();
    }
    notifySettingsSaved('Department added');
    bumpSettingsSlices(newDept.factory_id, DEPARTMENT_SETTINGS_SLICES);
    return deptId;
  },
  updateDepartment: async (id, dept, defects?, rates?) => {
    const existing = get().departments.find((d) => d.id === id);
    const role = dept.role || existing?.role || 'standard';
    const composed = role === 'terminal'
      ? mergeTerminalDepartmentApps(dept.apps, get().factoryEntitlements)
      : sanitizeDepartmentApps(dept.apps, get().factoryEntitlements);
    const productionAppsForSave = role === 'terminal'
      ? [...TERMINAL_PRODUCTION_APPS]
      : role === 'origin' && (dept.isNative ?? existing?.isNative)
        ? [...ORIGIN_CUTTING_APPS]
        : (dept.productionApps ?? existing?.productionApps ?? productionAppsFromList(composed));
    const productionPath = role === 'terminal'
      ? 'native_shipment'
      : role === 'origin' && (dept.isNative ?? existing?.isNative)
        ? 'native_cutting'
        : (dept.productionPath
          ?? existing?.productionPath
          ?? productionPathFromApps(productionAppsForSave, role, dept.isNative ?? existing?.isNative));
    const planningMode = planningModeForDepartment({
      role,
      planning_mode: dept.planning_mode ?? existing?.planning_mode,
    });
    const appPayload = serializeDepartmentFlagsForDb({
      productionApps: productionAppsForSave,
      transactionEnabled: dept.transactionEnabled ?? existing?.transactionEnabled,
      supervisorEnabled: dept.supervisorEnabled ?? existing?.supervisorEnabled ?? (
        role !== 'terminal' && supervisorAppliesToPath(productionPath)
      ),
    });
    const sequence = role === 'standard'
      ? effectiveDepartmentSequence(dept)
      : sequenceForRole(role);
    const p_defects = defects ? defectsToDb(defects) : null;
    const p_workforce_rates = rates ? versionDraftsToRateRows(rates) : null;
    const { data, error } = await supabase.rpc('save_department', {
      p_action: 'update',
      p_factory_id: existing?.factory_id || useNavigationStore.getState().factoryId,
      p_id: id,
      p_department: {
        name: dept.name ?? existing?.name ?? null,
        role,
        is_native: dept.isNative ?? existing?.isNative ?? null,
        sequence,
        planning_mode: planningMode,
        transaction_enabled: appPayload.transaction_enabled,
        supervisor_enabled: role !== 'terminal' && (appPayload.supervisor_enabled === true),
      },
      p_defects,
      p_workforce_rates,
    });
    if (error) throw error;
    if (!Array.isArray(data) || !data[0]) throw new Error('No department returned');
    const fullApps = composeDepartmentApps({
      productionApps: productionAppsForSave,
      transactionEnabled: appPayload.transaction_enabled,
      auditEnabled: true,
      supervisorEnabled: appPayload.supervisor_enabled,
    });
    const factoryId = resolveFactoryId(existing?.factory_id);
    const existingDefects = get().departmentDefects.find((d) => d.department_id === id);
    set((s) => ({
      departments: sortDepartmentsForDisplay(
        s.departments.map((x) => (x.id === id ? {
          ...x,
          ...dept,
          apps: fullApps,
          productionApps: productionAppsForSave,
          transactionEnabled: appPayload.transaction_enabled,
          auditEnabled: true,
          supervisorEnabled: appPayload.supervisor_enabled,
          sequence,
          planning_mode: planningMode,
          productionPath,
        } : x)),
      ),
      departmentDefects: p_defects !== null
        ? existingDefects
          ? s.departmentDefects.map((d) =>
              d.department_id === id ? { ...d, defects: p_defects } : d,
            )
          : [...s.departmentDefects, {
              id: crypto.randomUUID(),
              factory_id: factoryId,
              department_id: id,
              defects: p_defects,
            }]
        : s.departmentDefects,
    }));
    notifySettingsSaved('Department updated');
    bumpSettingsSlices(factoryId, DEPARTMENT_SETTINGS_SLICES);
  },
  deleteDepartment: async (id) => {
    const dept = get().departments.find((d) => d.id === id);
    if (dept?.isNative) {
      throw new Error('Origin and Shipment work centers cannot be deleted.');
    }

    const { error } = await supabase.rpc('save_department', {
      p_action: 'delete',
      p_factory_id: dept?.factory_id || useNavigationStore.getState().factoryId,
      p_id: id,
    });
    if (error) throw error;
    set((s) => {
      const { [id]: _removed, ...restCatalog } = s.catalogResourcesByDept;
      return {
        departments: s.departments.filter((x) => x.id !== id),
        catalogResourcesByDept: restCatalog,
        departmentResourceSession:
          s.departmentResourceSession?.deptId === id ? null : s.departmentResourceSession,
        departmentOperationsSession:
          s.departmentOperationsSession?.deptId === id ? null : s.departmentOperationsSession,
      };
    });
    const deletedFactoryId = dept?.factory_id || useNavigationStore.getState().factoryId!;
    bumpSettingsSlices(deletedFactoryId, DEPARTMENT_SETTINGS_SLICES);
    useNotificationStore.getState().showNotification("Department deleted");
  },

  // --- SHIFT CRUD ---
  addShift: async (sh) => {
    const factoryId = sh.factory_id || useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const { data, error } = await supabase.rpc('save_shift', {
      p_action: 'insert',
      p_factory_id: factoryId,
      p_id: null,
      p_name: sh.name,
      p_type: sh.type || 'Regular',
      p_start_time: sh.startTime ?? null,
      p_end_time: sh.endTime ?? null,
      p_break_start: sh.breakStart ?? null,
      p_break_end: sh.breakEnd ?? null,
      p_hours: sh.hours || [],
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No shift returned');
    const newShift: Shift = {
      id: row.id,
      factory_id: row.factory_id,
      name: row.name,
      type: row.type,
      startTime: row.start_time,
      endTime: row.end_time,
      breakStart: row.break_start,
      breakEnd: row.break_end,
      hours: row.hours || [],
    };
    set((s) => ({ shifts: [...s.shifts, newShift] }));
    bumpSettingsSlices(factoryId, ['shifts']);
    useNotificationStore.getState().showNotification("Shift added");
  },
  updateShift: async (id, sh) => {
    const factoryId = sh.factory_id || useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const { data, error } = await supabase.rpc('save_shift', {
      p_action: 'update',
      p_factory_id: factoryId,
      p_id: id,
      p_name: sh.name ?? null,
      p_type: sh.type || 'Regular',
      p_start_time: sh.startTime ?? null,
      p_end_time: sh.endTime ?? null,
      p_break_start: sh.breakStart ?? null,
      p_break_end: sh.breakEnd ?? null,
      p_hours: sh.hours || [],
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No shift returned');
    const updated: Shift = {
      id: row.id,
      factory_id: row.factory_id,
      name: row.name,
      type: row.type,
      startTime: row.start_time,
      endTime: row.end_time,
      breakStart: row.break_start,
      breakEnd: row.break_end,
      hours: row.hours || [],
    };
    set((s) => ({ shifts: s.shifts.map((x) => (x.id === id ? updated : x)) }));
    bumpSettingsSlices(factoryId, ['shifts']);
    useNotificationStore.getState().showNotification("Shift updated");
  },
  deleteShift: async (id) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const { error } = await supabase.rpc('save_shift', {
      p_action: 'delete',
      p_factory_id: factoryId,
      p_id: id,
    });
    if (error) throw error;
    set((s) => ({ shifts: s.shifts.filter((x) => x.id !== id) }));
    bumpSettingsSlices(factoryId, ['shifts']);
    useNotificationStore.getState().showNotification("Shift deleted");
  },

  // --- PROCESS FLOW CRUD ---
  addProcessFlow: async (f) => {
    const factory_id = f.factory_id || useNavigationStore.getState().factoryId;
    if (!factory_id) throw new Error('Factory not selected');

    const flowId = f.id || crypto.randomUUID();
    const flow: ProcessFlow = {
      ...(f as ProcessFlow),
      id: flowId,
      factory_id,
      name: f.name,
      steps: f.steps ?? [],
    };

    const { data, error } = await supabase.rpc('save_process_flow', {
      p_action: 'insert',
      p_factory_id: factory_id,
      p_id: flowId,
      p_name: flow.name,
      p_description: flow.description?.trim() || null,
      p_steps: processFlowToDbRow(flow).steps,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No process flow returned');
    const mapped = mapProcessFlowFromDbInline(
      row as Record<string, unknown>,
      get().catalogOperations,
      get().departments,
    );
    set((s) => ({ processFlows: [...s.processFlows, mapped] }));
    bumpSettingsSlices(factory_id, ['processFlows']);
    useNotificationStore.getState().showNotification('Process flow created');
    return mapped.id;
  },
  versionCurrentProcessFlow: async (oldId, newFlow) => {
    const { data, error } = await supabase.rpc('save_process_flow', {
      p_action: 'version',
      p_factory_id: newFlow.factory_id,
      p_old_id: oldId,
      p_id: newFlow.id,
      p_name: newFlow.name,
      p_description: newFlow.description?.trim() || null,
      p_steps: processFlowToDbRow(newFlow).steps,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No process flow returned');
    const mapped = mapProcessFlowFromDbInline(
      row as Record<string, unknown>,
      get().catalogOperations,
      get().departments,
    );
    set((s) => ({ processFlows: [...s.processFlows.filter((x) => x.id !== oldId), mapped] }));
    bumpSettingsSlices(newFlow.factory_id, ['processFlows']);
  },
  updateProcessFlow: async (id, f) => {
    const factory_id = f.factory_id || useNavigationStore.getState().factoryId;
    if (!factory_id) throw new Error('Factory not selected');
    const { data, error } = await supabase.rpc('save_process_flow', {
      p_action: 'update',
      p_factory_id: factory_id,
      p_id: id,
      p_name: f.name ?? null,
      p_description: f.description?.trim() ?? null,
      p_steps: f.steps !== undefined ? processFlowUpdatePayload(f).steps : null,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No process flow returned');
    const mapped = mapProcessFlowFromDbInline(
      row as Record<string, unknown>,
      get().catalogOperations,
      get().departments,
    );
    set((s) => ({ processFlows: s.processFlows.map((x) => (x.id === id ? mapped : x)) }));
    bumpSettingsSlices(factory_id, ['processFlows']);
    useNotificationStore.getState().showNotification('Process flow updated');
  },
  deleteProcessFlow: async (id) => {
    const factory_id = useNavigationStore.getState().factoryId;
    if (!factory_id) throw new Error('Factory not selected');
    const { error } = await supabase.rpc('save_process_flow', {
      p_action: 'delete',
      p_factory_id: factory_id,
      p_id: id,
    });
    if (error) throw error;
    set((s) => ({ processFlows: s.processFlows.filter((x) => x.id !== id) }));
    bumpSettingsSlices(factory_id, ['processFlows']);
    useNotificationStore.getState().showNotification('Process flow deleted');
  },

  // --- SUPPORT DROPDOWNS CRUD ---
  addSupportDropdown: async (sd) => {
    const data = await saveSupportDropdownRpc('insert', sd.factory_id, {
      id: sd.id,
      category: sd.category,
      app_name: sd.app_name ?? null,
      values: sd.values || [],
    });
    if (data) {
      set((s) => ({
        supportDropdowns: [
          ...s.supportDropdowns,
          { ...data, values: data.values || [], app_name: data.app_name || null },
        ],
      }));
      bumpSettingsSlices(sd.factory_id, ['supportDropdowns']);
    }
    useNotificationStore.getState().showNotification("Dropdown created");
  },
  updateSupportDropdown: async (id, sd) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('Factory not selected');
    const existing = get().supportDropdowns.find((x) => x.id === id);
    await saveSupportDropdownRpc('update', factoryId, {
      id,
      category: sd.category ?? existing?.category ?? '',
      app_name: sd.app_name ?? existing?.app_name ?? null,
      values: sd.values ?? existing?.values ?? [],
    });
    set((s) => ({
      supportDropdowns: s.supportDropdowns.map((x) =>
        x.id === id ? { ...x, values: sd.values || [], app_name: sd.app_name || null } : x,
      ),
    }));
    bumpSettingsSlices(factoryId, ['supportDropdowns']);
    useNotificationStore.getState().showNotification("Dropdown updated");
  },
  deleteSupportDropdown: async (id) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('Factory not selected');
    await saveSupportDropdownRpc('delete', factoryId, { id, category: '', values: [] });
    set((s) => ({ supportDropdowns: s.supportDropdowns.filter((x) => x.id !== id) }));
    bumpSettingsSlices(factoryId, ['supportDropdowns']);
    useNotificationStore.getState().showNotification("Dropdown deleted");
  },

  // --- RACK CRUD (local only — no DB table yet) ---
  addRack: async (rack) => {
    set((s) => ({ racks: [...s.racks, rack] }));
    useNotificationStore.getState().showNotification("Rack added");
  },
  deleteRack: async (id) => {
    set((s) => ({ racks: s.racks.filter((x) => x.id !== id) }));
    useNotificationStore.getState().showNotification("Rack deleted");
  },

  // --- SIZE GROUP CRUD ---
  addSizeGroup: async (g) => {
    const factoryId = g.factory_id || useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const { data, error } = await supabase.rpc('save_size_group', {
      p_action: 'insert',
      p_factory_id: factoryId,
      p_id: g.id || null,
      p_name: g.name,
      p_buyer_id: g.buyerId || null,
      p_sizes: normalizeSizes(g.sizes),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No size group returned');
    const mapped = mapSizeGroupFromDb(row);
    set((s) => ({ sizeGroups: [...s.sizeGroups, mapped] }));
    bumpSettingsSlices(factoryId, ['sizeGroups']);
  },
  updateSizeGroup: async (id, g) => {
    const factoryId = g.factory_id || useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const { data, error } = await supabase.rpc('save_size_group', {
      p_action: 'update',
      p_factory_id: factoryId,
      p_id: id,
      p_name: g.name,
      p_buyer_id: g.buyerId ?? null,
      p_sizes: normalizeSizes(g.sizes),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('No size group returned');
    const mapped = mapSizeGroupFromDb(row);
    set((s) => ({ sizeGroups: s.sizeGroups.map((x) => (x.id === id ? mapped : x)) }));
    bumpSettingsSlices(factoryId, ['sizeGroups']);
  },
  deleteSizeGroup: async (id) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) throw new Error('No factory selected');
    const { error } = await supabase.rpc('save_size_group', {
      p_action: 'delete',
      p_factory_id: factoryId,
      p_id: id,
    });
    if (error) throw error;
    set((s) => ({ sizeGroups: s.sizeGroups.filter((x) => x.id !== id) }));
    bumpSettingsSlices(factoryId, ['sizeGroups']);
  },

  getDepartmentDefects: (departmentId) => {
    const record = get().departmentDefects.find((d) => d.department_id === departmentId);
    return record?.defects ?? [];
  },

  ensureDepartmentDefects: async (departmentId, departmentName) => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return false;

    const existing = get().departmentDefects.find((d) => d.department_id === departmentId);
    if (existing) return true;

    const seeded = defaultDefectsForDepartment(departmentName);
    const { data, error } = await supabase.rpc('ensure_department_defects', {
      p_factory_id: factoryId,
      p_department_id: departmentId,
      p_default_defects: defectsToDb(seeded),
    });

    if (error) {
      if (String(error.message).toLowerCase().includes('not authorized')) return false;
      throw error;
    }

    if (data) {
      let mapped: DepartmentDefectRecord;
      if (Array.isArray(data)) {
        mapped = {
          id: crypto.randomUUID(),
          factory_id: factoryId,
          department_id: departmentId,
          defects: parseDefectsJson(data),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        mapped = mapDepartmentDefectFromDb(data as Record<string, unknown>);
      }
      set((s) => ({
        departmentDefects: s.departmentDefects.some((d) => d.department_id === departmentId)
          ? s.departmentDefects.map((d) => (d.department_id === departmentId ? mapped : d))
          : [...s.departmentDefects, mapped],
      }));
      bumpSettingsSlices(factoryId, ['defects']);
    }

    return true;
  },

  getOperationsForDepartment: (departmentId) => {
    return get().catalogOperations.filter((op) => op.department_id === departmentId);
  },

  refreshCatalogOperations: async () => {
    const factoryId = useNavigationStore.getState().factoryId;
    if (!factoryId) return;
    const [{ data }, appConfiguration] = await Promise.all([
      supabase
        .from('operations')
        .select('*')
        .eq('factory_id', factoryId)
        .eq('is_active', true)
        .order('department_id')
        .order('name'),
      fetchAppConfiguration(factoryId),
    ]);
    const catalogOperations: OperationRow[] = (data || []).map((row) => ({
      id: row.id as string,
      factory_id: row.factory_id as string,
      department_id: row.department_id as string,
      name: row.name as string,
      step_type: (row.step_type as OperationStepType) || 'produce',
      capture_app: (row.capture_app as string) || null,
      is_active: row.is_active !== false,
    }));
    set({ catalogOperations, appConfiguration });
    bumpSettingsSlices(factoryId, ['operations', 'appConfiguration', 'processFlows']);
  },

  loadFabricComponents: async (factoryId, originDepartmentId) =>
    get().ensureFabricComponentsForOrigin(factoryId, originDepartmentId),

  ensureFabricComponentsForOrigin: async (factoryId, originDepartmentId) => {
    if (!factoryId || !originDepartmentId) return [];
    await ensureFactoryFabricComponents(factoryId, originDepartmentId);
    const { fabricComponents, settingsFactoryId, loading } = get();
    if (
      !loading
      && settingsFactoryId === factoryId
      && fabricComponents.length > 0
      && fabricComponents.every((c) => c.factory_id === factoryId)
    ) {
      return fabricComponents;
    }
    const loaded = await fetchFabricComponentsForFactory(factoryId);
    set({ fabricComponents: loaded });
    return loaded;
  },

  saveFabricComponents: async (factoryId, originDepartmentId, draft, baseline) => {
    const base = baseline ?? get().fabricComponents;
    const saved = await saveFabricComponentsForFactory(
      factoryId,
      originDepartmentId,
      draft,
      base,
    );
    set({ fabricComponents: saved });
    bumpSettingsSlices(factoryId, ['fabricComponents']);
    notifySettingsSaved('Fabric categories saved');
    return saved;
  },

}));
