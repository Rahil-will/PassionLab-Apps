import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';
import { fetchOrdersList } from '../hooks/useOrdersList';

const DEFAULT_LIST_PAGE_SIZE = 20;

/** Warm the paginated orders list cache when entering data-heavy routes. */
export function prefetchOrdersList(factoryId: string, page = 1, pageSize = DEFAULT_LIST_PAGE_SIZE): void {
  void queryClient.prefetchQuery({
    queryKey: queryKeys.ordersList(factoryId, page, { pageSize }),
    queryFn: () => fetchOrdersList(factoryId, page, pageSize),
    staleTime: 60 * 1000,
  });
}

export function prefetchFactoryListData(factoryId: string): void {
  prefetchOrdersList(factoryId);
}
