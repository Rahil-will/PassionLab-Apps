import { useQuery } from '@tanstack/react-query';
import { fetchOrderDetailBundle, type OrderDetailBundle } from '../lib/orderDetailBundle';
import type { OrderRoutingStepLike } from '../lib/orderRoutingFlow';
import { queryKeys } from '../lib/queryKeys';

export interface UseOrderDetailArgs {
  factoryId: string | null | undefined;
  orderId: string | null | undefined;
  colorwayIds?: string[];
  routingSteps?: OrderRoutingStepLike[];
  departments?: Array<{ id: string; name: string }>;
  enabled?: boolean;
  refreshKey?: number;
}

/** Order-scoped detail bundle — cached via TanStack Query (IndexedDB when persisted). */
export function useOrderDetail({
  factoryId,
  orderId,
  colorwayIds = [],
  routingSteps = [],
  departments,
  enabled = true,
  refreshKey = 0,
}: UseOrderDetailArgs) {
  const routingKey = routingSteps
    .map((s) => `${s.visit_id ?? ''}:${s.operation_def_id ?? s.dept_id ?? ''}`)
    .join('|');
  const colorwayKey = [...colorwayIds].sort().join(',');

  return useQuery<OrderDetailBundle>({
    queryKey: [
      ...queryKeys.orderDetail(factoryId ?? '', orderId ?? ''),
      routingKey,
      colorwayKey,
      refreshKey,
    ] as const,
    queryFn: () =>
      fetchOrderDetailBundle(
        factoryId!,
        orderId!,
        colorwayIds,
        routingSteps,
        departments,
      ),
    enabled: Boolean(factoryId && orderId && enabled),
    staleTime: 90 * 1000,
    placeholderData: (prev) => prev,
  });
}
