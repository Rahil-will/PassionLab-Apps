import { supabase } from './supabase';
import type { LineAllocationActual, ProductionSummaryRow } from '../types';
import type { CutToShipJourneyRow } from './mesReportsApi';

interface DailyOutputRow {
  order_id: string;
  colorway_id: string | null;
  department_id: string;
  operation_id?: string | null;
  output_qty: number;
  log_date: string;
}

function aggregateProductionSummary(
  rows: DailyOutputRow[],
  deptIdToName: Map<string, string>,
): ProductionSummaryRow[] {
  const agg = new Map<string, ProductionSummaryRow>();
  for (const row of rows) {
    const colorwayId = row.colorway_id || '';
    const deptName = deptIdToName.get(row.department_id) || row.department_id;
    const opId = row.operation_id || '';
    const key = `${row.order_id}|${colorwayId}|${row.department_id}|${opId}|${deptName}`;
    const qty = Number(row.output_qty) || 0;
    if (qty <= 0) continue;
    const logDate = row.log_date;
    const existing = agg.get(key);
    if (existing) {
      existing.total_passed = (existing.total_passed || 0) + qty;
      existing.total_scanned = (existing.total_scanned || 0) + qty;
      if (logDate) {
        if (!existing.first_output_date || logDate < existing.first_output_date) {
          existing.first_output_date = logDate;
        }
        if (!existing.last_output_date || logDate > existing.last_output_date) {
          existing.last_output_date = logDate;
        }
      }
    } else {
      agg.set(key, {
        order_id: row.order_id,
        colorway_id: colorwayId,
        department: deptName,
        department_id: row.department_id,
        operation_id: row.operation_id || null,
        total_passed: qty,
        total_scanned: qty,
        first_output_date: logDate || undefined,
        last_output_date: logDate || undefined,
      });
    }
  }
  return [...agg.values()];
}

async function fetchProductionSummaryFromTables(
  factoryId: string,
  deptIdToName: Map<string, string>,
): Promise<ProductionSummaryRow[]> {
  const [
    routeRes,
    deptRes,
    fabricRes,
    sessionRes,
    hourlyRes,
    qcRes,
    batchRes,
    cuttingRes,
    shipmentRes,
  ] = await Promise.all([
    supabase
      .from('order_routing_steps')
      .select('id, order_id, dept_id, operation_def_id, is_primary_output')
      .eq('factory_id', factoryId),
    supabase.from('departments').select('id, role').eq('factory_id', factoryId),
    supabase
      .from('fabric_components')
      .select('id, factory_id, is_primary')
      .eq('factory_id', factoryId)
      .eq('is_primary', true)
      .limit(1),
    supabase
      .from('cutting_sessions')
      .select('id, order_route_id')
      .eq('factory_id', factoryId),
    supabase
      .from('hourly_counts')
      .select('order_id, colorway_id, department_id, order_route_id, count, log_date')
      .eq('factory_id', factoryId),
    supabase
      .from('inspection_sessions')
      .select('order_id, colorway_id, department_id, order_route_id, passed, rework_passed, log_date')
      .eq('factory_id', factoryId),
    supabase
      .from('batch_production')
      .select('order_id, colorway_id, department_id, order_route_id, produced_qty, log_date')
      .eq('factory_id', factoryId),
    supabase
      .from('cutting_bundles')
      .select('order_id, colorway_id, session_id, qty, fabric_component_id, created_at')
      .eq('factory_id', factoryId),
    supabase
      .from('shipments')
      .select('order_id, colorway_id, order_route_id, shipped_qty, shipment_date')
      .eq('factory_id', factoryId),
  ]);

  if (hourlyRes.error) throw hourlyRes.error;
  if (qcRes.error) throw qcRes.error;
  if (batchRes.error) throw batchRes.error;
  if (cuttingRes.error) throw cuttingRes.error;
  if (shipmentRes.error) throw shipmentRes.error;
  if (routeRes.error) console.warn('[fetchProductionSummaryFromTables] order_routing_steps:', routeRes.error.message);
  if (deptRes.error) console.warn('[fetchProductionSummaryFromTables] departments:', deptRes.error.message);
  if (fabricRes.error) console.warn('[fetchProductionSummaryFromTables] fabric_components:', fabricRes.error.message);
  if (sessionRes.error) console.warn('[fetchProductionSummaryFromTables] cutting_sessions:', sessionRes.error.message);

  const rows: DailyOutputRow[] = [];

  const deptRole = new Map<string, string>();
  for (const d of deptRes.data || []) {
    deptRole.set(d.id as string, (d.role as string) || 'standard');
  }

  const routeToDept = new Map<string, string>();
  const routeToOrder = new Map<string, string>();
  const orderOriginDept = new Map<string, string>();
  const orderTerminalDept = new Map<string, string>();
  for (const r of routeRes.data || []) {
    const routeId = r.id as string;
    const deptId = r.dept_id as string;
    const orderId = r.order_id as string;
    routeToDept.set(routeId, deptId);
    routeToOrder.set(routeId, orderId);
    const role = deptRole.get(deptId);
    if (role === 'origin' && (!orderOriginDept.has(orderId) || r.is_primary_output)) {
      orderOriginDept.set(orderId, deptId);
    }
    if (role === 'terminal' && (!orderTerminalDept.has(orderId) || r.is_primary_output)) {
      orderTerminalDept.set(orderId, deptId);
    }
  }

  const sessionToRoute = new Map((sessionRes.data || []).map((s) => [s.id as string, s.order_route_id as string]));
  const primaryFabricId = (fabricRes.data || [])[0]?.id as string | undefined;

  const addRow = (
    orderId: string,
    colorwayId: string | null,
    departmentId: string | undefined,
    operationId: string | null,
    outputQty: number,
    logDate: string,
  ) => {
    if (!departmentId || outputQty <= 0) return;
    rows.push({
      order_id: orderId,
      colorway_id: colorwayId || null,
      department_id: departmentId,
      operation_id: operationId || null,
      output_qty: outputQty,
      log_date: logDate,
    });
  };

  const outputByKey = new Map<string, number>();
  const accumulate = (orderId: string, colorwayId: string | null, deptId: string, opId: string, logDate: string, qty: number) => {
    if (qty <= 0) return;
    const key = `${orderId}|${colorwayId ?? ''}|${deptId}|${opId}|${logDate}`;
    outputByKey.set(key, (outputByKey.get(key) || 0) + qty);
  };

  for (const raw of hourlyRes.data || []) {
    accumulate(
      raw.order_id as string,
      (raw.colorway_id as string) || null,
      raw.department_id as string,
      (raw.order_route_id as string) || '',
      (raw.log_date as string) || '',
      Number(raw.count) || 0,
    );
  }

  for (const raw of qcRes.data || []) {
    accumulate(
      raw.order_id as string,
      (raw.colorway_id as string) || null,
      raw.department_id as string,
      (raw.order_route_id as string) || '',
      (raw.log_date as string) || '',
      (Number(raw.passed) || 0) + (Number(raw.rework_passed) || 0),
    );
  }

  for (const raw of batchRes.data || []) {
    accumulate(
      raw.order_id as string,
      (raw.colorway_id as string) || null,
      raw.department_id as string,
      (raw.order_route_id as string) || '',
      (raw.log_date as string) || '',
      Number(raw.produced_qty) || 0,
    );
  }

  for (const raw of cuttingRes.data || []) {
    const orderId = raw.order_id as string;
    const routeId = sessionToRoute.get(raw.session_id as string);
    const deptId = routeId ? routeToDept.get(routeId) : orderOriginDept.get(orderId);
    const opId = routeId || '';
    const fabricId = raw.fabric_component_id as string | null;
    if (primaryFabricId && fabricId && fabricId !== primaryFabricId) continue;
    accumulate(
      orderId,
      (raw.colorway_id as string) || null,
      deptId || orderOriginDept.get(orderId) || '',
      opId,
      ((raw.created_at as string) || '').slice(0, 10),
      Number(raw.qty) || 0,
    );
  }

  for (const raw of shipmentRes.data || []) {
    const orderId = raw.order_id as string;
    const routeId = raw.order_route_id as string | null;
    const deptId = routeId ? routeToDept.get(routeId) : orderTerminalDept.get(orderId);
    const opId = routeId || '';
    accumulate(
      orderId,
      (raw.colorway_id as string) || null,
      deptId || orderTerminalDept.get(orderId) || '',
      opId,
      (raw.shipment_date as string) || '',
      Number(raw.shipped_qty) || 0,
    );
  }

  for (const [key, outputQty] of outputByKey) {
    if (outputQty <= 0) continue;
    const [orderId, colorwayId, departmentId, operationId, logDate] = key.split('|');
    addRow(orderId, colorwayId || null, departmentId, operationId || null, outputQty, logDate);
  }

  return aggregateProductionSummary(rows, deptIdToName);
}

async function fetchProductionSummaryFromRpc(
  factoryId: string,
  deptIdToName: Map<string, string>,
): Promise<ProductionSummaryRow[] | null> {
  const { data, error } = await supabase.rpc('get_factory_production_summary', {
    p_factory_id: factoryId,
  });
  if (error) return null;
  return aggregateProductionSummary(
    (data || []).map((r: Record<string, unknown>) => ({
      order_id: r.order_id as string,
      colorway_id: (r.colorway_id as string) || null,
      department_id: r.department_id as string,
      operation_id: (r.operation_id as string) || null,
      output_qty: Number(r.output_qty) || 0,
      log_date: (r.log_date as string) || '',
    })),
    deptIdToName,
  );
}

/** Cumulative produced qty from capture tables (visit/operation grain), not style_orders.progress. */
export async function fetchProductionSummaryFromViews(
  factoryId: string,
): Promise<ProductionSummaryRow[]> {
  const { data: depts } = await supabase
    .from('departments')
    .select('id, name')
    .eq('factory_id', factoryId);
  const deptIdToName = new Map((depts || []).map((d) => [d.id as string, d.name as string]));

  const fromRpc = await fetchProductionSummaryFromRpc(factoryId, deptIdToName);
  if (fromRpc) return fromRpc;

  return fetchProductionSummaryFromTables(factoryId, deptIdToName);
}

/**
 * Factory-wide per-order / per-visit / per-colorway cut-to-ship journey.
 * Uses order_dept_progress_rows so loading and produce output are already separated
 * server-side; this is the source of truth for dept-rollup UIs.
 */
export async function fetchFactoryOrderDeptProgressRows(
  factoryId: string,
): Promise<CutToShipJourneyRow[]> {
  const { data, error } = await supabase.rpc('order_dept_progress_rows', {
    p_factory_id: factoryId,
  });
  if (error) throw error;
  return (data || []) as CutToShipJourneyRow[];
}

function mergeAllocationActual(
  map: Map<string, LineAllocationActual>,
  lineAllocationId: string | null | undefined,
  qty: number,
  logDate?: string | null,
): void {
  if (!lineAllocationId || qty <= 0) return;
  const date = logDate?.slice(0, 10);
  const existing = map.get(lineAllocationId);
  if (existing) {
    existing.qty += qty;
    if (date) {
      if (!existing.first_output_date || date < existing.first_output_date) {
        existing.first_output_date = date;
      }
      if (!existing.last_output_date || date > existing.last_output_date) {
        existing.last_output_date = date;
      }
    }
    return;
  }
  map.set(lineAllocationId, {
    line_allocation_id: lineAllocationId,
    qty,
    first_output_date: date,
    last_output_date: date,
  });
}

/** Per line_allocation capture totals for Department Schedule running bars.
 *
 * Uses the single factory schedule RPC when available; falls back to the legacy
 * per-table scan so the UI keeps working until the migration is applied.
 */
export async function fetchLineAllocationActuals(
  factoryId: string,
): Promise<LineAllocationActual[]> {
  try {
    const { data, error } = await supabase.rpc('get_factory_schedule_actuals', {
      p_factory_id: factoryId,
    });

    if (error) throw error;

    return ((data as unknown[]) || []).map((row: any) => ({
      line_allocation_id: String(row.line_allocation_id),
      qty: Number(row.qty) || 0,
      first_output_date: row.first_output_date
        ? String(row.first_output_date).slice(0, 10)
        : undefined,
      last_output_date: row.last_output_date
        ? String(row.last_output_date).slice(0, 10)
        : undefined,
    }));
  } catch (e) {
    console.warn('[orderProgressApi] get_factory_schedule_actuals failed, falling back to table scan:', e);
  }

  const [hourlyRes, qcRes, batchRes, owmRes] = await Promise.all([
    supabase
      .from('hourly_counts')
      .select('line_allocation_id, count, log_date')
      .eq('factory_id', factoryId)
      .not('line_allocation_id', 'is', null),
    supabase
      .from('inspection_sessions')
      .select('line_allocation_id, passed, log_date')
      .eq('factory_id', factoryId)
      .not('line_allocation_id', 'is', null),
    supabase
      .from('batch_production')
      .select('line_allocation_id, produced_qty, log_date')
      .eq('factory_id', factoryId)
      .not('line_allocation_id', 'is', null),
    supabase
      .from('outsource_work_movements')
      .select('line_allocation_id, qty, occurred_at')
      .eq('factory_id', factoryId)
      .eq('movement_type', 'vendor_receive')
      .is('voided_at', null)
      .not('line_allocation_id', 'is', null),
  ]);

  if (hourlyRes.error) throw hourlyRes.error;
  if (qcRes.error) throw qcRes.error;
  if (batchRes.error) throw batchRes.error;
  if (owmRes.error) throw owmRes.error;

  const map = new Map<string, LineAllocationActual>();

  // In the fallback path we don't have route step-type information, so a line that
  // has a non-hourly output (qc/batch/outsource) should ignore its hourly rows;
  // those hourly rows are almost always the loading/receipt step for the same visit.
  const nonHourlyLineIds = new Set<string>([
    ...((qcRes.data || []) as { line_allocation_id?: string }[]).map((r) => r.line_allocation_id),
    ...((batchRes.data || []) as { line_allocation_id?: string }[]).map((r) => r.line_allocation_id),
    ...((owmRes.data || []) as { line_allocation_id?: string }[]).map((r) => r.line_allocation_id),
  ].filter(Boolean) as string[]);

  for (const row of hourlyRes.data || []) {
    const lineId = row.line_allocation_id as string;
    if (nonHourlyLineIds.has(lineId)) continue;
    mergeAllocationActual(map, lineId, Number(row.count) || 0, row.log_date as string);
  }

  for (const row of qcRes.data || []) {
    mergeAllocationActual(
      map,
      row.line_allocation_id as string,
      Number(row.passed) || 0,
      row.log_date as string,
    );
  }

  for (const row of batchRes.data || []) {
    mergeAllocationActual(
      map,
      row.line_allocation_id as string,
      Number(row.produced_qty) || 0,
      row.log_date as string,
    );
  }

  for (const row of owmRes.data || []) {
    const occurredAt = row.occurred_at as string | null;
    mergeAllocationActual(
      map,
      row.line_allocation_id as string,
      Number(row.qty) || 0,
      occurredAt ? occurredAt.slice(0, 10) : undefined,
    );
  }

  return [...map.values()];
}

/** Per line_allocation capture totals for a single order / colorway.
 *
 * More efficient than the factory-wide schedule RPC when the page already has
 * an order/colorway context (StyleDetails / StyleColorDetails).
 */
export async function fetchOrderColorwayActuals(
  factoryId: string,
  orderId: string,
  colorwayId?: string | null,
): Promise<LineAllocationActual[]> {
  try {
    const { data, error } = await supabase.rpc('get_order_colorway_actuals', {
      p_factory_id: factoryId,
      p_order_id: orderId,
      p_colorway_id: colorwayId || null,
    });

    if (error) throw error;

    return ((data as unknown[]) || []).map((row: any) => ({
      line_allocation_id: String(row.line_allocation_id),
      qty: Number(row.qty) || 0,
      first_output_date: row.first_output_date
        ? String(row.first_output_date).slice(0, 10)
        : undefined,
      last_output_date: row.last_output_date
        ? String(row.last_output_date).slice(0, 10)
        : undefined,
    }));
  } catch (e) {
    console.warn('[orderProgressApi] get_order_colorway_actuals failed, falling back to factory schedule:', e);
  }

  // Fallback to the factory-wide scan and let the caller filter; keeps the UI
  // working if the migration is not applied yet.
  const all = await fetchLineAllocationActuals(factoryId);
  return all.filter(
    (a) =>
      a.line_allocation_id &&
      // We don't have order_id in the fallback rows, so we can't filter by order/colorway here.
      // The fallback is a degraded path; the caller can further filter if needed.
      true,
  );
}
