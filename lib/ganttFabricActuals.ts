import { supabase } from './supabase';

export interface GanttFabricActual {
  resourceId: string;
  orderId: string;
  colorwayId: string | null;
  fabricType: string;
  /** fabric_components.id used to decide when to split vs sum cards. */
  fabricComponentId?: string;
  qty: number;
  startDate: string;
  endDate: string;
  /** order_routing_steps.id for the cutting session — lets visit-scoped views match the correct row. */
  orderRouteId?: string;
}

/** Merge fabric actuals so multiple captures for the same fabric component sum into one card. */
export function mergeFabricActualsByComponent(actuals: GanttFabricActual[]): GanttFabricActual[] {
  const groups = new Map<string, GanttFabricActual>();
  for (const actual of actuals) {
    const key = actual.fabricComponentId || actual.fabricType;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...actual });
      continue;
    }
    existing.qty += actual.qty;
    if (actual.startDate < existing.startDate) existing.startDate = actual.startDate;
    if (actual.endDate > existing.endDate) existing.endDate = actual.endDate;
  }
  return [...groups.values()];
}

/** Merge per-session fabric actuals into one card per order, colorway, resource, date and component. */
export function mergeFabricActualsByDateAndComponent(actuals: GanttFabricActual[]): GanttFabricActual[] {
  const groups = new Map<string, GanttFabricActual>();
  for (const actual of actuals) {
    const key = `${actual.orderId}|${actual.colorwayId || 'none'}|${actual.resourceId}|${actual.startDate}|${actual.fabricComponentId || actual.fabricType}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...actual });
      continue;
    }
    existing.qty += actual.qty;
    if (actual.endDate > existing.endDate) existing.endDate = actual.endDate;
  }
  return [...groups.values()];
}

export async function fetchGanttFabricActuals(
  factoryId: string,
  orderId: string,
  colorwayId?: string,
): Promise<GanttFabricActual[]> {
  const [bundlesRes, sessionsRes, componentsRes] = await Promise.all([
    supabase
      .from('cutting_bundles')
      .select('session_id, colorway_id, fabric_component_id, qty, created_at')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId),
    supabase
      .from('cutting_sessions')
      .select('id, resource_id, log_date, order_route_id')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId),
    supabase
      .from('fabric_components')
      .select('id, fabric_type')
      .eq('factory_id', factoryId),
  ]);
  if (bundlesRes.error) throw bundlesRes.error;
  if (sessionsRes.error) throw sessionsRes.error;
  if (componentsRes.error) throw componentsRes.error;

  const sessions = (sessionsRes.data || []) as Array<{ id: string; resource_id: string | null; log_date: string | null; order_route_id: string | null }>;
  const components = (componentsRes.data || []) as Array<{ id: string; fabric_type: string }>;
  const bundles = (bundlesRes.data || []) as Array<{
    session_id: string | null;
    colorway_id: string | null;
    fabric_component_id: string | null;
    qty: number | null;
    created_at: string | null;
  }>;
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const fabricById = new Map(components.map((component) => [component.id, component.fabric_type]));
  const grouped = new Map<string, GanttFabricActual>();

  for (const bundle of bundles) {
    if (colorwayId && bundle.colorway_id !== colorwayId) continue;
    const session = bundle.session_id ? sessionById.get(bundle.session_id) : undefined;
    const resourceId = session?.resource_id || '';
    const fabricType = bundle.fabric_component_id ? fabricById.get(bundle.fabric_component_id) : undefined;
    const date = session?.log_date || bundle.created_at?.slice(0, 10);
    const qty = Number(bundle.qty) || 0;
    if (!resourceId || !fabricType || !date || qty <= 0) continue;

    const routeId = session?.order_route_id || '';
    const key = `${orderId}|${resourceId}|${date}|${bundle.fabric_component_id ?? ''}|${routeId}`;
    const current = grouped.get(key);
    if (current) {
      current.qty += qty;
      if (date < current.startDate) current.startDate = date;
      if (date > current.endDate) current.endDate = date;
      continue;
    }
    grouped.set(key, {
      resourceId,
      orderId,
      colorwayId: bundle.colorway_id,
      fabricType,
      fabricComponentId: bundle.fabric_component_id || undefined,
      qty,
      startDate: date,
      endDate: date,
      orderRouteId: session?.order_route_id || undefined,
    });
  }

  return [...grouped.values()];
}

/** Batch fetch fabric actuals for many orders in two round-trips. */
export async function fetchGanttFabricActualsForOrders(
  factoryId: string,
  orderIds: string[],
  colorwayId?: string,
): Promise<GanttFabricActual[]> {
  if (!orderIds.length) return [];
  const [bundlesRes, sessionsRes, componentsRes] = await Promise.all([
    supabase
      .from('cutting_bundles')
      .select('order_id, session_id, colorway_id, fabric_component_id, qty, created_at')
      .eq('factory_id', factoryId)
      .in('order_id', orderIds),
    supabase
      .from('cutting_sessions')
      .select('id, order_id, resource_id, log_date, order_route_id')
      .eq('factory_id', factoryId)
      .in('order_id', orderIds),
    supabase
      .from('fabric_components')
      .select('id, fabric_type')
      .eq('factory_id', factoryId),
  ]);
  if (bundlesRes.error) throw bundlesRes.error;
  if (sessionsRes.error) throw sessionsRes.error;
  if (componentsRes.error) throw componentsRes.error;

  const sessions = (sessionsRes.data || []) as Array<{ order_id: string; id: string; resource_id: string | null; log_date: string | null; order_route_id: string | null }>;
  const components = (componentsRes.data || []) as Array<{ id: string; fabric_type: string }>;
  const bundles = (bundlesRes.data || []) as Array<{ order_id: string; session_id: string | null; colorway_id: string | null; fabric_component_id: string | null; qty: number | null; created_at: string | null }>;
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const fabricById = new Map(components.map((component) => [component.id, component.fabric_type]));
  const grouped = new Map<string, GanttFabricActual>();

  for (const bundle of bundles) {
    if (colorwayId && bundle.colorway_id !== colorwayId) continue;
    const session = bundle.session_id ? sessionById.get(bundle.session_id) : undefined;
    const resourceId = session?.resource_id || '';
    const fabricType = bundle.fabric_component_id ? fabricById.get(bundle.fabric_component_id) : undefined;
    const date = session?.log_date || bundle.created_at?.slice(0, 10);
    const qty = Number(bundle.qty) || 0;
    const orderId = bundle.order_id || '';
    if (!resourceId || !fabricType || !date || qty <= 0 || !orderId) continue;

    const routeId = session?.order_route_id || '';
    const key = `${orderId}|${resourceId}|${date}|${bundle.fabric_component_id ?? ''}|${routeId}`;
    const current = grouped.get(key);
    if (current) {
      current.qty += qty;
      if (date < current.startDate) current.startDate = date;
      if (date > current.endDate) current.endDate = date;
      continue;
    }
    grouped.set(key, {
      resourceId,
      orderId,
      colorwayId: bundle.colorway_id,
      fabricType,
      fabricComponentId: bundle.fabric_component_id || undefined,
      qty,
      startDate: date,
      endDate: date,
      orderRouteId: session?.order_route_id || undefined,
    });
  }

  return [...grouped.values()];
}
