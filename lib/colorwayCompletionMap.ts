import { useQuery } from '@tanstack/react-query';
import type { ColorwayCompletionStatus } from '../types';
import { supabase } from './supabase';
import { queryKeys } from './queryKeys';

export interface ColorwayCompletionEntry {
  status: ColorwayCompletionStatus;
  closeReason?: string | null;
}

export type ColorwayCompletionMap = Map<string, ColorwayCompletionEntry>;

export function colorwayCompletionKey(orderId: string, colorwayId: string): string {
  return `${orderId}:${colorwayId}`;
}

export async function fetchColorwayCompletionMap(
  factoryId: string,
  orderIds: string[],
): Promise<ColorwayCompletionMap> {
  const map: ColorwayCompletionMap = new Map();
  if (orderIds.length === 0) return map;

  const uniqueIds = [...new Set(orderIds)];
  const batchSize = 100;
  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('colorways')
      .select('id, order_id, completion_status, close_reason')
      .eq('factory_id', factoryId)
      .in('order_id', batch);
    if (error) throw error;
    for (const row of data ?? []) {
      const orderId = row.order_id as string;
      const colorwayId = row.id as string;
      map.set(colorwayCompletionKey(orderId, colorwayId), {
        status: ((row.completion_status as string) || 'ongoing') as ColorwayCompletionStatus,
        closeReason: (row.close_reason as string) || null,
      });
    }
  }
  return map;
}

export function useColorwayCompletionMap(
  factoryId: string | null | undefined,
  orderIds: string[],
  enabled = true,
) {
  const idsKey = [...new Set(orderIds)].sort().join(',');
  return useQuery({
    queryKey: [...queryKeys.factory(factoryId ?? ''), 'colorwayCompletion', idsKey] as const,
    queryFn: () => fetchColorwayCompletionMap(factoryId!, orderIds),
    enabled: Boolean(factoryId && enabled && orderIds.length > 0),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
