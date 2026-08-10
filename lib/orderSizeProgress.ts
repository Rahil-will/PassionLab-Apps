import { supabase } from './supabase';
import type { SizeMap } from './mesSizeDisplay';
import { sumSizeMap } from './mesSizeDisplay';
import { proportionalDistribute } from './cutToShipOps';
import { sizeAdjQty, sizeOrderQty } from './colorwaySizesUtils';
import type { SizeQty } from '../types';
import type { VisitFlowMetrics } from './orderFlowMetrics';

export interface OrderDeptProgress {
  cumulative_produced: number;
  today_produced: number;
  today_target: number;
  cumulative_sent: number;
  today_sent: number;
  available_to_send: number;
  planned_qty_by_size: SizeMap;
  produced_qty_by_size: SizeMap;
  sent_qty_by_size: SizeMap;
  remaining_qty: number;
}

export type ProductionProgressPhase = 'not_started' | 'in_progress' | 'complete';

export interface FlowStepRef {
  dept_id: string;
  dept_name: string;
}

function mergeHourlySizeMaps(rows: Array<{ count_by_size?: unknown; count?: unknown }>): SizeMap {
  const out: SizeMap = {};
  for (const raw of rows) {
    const bySize = raw.count_by_size;
    if (bySize && typeof bySize === 'object' && !Array.isArray(bySize)) {
      for (const [size, qty] of Object.entries(bySize as Record<string, unknown>)) {
        out[size] = (out[size] || 0) + (Number(qty) || 0);
      }
      continue;
    }
    const total = Number(raw.count) || 0;
    if (total > 0) out.TOTAL = (out.TOTAL || 0) + total;
  }
  return out;
}

function mergeQcSessionSizeMaps(
  rows: Array<{
    passed_by_size?: unknown;
    passed?: unknown;
  }>,
): SizeMap {
  const out: SizeMap = {};
  for (const raw of rows) {
    let usedSizeBreakdown = false;
    const bySize = raw.passed_by_size;
    if (bySize && typeof bySize === 'object' && !Array.isArray(bySize)) {
      for (const [size, qty] of Object.entries(bySize as Record<string, unknown>)) {
        const n = Number(qty) || 0;
        if (n > 0) {
          out[size] = (out[size] || 0) + n;
          usedSizeBreakdown = true;
        }
      }
    }
    if (!usedSizeBreakdown) {
      const qty = Number(raw.passed) || 0;
      if (qty > 0) out.TOTAL = (out.TOTAL || 0) + qty;
    }
  }
  return out;
}

async function fetchProducedBySizeFromTables(
  factoryId: string,
  orderId: string,
  colorwayId: string,
  departmentId: string,
): Promise<SizeMap> {
  const [hourlyRes, qcRes] = await Promise.all([
    supabase
      .from('hourly_counts')
      .select('count_by_size, count')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .eq('colorway_id', colorwayId)
      .eq('department_id', departmentId),
    supabase
      .from('inspection_sessions')
      .select('passed, rework_passed, passed_by_size, rework_by_size')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .eq('colorway_id', colorwayId)
      .eq('department_id', departmentId),
  ]);

  const hourlyMap = mergeHourlySizeMaps(hourlyRes.data || []);
  if (hourlyRes.error) {
    console.warn('[orderSizeProgress] hourly_counts:', hourlyRes.error.message);
  }
  if (sumSizeMap(hourlyMap) > 0) return hourlyMap;

  if (qcRes.error) {
    console.warn('[orderSizeProgress] inspection_sessions:', qcRes.error.message);
  }
  return mergeQcSessionSizeMaps(qcRes.data || []);
}

async function fetchPlannedBySize(colorwayId: string): Promise<SizeMap> {
  const { data } = await supabase
    .from('colorways')
    .select('sizes')
    .eq('id', colorwayId)
    .maybeSingle();
  const rows = (data?.sizes as SizeQty[] | undefined) ?? [];
  const planned: SizeMap = {};
  for (const row of rows) {
    const qty = sizeAdjQty(row) || sizeOrderQty(row);
    if (qty > 0) planned[row.size] = qty;
  }
  return planned;
}

function normalizeProducedSizeMap(sizeMap: SizeMap, planned: SizeMap): SizeMap {
  const directTotal = sumSizeMap(sizeMap);
  if (directTotal <= 0) return sizeMap;

  const sizeKeys = Object.keys(sizeMap).filter((k) => k !== 'TOTAL');
  const hasDirectSizes = sizeKeys.some((k) => (sizeMap[k] ?? 0) > 0);
  if (hasDirectSizes) return sizeMap;

  const aggregate = sizeMap.TOTAL ?? directTotal;
  if (sumSizeMap(planned) > 0) {
    return proportionalDistribute(aggregate, planned);
  }
  return { TOTAL: aggregate };
}

async function resolveProducedBySize(
  factoryId: string,
  orderId: string,
  colorwayId: string,
  departmentId: string,
): Promise<SizeMap> {
  if (!departmentId) return {};

  const planned = await fetchPlannedBySize(colorwayId);

  try {
    const progress = await fetchOrderDeptProgress(
      factoryId,
      orderId,
      colorwayId,
      departmentId,
    );
    let sizeMap = progress.produced_qty_by_size || {};
    if (sumSizeMap(sizeMap) === 0 && progress.cumulative_produced > 0) {
      sizeMap = proportionalDistribute(
        progress.cumulative_produced,
        progress.planned_qty_by_size || planned,
      );
    }
    const normalized = normalizeProducedSizeMap(sizeMap, planned);
    if (sumSizeMap(normalized) > 0) return normalized;
  } catch {
    // RPC may be missing on partial schema deploys — fall through to tables.
  }

  const tableMap = await fetchProducedBySizeFromTables(factoryId, orderId, colorwayId, departmentId);
  return normalizeProducedSizeMap(tableMap, planned);
}

export interface SizeProgressLookup {
  getSizeCount: (colorwayId: string | undefined, deptName: string, size: string) => number;
  getDeptTotal: (colorwayId: string | undefined, deptName: string) => number;
  getVisitSizeCount?: (colorwayId: string | undefined, visitId: string, size: string) => number;
  getVisitTotal?: (colorwayId: string | undefined, visitId: string) => number;
  /** Per routing step (hourly_counts.order_route_id) — used when visit rollup is empty. */
  getRouteSizeCount?: (colorwayId: string | undefined, routeStepId: string, size: string) => number;
  getRouteTotal?: (colorwayId: string | undefined, routeStepId: string) => number;
}

function mergeSizeMaps(target: SizeMap, source: SizeMap): void {
  for (const [size, qty] of Object.entries(source)) {
    target[size] = (target[size] || 0) + (Number(qty) || 0);
  }
}

function parseOrderDeptProgress(raw: unknown): OrderDeptProgress {
  const row = (raw || {}) as Record<string, unknown>;
  return {
    cumulative_produced: Number(row.cumulative_produced) || 0,
    today_produced: Number(row.today_produced) || 0,
    today_target: Number(row.today_target) || 0,
    cumulative_sent: Number(row.cumulative_sent) || 0,
    today_sent: Number(row.today_sent) || 0,
    available_to_send: Number(row.available_to_send) || 0,
    planned_qty_by_size: (row.planned_qty_by_size as SizeMap) || {},
    produced_qty_by_size: (row.produced_qty_by_size as SizeMap) || {},
    sent_qty_by_size: (row.sent_qty_by_size as SizeMap) || {},
    remaining_qty: Number(row.remaining_qty) || 0,
  };
}

export async function fetchOrderDeptProgress(
  factoryId: string,
  orderId: string,
  colorwayId: string,
  departmentId: string,
  date?: string,
): Promise<OrderDeptProgress> {
  const { data, error } = await supabase.rpc('get_order_dept_progress', {
    p_factory_id: factoryId,
    p_order_id: orderId,
    p_colorway_id: colorwayId,
    p_department_id: departmentId,
    p_date: date ?? new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  return parseOrderDeptProgress(data);
}

export async function buildSizeProgressLookup(
  factoryId: string,
  orderId: string,
  colorwayIds: string[],
  flowSteps: FlowStepRef[],
): Promise<SizeProgressLookup> {
  const activeSteps = flowSteps
    .map((s) => ({
      dept_id: s.dept_id,
      dept_name: s.dept_name,
    }))
    .filter((s) => s.dept_id || s.dept_name);

  const byColorwayDept = new Map<string, SizeMap>();

  if (colorwayIds.length === 0) {
    return {
      getSizeCount: () => 0,
      getDeptTotal: () => 0,
    };
  }

  // One batch of table reads for the whole order (was N colorways × M depts of RPCs).
  const [hourlyRes, qcRes, batchRes, cuttingRes, cuttingSessionRes, shipmentRes, routeRes, fabricRes, colorwayRes] =
    await Promise.all([
      supabase
        .from('hourly_counts')
        .select('colorway_id, department_id, count_by_size, count')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('inspection_sessions')
        .select('colorway_id, department_id, passed, rework_passed, passed_by_size, rework_by_size')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('batch_production')
        .select('colorway_id, department_id, produced_by_size')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('cutting_bundles')
        .select('colorway_id, session_id, size, qty, fabric_component_id')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('cutting_sessions')
        .select('id, order_route_id')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId),
      supabase
        .from('shipments')
        .select('colorway_id, order_route_id, shipped_qty_by_size')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('order_routing_steps')
        .select('id, dept_id')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId),
      supabase
        .from('fabric_components')
        .select('id')
        .eq('factory_id', factoryId)
        .eq('is_primary', true)
        .limit(1),
      supabase
        .from('colorways')
        .select('id, sizes')
        .eq('factory_id', factoryId)
        .in('id', colorwayIds),
    ]);

  if (hourlyRes.error) {
    console.warn('[orderSizeProgress] hourly_counts batch:', hourlyRes.error.message);
  }
  if (qcRes.error) {
    console.warn('[orderSizeProgress] inspection_sessions batch:', qcRes.error.message);
  }
  if (batchRes.error) {
    console.warn('[orderSizeProgress] batch_production batch:', batchRes.error.message);
  }
  if (cuttingRes.error) {
    console.warn('[orderSizeProgress] cutting_bundles batch:', cuttingRes.error.message);
  }
  if (cuttingSessionRes.error) {
    console.warn('[orderSizeProgress] cutting_sessions batch:', cuttingSessionRes.error.message);
  }
  if (shipmentRes.error) {
    console.warn('[orderSizeProgress] shipments batch:', shipmentRes.error.message);
  }

  const primaryFabricId = (fabricRes.data || [])[0]?.id as string | undefined;
  const sessionToRoute = new Map((cuttingSessionRes.data || []).map((s) => [s.id as string, s.order_route_id as string]));
  const routeToDept = new Map((routeRes.data || []).map((r) => [r.id as string, r.dept_id as string]));

  const plannedByColor = new Map<string, SizeMap>();
  for (const row of colorwayRes.data || []) {
    const planned: SizeMap = {};
    for (const sizeRow of ((row.sizes as SizeQty[] | undefined) ?? [])) {
      const qty = sizeAdjQty(sizeRow) || sizeOrderQty(sizeRow);
      if (qty > 0) planned[sizeRow.size] = qty;
    }
    plannedByColor.set(row.id as string, planned);
  }

  type AggKey = string;
  const hourlyByKey = new Map<AggKey, Array<{ count_by_size?: unknown; count?: unknown }>>();
  for (const raw of hourlyRes.data || []) {
    const cw = (raw.colorway_id as string) || '';
    const dept = (raw.department_id as string) || '';
    if (!cw || !dept) continue;
    const key = `${cw}|${dept}`;
    const list = hourlyByKey.get(key) ?? [];
    list.push(raw);
    hourlyByKey.set(key, list);
  }

  const qcByKey = new Map<AggKey, SizeMap>();
  for (const raw of qcRes.data || []) {
    const cw = (raw.colorway_id as string) || '';
    const dept = (raw.department_id as string) || '';
    if (!cw || !dept) continue;
    const key = `${cw}|${dept}`;
    const existing = qcByKey.get(key) ?? {};
    const merged = mergeQcSessionSizeMaps([raw]);
    for (const [size, qty] of Object.entries(merged)) {
      existing[size] = (existing[size] || 0) + qty;
    }
    qcByKey.set(key, existing);
  }

  const batchByKey = new Map<AggKey, SizeMap>();
  for (const raw of batchRes.data || []) {
    const cw = (raw.colorway_id as string) || '';
    const dept = (raw.department_id as string) || '';
    if (!cw || !dept) continue;
    const key = `${cw}|${dept}`;
    const existing = batchByKey.get(key) ?? {};
    const merged = mergeHourlySizeMaps([{ count_by_size: raw.produced_by_size }]);
    for (const [size, qty] of Object.entries(merged)) {
      existing[size] = (existing[size] || 0) + qty;
    }
    batchByKey.set(key, existing);
  }

  const cuttingByKey = new Map<AggKey, SizeMap>();
  for (const raw of cuttingRes.data || []) {
    const cw = (raw.colorway_id as string) || '';
    const routeId = sessionToRoute.get(raw.session_id as string);
    const dept = routeId ? routeToDept.get(routeId) : '';
    if (!cw || !dept) continue;
    const fabricId = raw.fabric_component_id as string | null;
    if (primaryFabricId && fabricId && fabricId !== primaryFabricId) continue;
    const key = `${cw}|${dept}`;
    const existing = cuttingByKey.get(key) ?? {};
    const size = (raw.size as string) || 'TOTAL';
    existing[size] = (existing[size] || 0) + (Number(raw.qty) || 0);
    cuttingByKey.set(key, existing);
  }

  const shipmentByKey = new Map<AggKey, SizeMap>();
  for (const raw of shipmentRes.data || []) {
    const cw = (raw.colorway_id as string) || '';
    const routeId = (raw.order_route_id as string) || '';
    const dept = routeToDept.get(routeId) || '';
    if (!cw || !dept) continue;
    const key = `${cw}|${dept}`;
    const existing = shipmentByKey.get(key) ?? {};
    const merged = mergeHourlySizeMaps([{ count_by_size: raw.shipped_qty_by_size }]);
    for (const [size, qty] of Object.entries(merged)) {
      existing[size] = (existing[size] || 0) + qty;
    }
    shipmentByKey.set(key, existing);
  }

  for (const colorwayId of colorwayIds) {
    const planned = plannedByColor.get(colorwayId) ?? {};
    for (const step of activeSteps) {
      const mapKey = `${colorwayId}|${step.dept_name}`;
      const deptId = step.dept_id;
      if (!deptId) {
        byColorwayDept.set(mapKey, {});
        continue;
      }
      const tableKey = `${colorwayId}|${deptId}`;
      const hourlyMap = mergeHourlySizeMaps(hourlyByKey.get(tableKey) ?? []);
      let sizeMap: SizeMap = {};
      mergeSizeMaps(sizeMap, hourlyMap);
      mergeSizeMaps(sizeMap, qcByKey.get(tableKey) ?? {});
      mergeSizeMaps(sizeMap, batchByKey.get(tableKey) ?? {});
      mergeSizeMaps(sizeMap, cuttingByKey.get(tableKey) ?? {});
      mergeSizeMaps(sizeMap, shipmentByKey.get(tableKey) ?? {});
      sizeMap = normalizeProducedSizeMap(sizeMap, planned);
      byColorwayDept.set(mapKey, sizeMap);
    }
  }

  const aggregateByDept = new Map<string, SizeMap>();
  for (const [key, sizeMap] of byColorwayDept) {
    const deptName = key.split('|')[1];
    const agg = aggregateByDept.get(deptName) || {};
    mergeSizeMaps(agg, sizeMap);
    aggregateByDept.set(deptName, agg);
  }

  return {
    getSizeCount(colorwayId, deptName, size) {
      if (colorwayId) {
        return Number(byColorwayDept.get(`${colorwayId}|${deptName}`)?.[size]) || 0;
      }
      return Number(aggregateByDept.get(deptName)?.[size]) || 0;
    },
    getDeptTotal(colorwayId, deptName) {
      if (colorwayId) {
        return sumSizeMap(byColorwayDept.get(`${colorwayId}|${deptName}`));
      }
      return sumSizeMap(aggregateByDept.get(deptName));
    },
  };
}

type RouteStepRef = {
  id?: string;
  visit_id?: string | null;
  dept_name?: string;
  step_label?: string;
  operation_name?: string;
  step_type?: string | null;
};

/** Size progress keyed by order_route_id when bundle RPC returns no size_produced rows. */
export async function buildRouteSizeProgressLookup(
  factoryId: string,
  orderId: string,
  colorwayIds: string[],
  routingSteps: RouteStepRef[],
): Promise<SizeProgressLookup> {
  const stepById = new Map(
    routingSteps.filter((s) => s.id).map((s) => [s.id as string, s]),
  );

  const [
    hourlyRes,
    qcRes,
    batchRes,
    cuttingRes,
    cuttingSessionRes,
    shipmentRes,
    outsourceReceiveRes,
    fabricRes,
    colorwayRes,
  ] = await Promise.all([
      supabase
        .from('hourly_counts')
        .select('colorway_id, order_route_id, count_by_size, count')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('inspection_sessions')
        .select('colorway_id, order_route_id, passed, rework_passed, passed_by_size, rework_by_size')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('batch_production')
        .select('colorway_id, order_route_id, produced_by_size')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('cutting_bundles')
        .select('colorway_id, session_id, size, qty, fabric_component_id')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('cutting_sessions')
        .select('id, order_route_id')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId),
      supabase
        .from('shipments')
        .select('colorway_id, order_route_id, shipped_qty_by_size')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .in('colorway_id', colorwayIds),
      supabase
        .from('outsource_work_movements')
        .select('colorway_id, order_route_id, qty_by_size, qty')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .eq('movement_type', 'vendor_receive')
        .is('voided_at', null)
        .in('colorway_id', colorwayIds),
      supabase
        .from('fabric_components')
        .select('id')
        .eq('factory_id', factoryId)
        .eq('is_primary', true)
        .limit(1),
      supabase
        .from('colorways')
        .select('id, sizes')
        .eq('factory_id', factoryId)
        .in('id', colorwayIds),
    ]);

  if (hourlyRes.error) {
    console.warn('[buildRouteSizeProgressLookup] hourly_counts:', hourlyRes.error.message);
  }
  if (qcRes.error) {
    console.warn('[buildRouteSizeProgressLookup] inspection_sessions:', qcRes.error.message);
  }
  if (batchRes.error) {
    console.warn('[buildRouteSizeProgressLookup] batch_production:', batchRes.error.message);
  }
  if (cuttingRes.error) {
    console.warn('[buildRouteSizeProgressLookup] cutting_bundles:', cuttingRes.error.message);
  }
  if (cuttingSessionRes.error) {
    console.warn('[buildRouteSizeProgressLookup] cutting_sessions:', cuttingSessionRes.error.message);
  }
  if (shipmentRes.error) {
    console.warn('[buildRouteSizeProgressLookup] shipments:', shipmentRes.error.message);
  }
  if (outsourceReceiveRes.error) {
    console.warn('[buildRouteSizeProgressLookup] outsource_work_movements:', outsourceReceiveRes.error.message);
  }

  const primaryFabricId = (fabricRes.data || [])[0]?.id as string | undefined;
  const sessionToRoute = new Map((cuttingSessionRes.data || []).map((s) => [s.id as string, s.order_route_id as string]));

  const plannedByColor = new Map<string, SizeMap>();
  for (const row of colorwayRes.data || []) {
    const planned: SizeMap = {};
    for (const sizeRow of ((row.sizes as SizeQty[] | undefined) ?? [])) {
      const qty = sizeAdjQty(sizeRow) || sizeOrderQty(sizeRow);
      if (qty > 0) planned[sizeRow.size] = qty;
    }
    plannedByColor.set(row.id as string, planned);
  }

  const byRoute = new Map<string, SizeMap>();
  const byVisit = new Map<string, SizeMap>();
  const byDept = new Map<string, SizeMap>();

  const absorb = (cw: string, routeId: string, chunk: SizeMap) => {
    const step = stepById.get(routeId);
    const visitId = step?.visit_id || routeId;
    const deptName = (step?.dept_name || step?.step_label || step?.operation_name || '').trim();
    const planned = plannedByColor.get(cw) ?? {};
    const normalized = normalizeProducedSizeMap(chunk, planned);

    const routeKey = `${cw}|${routeId}`;
    const routeExisting = byRoute.get(routeKey) ?? {};
    mergeSizeMaps(routeExisting, normalized);
    byRoute.set(routeKey, routeExisting);

    const visitKey = `${cw}|${visitId}`;
    const visitExisting = byVisit.get(visitKey) ?? {};
    mergeSizeMaps(visitExisting, normalized);
    byVisit.set(visitKey, visitExisting);

    if (deptName) {
      const deptKey = `${cw}|${deptName}`;
      const deptExisting = byDept.get(deptKey) ?? {};
      mergeSizeMaps(deptExisting, normalized);
      byDept.set(deptKey, deptExisting);
    }
  };

  for (const raw of hourlyRes.data || []) {
    const routeId = (raw.order_route_id as string) || '';
    const cw = (raw.colorway_id as string) || '';
    if (!routeId || !cw) continue;
    absorb(cw, routeId, mergeHourlySizeMaps([raw]));
  }

  for (const raw of qcRes.data || []) {
    const routeId = (raw.order_route_id as string) || '';
    const cw = (raw.colorway_id as string) || '';
    if (!routeId || !cw) continue;
    absorb(cw, routeId, mergeQcSessionSizeMaps([raw]));
  }

  for (const raw of batchRes.data || []) {
    const routeId = (raw.order_route_id as string) || '';
    const cw = (raw.colorway_id as string) || '';
    if (!routeId || !cw) continue;
    absorb(cw, routeId, mergeHourlySizeMaps([{ count_by_size: raw.produced_by_size }]));
  }

  for (const raw of cuttingRes.data || []) {
    const cw = (raw.colorway_id as string) || '';
    if (!cw) continue;
    const routeId = sessionToRoute.get(raw.session_id as string);
    if (!routeId) continue;
    const fabricId = raw.fabric_component_id as string | null;
    if (primaryFabricId && fabricId && fabricId !== primaryFabricId) continue;
    const size = (raw.size as string) || 'TOTAL';
    absorb(cw, routeId, { [size]: Number(raw.qty) || 0 });
  }

  for (const raw of shipmentRes.data || []) {
    const routeId = (raw.order_route_id as string) || '';
    const cw = (raw.colorway_id as string) || '';
    if (!routeId || !cw) continue;
    absorb(cw, routeId, mergeHourlySizeMaps([{ count_by_size: raw.shipped_qty_by_size }]));
  }

  for (const raw of outsourceReceiveRes.data || []) {
    const routeId = (raw.order_route_id as string) || '';
    const cw = (raw.colorway_id as string) || '';
    if (!routeId || !cw) continue;
    absorb(cw, routeId, mergeHourlySizeMaps([{ count_by_size: raw.qty_by_size, count: raw.qty }]));
  }

  const aggregateByRoute = new Map<string, SizeMap>();
  const aggregateByVisit = new Map<string, SizeMap>();
  const aggregateByDept = new Map<string, SizeMap>();

  for (const [key, sizeMap] of byRoute) {
    const routeId = key.split('|').slice(1).join('|');
    const agg = aggregateByRoute.get(routeId) ?? {};
    mergeSizeMaps(agg, sizeMap);
    aggregateByRoute.set(routeId, agg);
  }
  for (const [key, sizeMap] of byVisit) {
    const visitId = key.split('|').slice(1).join('|');
    const agg = aggregateByVisit.get(visitId) ?? {};
    mergeSizeMaps(agg, sizeMap);
    aggregateByVisit.set(visitId, agg);
  }
  for (const [key, sizeMap] of byDept) {
    const deptName = key.split('|').slice(1).join('|');
    const agg = aggregateByDept.get(deptName) ?? {};
    mergeSizeMaps(agg, sizeMap);
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
    getRouteSizeCount(colorwayId, routeStepId, size) {
      if (colorwayId) {
        return Number(byRoute.get(`${colorwayId}|${routeStepId}`)?.[size]) || 0;
      }
      return Number(aggregateByRoute.get(routeStepId)?.[size]) || 0;
    },
    getRouteTotal(colorwayId, routeStepId) {
      if (colorwayId) {
        return sumSizeMap(byRoute.get(`${colorwayId}|${routeStepId}`));
      }
      return sumSizeMap(aggregateByRoute.get(routeStepId));
    },
  };
}

export function formatProductionStatus(phase: ProductionProgressPhase): string {
  switch (phase) {
    case 'not_started':
      return 'Not Started';
    case 'in_progress':
      return 'In Progress';
    case 'complete':
      return 'Complete';
  }
}

export function statusColorClass(phase: ProductionProgressPhase): string {
  switch (phase) {
    case 'not_started':
      return 'text-slate-500';
    case 'in_progress':
      return 'text-blue-600';
    case 'complete':
      return 'text-emerald-600';
  }
}

export function deriveColorwayProgressPhase(
  flowMetrics: VisitFlowMetrics[],
  plannedTotal: number,
  getVisitTotal: (visitId: string) => number,
): ProductionProgressPhase {
  if (flowMetrics.length === 0 || plannedTotal <= 0) return 'not_started';
  const any = flowMetrics.some((v) => getVisitTotal(v.visitId) > 0);
  if (!any) return 'not_started';
  const terminal = flowMetrics[flowMetrics.length - 1];
  if (getVisitTotal(terminal.visitId) >= plannedTotal) return 'complete';
  return 'in_progress';
}

export function deriveSizeProgressPhase(
  flowMetrics: VisitFlowMetrics[],
  sizeAdjQty: number,
  getVisitSizeCount: (visitId: string) => number,
): ProductionProgressPhase {
  if (flowMetrics.length === 0 || sizeAdjQty <= 0) return 'not_started';
  const any = flowMetrics.some((v) => getVisitSizeCount(v.visitId) > 0);
  if (!any) return 'not_started';
  const terminal = flowMetrics[flowMetrics.length - 1];
  if (getVisitSizeCount(terminal.visitId) >= sizeAdjQty) return 'complete';
  return 'in_progress';
}

export function colorwayStatusLabel(
  phase: ProductionProgressPhase,
  hasAllocations: boolean,
): string {
  if (phase === 'not_started' && hasAllocations) return 'Configured';
  return formatProductionStatus(phase);
}
