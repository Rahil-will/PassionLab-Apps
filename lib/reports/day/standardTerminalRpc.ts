import { supabase } from '../../supabase';
import { isPostgrestRpcMissing } from '../shared/rpcUtils';
import type { DayNativeEntry, WorkforceCategoryCount } from './types';

export type DayStandardRpcRow = {
  source: 'hourly' | 'qc' | 'batch' | string;
  id: string;
  log_date: string;
  hour_slot: string | null;
  shift_id: string | null;
  order_id: string;
  colorway_id: string | null;
  resource_id: string | null;
  order_route_id: string | null;
  qty: number | null;
  inspected_qty: number | null;
  started_at: string | null;
  ended_at: string | null;
  activity_no: string | null;
  ref_no: string | null;
  comment: string | null;
  headcount_by_category: Record<string, unknown> | null;
  style_name: string | null;
  style_ref: string | null;
  buyer_name: string | null;
  po_number: string | null;
  color_name: string | null;
  resource_name: string | null;
  operation_name: string | null;
  operation_def_id: string | null;
};

export type DayTerminalRpcRow = {
  id: string;
  log_date: string;
  started_at: string | null;
  order_id: string;
  colorway_id: string | null;
  order_route_id: string | null;
  output_qty: number | null;
  style_name: string | null;
  style_ref: string | null;
  buyer_name: string | null;
  po_number: string | null;
  color_name: string | null;
  operation_name: string | null;
  shipment_type: string | null;
  destination: string | null;
  invoice_number: string | null;
  awb_number: string | null;
  notes: string | null;
};

function workerCategoriesFromHeadcount(source: Record<string, unknown> | null): WorkforceCategoryCount[] {
  if (!source || typeof source !== 'object') return [];
  return Object.entries(source)
    .map(([category, value]) => ({ category, count: Number(value) || 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

export function mapStandardRpcToBatchEntry(row: DayStandardRpcRow): DayNativeEntry {
  return {
    id: String(row.id),
    kind: 'batch',
    logDate: String(row.log_date || '').slice(0, 10),
    operationName: row.operation_name || 'Batch',
    styleName: row.style_name || String(row.order_id || '').slice(0, 8),
    styleRef: row.style_ref || '',
    buyerName: row.buyer_name || '',
    poNumber: row.po_number || '',
    colorName: row.color_name || '—',
    resourceName: row.resource_name || '—',
    activityNo: row.activity_no || undefined,
    refNo: row.ref_no || undefined,
    startedAt: row.started_at || undefined,
    endedAt: row.ended_at || undefined,
    workerCategories: workerCategoriesFromHeadcount(row.headcount_by_category),
    outputQty: Number(row.qty) || 0,
    comment: row.comment || undefined,
  };
}

export function mapTerminalRpcToNativeEntry(row: DayTerminalRpcRow): DayNativeEntry {
  return {
    id: String(row.id),
    kind: 'shipment',
    logDate: String(row.log_date || '').slice(0, 10),
    operationName: row.operation_name || 'Dispatch',
    styleName: row.style_name || String(row.order_id || '').slice(0, 8),
    styleRef: row.style_ref || '',
    buyerName: row.buyer_name || '',
    poNumber: row.po_number || '',
    colorName: row.color_name || '—',
    startedAt: row.started_at || undefined,
    outputQty: Number(row.output_qty) || 0,
    shipmentType: row.shipment_type || undefined,
    destination: row.destination || undefined,
    invoiceNumber: row.invoice_number || undefined,
    awbNumber: row.awb_number || undefined,
    notes: row.notes || undefined,
  };
}

export async function fetchDayStandardReportRpc(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DayStandardRpcRow[] | null> {
  const { data, error } = await supabase.rpc('get_day_standard_report', {
    p_factory_id: factoryId,
    p_department_id: departmentId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (!error) return (data || []) as DayStandardRpcRow[];
  if (isPostgrestRpcMissing(error)) return null;
  throw error;
}

export async function fetchDayTerminalReportRpc(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DayTerminalRpcRow[] | null> {
  const { data, error } = await supabase.rpc('get_day_terminal_report', {
    p_factory_id: factoryId,
    p_department_id: departmentId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (!error) return (data || []) as DayTerminalRpcRow[];
  if (isPostgrestRpcMissing(error)) return null;
  throw error;
}
