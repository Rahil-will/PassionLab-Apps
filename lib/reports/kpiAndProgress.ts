import {
  parseSizeQtyMap,
  type FulfillmentAuditRow,
  type FulfillmentRejectionRow,
  type FulfillmentShipmentRow,
} from '../fulfillmentData';
import eachDayOfInterval from 'date-fns/eachDayOfInterval';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { supabase } from '../supabase';
import { allocationSamValue } from '../allocationUtils';
import type { DayDeptRow, StyleReportRow } from './legacyTypes';
import { sumSizeMap, type SizeMap } from '../mesSizeDisplay';
import type { SizeProgressLookup } from '../orderSizeProgress';
import type { FabricCutQtyComponentRow } from '../fabricCutQtyDisplay';
import { parseFabricCutQtyComponents } from '../fabricCutQtyDisplay';
import { composeDeptAppsFromRow, isAuditDept, isQcDept, parseDeptApps } from '../reportDeptUtils';
import { resolvePlanningMode, sortDepartmentsForDisplay } from '../departmentFilters';
import { productionPathFromApps, type DepartmentProductionPath } from '../departmentProductionPath';
import type { DepartmentPlanningMode } from '../../types/settings';
import { getRegularShiftHours, hourlyTargetFromDaily } from '../shiftHours';
import { allActiveHourSlots, activeHourSlotsForShift, isOtShift, regularShiftProductiveMins } from '../shiftSlots';
import type { Shift, ShiftHourBlock } from '../../types';
import {
  handoverDbToDisplay,
  handoverDisplayLabel,
  handoverQtyGap,
  type HandoverDisplayStatus,
} from '../handoverStatus';
import { fetchHandoverReport } from '../transactionReportApi';
import { fetchOrderRoutingSteps } from '../orderRoutingEditor';
import { visitPipelineCellsFromRouting } from '../orderRoutingFlow';
import { qcSessionOutputQty, qcSessionDefectiveQty } from './shared/qcUtils';
import { inDateRange, isPostgrestRpcMissing, isMissingRelationError, isMissingColumnError } from './shared/rpcUtils';
import type { ReportMeta } from './reportMeta';

export interface DailyKpiRpcRow {
  factory_id: string;
  order_id: string;
  department_id: string;
  log_date: string;
  daily_target: number;
  daily_output: number;
  daily_available_mins: number;
  daily_produced_mins: number;
  daily_efficiency_pct: number | null;
  day_completeness: string;
  dhu: number | null;
  defective_pct: number | null;
  wip_qty: number;
  shift_breakdown?: unknown;
}

export interface ShiftKpiRpcRow {
  factory_id: string;
  order_id: string;
  department_id: string;
  log_date: string;
  shift_id: string;
  shift_name: string;
  shift_output: number;
  shift_headcount: number;
  shift_available_mins: number;
  shift_efficiency_pct: number | null;
  shift_productivity: number | null;
  dhu: number | null;
  defective_pct: number | null;
}

/** Style Report only — calls order_dept_progress_rows RPC (not for order-scoped pages). */
export async function fetchOrderDeptProgressRows(
  factoryId: string,
  orderId: string,
  colorwayId?: string | null,
): Promise<CutToShipJourneyRow[]> {
  const { data, error } = await supabase.rpc('order_dept_progress_rows', {
    p_factory_id: factoryId,
    p_order_id: orderId,
  });
  if (error) throw error;
  let rows = (data || []) as CutToShipJourneyRow[];
  rows = [...rows].sort((a, b) => (a.flow_step ?? 0) - (b.flow_step ?? 0));
  if (colorwayId) {
    rows = rows.filter((r) => !r.colorway_id || r.colorway_id === colorwayId);
  }
  return rows;
}

export interface OperationProgressRow {
  factory_id: string;
  order_id: string;
  colorway_id: string | null;
  operation_id: string;
  visit_id: string | null;
  dept_id: string;
  dept_name: string;
  capture_app: string | null;
  step_type: string | null;
  dept_role: string | null;
  is_primary_output: boolean | null;
  route_seq: number | null;
  qty_produced: number | null;
  qty_produced_by_size: SizeMap | null;
}

export async function fetchOperationProgressRows(
  factoryId: string,
  orderId: string,
  colorwayId?: string | null,
): Promise<OperationProgressRow[]> {
  const { data, error } = await supabase.rpc('operation_progress_rows', {
    p_factory_id: factoryId,
    p_order_id: orderId,
  });
  if (error) throw error;
  let rows = (data || []) as OperationProgressRow[];
  rows = [...rows].sort((a, b) => (a.route_seq ?? 0) - (b.route_seq ?? 0));
  if (colorwayId) {
    rows = rows.filter((r) => !r.colorway_id || r.colorway_id === colorwayId);
  }
  return rows;
}

export interface CuttingComponentProgressRow {
  factory_id: string;
  order_id: string;
  colorway_id: string;
  operation_id: string;
  visit_id: string;
  fabric_component_id: string;
  fabric_code: string;
  fabric_type: string;
  is_primary: boolean;
  qty: number;
  qty_by_size: SizeMap;
}

export async function fetchCuttingComponentProgressRows(
  factoryId: string,
  orderId: string,
): Promise<CuttingComponentProgressRow[]> {
  const { data, error } = await supabase.rpc('cutting_component_progress_rows', {
    p_factory_id: factoryId,
    p_order_id: orderId,
  });
  if (error) throw error;
  return ((data || []) as unknown[]).map((row: unknown) => {
    const r = row as Record<string, unknown>;
    const qty_by_size: SizeMap = {};
    const raw = r.qty_by_size;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const n = Number(v) || 0;
        if (n > 0) qty_by_size[k] = n;
      }
    }
    return {
      factory_id: String(r.factory_id ?? ''),
      order_id: String(r.order_id ?? ''),
      colorway_id: String(r.colorway_id ?? ''),
      operation_id: String(r.operation_id ?? ''),
      visit_id: String(r.visit_id ?? ''),
      fabric_component_id: String(r.fabric_component_id ?? ''),
      fabric_code: String(r.fabric_code ?? ''),
      fabric_type: String(r.fabric_type ?? ''),
      is_primary: r.is_primary === true,
      qty: Number(r.qty) || 0,
      qty_by_size,
    };
  });
}

export function cuttingComponentsForOperation(
  rows: CuttingComponentProgressRow[],
  operationId: string,
  colorwayId?: string | null,
  size?: string,
): FabricCutQtyComponentRow[] {
  const filtered = rows.filter(
    (r) => r.operation_id === operationId && (!colorwayId || r.colorway_id === colorwayId),
  );
  const byComponent = new Map<string, FabricCutQtyComponentRow>();
  for (const r of filtered) {
    const source = r.qty_by_size ?? {};
    const by_size: SizeMap = {};
    if (size) {
      const n = Number(source[size]) || 0;
      if (n > 0) by_size[size] = n;
    } else {
      for (const [k, v] of Object.entries(source)) {
        const n = Number(v) || 0;
        if (n > 0) by_size[k] = n;
      }
    }
    const total = size
      ? (by_size[size] || 0)
      : (Object.values(by_size).reduce((sum, v) => sum + v, 0) || (Number(r.qty) || 0));
    if (total <= 0) continue;
    const existing = byComponent.get(r.fabric_component_id);
    if (existing) {
      existing.total += total;
      for (const [k, v] of Object.entries(by_size)) {
        existing.by_size[k] = (existing.by_size[k] || 0) + v;
      }
    } else {
      byComponent.set(r.fabric_component_id, {
        component_id: r.fabric_component_id,
        fabric_type: r.fabric_type,
        remarks: r.fabric_code || null,
        is_primary: r.is_primary,
        by_size,
        total,
      });
    }
  }
  const out = [...byComponent.values()].filter((c) => c.total > 0);
  return out.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
}

function aggregateShiftRowsToDaily(rows: Record<string, unknown>[]): DailyKpiRpcRow[] {
  const byKey = new Map<
    string,
    DailyKpiRpcRow & {
      _completeOutput: number;
      _completeHeadcount: number;
      _anyComplete: boolean;
      _availableForEff: number;
      _producedForEff: number;
    }
  >();

  for (const row of rows) {
    const key = `${row.factory_id}|${row.order_id}|${row.department_id}|${row.log_date}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        factory_id: String(row.factory_id ?? ''),
        order_id: String(row.order_id ?? ''),
        department_id: String(row.department_id ?? ''),
        log_date: String(row.log_date ?? ''),
        daily_target: Number(row.daily_target) || 0,
        daily_output: 0,
        daily_available_mins: 0,
        daily_produced_mins: 0,
        daily_efficiency_pct: null,
        day_completeness: 'none',
        dhu: row.dhu != null ? Number(row.dhu) : null,
        defective_pct: row.defective_pct != null ? Number(row.defective_pct) : null,
        wip_qty: 0,
        shift_breakdown: [],
        _completeOutput: 0,
        _completeHeadcount: 0,
        _anyComplete: false,
        _availableForEff: 0,
        _producedForEff: 0,
      };
      byKey.set(key, agg);
    }

    const shiftOutput = Number(row.shift_output) || 0;
    const shiftHeadcount = Number(row.shift_headcount) || 0;
    const shiftAvailableMins = Number(row.shift_available_mins) || 0;
    const shiftEffPct = row.shift_efficiency_pct != null ? Number(row.shift_efficiency_pct) : null;
    const completeness = String(row.data_completeness ?? row.day_completeness ?? '');

    agg.daily_output += shiftOutput;
    agg.daily_available_mins += shiftAvailableMins;
    if (shiftEffPct != null && shiftAvailableMins > 0) {
      agg._availableForEff += shiftAvailableMins;
      agg._producedForEff += (shiftEffPct / 100) * shiftAvailableMins;
    }
    if (completeness === 'complete') {
      agg._anyComplete = true;
      agg._completeOutput += shiftOutput;
      agg._completeHeadcount += shiftHeadcount;
    } else if (completeness === 'output_only' && shiftOutput > 0) {
      agg.day_completeness = agg.day_completeness === 'workforce_only' ? 'partial' : 'output_only';
    } else if (completeness === 'workforce_only' && shiftHeadcount > 0) {
      agg.day_completeness = agg.day_completeness === 'output_only' ? 'partial' : 'workforce_only';
    }

    if (row.dhu != null) agg.dhu = Number(row.dhu);
    if (row.defective_pct != null) agg.defective_pct = Number(row.defective_pct);

    const breakdown = (agg.shift_breakdown as Array<Record<string, unknown>>) ?? [];
    breakdown.push({
      shift_id: row.shift_id,
      shift_name: row.shift_name,
      output: shiftOutput,
      headcount: shiftHeadcount,
      efficiency_pct: row.shift_efficiency_pct,
    });
    agg.shift_breakdown = breakdown;
  }

  return [...byKey.values()].map(
    ({ _completeOutput, _completeHeadcount, _anyComplete, _availableForEff, _producedForEff, ...row }) => ({
      ...row,
      daily_available_mins: _availableForEff,
      daily_produced_mins: _producedForEff,
      daily_efficiency_pct:
        _availableForEff > 0
          ? Math.round((100 * _producedForEff) / _availableForEff)
          : null,
      day_completeness: _anyComplete
        ? row.day_completeness === 'none'
          ? 'complete'
          : row.day_completeness === 'complete'
            ? 'complete'
            : 'partial'
        : row.day_completeness,
    }),
  );
}

async function queryShiftKpiViewRows(
  factoryId: string,
  departmentId: string | undefined,
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, unknown>[] | null> {
  let q = supabase
    .from('v_department_kpis_by_shift')
    .select('*')
    .eq('factory_id', factoryId)
    .gte('log_date', dateFrom)
    .lte('log_date', dateTo);
  if (departmentId) q = q.eq('department_id', departmentId);
  const res = await q.order('log_date').order('shift_name').order('order_id');
  if (!res.error) return (res.data ?? []) as Record<string, unknown>[];
  return null;
}

async function queryDailyKpiViewRows(
  factoryId: string,
  opts: { departmentId?: string; dateFrom: string; dateTo: string },
): Promise<DailyKpiRpcRow[] | null> {
  const shiftRows = await queryShiftKpiViewRows(
    factoryId,
    opts.departmentId,
    opts.dateFrom,
    opts.dateTo,
  );
  if (shiftRows) return aggregateShiftRowsToDaily(shiftRows);
  return null;
}

/** End-of-day WIP per aggregate key — uses latest log_date within the row set. */
function wipByKeyLatestDay(
  rows: DailyKpiRpcRow[],
  keyFn: (row: DailyKpiRpcRow) => string,
): Map<string, number> {
  const latestByKey = new Map<string, string>();
  for (const row of rows) {
    const key = keyFn(row);
    const cur = latestByKey.get(key);
    if (!cur || row.log_date > cur) latestByKey.set(key, row.log_date);
  }
  const wip = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    if (row.log_date !== latestByKey.get(key)) continue;
    wip.set(key, (wip.get(key) || 0) + (row.wip_qty || 0));
  }
  return wip;
}

export interface CutToShipRow {
  factory_id: string;
  order_id: string;
  colorway_id: string | null;
  style_name: string;
  buyer_name: string | null;
  po_number: string | null;
  order_qty: number;
  cut_qty: number;
  cut_qty_source: string;
  shipped_qty: number;
  rejected_qty: number;
  wip_qty: number;
  reconciliation_gap: number;
  is_balanced: boolean;
  completion_pct: number | null;
  order_status: string | null;
  last_shipment_date: string | null;
  cut_qty_by_size?: SizeMap;
  cut_qty_by_component?: FabricCutQtyComponentRow[];
  shipped_qty_by_size?: SizeMap;
  rejected_qty_by_size?: SizeMap;
  wip_qty_by_size?: SizeMap;
}

export interface CutToShipJourneyRow {
  factory_id: string;
  order_id: string;
  colorway_id: string | null;
  /** Visit group id (order_routing_steps.visit_id or primary step). */
  visit_id?: string | null;
  /** departments.id — not routing step id. */
  dept_id: string;
  dept_name: string;
  flow_step: number | null;
  is_in_flow: boolean;
  qty_received: number | null;
  qty_produced: number | null;
  qty_sent: number | null;
  qty_rejected: number | null;
  wip_qty: number | null;
  wip_qty_by_size?: SizeMap | null;
  qty_received_by_size?: SizeMap | null;
  qty_produced_by_size?: SizeMap | null;
  qty_sent_by_size?: SizeMap | null;
  qty_rejected_by_size?: SizeMap | null;
  /** Pieces on pending handovers not yet received at this visit. */
  qty_in_transit?: number | null;
  /** Closed handovers where received_qty < sent_qty. */
  qty_missing_in_transit?: number | null;
  planned_qty?: number | null;
  remaining_qty?: number | null;
  available_to_send?: number | null;
  status: string;
}

export interface CutToShipDetail {
  reconciliation: CutToShipRow[];
  shipments: Array<Record<string, unknown>>;
  rejections: Array<Record<string, unknown>>;
  wip_by_dept: Array<Record<string, unknown>>;
  journey: CutToShipJourneyRow[];
}

export async function fetchFactoryKpis(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DailyKpiRpcRow[]> {
  const viewRows = await queryDailyKpiViewRows(factoryId, { dateFrom, dateTo });
  return viewRows || [];
}

export async function fetchDepartmentKpis(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DailyKpiRpcRow[]> {
  const viewRows = await queryDailyKpiViewRows(factoryId, {
    departmentId,
    dateFrom,
    dateTo,
  });
  if (viewRows) return viewRows;

  const { data, error } = await supabase.rpc('get_department_kpis', {
    p_factory_id: factoryId,
    p_department_id: departmentId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (!error) return (data || []) as DailyKpiRpcRow[];
  if (isPostgrestRpcMissing(error)) return [];
  throw error;
}

export async function fetchStyleKpis(factoryId: string, orderId: string): Promise<DailyKpiRpcRow[]> {
  const { data, error } = await supabase.rpc('get_style_kpis', {
    p_factory_id: factoryId,
    p_order_id: orderId,
  });
  if (!error) return aggregateShiftRowsToDaily((data || []) as Record<string, unknown>[]);
  const code = (error as { code?: string }).code;
  if (code === 'PGRST202' || code === 'PGRST203') {
    return [];
  }
  throw error;
}

/**
 * Unused export — day reports use `fetchDepartmentKpis` → `queryShiftKpiViewRows`.
 * From `20260810160000`, `get_department_kpis_by_shift` is revoked for `authenticated`.
 * Do not wire this until the RPC validates `p_factory_id` against `current_factory_id()`.
 */
export async function fetchDepartmentKpisByShift(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ShiftKpiRpcRow[]> {
  const { data, error } = await supabase.rpc('get_department_kpis_by_shift', {
    p_factory_id: factoryId,
    p_department_id: departmentId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (!error) return (data || []) as ShiftKpiRpcRow[];
  if (isPostgrestRpcMissing(error)) return [];

  const shiftRows = await queryShiftKpiViewRows(
    factoryId,
    departmentId,
    dateFrom,
    dateTo,
  );
  if (shiftRows) return shiftRows as unknown as ShiftKpiRpcRow[];
  throw error ?? new Error('Shift KPI data unavailable');
}

export async function fetchCutToShipReport(
  factoryId: string,
  opts?: {
    dateFrom?: string | null;
    dateTo?: string | null;
    buyerId?: string | null;
    balancedOnly?: boolean | null;
    orderIds?: string[];
  },
): Promise<CutToShipRow[]> {
  const { data, error } = await supabase.rpc('get_cut_to_ship_report', {
    p_factory_id: factoryId,
    p_date_from: opts?.dateFrom ?? null,
    p_date_to: opts?.dateTo ?? null,
    p_buyer_id: opts?.buyerId ?? null,
    p_balanced_only: opts?.balancedOnly ?? null,
    p_order_ids: opts?.orderIds?.length ? opts.orderIds : null,
  });
  if (!error) {
    return (data || []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ...(r as unknown as CutToShipRow),
        cut_qty_by_component: parseFabricCutQtyComponents(r.cut_qty_by_component),
      };
    });
  }

  throw error;
}

function parseCutToShipDetail(raw: Record<string, unknown>): CutToShipDetail {
  return {
    reconciliation: (raw.reconciliation as CutToShipRow[]) || [],
    shipments: (raw.shipments as Array<Record<string, unknown>>) || [],
    rejections: (raw.rejections as Array<Record<string, unknown>>) || [],
    wip_by_dept: (raw.wip_by_dept as Array<Record<string, unknown>>) || [],
    journey: (raw.journey as CutToShipJourneyRow[]) || [],
  };
}

export async function fetchCutToShipDetail(
  factoryId: string,
  orderId: string,
): Promise<CutToShipDetail> {
  const { fetchOrderDetailBundle } = await import('../orderDetailBundle');
  const bundle = await fetchOrderDetailBundle(factoryId, orderId, []);
  return {
    reconciliation: bundle.reconciliation,
    shipments: bundle.shipments,
    rejections: bundle.rejections,
    wip_by_dept: [],
    journey: bundle.journey,
  };
}

export function buildDayReportFromRpc(
  rows: DailyKpiRpcRow[],
  departments: ReportMeta['departments'],
  dateFrom: string,
  dateTo: string,
): DayDeptRow[] {
  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const byDept = new Map<string, {
    output: number;
    target: number;
    producedMins: number;
    availableMins: number;
    dhuSum: number;
    dhuWeight: number;
    wip: number;
  }>();

  const inRange = rows.filter((r) => inDateRange(r.log_date, dateFrom, dateTo));
  const wipByDept = wipByKeyLatestDay(inRange, (r) => r.department_id);

  for (const row of inRange) {
    const agg = byDept.get(row.department_id) ?? {
      output: 0, target: 0, producedMins: 0, availableMins: 0, dhuSum: 0, dhuWeight: 0, wip: 0,
    };
    agg.output += row.daily_output || 0;
    agg.target += row.daily_target || 0;
    agg.producedMins += row.daily_produced_mins || 0;
    agg.availableMins += row.daily_available_mins || 0;
    if (row.dhu != null) {
      const weight = row.daily_output > 0 ? row.daily_output : 1;
      agg.dhuSum += Number(row.dhu) * weight;
      agg.dhuWeight += weight;
    }
    byDept.set(row.department_id, agg);
  }

  return [...byDept.entries()]
    .map(([departmentId, agg]) => ({
      departmentId,
      departmentName: deptMap.get(departmentId) || departmentId,
      output: agg.output,
      target: agg.target,
      efficiency: agg.availableMins > 0 ? (agg.producedMins / agg.availableMins) * 100 : (agg.target > 0 ? (agg.output / agg.target) * 100 : null),
      dhu: agg.dhuWeight > 0 ? Math.round(agg.dhuSum / agg.dhuWeight) : null,
      wip: wipByDept.get(departmentId) || 0,
    }))
    .filter((r) => r.output > 0 || r.target > 0)
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
}

export function buildStyleReportFromRpc(
  rows: DailyKpiRpcRow[],
  meta: ReportMeta,
  dateFrom: string,
  dateTo: string,
  orderId?: string,
): StyleReportRow[] {
  const deptMap = new Map(meta.departments.map((d) => [d.id, d.name]));
  const orderMap = new Map(meta.orders.map((o) => [o.id, o]));
  const filtered = rows.filter(
    (r) => inDateRange(r.log_date, dateFrom, dateTo) && (!orderId || r.order_id === orderId),
  );
  const wipByOrderDept = wipByKeyLatestDay(filtered, (r) => `${r.order_id}|${r.department_id}`);

  const agg = new Map<string, {
    orderId: string;
    departmentId: string;
    output: number;
    target: number;
    wip: number;
    producedMins: number;
    availableMins: number;
    dhuSum: number;
    dhuWeight: number;
    hourly: StyleReportRow['hourly'];
  }>();

  for (const row of filtered) {
    const key = `${row.order_id}|${row.department_id}`;
    const cur = agg.get(key) ?? {
      orderId: row.order_id,
      departmentId: row.department_id,
      output: 0,
      target: 0,
      wip: 0,
      producedMins: 0,
      availableMins: 0,
      dhuSum: 0,
      dhuWeight: 0,
      hourly: [],
    };
    cur.output += row.daily_output || 0;
    cur.target += row.daily_target || 0;
    cur.producedMins += row.daily_produced_mins || 0;
    cur.availableMins += row.daily_available_mins || 0;
    if (row.dhu != null) {
      const weight = row.daily_output > 0 ? row.daily_output : 1;
      cur.dhuSum += Number(row.dhu) * weight;
      cur.dhuWeight += weight;
    }
    const breakdown = Array.isArray(row.shift_breakdown) ? row.shift_breakdown : [];
    for (const s of breakdown) {
      const slot = (s as { shift_name?: string; shift_output?: number }).shift_name || 'Shift';
      const actual = (s as { shift_output?: number }).shift_output || 0;
      const existing = cur.hourly.find((h) => h.hourSlot === slot);
      if (existing) {
        existing.actual += actual;
        existing.variance += actual;
      } else {
        cur.hourly.push({ hourSlot: slot, actual, target: 0, variance: actual });
      }
    }
    agg.set(key, cur);
  }

  return [...agg.values()].map((a) => {
    const order = orderMap.get(a.orderId);
    const wipKey = `${a.orderId}|${a.departmentId}`;
    return {
      orderId: a.orderId,
      styleName: order?.styleName || '',
      poNumber: order?.poNumber || '',
      departmentId: a.departmentId,
      departmentName: deptMap.get(a.departmentId) || a.departmentId,
      output: a.output,
      target: a.target,
      efficiency: a.availableMins > 0
        ? (a.producedMins / a.availableMins) * 100
        : a.target > 0
          ? (a.output / a.target) * 100
          : null,
      dhu: a.dhuWeight > 0 ? Math.round(a.dhuSum / a.dhuWeight) : null,
      wip: wipByOrderDept.get(wipKey) || 0,
      hourly: a.hourly,
    };
  });
}

export function buildDepartmentReportFromRpc(
  rows: DailyKpiRpcRow[],
  meta: ReportMeta,
  dateFrom: string,
  dateTo: string,
  departmentId?: string,
): StyleReportRow[] {
  const styleRows = buildStyleReportFromRpc(rows, meta, dateFrom, dateTo);
  return departmentId ? styleRows.filter((r) => r.departmentId === departmentId) : styleRows;
}

export function buildDepartmentShiftReportFromRpc(
  rows: ShiftKpiRpcRow[],
  meta: ReportMeta,
  dateFrom: string,
  dateTo: string,
  departmentId: string,
  shiftId?: string,
): StyleReportRow[] {
  const deptMap = new Map(meta.departments.map((d) => [d.id, d.name]));
  const orderMap = new Map(meta.orders.map((o) => [o.id, o]));
  const filtered = rows.filter(
    (r) =>
      r.department_id === departmentId &&
      inDateRange(r.log_date, dateFrom, dateTo) &&
      (!shiftId || r.shift_id === shiftId),
  );

  const agg = new Map<string, {
    orderId: string;
    shiftId: string;
    shiftName: string;
    output: number;
    effSum: number;
    effCount: number;
    dhuSum: number;
    dhuWeight: number;
  }>();

  for (const row of filtered) {
    const key = `${row.order_id}|${row.shift_id}`;
    const cur = agg.get(key) ?? {
      orderId: row.order_id,
      shiftId: row.shift_id,
      shiftName: row.shift_name,
      output: 0,
      effSum: 0,
      effCount: 0,
      dhuSum: 0,
      dhuWeight: 0,
    };
    cur.output += row.shift_output || 0;
    if (row.shift_efficiency_pct != null) {
      cur.effSum += Number(row.shift_efficiency_pct);
      cur.effCount += 1;
    }
    if (row.dhu != null) {
      const weight = row.shift_output > 0 ? row.shift_output : 1;
      cur.dhuSum += Number(row.dhu) * weight;
      cur.dhuWeight += weight;
    }
    agg.set(key, cur);
  }

  return [...agg.values()]
    .map((a) => {
      const order = orderMap.get(a.orderId);
      return {
        orderId: a.orderId,
        styleName: order?.styleName || '',
        poNumber: order?.poNumber || '',
        departmentId,
        departmentName: deptMap.get(departmentId) || departmentId,
        shiftId: a.shiftId,
        shiftName: a.shiftName,
        output: a.output,
        target: 0,
        efficiency: a.effCount ? a.effSum / a.effCount : null,
        dhu: a.dhuWeight > 0 ? Math.round(a.dhuSum / a.dhuWeight) : null,
        wip: 0,
        hourly: [],
      };
    })
    .filter((r) => r.output > 0)
    .sort((a, b) => a.styleName.localeCompare(b.styleName) || (a.shiftName || '').localeCompare(b.shiftName || ''));
}

export function listShiftsFromKpiRows(rows: ShiftKpiRpcRow[]): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.shift_id) map.set(row.shift_id, row.shift_name || row.shift_id);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
