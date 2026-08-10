import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { queryKeys } from '../lib/queryKeys';
import { useOrdersEnrichedPage } from '../lib/queries/factoryOrders';
import { useProductionSummary } from '../lib/queries/productionSummary';
import type { PipelineStatusFilter } from '../lib/orderPipelineFilter';

export interface OrderListRow {
  id: string;
  style_name: string;
  style_ref: string | null;
  po_number: string;
  buyer_name: string | null;
  buyer_id: string | null;
  status: string;
  order_qty: number;
  adj_qty: number;
  created_at: string;
  image_url: string | null;
  season: string | null;
  priority: string;
}

export interface OrdersListFilters {
  status?: string;
  buyerId?: string;
  search?: string;
  /** Omit Completed/Cancelled header status from the server page. */
  excludeCompleted?: boolean;
  /** When set, list is fetched via get_orders_pipeline_page (server-side pipeline filter). */
  pipelineStatus?: PipelineStatusFilter;
}

type OrdersPipelinePageRow = OrderListRow & { total_count: number | string | null };

export interface OrdersListResult {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
}

const LIST_COLUMNS =
  'id, style_name, style_ref, po_number, buyer_name, buyer_id, status, order_qty, adj_qty, created_at, image_url, season, priority';

/** Map get_orders_pipeline_page RPC rows into the shared list result shape. */
export function mapOrdersPipelinePageRows(
  rows: OrdersPipelinePageRow[],
  page: number,
  pageSize: number,
): OrdersListResult {
  const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  return {
    rows: rows.map(({ total_count: _totalCount, ...row }) => row),
    total,
    page,
    pageSize,
  };
}

export async function fetchOrdersPipelinePage(
  factoryId: string,
  page: number,
  pageSize: number,
  filters: Pick<OrdersListFilters, 'buyerId' | 'search'> & { pipelineStatus: PipelineStatusFilter },
): Promise<OrdersListResult> {
  const { data, error } = await supabase.rpc('get_orders_pipeline_page', {
    p_factory_id: factoryId,
    p_pipeline_status: filters.pipelineStatus,
    p_page: page,
    p_page_size: pageSize,
    p_search: filters.search?.trim() || null,
    p_buyer_id: filters.buyerId || null,
  });
  if (error) throw error;
  return mapOrdersPipelinePageRows((data || []) as OrdersPipelinePageRow[], page, pageSize);
}

export async function fetchOrdersList(
  factoryId: string,
  page: number,
  pageSize: number,
  filters: OrdersListFilters = {},
): Promise<OrdersListResult> {
  if (filters.pipelineStatus) {
    return fetchOrdersPipelinePage(factoryId, page, pageSize, {
      pipelineStatus: filters.pipelineStatus,
      buyerId: filters.buyerId,
      search: filters.search,
    });
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('style_orders')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.excludeCompleted) {
    query = query.not('status', 'in', '("Completed","Cancelled")');
  }
  if (filters.buyerId) {
    query = query.eq('buyer_id', filters.buyerId);
  }
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    query = query.or(
      `style_name.ilike.${q},po_number.ilike.${q},style_ref.ilike.${q},buyer_name.ilike.${q}`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    rows: (data || []) as OrderListRow[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Paginated order list for Dashboard / Status Tracker / Planning list. */
export function useOrdersList(
  factoryId: string | null | undefined,
  page = 1,
  pageSize = 20,
  filters: OrdersListFilters = {},
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.ordersList(factoryId ?? '', page, {
      status: filters.status,
      buyerId: filters.buyerId,
      search: filters.search,
      excludeCompleted: filters.excludeCompleted,
      pipelineStatus: filters.pipelineStatus,
      pageSize,
    }),
    queryFn: () => fetchOrdersList(factoryId!, page, pageSize, filters),
    enabled: Boolean(factoryId && enabled),
    staleTime: 60 * 1000,
    placeholderData: filters.pipelineStatus ? undefined : (prev) => prev,
  });
}

export interface OrdersListPipelinePageOptions {
  factoryId: string | null | undefined;
  page: number;
  pageSize: number;
  filters: Omit<OrdersListFilters, 'excludeCompleted'>;
  pipelineStatus: PipelineStatusFilter;
  enabled?: boolean;
}

/** Paginated list + enriched orders + production summary for Status Tracker pipeline filters. */
export function useOrdersListPipelinePage(options: OrdersListPipelinePageOptions) {
  const {
    factoryId,
    page,
    pageSize,
    filters,
    pipelineStatus,
    enabled = true,
  } = options;
  const pipelineActive = Boolean(pipelineStatus);

  const listQuery = useOrdersList(
    factoryId,
    page,
    pageSize,
    {
      ...filters,
      excludeCompleted: !pipelineActive,
      pipelineStatus: pipelineActive ? pipelineStatus : undefined,
    },
    enabled,
  );

  const pageOrderIds = useMemo(
    () => (listQuery.data?.rows ?? []).map((r) => r.id),
    [listQuery.data?.rows],
  );

  const enrichedQuery = useOrdersEnrichedPage(
    factoryId,
    pageOrderIds,
    Boolean(factoryId && enabled && pageOrderIds.length > 0),
  );

  /** Drop stale placeholder enriched rows when the current page has no order ids. */
  const enrichedOrders = useMemo(() => {
    if (pageOrderIds.length === 0) return [];
    const allowed = new Set(pageOrderIds);
    return (enrichedQuery.data ?? []).filter((order) => allowed.has(order.id));
  }, [pageOrderIds, enrichedQuery.data]);

  const summaryQuery = useProductionSummary(
    factoryId,
    Boolean(factoryId && enabled && pipelineActive),
  );

  return {
    listQuery,
    enrichedQuery,
    enrichedOrders,
    summaryQuery,
    orderDeptProgress: summaryQuery.data?.orderDeptProgress ?? [],
    pageOrderIds,
  };
}
