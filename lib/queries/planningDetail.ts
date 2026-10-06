import { useQuery } from '@tanstack/react-query';
import type { LineAllocation } from '../../types';
import { supabase } from '../supabase';
import { mapAllocationRow } from '../allocationRowMap';
import { queryKeys } from '../queryKeys';

/** Minimal order slice for Gantt bar labels on other styles. */
export interface PlanningGanttOrderLabel {
  id: string;
  styleName: string;
  colorways: Array<{ id: string; name: string }>;
}

export interface PlanningGanttContext {
  allocations: LineAllocation[];
  peerOrderLabels: PlanningGanttOrderLabel[];
}

export async function fetchPlanningAllocationsWindow(
  factoryId: string,
  viewStart: string,
  viewEnd: string,
): Promise<LineAllocation[]> {
  const { data, error } = await supabase
    .from('line_allocations')
    .select('*')
    .eq('factory_id', factoryId)
    .lte('start_date', viewEnd)
    .gte('end_date', viewStart);

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapAllocationRow);
}

/** All line allocations for one order (not clipped to the Gantt date window). */
export async function fetchOrderLineAllocations(
  factoryId: string,
  orderId: string,
): Promise<LineAllocation[]> {
  const { data, error } = await supabase
    .from('line_allocations')
    .select('*')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapAllocationRow);
}

export async function fetchPlanningGanttOrderLabels(
  factoryId: string,
  orderIds: string[],
): Promise<PlanningGanttOrderLabel[]> {
  if (orderIds.length === 0) return [];

  const uniqueIds = [...new Set(orderIds)];
  const batchSize = 40;
  const labels: PlanningGanttOrderLabel[] = [];

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    const [ordersRes, colorwaysRes] = await Promise.all([
      supabase
        .from('style_orders')
        .select('id, style_name')
        .eq('factory_id', factoryId)
        .in('id', batch),
      supabase
        .from('colorways')
        .select('id, order_id, name')
        .eq('factory_id', factoryId)
        .in('order_id', batch),
    ]);
    if (ordersRes.error) throw ordersRes.error;
    if (colorwaysRes.error) throw colorwaysRes.error;

    const colorwaysByOrder = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of colorwaysRes.data ?? []) {
      const orderId = row.order_id as string;
      const list = colorwaysByOrder.get(orderId) ?? [];
      list.push({ id: row.id as string, name: (row.name as string) || '' });
      colorwaysByOrder.set(orderId, list);
    }

    for (const row of ordersRes.data ?? []) {
      const orderId = row.id as string;
      labels.push({
        id: orderId,
        styleName: (row.style_name as string) || '',
        colorways: colorwaysByOrder.get(orderId) ?? [],
      });
    }
  }

  return labels;
}

export async function fetchPlanningGanttContext(
  factoryId: string,
  viewStart: string,
  viewEnd: string,
  selectedOrderId?: string | null,
): Promise<PlanningGanttContext> {
  // Windowed fetch for peer bars on the timeline. Selected order is always loaded
  // in full so departmental planning rows past the 30-day view (e.g. Finishing /
  // Packing near delivery) do not vanish after save/refresh.
  const [windowAllocations, selectedOrderAllocations] = await Promise.all([
    fetchPlanningAllocationsWindow(factoryId, viewStart, viewEnd),
    selectedOrderId
      ? fetchOrderLineAllocations(factoryId, selectedOrderId)
      : Promise.resolve([] as LineAllocation[]),
  ]);

  const byId = new Map<string, LineAllocation>();
  for (const alloc of windowAllocations) {
    if (alloc.id) byId.set(alloc.id, alloc);
  }
  for (const alloc of selectedOrderAllocations) {
    if (alloc.id) byId.set(alloc.id, alloc);
  }
  const allocations = [...byId.values()];

  const peerIds = [
    ...new Set(
      allocations
        .map((a) => a.orderId)
        .filter((id): id is string => Boolean(id && id !== selectedOrderId)),
    ),
  ];
  const peerOrderLabels = await fetchPlanningGanttOrderLabels(factoryId, peerIds);
  return { allocations, peerOrderLabels };
}

/**
 * Window-scoped peer allocations for the Gantt timeline, merged with the
 * selected order's full allocation set (so planning table rows beyond the
 * visible date window still reload after save/refresh).
 */
export function usePlanningGanttContext(
  factoryId: string | null | undefined,
  selectedOrderId: string | null | undefined,
  viewStart: string,
  viewEnd: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.planningGanttContext(
      factoryId ?? '',
      selectedOrderId,
      viewStart,
      viewEnd,
    ),
    queryFn: () => fetchPlanningGanttContext(factoryId!, viewStart, viewEnd, selectedOrderId),
    enabled: Boolean(factoryId && enabled && viewStart && viewEnd),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
