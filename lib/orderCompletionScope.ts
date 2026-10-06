import type { CutToShipRow } from './mesReportsApi';
import { type SizeMap } from './mesSizeDisplay';
import type { ColorwayCutShipItem } from './cutToShipList';
import type { FabricCutQtyComponentRow } from './fabricCutQtyDisplay';
import { deliverySortKey } from './planningOrderStatus';
import { supabase } from './supabase';

function mergeSizeMaps(a: SizeMap, b: SizeMap): SizeMap {
  const out: SizeMap = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + (v || 0);
  return out;
}

function mergeFabricComponents(
  components: FabricCutQtyComponentRow[],
  additions: FabricCutQtyComponentRow[],
): FabricCutQtyComponentRow[] {
  const byComponent = new Map(components.map((component) => [component.component_id || component.fabric_type, component]));
  for (const component of additions) {
    const key = component.component_id || component.fabric_type;
    const existing = byComponent.get(key);
    if (!existing) {
      byComponent.set(key, { ...component, by_size: { ...component.by_size } });
      continue;
    }
    byComponent.set(key, {
      ...existing,
      total: existing.total + component.total,
      by_size: mergeSizeMaps(existing.by_size ?? {}, component.by_size ?? {}),
    });
  }
  return [...byComponent.values()];
}

export interface OrderCompletionGroup {
  orderId: string;
  poNumber: string;
  styleName: string;
  buyerName: string;
  items: ColorwayCutShipItem[];
  /** When sidebar is loaded from paginated RPC, color count may be set without items. */
  colorCount?: number;
  cutQty: number;
  shippedQty: number;
  rejectedQty: number;
  /** Earliest active shipment / delivery target date (YYYY-MM-DD). */
  earliestDeliveryDate?: string;
}

/** Earliest non-rescheduled target_date per order — used to sort the completion sidebar. */
export async function fetchEarliestDeliveryDateByOrder(
  factoryId: string,
  orderIds: string[],
): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('order_delivery_targets')
    .select('order_id, target_date, status')
    .eq('factory_id', factoryId)
    .in('order_id', orderIds);

  if (error) throw error;

  const datesByOrder = new Map<string, string[]>();
  for (const row of data ?? []) {
    if ((row.status as string) === 'rescheduled') continue;
    const orderId = row.order_id as string;
    const date = String(row.target_date ?? '').split('T')[0];
    if (!date) continue;
    const list = datesByOrder.get(orderId) ?? [];
    list.push(date);
    datesByOrder.set(orderId, list);
  }

  const out = new Map<string, string>();
  for (const [orderId, dates] of datesByOrder) {
    out.set(orderId, dates.slice().sort()[0]);
  }
  return out;
}

export function sortOrderCompletionGroupsByDelivery(
  groups: OrderCompletionGroup[],
  earliestDateByOrderId: Map<string, string>,
): OrderCompletionGroup[] {
  return [...groups]
    .map((group) => ({
      ...group,
      earliestDeliveryDate: earliestDateByOrderId.get(group.orderId),
    }))
    .sort((a, b) => {
      const byDate = deliverySortKey(
        a.earliestDeliveryDate ? [a.earliestDeliveryDate] : [],
      ).localeCompare(
        deliverySortKey(b.earliestDeliveryDate ? [b.earliestDeliveryDate] : [],
      ));
      if (byDate !== 0) return byDate;
      return a.poNumber.localeCompare(b.poNumber) || a.styleName.localeCompare(b.styleName);
    });
}

export function groupColorwayItemsByOrder(items: ColorwayCutShipItem[]): OrderCompletionGroup[] {
  const byOrder = new Map<string, ColorwayCutShipItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push(item);
    byOrder.set(item.orderId, list);
  }
  return [...byOrder.entries()]
    .map(([orderId, groupItems]) => {
      const first = groupItems[0];
      return {
        orderId,
        poNumber: first.poNumber,
        styleName: first.styleName,
        buyerName: first.buyerName,
        items: groupItems,
        cutQty: groupItems.reduce((s, i) => s + i.cutQty, 0),
        shippedQty: groupItems.reduce((s, i) => s + i.shippedQty, 0),
        rejectedQty: groupItems.reduce((s, i) => s + i.rejectedQty, 0),
      };
    })
    .sort((a, b) => a.poNumber.localeCompare(b.poNumber) || a.styleName.localeCompare(b.styleName));
}

export function mergeCutToShipRows(rows: CutToShipRow[]): CutToShipRow | null {
  if (rows.length === 0) return null;
  const first = rows[0];
  let cutQty = 0;
  let shippedQty = 0;
  let rejectedQty = 0;
  let orderQty = 0;
  let wipQty = 0;
  let cutBySize: SizeMap = {};
  let shippedBySize: SizeMap = {};
  let rejectedBySize: SizeMap = {};
  let cutByComponent: FabricCutQtyComponentRow[] = [];
  let lastShipment: string | null = null;

  for (const row of rows) {
    cutQty += row.cut_qty || 0;
    shippedQty += row.shipped_qty || 0;
    rejectedQty += row.rejected_qty || 0;
    orderQty += row.order_qty || 0;
    wipQty += row.wip_qty || 0;
    cutBySize = mergeSizeMaps(cutBySize, row.cut_qty_by_size ?? {});
    shippedBySize = mergeSizeMaps(shippedBySize, row.shipped_qty_by_size ?? {});
    rejectedBySize = mergeSizeMaps(rejectedBySize, row.rejected_qty_by_size ?? {});
    cutByComponent = mergeFabricComponents(cutByComponent, row.cut_qty_by_component ?? []);
    if (row.last_shipment_date && (!lastShipment || row.last_shipment_date > lastShipment)) {
      lastShipment = row.last_shipment_date;
    }
  }

  return {
    ...first,
    colorway_id: null,
    order_qty: orderQty,
    cut_qty: cutQty,
    shipped_qty: shippedQty,
    rejected_qty: rejectedQty,
    wip_qty: wipQty,
    reconciliation_gap: Math.max(cutQty - shippedQty - rejectedQty, 0),
    is_balanced: rows.every((r) => r.is_balanced),
    last_shipment_date: lastShipment,
    // No synthetic "TOTAL" size key here — callers derive sizeKeys from the
    // colorway's actual size rows, and a fabricated key renders as a bogus
    // extra row in the Production Matrix alongside the real Total footer.
    cut_qty_by_size: cutBySize,
    cut_qty_by_component: cutByComponent,
    shipped_qty_by_size: shippedBySize,
    rejected_qty_by_size: rejectedBySize,
  };
}

export function disputedQtyByDepartment(
  slips: Array<{
    from_department_id?: string | null;
    colorway_id?: string | null;
    status?: string | null;
    sent_qty?: number | null;
    received_qty?: number | null;
  }>,
  colorwayId: string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const slip of slips) {
    if (slip.status !== 'disputed') continue;
    if (colorwayId && slip.colorway_id !== colorwayId) continue;
    const deptId = slip.from_department_id;
    if (!deptId) continue;
    const lost = Math.max((slip.sent_qty ?? 0) - (slip.received_qty ?? 0), 0);
    out.set(deptId, (out.get(deptId) ?? 0) + lost);
  }
  return out;
}

export function aggregateSizeMaps(rows: CutToShipRow[], pick: (r: CutToShipRow) => SizeMap | undefined): SizeMap {
  let out: SizeMap = {};
  for (const row of rows) {
    out = mergeSizeMaps(out, pick(row) ?? {});
  }
  return out;
}

export function fulfillmentStatusForOrder(items: ColorwayCutShipItem[]): 'ongoing' | 'closed' {
  if (items.every((i) => i.completionStatus === 'complete' || i.completionStatus === 'short_closed')) {
    return 'closed';
  }
  return 'ongoing';
}
