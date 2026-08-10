import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { ensureAssignedResources, fetchAssignedResources } from '../lib/queries/resources';
import type { AssignedResource } from '../types';

export { fetchAssignedResources, ensureAssignedResources };

/** Shared factory resource catalog — one network fetch per factory via Query cache. */
export function useAssignedResources(factoryId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.resources(factoryId ?? ''),
    queryFn: async (): Promise<AssignedResource[]> => {
      const { mapped } = await ensureAssignedResources(factoryId!);
      return mapped;
    },
    enabled: Boolean(factoryId),
    staleTime: 5 * 60 * 1000,
  });
}
