import { supabase } from '../../supabase';
import { shipmentAuditTypeLabel } from '../../fulfillmentData';
import { isMissingRelationError } from '../shared/rpcUtils';
import {
  colorwayDisplayLabel,
  fetchReportOrdersByIds,
  resolveColorwayMap,
} from '../reportMeta';

export interface DayAuditRow {
  id: string;
  logDate: string;
  orderId: string;
  colorwayId: string | null;
  styleName: string;
  styleRef: string;
  buyerName: string;
  poNumber: string;
  colorName: string;
  resourceName: string;
  operationName: string;
  auditType?: string | null;
  aqlLevel: string | null;
  lotSize: number;
  sampleSize: number;
  passed: number;
  failed: number;
  majorFailed: number;
  minorFailed: number;
  result: string | null;
}

export interface DayAuditKpis {
  lots: number;
  lotsPassed: number;
  lotsFailed: number;
  samples: number;
  passed: number;
  failed: number;
  passPct: number | null;
  defectivePct: number | null;
}

function embedOne<T>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

export function auditSessionLogDate(completedAt: string | null, loggedAt: string): string {
  const raw = completedAt || loggedAt || '';
  return raw.slice(0, 10);
}

export function isAuditLotPass(result: string | null | undefined, failed: number): boolean {
  if (result === 'pass') return true;
  if (result === 'fail') return false;
  return failed <= 0;
}

export function computeDayAuditKpis(rows: DayAuditRow[]): DayAuditKpis {
  let lotsPassed = 0;
  let lotsFailed = 0;
  let samples = 0;
  let passed = 0;
  let failed = 0;
  for (const row of rows) {
    if (isAuditLotPass(row.result, row.failed)) lotsPassed += 1;
    else lotsFailed += 1;
    samples += row.sampleSize;
    passed += row.passed;
    failed += row.failed;
  }
  const lots = rows.length;
  return {
    lots,
    lotsPassed,
    lotsFailed,
    samples,
    passed,
    failed,
    passPct: lots > 0 ? (lotsPassed / lots) * 100 : null,
    defectivePct: samples > 0 ? (failed / samples) * 100 : null,
  };
}

export function filterDayAuditRows(
  rows: DayAuditRow[],
  searchQuery: string,
  linkOrderId: string,
  linkColorwayId: string,
): DayAuditRow[] {
  const q = searchQuery.trim().toLowerCase();
  return rows.filter((row) => {
    if (linkOrderId && row.orderId !== linkOrderId) return false;
    if (linkColorwayId && row.colorwayId !== linkColorwayId) return false;
    if (!q) return true;
    return (
      row.styleName.toLowerCase().includes(q) ||
      row.poNumber.toLowerCase().includes(q) ||
      row.styleRef.toLowerCase().includes(q) ||
      row.buyerName.toLowerCase().includes(q) ||
      row.colorName.toLowerCase().includes(q) ||
      (row.auditType || '').toLowerCase().includes(q) ||
      row.operationName.toLowerCase().includes(q)
    );
  });
}

export async function fetchDayDeptAudits(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  opts?: { shipmentDesk?: boolean },
): Promise<DayAuditRow[]> {
  if (opts?.shipmentDesk) {
    return fetchDayShipmentAudits(factoryId, dateFrom, dateTo);
  }
  return fetchDayFloorAudits(factoryId, departmentId, dateFrom, dateTo);
}

async function fetchDayShipmentAudits(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DayAuditRow[]> {
  const { data, error } = await supabase
    .from('shipment_audits')
    .select(
      'id, audit_date, audit_type, lot_size, sample_size, aql_level, passed, failed, major_failed, minor_failed, result, order_id, colorway_id, notes',
    )
    .eq('factory_id', factoryId)
    .eq('status', 'completed')
    .gte('audit_date', dateFrom)
    .lte('audit_date', dateTo)
    .order('audit_date', { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  if (!data?.length) return [];

  const [orders, colorMap] = await Promise.all([
    fetchReportOrdersByIds(
      factoryId,
      data.map((raw) => String(raw.order_id ?? '')),
    ),
    resolveColorwayMap(
      factoryId,
      [],
      data.map((raw) => (raw.colorway_id ? String(raw.colorway_id) : null)),
    ),
  ]);
  const orderMap = new Map(orders.map((order) => [order.id, order]));

  return data
    .map((raw) => {
      const order = orderMap.get(String(raw.order_id ?? ''));
      const colorwayId = raw.colorway_id ? String(raw.colorway_id) : null;
      const auditType = String(raw.audit_type ?? '');
      return {
        id: String(raw.id),
        logDate: String(raw.audit_date ?? '').slice(0, 10),
        orderId: String(raw.order_id ?? ''),
        colorwayId,
        styleName: order?.styleName ?? '',
        styleRef: order?.styleRef ?? '',
        buyerName: order?.buyerName ?? '',
        poNumber: order?.poNumber ?? '',
        colorName: colorwayDisplayLabel(colorwayId, colorMap),
        resourceName: '',
        operationName: shipmentAuditTypeLabel(auditType),
        auditType,
        aqlLevel: (raw.aql_level as string) || null,
        lotSize: Number(raw.lot_size) || 0,
        sampleSize: Number(raw.sample_size) || 0,
        passed: Number(raw.passed) || 0,
        failed: Number(raw.failed) || 0,
        majorFailed: Number(raw.major_failed) || 0,
        minorFailed: Number(raw.minor_failed) || 0,
        result: (raw.result as string) || null,
      } satisfies DayAuditRow;
    })
    .sort(
      (a, b) =>
        a.logDate.localeCompare(b.logDate) ||
        a.styleName.localeCompare(b.styleName) ||
        (a.auditType || '').localeCompare(b.auditType || ''),
    );
}

async function fetchDayFloorAudits(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DayAuditRow[]> {
  const { data, error } = await supabase
    .from('audit_sessions')
    .select(
      `
      id,
      logged_at,
      completed_at,
      lot_size,
      sample_size,
      aql_level,
      passed,
      failed,
      major_failed,
      minor_failed,
      result,
      order_id,
      colorway_id,
      assigned_resources ( resource_name ),
      order_routing_steps ( operation_name )
    `,
    )
    .eq('factory_id', factoryId)
    .eq('department_id', departmentId)
    .eq('status', 'completed')
    .gte('logged_at', `${dateFrom}T00:00:00`)
    .lte('logged_at', `${dateTo}T23:59:59.999`);

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  const sessions = (data || []).filter((raw) => {
    const logDate = auditSessionLogDate(
      (raw.completed_at as string | null) ?? null,
      String(raw.logged_at ?? ''),
    );
    return logDate >= dateFrom && logDate <= dateTo;
  });
  if (sessions.length === 0) return [];

  const orderIds = sessions.map((raw) => String(raw.order_id ?? '')).filter(Boolean);
  const [orders, colorMap] = await Promise.all([
    fetchReportOrdersByIds(factoryId, orderIds),
    resolveColorwayMap(
      factoryId,
      [],
      sessions.map((raw) => (raw.colorway_id ? String(raw.colorway_id) : null)),
    ),
  ]);
  const orderMap = new Map(orders.map((order) => [order.id, order]));

  const rows: DayAuditRow[] = [];
  for (const raw of sessions) {
    const logDate = auditSessionLogDate(
      (raw.completed_at as string | null) ?? null,
      String(raw.logged_at ?? ''),
    );
    const order = orderMap.get(String(raw.order_id ?? ''));
    const resource = embedOne(
      raw.assigned_resources as { resource_name?: string } | { resource_name?: string }[] | null,
    );
    const operation = embedOne(
      raw.order_routing_steps as { operation_name?: string } | { operation_name?: string }[] | null,
    );
    const colorwayId = raw.colorway_id ? String(raw.colorway_id) : null;

    rows.push({
      id: String(raw.id),
      logDate,
      orderId: String(raw.order_id ?? ''),
      colorwayId,
      styleName: order?.styleName ?? '',
      styleRef: order?.styleRef ?? '',
      buyerName: order?.buyerName ?? '',
      poNumber: order?.poNumber ?? '',
      colorName: colorwayDisplayLabel(colorwayId, colorMap),
      resourceName: String(resource?.resource_name ?? ''),
      operationName: String(operation?.operation_name ?? ''),
      aqlLevel: (raw.aql_level as string) || null,
      lotSize: Number(raw.lot_size) || 0,
      sampleSize: Number(raw.sample_size) || 0,
      passed: Number(raw.passed) || 0,
      failed: Number(raw.failed) || 0,
      majorFailed: Number(raw.major_failed) || 0,
      minorFailed: Number(raw.minor_failed) || 0,
      result: (raw.result as string) || null,
    });
  }

  return rows.sort(
    (a, b) =>
      a.logDate.localeCompare(b.logDate) ||
      a.styleName.localeCompare(b.styleName) ||
      a.colorName.localeCompare(b.colorName),
  );
}
