import type { Colorway } from '../types';
import { materialToRpcPayload } from './colorwayMaterialsDb';
import { sizeRowToDb, sumSizeAdjQty, sumSizeOrderQty } from './colorwaySizesUtils';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ensureColorwayId(id: string | undefined): string {
  if (id && UUID_RE.test(id)) return id;
  return crypto.randomUUID();
}

/** Columns: id, order_id, name, color_code, qty, adj_qty, sizes.
 *  `materials` is RPC payload only — persisted on public.colorway_materials. */
export function colorwayToDbRow(c: Colorway, orderId: string) {
  const sizes = (c.sizes || []).map(sizeRowToDb);
  return {
    id: ensureColorwayId(c.id),
    order_id: orderId,
    name: String(c.name ?? '').trim(),
    color_code: c.colorCode || '',
    qty: Number(c.orderQty) || sumSizeOrderQty(c.sizes),
    adj_qty: Number(c.adjQty) || sumSizeAdjQty(c.sizes),
    sizes,
    planning_remarks: c.planningRemarks?.trim() || null,
    materials: (c.materials ?? []).map(materialToRpcPayload),
  };
}
