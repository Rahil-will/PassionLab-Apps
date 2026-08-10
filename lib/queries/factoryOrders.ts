import { useQuery } from '@tanstack/react-query';
import type { LineAllocation, StyleOrder } from '../../types';
import { supabase } from '../supabase';
import { mapStyleOrderFromDb } from '../styleOrderDb';
import {
  ORDER_ROUTING_STEP_SELECT_SLIM,
  mapRoutingRecordToRow,
} from '../orderRoutingEditor';
import { mapAllocationRow } from '../allocationRowMap';
import { queryKeys } from '../queryKeys';

/** Active in-production order count without loading full orders. */
export async function fetchActiveOrderCount(factoryId: string): Promise<number> {
  const { count, error } = await supabase
    .from('style_orders')
    .select('id', { count: 'exact', head: true })
    .eq('factory_id', factoryId)
    .not('status', 'in', '("Completed","Cancelled")');
  if (error) throw error;
  return count ?? 0;
}

export function useActiveOrderCount(factoryId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.factory(factoryId ?? ''), 'activeOrderCount'] as const,
    queryFn: () => fetchActiveOrderCount(factoryId!),
    enabled: Boolean(factoryId && enabled),
    staleTime: 60 * 1000,
  });
}

/** Enrich a page of order ids into full StyleOrder objects (for Status Tracker pagination). */
export async function fetchOrdersEnrichedByIds(
  factoryId: string,
  orderIds: string[],
): Promise<StyleOrder[]> {
  if (orderIds.length === 0) return [];

  const [ordersRes, colorwaysRes, odtRes, routingRes] = await Promise.all([
    supabase.from('style_orders').select('*').eq('factory_id', factoryId).in('id', orderIds),
    supabase.from('colorways').select('*').eq('factory_id', factoryId).in('order_id', orderIds),
    supabase
      .from('order_delivery_targets')
      .select('id, order_id, colorway_id, target_date, ship_mode, shipment_type, qty_by_size, destination_country, status, change_history, notes')
      .eq('factory_id', factoryId)
      .in('order_id', orderIds),
    supabase
      .from('order_routing_steps')
      .select(`order_id, ${ORDER_ROUTING_STEP_SELECT_SLIM}`)
      .eq('factory_id', factoryId)
      .in('order_id', orderIds)
      .order('seq'),
  ]);

  if (ordersRes.error) throw ordersRes.error;

  const colorwaysByOrder = new Map<string, Record<string, unknown>[]>();
  for (const cw of (colorwaysRes.data ?? []) as Record<string, unknown>[]) {
    const oid = cw.order_id as string;
    if (!colorwaysByOrder.has(oid)) colorwaysByOrder.set(oid, []);
    colorwaysByOrder.get(oid)!.push(cw);
  }

  const odtByOrder = new Map<string, Record<string, unknown>[]>();
  for (const row of (odtRes.data ?? []) as Record<string, unknown>[]) {
    const oid = row.order_id as string;
    if (!odtByOrder.has(oid)) odtByOrder.set(oid, []);
    odtByOrder.get(oid)!.push(row);
  }

  const routingByOrder = new Map<string, Record<string, unknown>[]>();
  for (const raw of routingRes.data ?? []) {
    const orderId = raw.order_id as string;
    const row = mapRoutingRecordToRow(raw);
    if (!routingByOrder.has(orderId)) routingByOrder.set(orderId, []);
    routingByOrder.get(orderId)!.push({ ...row, order_id: orderId } as Record<string, unknown>);
  }

  const byId = new Map(
    ((ordersRes.data ?? []) as Record<string, unknown>[]).map((row) => [
      row.id as string,
      mapStyleOrderFromDb({
        ...row,
        colorways: colorwaysByOrder.get(row.id as string) ?? [],
        delivery_targets: odtByOrder.get(row.id as string) ?? [],
        routing_steps: routingByOrder.get(row.id as string) ?? [],
      }),
    ]),
  );

  return orderIds.map((id) => byId.get(id)).filter((o): o is StyleOrder => o != null);
}

/** Line allocations for a page of orders (planning list pagination). */
export async function fetchAllocationsForOrderIds(
  factoryId: string,
  orderIds: string[],
): Promise<LineAllocation[]> {
  if (orderIds.length === 0) return [];
  const { data, error } = await supabase
    .from('line_allocations')
    .select('*')
    .eq('factory_id', factoryId)
    .in('order_id', orderIds);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((a) => mapAllocationRow(a));
}

/** All line allocations for a factory (planning Gantt peer bars). */
export async function fetchAllFactoryAllocations(
  factoryId: string,
): Promise<LineAllocation[]> {
  const { data, error } = await supabase
    .from('line_allocations')
    .select('*')
    .eq('factory_id', factoryId);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((a) => mapAllocationRow(a));
}

export function useAllocationsForOrderIds(
  factoryId: string | null | undefined,
  orderIds: string[],
  enabled = true,
) {
  const idsKey = [...orderIds].sort().join(',');
  return useQuery({
    queryKey: [...queryKeys.factory(factoryId ?? ''), 'allocations', idsKey] as const,
    queryFn: () => fetchAllocationsForOrderIds(factoryId!, orderIds),
    enabled: Boolean(factoryId && enabled && orderIds.length > 0),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

export function useOrdersEnrichedPage(
  factoryId: string | null | undefined,
  orderIds: string[],
  enabled = true,
) {
  const idsKey = [...orderIds].sort().join(',');
  return useQuery({
    queryKey: [...queryKeys.factory(factoryId ?? ''), 'ordersEnriched', idsKey] as const,
    queryFn: () => fetchOrdersEnrichedByIds(factoryId!, orderIds),
    enabled: Boolean(factoryId && enabled && orderIds.length > 0),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });
}
