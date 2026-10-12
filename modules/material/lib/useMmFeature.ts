import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore } from '../../../stores/navigationStore';
import {
  mmGetMaterialFeatures,
  type MmMaterialFeatureKey,
  type MmMaterialFeatures,
} from './mmRpc';

export function useMmMaterialFeatures(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmMaterialFeatures(factoryId ?? ''),
    queryFn: async (): Promise<MmMaterialFeatures> => {
      const res = await mmGetMaterialFeatures();
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && enabled),
    staleTime: 30_000,
  });
}

/** True only after the feature RPC has loaded and the switch is on. */
export function useMmFeature(key: MmMaterialFeatureKey, enabled = true): boolean {
  const { data } = useMmMaterialFeatures(enabled);
  return data?.[key] === true;
}
