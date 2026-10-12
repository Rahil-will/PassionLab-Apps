import {
  sizeAdjQty,
  sizeOrderQty,
  sumSizeAdjQty,
  sumSizeOrderQty,
} from './colorwaySizesUtils';
import type { Colorway, StyleOrder } from '../types';

export interface ScopedQuantities {
  orderQty: number;
  adjQty: number;
}

type OrderLike = Pick<StyleOrder, 'orderQty' | 'adjQty' | 'colorways'>;

/** Order and adjusted qty for a whole order or a single colorway (from size rows). */
export function scopedOrderQuantities(
  order: OrderLike | null | undefined,
  colorwayId: string | null,
): ScopedQuantities {
  if (!order) return { orderQty: 0, adjQty: 0 };

  if (!colorwayId) {
    const adjFromSizes = order.colorways.reduce(
      (sum, cw) => sum + sumSizeAdjQty(cw.sizes ?? []),
      0,
    );
    const orderFromSizes = order.colorways.reduce(
      (sum, cw) => sum + sumSizeOrderQty(cw.sizes ?? []),
      0,
    );
    return {
      orderQty: orderFromSizes || order.orderQty,
      adjQty: adjFromSizes || order.adjQty || orderFromSizes || order.orderQty,
    };
  }

  const cw = order.colorways.find((c) => c.id === colorwayId);
  if (!cw) {
    return { orderQty: order.orderQty, adjQty: order.adjQty || order.orderQty };
  }

  return colorwayQuantities(cw);
}

export function colorwayQuantities(
  cw: Pick<Colorway, 'orderQty' | 'adjQty' | 'sizes'>,
): ScopedQuantities {
  const orderQty = cw.orderQty || sumSizeOrderQty(cw.sizes ?? []);
  const adjFromSizes = sumSizeAdjQty(cw.sizes ?? []);
  const adjQty = cw.adjQty || adjFromSizes || orderQty;
  return { orderQty, adjQty };
}

/** Build per-size adjusted qty from colorway size rows (never cut-qty recon). */
export function adjQtyBySizeFromColorways(
  colorways: Array<Pick<Colorway, 'sizes'>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cw of colorways) {
    for (const row of cw.sizes ?? []) {
      const size = String(row.size ?? '').trim();
      if (!size) continue;
      const adj = sizeAdjQty(row) || sizeOrderQty(row);
      out[size] = (out[size] ?? 0) + adj;
    }
  }
  return out;
}
