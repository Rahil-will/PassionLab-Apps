import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigationStore } from '../../../stores/navigationStore';
import { queryKeys } from '../../../lib/queryKeys';
import { mmGetV4Config, type MmV4Config } from './mmV4Rpc';

export function useMmV4Config(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmV4Config(factoryId ?? ''),
    queryFn: async (): Promise<MmV4Config> => {
      const res = await mmGetV4Config();
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && enabled),
    staleTime: 30_000,
  });
}

export function useRefreshMmV4Config() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const qc = useQueryClient();
  return async () => {
    if (!factoryId) return;
    await qc.invalidateQueries({ queryKey: queryKeys.mmV4Config(factoryId) });
  };
}

/** Route-level / page gate: fabric_v4 feature flag from live config. */
export function useFabricV4Enabled(enabled = true): boolean {
  const { data } = useMmV4Config(enabled);
  return data?.fabric_v4 === true;
}
