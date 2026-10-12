import type { CompletionListFilter } from './cutToShipList';
import { buildColorwayCutShipItems, matchesColorwaySearch, matchesCompletionFilter } from './cutToShipList';
import { fetchColorwayCompletionMap } from './colorwayCompletionMap';
import type { ColorwayLabel } from './reports/reportMeta';
import { fetchColorwayLabels } from './reports/reportMeta';
import type { CutToShipRow } from './reports/kpiAndProgress';
import { parseFabricCutQtyComponents } from './fabricCutQtyDisplay';
import {
  groupColorwayItemsByOrder,
  sortOrderCompletionGroupsByDelivery,
  type OrderCompletionGroup,
} from './orderCompletionScope';
import { supabase } from './supabase';

export const ORDER_COMPLETION_SIDEBAR_PAGE_SIZE = 8;

interface OrderCompletionPageRow {
  id: string;
  style_name: string;
  po_number: string;
  buyer_name: string;
  earliest_delivery: string | null;
  total_count: number | string | null;
}

export interface OrderCompletionSidebarPage {
  groups: OrderCompletionGroup[];
  total: number;
  page: number;
  pageSize: number;
  orderIds: string[];
  cutRows: CutToShipRow[];
  colorwayMap: Map<string, ColorwayLabel>;
}

export async function fetchCutToShipReportForOrders(
  factoryId: string,
  orderIds: string[],
  opts?: { buyerId?: string | null },
): Promise<CutToShipRow[]> {
  if (orderIds.length === 0) return [];

  const { data, error } = await supabase.rpc('get_cut_to_ship_report', {
    p_factory_id: factoryId,
    p_date_from: null,
    p_date_to: null,
    p_buyer_id: opts?.buyerId ?? null,
    p_balanced_only: null,
    p_order_ids: orderIds,
  });
  if (error) throw error;

  return (data || []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      ...(r as unknown as CutToShipRow),
      cut_qty_by_component: parseFabricCutQtyComponents(r.cut_qty_by_component),
    };
  });
}

export async function fetchOrderCompletionSidebarPage(args: {
  factoryId: string;
  page: number;
  pageSize?: number;
  buyerId?: string;
  search?: string;
  completionFilter: CompletionListFilter;
  includeOrderId?: string;
}): Promise<OrderCompletionSidebarPage> {
  const pageSize = args.pageSize ?? ORDER_COMPLETION_SIDEBAR_PAGE_SIZE;

  const { data, error } = await supabase.rpc('get_order_completion_page', {
    p_factory_id: args.factoryId,
    p_completion_filter: args.completionFilter,
    p_page: args.page,
    p_page_size: pageSize,
    p_search: args.search?.trim() || null,
    p_buyer_id: args.buyerId || null,
    p_include_order_id: args.includeOrderId || null,
  });
  if (error) throw error;

  const rows = (data || []) as OrderCompletionPageRow[];
  const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  const orderIds = [...new Set(rows.map((row) => row.id).filter(Boolean))];

  const deliveryByOrderId = new Map<string, string>();
  for (const row of rows) {
    const date = row.earliest_delivery?.split('T')[0];
    if (date) deliveryByOrderId.set(row.id, date);
  }

  const [cutRows, colorways, completionMap] = await Promise.all([
    fetchCutToShipReportForOrders(args.factoryId, orderIds, { buyerId: args.buyerId }),
    fetchColorwayLabels(args.factoryId, { orderIds }),
    fetchColorwayCompletionMap(args.factoryId, orderIds),
  ]);

  const colorwayMap = new Map(colorways.map((c) => [c.id, c]));
  const q = args.search?.trim().toLowerCase() ?? '';

  const items = buildColorwayCutShipItems(cutRows, [], colorwayMap, completionMap).filter(
    (item) =>
      orderIds.includes(item.orderId)
      && matchesColorwaySearch(item, q)
      && matchesCompletionFilter(item, args.completionFilter),
  );

  const grouped = sortOrderCompletionGroupsByDelivery(
    groupColorwayItemsByOrder(items),
    deliveryByOrderId,
  );

  const orderRank = new Map(orderIds.map((id, index) => [id, index]));
  let groups = grouped.sort(
    (a, b) => (orderRank.get(a.orderId) ?? 999) - (orderRank.get(b.orderId) ?? 999),
  );

  if (args.includeOrderId && groups.length > pageSize) {
    const pinned = groups.find((group) => group.orderId === args.includeOrderId);
    const rest = groups.filter((group) => group.orderId !== args.includeOrderId).slice(0, pageSize - 1);
    groups = pinned ? [pinned, ...rest] : groups.slice(0, pageSize);
  }

  return {
    groups,
    total,
    page: args.page,
    pageSize,
    orderIds,
    cutRows,
    colorwayMap,
  };
}
