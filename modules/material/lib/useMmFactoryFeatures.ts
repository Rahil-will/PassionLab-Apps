import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore } from '../../../stores/navigationStore';

export type MmFeatureMap = Record<string, boolean>;

export function useMmFactoryFeatures(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmFactoryFeatures(factoryId ?? ''),
    queryFn: async (): Promise<MmFeatureMap> => {
      const { data, error } = await supabase
        .from('mm_factory_features')
        .select('feature_key, enabled')
        .eq('factory_id', factoryId!);
      if (error) throw error;
      const map: MmFeatureMap = {};
      for (const row of data ?? []) {
        map[String(row.feature_key)] = Boolean(row.enabled);
      }
      return map;
    },
    enabled: Boolean(factoryId && enabled),
    staleTime: 30_000,
  });
}
