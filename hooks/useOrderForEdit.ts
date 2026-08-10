import { useQuery } from '@tanstack/react-query';
import type { StyleOrder } from '../types';
import { reloadOrderFromDb } from '../lib/reloadOrderFromDb';
import { queryKeys } from '../lib/queryKeys';

/** Single-order load for edit/report/detail routes — TanStack Query only. */
export function useOrderForEdit(
  factoryId: string | null | undefined,
  editOrderId: string | null | undefined,
) {
  const query = useQuery<StyleOrder | null>({
    queryKey: [...queryKeys.orderDetail(factoryId ?? '', editOrderId ?? ''), 'edit'] as const,
    queryFn: () => reloadOrderFromDb(factoryId!, editOrderId!),
    enabled: Boolean(factoryId && editOrderId),
    staleTime: 60 * 1000,
  });

  return {
    order: query.data ?? null,
    loading: Boolean(editOrderId) && query.isLoading && !query.data,
    error: query.error,
  };
}
