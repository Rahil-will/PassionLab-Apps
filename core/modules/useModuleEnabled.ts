import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { queryKeys } from '../../lib/queryKeys';
import { useNavigationStore } from '../../stores/navigationStore';
import type { ModuleKey } from './types';

export interface FactoryModuleRow {
  module_key: ModuleKey;
  enabled: boolean;
  enabled_at: string | null;
  config: Record<string, unknown>;
}

async function fetchFactoryModules(factoryId: string): Promise<FactoryModuleRow[]> {
  const { data, error } = await supabase
    .from('factory_modules')
    .select('module_key, enabled, enabled_at, config')
    .eq('factory_id', factoryId);

  if (error) throw error;
  return (data ?? []) as FactoryModuleRow[];
}

export function useFactoryModules() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.factoryModules(factoryId ?? ''),
    queryFn: () => fetchFactoryModules(factoryId!),
    enabled: Boolean(factoryId),
    staleTime: 60_000,
  });
}

export function useModuleEnabled(key: ModuleKey): boolean {
  const { data } = useFactoryModules();
  const row = data?.find((m) => m.module_key === key);
  return Boolean(row?.enabled);
}

export function useModuleConfig(key: ModuleKey): Record<string, unknown> {
  const { data } = useFactoryModules();
  const row = data?.find((m) => m.module_key === key);
  return (row?.config ?? {}) as Record<string, unknown>;
}
