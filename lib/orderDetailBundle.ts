import { supabase } from './supabase';
import type { CutToShipJourneyRow, CutToShipRow } from './mesReportsApi';
import type { SizeMap } from './mesSizeDisplay';
import { parseFabricCutQtyComponents } from './fabricCutQtyDisplay';
import { sumSizeMap } from './mesSizeDisplay';
import { proportionalDistribute } from './cutToShipOps';
import type { VisitFlowMetrics } from './orderFlowMetrics';
import type { SizeProgressLookup } from './orderSizeProgress';
import type { OrderRoutingStepLike } from './orderRoutingFlow';

export interface OrderDetailRoutingCell {
  visit_id: string;
  dept_id: string;
  dept_name: string;
  seq: number;
  primary_route_id: string | null;
  route_ids: string[];
  operations: Array<{
    route_id: string;
    operation_name: string;
    step_type: string;
    is_primary_output: boolean;
  }>;
  capture_apps: string[];
  is_qc: boolean;
}

export interface OrderDetailSizeProduced {
  colorway_id: string;
  route_id: string;
  visit_id: string;
  dept_id: string | null;
  dept_name: string;
  produced_by_size: SizeMap;
}

export interface OrderDetailBundle {
  factory_id: string;
  order_id: string;
  routing_cells: OrderDetailRoutingCell[];
  journey: CutToShipJourneyRow[];
  size_produced: OrderDetailSizeProduced[];
  planned_by_colorway: Array<{ colorway_id: string; planned_by_size: SizeMap }>;
  reconciliation: CutToShipRow[];
  shipments: Array<Record<string, unknown>>;
  rejections: Array<Record<string, unknown>>;
  flowMetrics: VisitFlowMetrics[];
  flowByColor: Record<string, VisitFlowMetrics[]>;
  sizeProgress: SizeProgressLookup;
}

function journeyForVisit(
  journey: CutToShipJourneyRow[],
  visitId: string,
  deptId: string,
  colorwayId?: string | null,
): { received: number; produced: number; sent: number; wip: number; inTransit: number; missingInTransit: number } {
  const rows = journey.filter((r) => {
    const visitMatch = r.visit_id
      ? r.visit_id === visitId
      : r.dept_id === deptId;
    if (!visitMatch) return false;
    if (colorwayId && r.colorway_id && r.colorway_id !== colorwayId) return false;
    return true;
  });
  if (rows.length === 0) return { received: 0, produced: 0, sent: 0, wip: 0, inTransit: 0, missingInTransit: 0 };
  let received = 0;
  let produced = 0;
  let sent = 0;
  let wip = 0;
  let inTransit = 0;
  let missingInTransit = 0;
  for (const r of rows) {
    received += Number(r.qty_received) || 0;
    produced += Number(r.qty_produced) || 0;
    sent += Number(r.qty_sent) || 0;
    wip += Number(r.wip_qty) || 0;
    inTransit += Number(r.qty_in_transit) || 0;
    missingInTransit += Number(r.qty_missing_in_transit) || 0;
  }
  return { received, produced, sent, wip, inTransit, missingInTransit };
}

function cellsToFlowMetrics(
  cells: OrderDetailRoutingCell[],
  journey: CutToShipJourneyRow[],
  colorwayId?: string | null,
): VisitFlowMetrics[] {
  return cells.map((cell) => {
    const m = journeyForVisit(journey, cell.visit_id, cell.dept_id, colorwayId);
    const opNames = (cell.operations || [])
      .map((o) => o.operation_name)
      .filter((n): n is string => Boolean(n) && n !== cell.dept_name);
    const activitiesLabel = opNames.join(' · ');
    return {
      visitId: cell.visit_id,
      deptId: cell.dept_id,
      deptName: cell.dept_name,
      activitiesLabel,
      label: activitiesLabel ? `${cell.dept_name} (${activitiesLabel})` : cell.dept_name,
      primaryRouteId: cell.primary_route_id ?? undefined,
      received: m.received,
      produced: m.produced,
      sent: m.sent,
      wip: m.wip > 0 ? m.wip : Math.max(0, m.received - m.sent),
      inTransit: m.inTransit,
      missingInTransit: m.missingInTransit,
    };
  });
}

function sizeProgressFromBundle(
  sizeProduced: OrderDetailSizeProduced[],
  plannedByColorway: Array<{ colorway_id: string; planned_by_size: SizeMap }> = [],
): SizeProgressLookup {
  const plannedByColor = new Map(
    plannedByColorway.map((p) => [p.colorway_id, p.planned_by_size || {}]),
  );
  const byRoute = new Map<string, SizeMap>();
  const byVisit = new Map<string, SizeMap>();
  const byDept = new Map<string, SizeMap>();

  const absorb = (colorwayId: string, routeId: string, visitId: string, deptName: string, raw: SizeMap) => {
    const planned = plannedByColor.get(colorwayId) ?? {};
    const sizeMap = normalizeBundleSizeMap(raw, planned);
    if (sumSizeMap(sizeMap) <= 0) return;

    if (routeId) {
      const routeKey = `${colorwayId}|${routeId}`;
      const routeExisting = byRoute.get(routeKey) || {};
      for (const [size, qty] of Object.entries(sizeMap)) {
        routeExisting[size] = (routeExisting[size] || 0) + (Number(qty) || 0);
      }
      byRoute.set(routeKey, routeExisting);
    }

    if (visitId) {
      const visitKey = `${colorwayId}|${visitId}`;
      const visitExisting = byVisit.get(visitKey) || {};
      for (const [size, qty] of Object.entries(sizeMap)) {
        visitExisting[size] = (visitExisting[size] || 0) + (Number(qty) || 0);
      }
      byVisit.set(visitKey, visitExisting);
    }

    if (deptName) {
      const deptKey = `${colorwayId}|${deptName}`;
      const deptExisting = byDept.get(deptKey) || {};
      for (const [size, qty] of Object.entries(sizeMap)) {
        deptExisting[size] = (deptExisting[size] || 0) + (Number(qty) || 0);
      }
      byDept.set(deptKey, deptExisting);
    }
  };

  for (const row of sizeProduced) {
    absorb(
      row.colorway_id,
      row.route_id || '',
      row.visit_id || '',
      row.dept_name || '',
      row.produced_by_size || {},
    );
  }

  const aggregateByRoute = new Map<string, SizeMap>();
  const aggregateByVisit = new Map<string, SizeMap>();
  const aggregateByDept = new Map<string, SizeMap>();

  for (const [key, sizeMap] of byRoute) {
    const routeId = key.split('|').slice(1).join('|');
    const agg = aggregateByRoute.get(routeId) || {};
    for (const [size, qty] of Object.entries(sizeMap)) {
      agg[size] = (agg[size] || 0) + (Number(qty) || 0);
    }
    aggregateByRoute.set(routeId, agg);
  }
  for (const [key, sizeMap] of byVisit) {
    const visitId = key.split('|').slice(1).join('|');
    const agg = aggregateByVisit.get(visitId) || {};
    for (const [size, qty] of Object.entries(sizeMap)) {
      agg[size] = (agg[size] || 0) + (Number(qty) || 0);
    }
    aggregateByVisit.set(visitId, agg);
  }
  for (const [key, sizeMap] of byDept) {
    const deptName = key.split('|').slice(1).join('|');
    const agg = aggregateByDept.get(deptName) || {};
    for (const [size, qty] of Object.entries(sizeMap)) {
      agg[size] = (agg[size] || 0) + (Number(qty) || 0);
    }
    aggregateByDept.set(deptName, agg);
  }

  return {
    getSizeCount(colorwayId, deptName, size) {
      if (colorwayId) {
        return Number(byDept.get(`${colorwayId}|${deptName}`)?.[size]) || 0;
      }
      return Number(aggregateByDept.get(deptName)?.[size]) || 0;
    },
    getDeptTotal(colorwayId, deptName) {
      if (colorwayId) {
        return sumSizeMap(byDept.get(`${colorwayId}|${deptName}`));
      }
      return sumSizeMap(aggregateByDept.get(deptName));
    },
    getVisitSizeCount(colorwayId, visitId, size) {
      if (colorwayId) {
        return Number(byVisit.get(`${colorwayId}|${visitId}`)?.[size]) || 0;
      }
      return Number(aggregateByVisit.get(visitId)?.[size]) || 0;
    },
    getVisitTotal(colorwayId, visitId) {
      if (colorwayId) {
        return sumSizeMap(byVisit.get(`${colorwayId}|${visitId}`));
      }
      return sumSizeMap(aggregateByVisit.get(visitId));
    },
    getRouteSizeCount(colorwayId, routeId, size) {
      if (colorwayId) {
        return Number(byRoute.get(`${colorwayId}|${routeId}`)?.[size]) || 0;
      }
      return Number(aggregateByRoute.get(routeId)?.[size]) || 0;
    },
    getRouteTotal(colorwayId, routeId) {
      if (colorwayId) {
        return sumSizeMap(byRoute.get(`${colorwayId}|${routeId}`));
      }
      return sumSizeMap(aggregateByRoute.get(routeId));
    },
  };
}

/** Expand aggregate-only { TOTAL: n } maps into planned size keys for matrix cells. */
function normalizeBundleSizeMap(sizeMap: SizeMap, planned: SizeMap): SizeMap {
  const directTotal = sumSizeMap(sizeMap);
  if (directTotal <= 0) return sizeMap;

  const sizeKeys = Object.keys(sizeMap).filter((k) => k !== 'TOTAL');
  const hasDirectSizes = sizeKeys.some((k) => (sizeMap[k] ?? 0) > 0);
  if (hasDirectSizes) {
    const out: SizeMap = {};
    for (const [k, v] of Object.entries(sizeMap)) {
      if (k === 'TOTAL') continue;
      const n = Number(v) || 0;
      if (n > 0) out[k] = n;
    }
    return out;
  }

  const aggregate = sizeMap.TOTAL ?? directTotal;
  if (sumSizeMap(planned) > 0) {
    return proportionalDistribute(aggregate, planned);
  }
  return { TOTAL: aggregate };
}

type CachedBundle = Omit<OrderDetailBundle, 'flowMetrics' | 'flowByColor' | 'sizeProgress'>;

function bundleCacheKey(
  factoryId: string,
  orderId: string,
  routingSteps?: OrderRoutingStepLike[],
): string {
  const route = (routingSteps ?? [])
    .map((s) => `${s.id ?? ''}:${s.seq ?? 0}:${s.visit_id ?? ''}`)
    .join(',');
  return `${factoryId}|${orderId}|${route}`;
}

const bundleCache = new Map<string, CachedBundle>();
const bundleInflight = new Map<string, Promise<CachedBundle | null>>();

/** Drop cached bundle after saves / refresh so the next read is fresh. */
export function invalidateOrderDetailBundle(factoryId: string, orderId?: string): void {
  const prefix = orderId ? `${factoryId}|${orderId}|` : `${factoryId}|`;
  for (const key of bundleCache.keys()) {
    if (key.startsWith(prefix)) bundleCache.delete(key);
  }
  for (const key of bundleInflight.keys()) {
    if (key.startsWith(prefix)) bundleInflight.delete(key);
  }
}

async function enrichBundle(
  parsed: Omit<OrderDetailBundle, 'flowMetrics' | 'flowByColor' | 'sizeProgress'>,
  colorwayIds: string[],
): Promise<OrderDetailBundle> {
  const flowMetrics = cellsToFlowMetrics(parsed.routing_cells, parsed.journey);
  const flowByColor: Record<string, VisitFlowMetrics[]> = {};
  for (const cwId of colorwayIds) {
    flowByColor[cwId] = cellsToFlowMetrics(parsed.routing_cells, parsed.journey, cwId);
  }
  const sizeProgress = sizeProgressFromBundle(parsed.size_produced, parsed.planned_by_colorway);
  return {
    ...parsed,
    flowMetrics,
    flowByColor,
    sizeProgress,
  };
}

function parseBundle(raw: unknown): Omit<OrderDetailBundle, 'flowMetrics' | 'flowByColor' | 'sizeProgress'> {
  const row = (raw || {}) as Record<string, unknown>;
  const journey = (Array.isArray(row.journey) ? row.journey : []) as CutToShipJourneyRow[];
  const routing_cells = (Array.isArray(row.routing_cells) ? row.routing_cells : []) as OrderDetailRoutingCell[];
  const size_produced = (Array.isArray(row.size_produced) ? row.size_produced : []) as OrderDetailSizeProduced[];
  const planned_by_colorway = (
    Array.isArray(row.planned_by_colorway) ? row.planned_by_colorway : []
  ) as Array<{ colorway_id: string; planned_by_size: SizeMap }>;
  const reconciliation = (
    Array.isArray(row.reconciliation) ? row.reconciliation : []
  ).map((item) => {
    const r = item as Record<string, unknown>;
    return {
      ...(r as unknown as CutToShipRow),
      cut_qty_by_component: parseFabricCutQtyComponents(r.cut_qty_by_component),
    };
  });
  const shipments = (
    Array.isArray(row.shipments) ? row.shipments : []
  ) as Array<Record<string, unknown>>;
  const rejections = (
    Array.isArray(row.rejections) ? row.rejections : []
  ) as Array<Record<string, unknown>>;

  return {
    factory_id: String(row.factory_id || ''),
    order_id: String(row.order_id || ''),
    routing_cells,
    journey,
    size_produced,
    planned_by_colorway,
    reconciliation,
    shipments,
    rejections,
  };
}

async function loadOrderDetailBundleUncached(
  factoryId: string,
  orderId: string,
): Promise<CachedBundle | null> {
  const started = performance.now();
  const { data, error } = await supabase.rpc('get_order_detail_bundle', {
    p_factory_id: factoryId,
    p_order_id: orderId,
  });

  if (!error && data && typeof data === 'object' && !('error' in (data as object))) {
    return parseBundle(data);
  }

  return null;
}

/**
 * One RPC for Style Details / Color Details. Uses get_order_detail_bundle only;
 * no client-side re-aggregation fallback. Dedupes concurrent calls per order.
 */
export async function fetchOrderDetailBundle(
  factoryId: string,
  orderId: string,
  colorwayIds: string[],
  fallbackRoutingSteps?: OrderRoutingStepLike[],
  _fallbackDepartments?: Array<{ id: string; name: string }>,
): Promise<OrderDetailBundle> {
  const cacheKey = bundleCacheKey(factoryId, orderId, fallbackRoutingSteps);
  const cached = bundleCache.get(cacheKey);
  if (cached) return enrichBundle(cached, colorwayIds);

  let inflight = bundleInflight.get(cacheKey);
  if (!inflight) {
    inflight = loadOrderDetailBundleUncached(factoryId, orderId)
      .then((parsed) => {
        if (parsed) bundleCache.set(cacheKey, parsed);
        bundleInflight.delete(cacheKey);
        return parsed;
      })
      .catch((err) => {
        bundleInflight.delete(cacheKey);
        throw err;
      });
    bundleInflight.set(cacheKey, inflight);
  }

  const parsed = await inflight;
  if (parsed) return enrichBundle(parsed, colorwayIds);

  throw new Error(
    `[fetchOrderDetailBundle] get_order_detail_bundle unavailable for order ${orderId}: ` +
      'no fallback re-aggregation is used.'
  );
}
