import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LineAllocationActual, ProductionSummaryRow } from '../../types';
import type { CutToShipJourneyRow } from '../mesReportsApi';
import {
  fetchFactoryOrderDeptProgressRows,
  fetchLineAllocationActuals,
  fetchProductionSummaryFromViews,
} from '../orderProgressApi';
import { queryKeys } from '../queryKeys';

export interface ProductionSummaryBundle {
  productionSummary: ProductionSummaryRow[];
  orderDeptProgress: CutToShipJourneyRow[];
  lineAllocationActuals: LineAllocationActual[];
}

export async function fetchProductionSummaryBundle(
  factoryId: string,
): Promise<ProductionSummaryBundle> {
  const [summaryRows, deptRows, allocActualRows] = await Promise.all([
    fetchProductionSummaryFromViews(factoryId),
    fetchFactoryOrderDeptProgressRows(factoryId),
    fetchLineAllocationActuals(factoryId),
  ]);
  return {
    productionSummary: summaryRows,
    orderDeptProgress: deptRows,
    lineAllocationActuals: allocActualRows,
  };
}

export function useProductionSummary(
  factoryId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.productionSummary(factoryId ?? ''),
    queryFn: () => fetchProductionSummaryBundle(factoryId!),
    enabled: Boolean(factoryId && enabled),
    staleTime: 90 * 1000,
    placeholderData: (prev) => prev,
  });
}

export async function invalidateProductionSummary(
  queryClient: ReturnType<typeof useQueryClient>,
  factoryId: string,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.productionSummary(factoryId) });
}

export async function refreshProductionSummaryQuery(
  queryClient: ReturnType<typeof useQueryClient>,
  factoryId: string,
): Promise<ProductionSummaryBundle> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.productionSummary(factoryId),
    queryFn: () => fetchProductionSummaryBundle(factoryId),
    staleTime: 0,
  });
}
