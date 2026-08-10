import type { StyleOrder } from '../types';
import { supabase } from './supabase';
import { mapStyleOrderFromDb } from './styleOrderDb';
import {
  ORDER_ROUTING_STEP_SELECT_SLIM,
  mapRoutingRecordToRow,
} from './orderRoutingEditor';

/** Reload one style order (header + colorways + routing + delivery targets) after a save. */
export async function reloadOrderFromDb(
  factoryId: string,
  orderId: string,
): Promise<StyleOrder | null> {
  const [orderRes, colorwaysRes, odtRes, routingRes] = await Promise.all([
    supabase
      .from('style_orders')
      .select('*')
      .eq('factory_id', factoryId)
      .eq('id', orderId)
      .maybeSingle(),
    supabase.from('colorways').select('*').eq('order_id', orderId),
    supabase
      .from('order_delivery_targets')
      .select('id, order_id, colorway_id, target_date, ship_mode, shipment_type, qty_by_size, destination_country, status, change_history, notes')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId),
    supabase
      .from('order_routing_steps')
      .select(`order_id, ${ORDER_ROUTING_STEP_SELECT_SLIM}`)
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .order('seq'),
  ]);

  if (orderRes.error) throw orderRes.error;
  if (!orderRes.data) return null;
  if (colorwaysRes.error) throw colorwaysRes.error;
  if (odtRes.error) throw odtRes.error;
  if (routingRes.error) throw routingRes.error;

  const routing_steps = (routingRes.data || []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const row = mapRoutingRecordToRow(r);
    return { ...row, order_id: orderId } as Record<string, unknown>;
  });

  return mapStyleOrderFromDb({
    ...(orderRes.data as Record<string, unknown>),
    colorways: colorwaysRes.data || [],
    delivery_targets: odtRes.data || [],
    routing_steps,
  });
}

/** Reload all line allocations for a factory (after line-plan save). */
export async function reloadAllocationsFromDb(
  factoryId: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('line_allocations')
    .select('*')
    .eq('factory_id', factoryId);
  if (error) throw error;
  return (data || []) as Record<string, unknown>[];
}
