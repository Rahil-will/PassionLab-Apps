import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigationStore } from '../../../stores/navigationStore';
import { queryKeys } from '../../../lib/queryKeys';
import { mmGetConfigBundle, type MmConfigBundle } from './mmRpc';

function mmConfigKey(factoryId: string) {
  if (typeof queryKeys.mmConfigBundle === 'function') {
    return queryKeys.mmConfigBundle(factoryId);
  }
  return ['mm', factoryId, 'configBundle'] as const;
}

export function useMmConfigBundle(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: mmConfigKey(factoryId ?? ''),
    queryFn: async (): Promise<MmConfigBundle> => {
      const res = await mmGetConfigBundle();
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && enabled),
    staleTime: 30_000,
  });
}

export function useRefreshMmConfig() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const qc = useQueryClient();
  return async () => {
    if (!factoryId) return;
    await Promise.all([
      qc.invalidateQueries({ queryKey: mmConfigKey(factoryId) }),
      qc.invalidateQueries({ queryKey: queryKeys.mmRequirementCatalog(factoryId) }),
    ]);
  };
}
