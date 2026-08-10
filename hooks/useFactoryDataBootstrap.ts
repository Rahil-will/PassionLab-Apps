import { useQueryClient } from '@tanstack/react-query';
import { RoutePath } from '../types';
import {
  routeFactoryDataScope,
  routeNeedsProductionSummary,
} from '../lib/factoryBootstrap';
import { invalidateFactoryOrders } from '../lib/invalidateFactoryData';
import { useProductionSummary } from '../lib/queries/productionSummary';
import { queryKeys } from '../lib/queryKeys';

/** Route-aware production summary prefetch. Order bundles are page-scoped via TanStack Query. */
export function useFactoryDataBootstrap(
  factoryId: string | null | undefined,
  route: string,
  enabled = true,
) {
  const scope = routeFactoryDataScope(route);
  const summaryQuery = useProductionSummary(
    factoryId,
    enabled && routeNeedsProductionSummary(route),
  );

  return { scope, loading: false, summaryQuery };
}

export function useRefreshFactoryData(
  factoryId: string | null | undefined,
  route: string,
) {
  const queryClient = useQueryClient();

  return async () => {
    if (!factoryId) return;

    if (route === RoutePath.STATUS_TRACKER || route === RoutePath.LINE_ASSIGNMENT) {
      await invalidateFactoryOrders(factoryId);
      return;
    }

    if (routeNeedsProductionSummary(route)) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.productionSummary(factoryId),
      });
    }
  };
}
