import { useQuery } from '@tanstack/react-query';
import {
  fetchGanttFabricActualsForOrders,
  type GanttFabricActual,
} from '../lib/ganttFabricActuals';
import { queryKeys } from '../lib/queryKeys';

/** Batch fabric actuals for the department schedule (all orders). */
export function useGanttFabricActualsForOrders(
  factoryId: string | null | undefined,
  orderIds: string[],
) {
  const key = [...orderIds].sort().join(',');
  return useQuery({
    queryKey: queryKeys.ganttFabric(factoryId ?? '', key || 'none'),
    queryFn: () => fetchGanttFabricActualsForOrders(factoryId!, orderIds),
    enabled: Boolean(factoryId) && orderIds.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

export type { GanttFabricActual };
