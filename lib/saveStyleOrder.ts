import type { StyleOrder } from '../types';
import { supabase } from './supabase';
import { colorwayToDbRow } from './colorwayDb';
import { styleOrderToDbRow } from './styleOrderDb';
import { isVirtualShipmentLine } from './orderShipmentPlan';

function rpcDeployHint(message: string): string {
  if (
    message.includes('Could not find the function') ||
    message.includes('function public.save_style_order') ||
    message.includes('schema cache')
  ) {
    return ' Apply migration save_style_order_rpc to Supabase.';
  }
  return '';
}

/**
 * Persist style order header + all colorways in a single DB transaction.
 * On any failure the entire write rolls back — no partial order saves.
 */
export async function saveStyleOrderAtomic(
  factoryId: string,
  order: Partial<StyleOrder>,
  orderId?: string,
): Promise<string> {
  const resolvedId = orderId ?? order.id ?? crypto.randomUUID();
  const orderRow = styleOrderToDbRow(order, factoryId, resolvedId);
  const colorwayRows = (order.colorways ?? []).map((c) => colorwayToDbRow(c, resolvedId));

  // Persist active + rescheduled rows to ODT (rescheduled = inactive history, never deleted by sync).
  const planLines = (order.shipmentPlan?.lines ?? [])
    .filter((l) => !isVirtualShipmentLine(l.id))
    .filter((l) => l.colorwayId && l.shipmentDate)
    .map(({ _dateChangeReason, changeHistory, ...line }) => {
      if (line.status === 'rescheduled') {
        return {
          ...line,
          notes: _dateChangeReason || line.notes,
        };
      }
      const payload = changeHistory?.length ? { ...line, changeHistory } : line;
      return _dateChangeReason ? { ...payload, dateChangeReason: _dateChangeReason } : payload;
    });
  if (order.shipmentPlan) {
    (orderRow as Record<string, unknown>).shipment_plan = { lines: planLines };
  }

  // Order-level fallback when a single line changed (RPC also reads per-line dateChangeReason)
  const dateChangeReason = planLines.find(
    (l) => 'dateChangeReason' in l && (l as { dateChangeReason?: string }).dateChangeReason,
  ) as { dateChangeReason?: string } | undefined;
  if (dateChangeReason?.dateChangeReason) {
    (orderRow as Record<string, unknown>).date_change_reason = dateChangeReason.dateChangeReason;
  }

  const { data, error } = await supabase.rpc('save_style_order', {
    p_factory_id: factoryId,
    p_order: orderRow,
    p_colorways: colorwayRows,
  });

  if (error) {
    throw new Error(error.message + rpcDeployHint(error.message));
  }

  if (typeof data !== 'string' || !data) {
    throw new Error('Save order did not return an id');
  }

  return data;
}
