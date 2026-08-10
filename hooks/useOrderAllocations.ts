import { useQuery } from '@tanstack/react-query';
import type { LineAllocation } from '../types';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { mapAllocationRow } from '../lib/allocationRowMap';

/** Line allocations for one order — Style Details / Color Details without full factory hydrate. */
export function useOrderAllocations(
  factoryId: string | null | undefined,
  orderId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [...queryKeys.orderDetail(factoryId ?? '', orderId ?? ''), 'allocations'] as const,
    queryFn: async (): Promise<LineAllocation[]> => {
      const { data, error } = await supabase
        .from('line_allocations')
        .select('*')
        .eq('factory_id', factoryId!)
        .eq('order_id', orderId!);
      if (error) throw error;
      return (data ?? []).map((row) => mapAllocationRow(row as Record<string, unknown>));
    },
    enabled: Boolean(factoryId && orderId && enabled),
    staleTime: 60 * 1000,
  });
}
