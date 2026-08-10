import type { CutToShipRow } from './mesReportsApi';
import type { ColorwayLabel } from './mesReportsApi';
import { colorwayDisplayLabel } from './mesReportsApi';
import type { ColorwayCompletionStatus, StyleOrder } from '../types';
import { syntheticCutRowFromColorway } from './cutToShipOps';
import {
  colorwayCompletionKey,
  type ColorwayCompletionMap,
} from './colorwayCompletionMap';

export interface ColorwayCutShipItem {
  key: string;
  orderId: string;
  colorwayId: string;
  styleName: string;
  poNumber: string;
  buyerName: string;
  colorLabel: string;
  cutQty: number;
  shippedQty: number;
  rejectedQty: number;
  completionStatus: ColorwayCompletionStatus;
  closeReason?: string | null;
  row: CutToShipRow;
}

function completionForColorway(
  ordersById: Map<string, StyleOrder>,
  completionMap: ColorwayCompletionMap | undefined,
  orderId: string,
  colorwayId: string,
): {
  status: ColorwayCompletionStatus;
  closeReason?: string | null;
} {
  const fromMap = completionMap?.get(colorwayCompletionKey(orderId, colorwayId));
  if (fromMap) return fromMap;

  const order = ordersById.get(orderId);
  const cw = order?.colorways.find((c) => c.id === colorwayId);
  return {
    status: cw?.completionStatus ?? 'ongoing',
    closeReason: cw?.closeReason ?? null,
  };
}

export function buildColorwayCutShipItems(
  cutRows: CutToShipRow[],
  orders: StyleOrder[],
  colorwayMap: Map<string, ColorwayLabel>,
  completionMap?: ColorwayCompletionMap,
): ColorwayCutShipItem[] {
  const items: ColorwayCutShipItem[] = [];
  const seen = new Set<string>();
  const ordersById = new Map(orders.map((o) => [o.id, o]));

  for (const row of cutRows) {
    const cwId = row.colorway_id || '';
    const order = ordersById.get(row.order_id);
    // Skip order-level aggregate rows when the order has per-colorway rows.
    if (!cwId && order?.colorways?.length) continue;

    const key = `${row.order_id}:${cwId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const completion = completionForColorway(ordersById, completionMap, row.order_id, cwId);
    items.push({
      key,
      orderId: row.order_id,
      colorwayId: cwId,
      styleName: row.style_name,
      poNumber: row.po_number || '—',
      buyerName: row.buyer_name || '—',
      colorLabel: colorwayDisplayLabel(cwId || null, colorwayMap),
      cutQty: row.cut_qty,
      shippedQty: row.shipped_qty,
      rejectedQty: row.rejected_qty,
      completionStatus: completion.status,
      closeReason: completion.closeReason,
      row,
    });
  }

  for (const order of orders) {
    for (const cw of order.colorways) {
      const key = `${order.id}:${cw.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const syn = syntheticCutRowFromColorway(order, cw);
      items.push({
        key,
        orderId: order.id,
        colorwayId: cw.id,
        styleName: order.styleName,
        poNumber: order.poNumber || '—',
        buyerName: order.buyer || '—',
        colorLabel: colorwayDisplayLabel(cw.id, colorwayMap),
        cutQty: syn.cut_qty,
        shippedQty: 0,
        rejectedQty: 0,
        completionStatus: cw.completionStatus ?? 'ongoing',
        closeReason: cw.closeReason ?? null,
        row: syn,
      });
    }
  }

  return items.sort((a, b) => {
    const po = a.poNumber.localeCompare(b.poNumber);
    if (po !== 0) return po;
    return a.colorLabel.localeCompare(b.colorLabel);
  });
}

export function groupItemsByPo(
  items: ColorwayCutShipItem[],
): Array<{ poNumber: string; items: ColorwayCutShipItem[] }> {
  const map = new Map<string, ColorwayCutShipItem[]>();
  for (const item of items) {
    const po = item.poNumber || '—';
    const list = map.get(po) ?? [];
    list.push(item);
    map.set(po, list);
  }
  return [...map.entries()].map(([poNumber, group]) => ({ poNumber, items: group }));
}

export function matchesColorwaySearch(item: ColorwayCutShipItem, q: string): boolean {
  if (!q) return true;
  const hay = `${item.styleName} ${item.poNumber} ${item.buyerName} ${item.colorLabel}`.toLowerCase();
  return hay.includes(q);
}

export type CompletionListFilter = 'all' | 'ongoing' | 'completed';

export function matchesCompletionFilter(
  item: ColorwayCutShipItem,
  filter: CompletionListFilter,
): boolean {
  if (filter === 'all') return true;
  const closed = item.completionStatus === 'complete' || item.completionStatus === 'short_closed';
  return filter === 'completed' ? closed : !closed;
}
