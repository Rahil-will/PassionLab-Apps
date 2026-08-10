import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { SettingsScope } from '../factoryBootstrap';
import { queryKeys } from '../queryKeys';
import {
  fetchBuyersTable,
  fetchDepartmentsTable,
  fetchShiftsTable,
  fetchProcessFlowsTable,
  fetchSizeGroupsTable,
  fetchSupportDropdownsTable,
  fetchDefectsTable,
  fetchOperationsTable,
  fetchFactoryProfileTable,
  fetchFabricComponentsTable,
  fetchAppConfigurationTable,
  fetchSettingsSlice,
  settingsSliceQueryKey,
  SETTINGS_SLICES_BY_SCOPE,
  type SettingsTableSlice,
} from '../settingsTableFetchers';
import { useSettingsStore } from '../../stores/settingsStore';
import type { DepartmentEntity } from '../../types/settings';

const SLICE_STALE_MS = 5 * 60 * 1000;

function useSettingsSliceQuery<T>(
  factoryId: string | null | undefined,
  slice: SettingsTableSlice,
  queryFn: () => Promise<T>,
  enabled = true,
) {
  return useQuery({
    queryKey: settingsSliceQueryKey(factoryId ?? '', slice),
    queryFn,
    enabled: Boolean(factoryId && enabled),
    staleTime: SLICE_STALE_MS,
    placeholderData: (prev) => prev,
  });
}

/** Sync loaded slice into Zustand for mutation editors. */
export function syncSettingsSliceToStore(
  slice: SettingsTableSlice,
  data: unknown,
  factoryId: string,
  scope?: SettingsScope,
): void {
  const store = useSettingsStore.getState();
  switch (slice) {
    case 'buyers':
      useSettingsStore.setState({ buyers: data as typeof store.buyers, settingsFactoryId: factoryId });
      break;
    case 'departments':
      useSettingsStore.setState({
        departments: data as typeof store.departments,
        settingsFactoryId: factoryId,
      });
      break;
    case 'shifts':
      useSettingsStore.setState({ shifts: data as typeof store.shifts, settingsFactoryId: factoryId });
      break;
    case 'processFlows':
      useSettingsStore.setState({
        processFlows: data as typeof store.processFlows,
        settingsFactoryId: factoryId,
      });
      break;
    case 'sizeGroups':
      useSettingsStore.setState({
        sizeGroups: data as typeof store.sizeGroups,
        settingsFactoryId: factoryId,
      });
      break;
    case 'supportDropdowns':
      useSettingsStore.setState({
        supportDropdowns: data as typeof store.supportDropdowns,
        settingsFactoryId: factoryId,
      });
      break;
    case 'defects':
      useSettingsStore.setState({
        departmentDefects: data as typeof store.departmentDefects,
        settingsFactoryId: factoryId,
      });
      break;
    case 'fabricComponents':
      useSettingsStore.setState({
        fabricComponents: data as typeof store.fabricComponents,
        settingsFactoryId: factoryId,
      });
      break;
    case 'operations':
      useSettingsStore.setState({
        catalogOperations: data as typeof store.catalogOperations,
        settingsFactoryId: factoryId,
      });
      break;
    case 'factoryProfile': {
      const profile = data as Awaited<
        ReturnType<typeof import('../settingsTableFetchers').fetchFactoryProfileTable>
      >;
      useSettingsStore.setState({
        factory: profile.factory,
        factoryEntitlements: profile.entitlements,
        settingsFactoryId: factoryId,
      });
      break;
    }
    case 'workforceRates':
      useSettingsStore.setState({
        departmentWorkforceByDept: data as typeof store.departmentWorkforceByDept,
        settingsFactoryId: factoryId,
      });
      break;
    case 'appConfiguration':
      useSettingsStore.setState({
        appConfiguration: data as typeof store.appConfiguration,
        settingsFactoryId: factoryId,
      });
      break;
    case 'catalogResources':
      useSettingsStore.setState({
        catalogResourcesByDept: data as typeof store.catalogResourcesByDept,
        settingsFactoryId: factoryId,
      });
      break;
    default:
      break;
  }
  if (scope) {
    useSettingsStore.setState({ settingsScopeLoaded: scope });
  }
}

/** Refresh department editor drafts after catalog slices reload (replaces fetchSettings session sync). */
export function refreshEditorSessionsAfterCatalogLoad(): void {
  const state = useSettingsStore.getState();
  const { catalogOperations, catalogResourcesByDept, departments } = state;

  const opSession = state.departmentOperationsSession;
  if (opSession?.deptId && !opSession.deptId.startsWith('temp_') && !opSession.draftTouched) {
    const ops = catalogOperations
      .filter((o) => o.department_id === opSession.deptId)
      .map((o) => ({ ...o }));
    useSettingsStore.setState({
      departmentOperationsSession: {
        deptId: opSession.deptId,
        draft: ops,
        baseline: ops.map((o) => ({ ...o })),
        status: 'ready',
        draftTouched: false,
      },
    });
  }

  const resSession = state.departmentResourceSession;
  if (resSession?.deptId && !resSession.deptId.startsWith('temp_') && !resSession.draftTouched) {
    const deptName = departments.find((d) => d.id === resSession.deptId)?.name ?? '';
    const resources = (catalogResourcesByDept[resSession.deptId] ?? []).map((r) => ({
      ...r,
      departmentName: deptName || r.departmentName,
    }));
    useSettingsStore.setState({
      departmentResourceSession: {
        deptId: resSession.deptId,
        draft: resources.map((r) => ({ ...r })),
        baseline: resources.map((r) => ({ ...r })),
        status: 'ready',
        draftTouched: false,
      },
    });
  }
}

export async function prefetchSettingsScope(
  queryClient: ReturnType<typeof useQueryClient>,
  factoryId: string,
  scope: SettingsScope,
): Promise<void> {
  useSettingsStore.setState({ loading: true });
  const slices = [...SETTINGS_SLICES_BY_SCOPE[scope]];
  let departments: DepartmentEntity[] | undefined;
  if (slices.includes('catalogResources')) {
    departments = await queryClient.fetchQuery({
      queryKey: settingsSliceQueryKey(factoryId, 'departments'),
      queryFn: () => fetchDepartmentsTable(factoryId),
      staleTime: SLICE_STALE_MS,
    });
  }
  await Promise.all(
    slices.map(async (slice) => {
      const data = await queryClient.fetchQuery({
        queryKey: settingsSliceQueryKey(factoryId, slice),
        queryFn: () => fetchSettingsSlice(factoryId, slice, { departments }),
        staleTime: SLICE_STALE_MS,
      });
      syncSettingsSliceToStore(slice, data, factoryId);
    }),
  );
  useSettingsStore.setState({
    loading: false,
    settingsFactoryId: factoryId,
    settingsScopeLoaded: scope,
  });
  refreshEditorSessionsAfterCatalogLoad();
}

export function useBuyersQuery(factoryId: string | null | undefined, enabled = true) {
  return useSettingsSliceQuery(factoryId, 'buyers', () => fetchBuyersTable(factoryId!), enabled);
}

export function useDepartmentsQuery(factoryId: string | null | undefined, enabled = true) {
  return useSettingsSliceQuery(
    factoryId,
    'departments',
    () => fetchDepartmentsTable(factoryId!),
    enabled,
  );
}

export function useShiftsQuery(factoryId: string | null | undefined, enabled = true) {
  return useSettingsSliceQuery(factoryId, 'shifts', () => fetchShiftsTable(factoryId!), enabled);
}

export function useProcessFlowsQuery(factoryId: string | null | undefined, enabled = true) {
  return useSettingsSliceQuery(
    factoryId,
    'processFlows',
    () => fetchProcessFlowsTable(factoryId!),
    enabled,
  );
}

export function useBuyersCatalog(
  factoryId: string | null | undefined,
  _scope: SettingsScope = 'core',
) {
  const query = useBuyersQuery(factoryId, Boolean(factoryId));
  return {
    buyers: query.data ?? useSettingsStore.getState().buyers,
    loading: query.isLoading && !query.data,
    ready: Boolean(query.data),
  };
}

export function useDepartmentsCatalog(
  factoryId: string | null | undefined,
  _scope: SettingsScope = 'core',
) {
  const query = useDepartmentsQuery(factoryId, Boolean(factoryId));
  return {
    departments: query.data ?? useSettingsStore.getState().departments,
    loading: query.isLoading && !query.data,
    ready: Boolean(query.data),
  };
}

export function useShiftsCatalog(
  factoryId: string | null | undefined,
  _scope: SettingsScope = 'core',
) {
  const query = useShiftsQuery(factoryId, Boolean(factoryId));
  return {
    shifts: query.data ?? useSettingsStore.getState().shifts,
    loading: query.isLoading && !query.data,
  };
}

export function useProcessFlowsCatalog(factoryId: string | null | undefined) {
  const query = useProcessFlowsQuery(factoryId, Boolean(factoryId));
  return {
    processFlows: query.data ?? useSettingsStore.getState().processFlows,
    loading: query.isLoading && !query.data,
    scopeLoaded: Boolean(query.data),
  };
}

export function useOrderFormSettings(factoryId: string | null | undefined) {
  const buyers = useBuyersQuery(factoryId, Boolean(factoryId));
  const departments = useDepartmentsQuery(factoryId, Boolean(factoryId));
  const shifts = useShiftsQuery(factoryId, Boolean(factoryId));
  const sizeGroups = useSettingsSliceQuery(
    factoryId,
    'sizeGroups',
    () => fetchSizeGroupsTable(factoryId!),
    Boolean(factoryId),
  );
  const supportDropdowns = useSettingsSliceQuery(
    factoryId,
    'supportDropdowns',
    () => fetchSupportDropdownsTable(factoryId!),
    Boolean(factoryId),
  );
  const store = useSettingsStore();
  return {
    buyers: buyers.data ?? store.buyers,
    sizeGroups: sizeGroups.data ?? store.sizeGroups,
    supportDropdowns: supportDropdowns.data ?? store.supportDropdowns,
    departments: departments.data ?? store.departments,
    shifts: shifts.data ?? store.shifts,
    loading:
      buyers.isLoading
      || departments.isLoading
      || shifts.isLoading
      || sizeGroups.isLoading
      || supportDropdowns.isLoading,
  };
}

export function useSupportDropdownsCatalog(factoryId: string | null | undefined) {
  const query = useSettingsSliceQuery(
    factoryId,
    'supportDropdowns',
    () => fetchSupportDropdownsTable(factoryId!),
    Boolean(factoryId),
  );
  return {
    supportDropdowns: query.data ?? useSettingsStore.getState().supportDropdowns,
    loading: query.isLoading && !query.data,
  };
}

export function useSizeGroupsCatalog(factoryId: string | null | undefined) {
  const query = useSettingsSliceQuery(
    factoryId,
    'sizeGroups',
    () => fetchSizeGroupsTable(factoryId!),
    Boolean(factoryId),
  );
  return {
    sizeGroups: query.data ?? useSettingsStore.getState().sizeGroups,
    loading: query.isLoading && !query.data,
  };
}

export function useFactoryProfileCatalog(factoryId: string | null | undefined) {
  const query = useSettingsSliceQuery(
    factoryId,
    'factoryProfile',
    () => fetchFactoryProfileTable(factoryId!),
    Boolean(factoryId),
  );
  const profile = query.data;
  const store = useSettingsStore.getState();
  return {
    factory: profile?.factory ?? store.factory,
    factoryEntitlements: profile?.entitlements ?? store.factoryEntitlements,
    loading: query.isLoading && !profile,
  };
}

export function useCatalogOperations(factoryId: string | null | undefined) {
  const query = useSettingsSliceQuery(
    factoryId,
    'operations',
    () => fetchOperationsTable(factoryId!),
    Boolean(factoryId),
  );
  return {
    catalogOperations: query.data ?? useSettingsStore.getState().catalogOperations,
    loading: query.isLoading && !query.data,
  };
}

export function useDepartmentDefectsCatalog(factoryId: string | null | undefined) {
  const query = useSettingsSliceQuery(
    factoryId,
    'defects',
    () => fetchDefectsTable(factoryId!),
    Boolean(factoryId),
  );
  return {
    departmentDefects: query.data ?? useSettingsStore.getState().departmentDefects,
    loading: query.isLoading && !query.data,
  };
}

export function useFabricComponentsCatalog(factoryId: string | null | undefined) {
  const query = useSettingsSliceQuery(
    factoryId,
    'fabricComponents',
    () => fetchFabricComponentsTable(factoryId!),
    Boolean(factoryId),
  );
  return {
    fabricComponents: query.data ?? useSettingsStore.getState().fabricComponents,
    loading: query.isLoading && !query.data,
  };
}

export function useAppConfigurationCatalog(factoryId: string | null | undefined) {
  const query = useSettingsSliceQuery(
    factoryId,
    'appConfiguration',
    () => fetchAppConfigurationTable(factoryId!),
    Boolean(factoryId),
  );
  return {
    appConfiguration: query.data ?? useSettingsStore.getState().appConfiguration,
    loading: query.isLoading && !query.data,
  };
}

export async function invalidateSettingsSlices(
  queryClient: QueryClient,
  factoryId: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.settings(factoryId) });
}

/** Refetch one settings slice into the Query cache (use after saves instead of Zustand getState). */
export async function refetchSettingsCatalogSlice<T>(
  queryClient: QueryClient,
  factoryId: string,
  slice: SettingsTableSlice,
  context?: { departments?: DepartmentEntity[] },
): Promise<T> {
  return queryClient.fetchQuery({
    queryKey: settingsSliceQueryKey(factoryId, slice),
    queryFn: () => fetchSettingsSlice(factoryId, slice, context) as Promise<T>,
  });
}
