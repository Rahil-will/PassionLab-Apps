import { useQuery, useQueryClient, useIsFetching } from '@tanstack/react-query';
import type { SettingsScope } from '../factoryBootstrap';
import { queryKeys } from '../queryKeys';
import { prefetchSettingsScope } from './settingsSlices';

/**
 * Route-aware settings bootstrap — loads only slices needed for the route scope.
 * Each master table is a separate TanStack Query; Zustand syncs for mutation editors.
 */
export function useSettingsBootstrap(
  factoryId: string | null | undefined,
  enabled = true,
  scope: SettingsScope = 'core',
) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: [...queryKeys.settings(factoryId ?? ''), scope] as const,
    queryFn: async () => {
      await prefetchSettingsScope(queryClient, factoryId!, scope);
      return scope;
    },
    enabled: Boolean(factoryId && enabled),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

/** True while any settings scope query is in flight for this factory. */
export function useSettingsLoading(factoryId: string | null | undefined): boolean {
  return useIsFetching({ queryKey: queryKeys.settings(factoryId ?? '') }) > 0;
}

/** True only while a specific settings scope has never loaded and is currently fetching. */
export function useSettingsScopeLoading(
  factoryId: string | null | undefined,
  scope: SettingsScope,
): boolean {
  const queryClient = useQueryClient();
  const key = [...queryKeys.settings(factoryId ?? ''), scope] as const;
  const state = queryClient.getQueryState(key);
  const fetching = useIsFetching({ queryKey: key }) > 0;
  return fetching && state?.status !== 'success';
}

/** Force settings reload for a scope (e.g. after Work Centers save). */
export function useRefreshSettings(factoryId: string | null | undefined) {
  const queryClient = useQueryClient();

  return async (scope: SettingsScope = 'full') => {
    if (!factoryId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings(factoryId) });
    await prefetchSettingsScope(queryClient, factoryId, scope);
  };
}
