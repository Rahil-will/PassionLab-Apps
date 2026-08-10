import { useEffect, useState } from 'react';
import type { VisitFlowMetrics } from '../lib/orderFlowMetrics';
import type { SizeProgressLookup } from '../lib/orderSizeProgress';
import type { OrderRoutingStepLike } from '../lib/orderRoutingFlow';
import { useOrderDetail } from './useOrderDetail';

interface UseOrderDetailMetricsArgs {
  factoryId: string | null | undefined;
  orderId: string | undefined;
  colorwayIds: string[];
  routingSteps: OrderRoutingStepLike[];
  departments?: Array<{ id: string; name: string }>;
  enabled: boolean;
  /** Bump after saves / manual refresh to bypass bundle cache. */
  refreshKey?: number;
}

const emptySizeProgress: SizeProgressLookup = {
  getSizeCount: () => 0,
  getDeptTotal: () => 0,
};

export function useOrderDetailMetrics({
  factoryId,
  orderId,
  colorwayIds,
  routingSteps,
  departments,
  enabled,
  refreshKey = 0,
}: UseOrderDetailMetricsArgs) {
  const {
    data: bundle,
    isFetching,
    error: queryError,
    isFetched,
  } = useOrderDetail({
    factoryId,
    orderId: orderId ?? null,
    colorwayIds,
    routingSteps,
    departments,
    enabled,
    refreshKey,
  });

  const [bundleError, setBundleError] = useState<string | null>(null);

  useEffect(() => {
    if (!queryError) {
      setBundleError(null);
      return;
    }
    setBundleError(
      queryError instanceof Error ? queryError.message : 'Failed to load order detail',
    );
  }, [queryError]);

  const loading = enabled && Boolean(factoryId && orderId) && (isFetching || !isFetched);
  const metricsFailed = Boolean(bundleError);

  return {
    flowMetrics: (bundle?.flowMetrics ?? []) as VisitFlowMetrics[],
    flowByColor: bundle?.flowByColor ?? {},
    sizeProgress: bundle?.sizeProgress ?? emptySizeProgress,
    journey: bundle?.journey ?? [],
    routingCells: bundle?.routing_cells ?? [],
    reconciliation: bundle?.reconciliation ?? [],
    shipments: bundle?.shipments ?? [],
    rejections: bundle?.rejections ?? [],
    metricsReady: !loading,
    flowLoading: loading,
    progressLoading: loading,
    bundleError,
    metricsFailed,
  };
}
