import type { SizeQty } from '../types';

export function calcAdjQty(orderQty: number, allowancePct: number): number {
  return Math.round(orderQty * (1 + allowancePct / 100));
}

/** Read order qty from a size row (supports legacy `qty` / `order_qty`). */
export function sizeOrderQty(row: SizeQty): number {
  return Number(row.order_qty ?? row.qty) || 0;
}

/** Read adjusted qty from a size row (supports legacy `plannedQty` / `adj_qty`). */
export function sizeAdjQty(row: SizeQty): number {
  return Number(row.adj_qty ?? row.plannedQty) || 0;
}

/** Normalize any stored/legacy row to canonical in-memory shape. */
export function normalizeSizeRow(row: SizeQty): SizeQty {
  return {
    size: String(row.size ?? '').trim(),
    order_qty: sizeOrderQty(row),
    adj_qty: sizeAdjQty(row),
  };
}

/** DB payload: only size, order_qty, adj_qty. */
export function sizeRowToDb(row: SizeQty): { size: string; order_qty: number; adj_qty: number } {
  const normalized = normalizeSizeRow(row);
  return {
    size: normalized.size,
    order_qty: normalized.order_qty,
    adj_qty: normalized.adj_qty,
  };
}

export function sumSizeOrderQty(sizes: SizeQty[]): number {
  return sizes.reduce((acc, s) => acc + sizeOrderQty(s), 0);
}

export function sumSizeAdjQty(sizes: SizeQty[]): number {
  return sizes.reduce((acc, s) => acc + sizeAdjQty(s), 0);
}

/** Preserve creation order from colorway size rows; append any extra keys from maps at end. */
export function orderedSizeKeys(sizes: SizeQty[] | undefined, extraKeys: string[] = []): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const row of sizes ?? []) {
    const size = String(row.size ?? '').trim();
    if (!size || seen.has(size)) continue;
    seen.add(size);
    ordered.push(size);
  }
  for (const key of extraKeys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}
