import { useQuery } from '@tanstack/react-query';
import type { LineAllocation, StyleOrder } from '../../types';
import { supabase } from '../supabase';
import { queryKeys } from '../queryKeys';
import { fetchOrdersEnrichedByIds } from './factoryOrders';
import { mapAllocationRow } from '../allocationRowMap';
import { ensureAssignedResources } from './resources';

export interface GanttScheduleWindowParams {
  factoryId: string;
  viewStart: string;
  viewEnd: string;
  includeCompleted: boolean;
}

export interface GanttScheduleWindowBundle {
  orders: StyleOrder[];
  allocations: LineAllocation[];
  assignedResources: Awaited<ReturnType<typeof ensureAssignedResources>>['mapped'];
}

export async function fetchGanttScheduleWindow(
  params: GanttScheduleWindowParams,
): Promise<GanttScheduleWindowBundle> {
  const { factoryId, viewStart, viewEnd, includeCompleted } = params;

  const { data: allocRows, error: allocError } = await supabase
    .from('line_allocations')
    .select('*')
    .eq('factory_id', factoryId)
    .lte('start_date', viewEnd)
    .gte('end_date', viewStart);

  if (allocError) throw allocError;

  const allocations = ((allocRows ?? []) as Record<string, unknown>[]).map(mapAllocationRow);
  const orderIds = [...new Set(allocations.map((a) => a.orderId).filter(Boolean))];

  const [orders, resourcesBundle] = await Promise.all([
    fetchOrdersEnrichedByIds(factoryId, orderIds),
    ensureAssignedResources(factoryId),
  ]);

  const filteredOrders = includeCompleted
    ? orders
    : orders.filter((o) => o.status !== 'Completed' && o.status !== 'Cancelled');

  const activeOrderIds = new Set(filteredOrders.map((o) => o.id));
  const filteredAllocations = allocations.filter((a) => activeOrderIds.has(a.orderId));

  return {
    orders: filteredOrders,
    allocations: filteredAllocations,
    assignedResources: resourcesBundle.mapped,
  };
}

export function useGanttScheduleWindow(
  factoryId: string | null | undefined,
  viewStart: string,
  viewEnd: string,
  includeCompleted: boolean,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.ganttScheduleWindow(factoryId ?? '', viewStart, viewEnd, includeCompleted),
    queryFn: () =>
      fetchGanttScheduleWindow({
        factoryId: factoryId!,
        viewStart,
        viewEnd,
        includeCompleted,
      }),
    enabled: Boolean(factoryId && enabled && viewStart && viewEnd),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
