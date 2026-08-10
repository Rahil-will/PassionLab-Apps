const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function resolveRouteOrderId(
  routeParams: Record<string, string | undefined>,
): string {
  const raw = routeParams.order || routeParams.style || '';
  return isUuid(raw) ? raw : '';
}

export function resolveRouteColorwayId(
  routeParams: Record<string, string | undefined>,
): string {
  const raw = routeParams.colorway || routeParams.colorId || '';
  return isUuid(raw) ? raw : '';
}

export function orderLabel(styleName: string, poNumber: string): string {
  return poNumber ? `${styleName} (${poNumber})` : styleName;
}

export function filterStyleSearchOrders<
  T extends {
    id: string;
    styleName: string;
    styleRef?: string;
    buyerName?: string;
    poNumber: string;
    createdAt?: string;
  },
>(orders: T[], query: string, limit: number): T[] {
  const q = query.trim().toLowerCase();
  const pool = q
    ? orders.filter(
        (o) =>
          o.styleName.toLowerCase().includes(q) ||
          o.poNumber.toLowerCase().includes(q) ||
          (o.styleRef || '').toLowerCase().includes(q) ||
          (o.buyerName || '').toLowerCase().includes(q),
      )
    : orders;
  return [...pool]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit);
}

export function orderExistsInMeta(
  orderId: string,
  orders: Array<{ id: string }>,
): boolean {
  return orders.some((o) => o.id === orderId);
}
