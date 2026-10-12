import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigationStore } from '../../../stores/navigationStore';
import { queryKeys } from '../../../lib/queryKeys';
import {
  mmDefaultWarehouse,
  mmGetV4Config,
  mmListPartners,
  mmListProcesses,
  type MmPartnerKind,
  type MmPartnerRow,
  type MmProcessRow,
  type MmV4Config,
} from './mmV4Rpc';

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

export function useMmPartners(kind: MmPartnerKind, includeInactive = false, enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'partners', kind, includeInactive] as const,
    queryFn: async (): Promise<MmPartnerRow[]> => {
      const res = await mmListPartners(kind, includeInactive);
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && enabled),
  });
}

export function useMmProcesses(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'processes'] as const,
    queryFn: async (): Promise<MmProcessRow[]> => {
      const res = await mmListProcesses();
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && enabled),
  });
}

export function useMmDefaultWarehouse(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'defaultWarehouse'] as const,
    queryFn: async () => {
      const res = await mmDefaultWarehouse();
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && enabled),
  });
}
