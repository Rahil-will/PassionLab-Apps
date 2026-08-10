import type { StyleOrder } from '../types';

/** Params for `#/planning-detail` — ProductionPlanning reads `orderId` + `color` (name). */
export function buildPlanningDetailParams(
  orderId: string,
  orders: StyleOrder[],
  colorwayId?: string,
): Record<string, string> {
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { orderId };

  const colorway = colorwayId
    ? order.colorways.find((c) => c.id === colorwayId)
    : order.colorways[0];

  if (colorway) {
    return { orderId, color: colorway.name };
  }

  return { orderId };
}
