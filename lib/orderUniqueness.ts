import type { Colorway, StyleOrder } from '../types';

/**
 * Factory rule: style name + PO + color name must be unique across orders.
 * Same style/color names are allowed when PO differs.
 */
export function findOrderColorConflict(
  orders: StyleOrder[],
  styleName: string,
  poNumber: string,
  colorways: Colorway[],
  excludeOrderId?: string,
): string | null {
  const styleKey = styleName.trim().toLowerCase();
  const poKey = poNumber.trim().toLowerCase();
  if (!styleKey || !poKey) return null;

  for (const order of orders) {
    if (excludeOrderId && order.id === excludeOrderId) continue;
    if ((order.styleName || '').trim().toLowerCase() !== styleKey) continue;
    if ((order.poNumber || '').trim().toLowerCase() !== poKey) continue;

    for (const cw of colorways) {
      const colorKey = cw.name.trim().toLowerCase();
      if (!colorKey) continue;
      const exists = order.colorways.some(
        (existing) => existing.name.trim().toLowerCase() === colorKey,
      );
      if (exists) {
        return `An order already exists with style "${styleName.trim()}", PO "${poNumber.trim()}", and color "${cw.name.trim()}". Change the PO or color name.`;
      }
    }
  }

  return null;
}
