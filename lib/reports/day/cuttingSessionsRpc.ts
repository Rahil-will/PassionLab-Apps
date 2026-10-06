import { supabase } from '../../supabase';
import { isPostgrestRpcMissing } from '../shared/rpcUtils';
import type { DayNativeEntry, DayOperationHourSection, DayResourceHourRow, WorkforceCategoryCount } from './types';

const CUTTING_OUTPUT_HOUR = 'Output';

export type DayCuttingSessionRpcRow = {
  id: string;
  log_date: string;
  started_at: string | null;
  ended_at: string | null;
  order_id: string;
  colorway_id: string | null;
  resource_id: string | null;
  order_route_id: string | null;
  session_no: string | null;
  ref_no: string | null;
  fabric_type: string | null;
  fabric_code: string | null;
  fabric_component_id: string | null;
  is_primary_fabric: boolean | null;
  lay_no: string | null;
  headcount_by_category: Record<string, unknown> | null;
  output_qty: number | null;
  style_name: string | null;
  style_ref: string | null;
  buyer_name: string | null;
  po_number: string | null;
  color_name: string | null;
  resource_name: string | null;
  operation_name: string | null;
  is_primary_output: boolean | null;
  operation_def_id: string | null;
};

function workerCategoriesFromHeadcount(source: Record<string, unknown> | null): WorkforceCategoryCount[] {
  if (!source || typeof source !== 'object') return [];
  return Object.entries(source)
    .map(([category, value]) => ({ category, count: Number(value) || 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

export function mapCuttingSessionRpcToNativeEntry(row: DayCuttingSessionRpcRow): DayNativeEntry {
  const logDate = String(row.log_date || '').slice(0, 10);
  return {
    id: String(row.id),
    kind: 'cutting_session',
    logDate,
    operationName: row.operation_name || 'Cutting',
    styleName: row.style_name || String(row.order_id || '').slice(0, 8),
    styleRef: row.style_ref || '',
    buyerName: row.buyer_name || '',
    poNumber: row.po_number || '',
    colorName: row.color_name || '—',
    resourceName: row.resource_name || '—',
    fabricType: row.fabric_type || undefined,
    fabricCode: row.fabric_code || undefined,
    sessionNo: row.session_no || undefined,
    refNo: row.ref_no || undefined,
    layNo: row.lay_no || undefined,
    startedAt: row.started_at || undefined,
    endedAt: row.ended_at || undefined,
    workerCategories: workerCategoriesFromHeadcount(row.headcount_by_category),
    outputQty: Number(row.output_qty) || 0,
  };
}

export function buildCuttingOperationSectionsFromRpc(
  rows: DayCuttingSessionRpcRow[],
): DayOperationHourSection[] {
  const sectionMaps = new Map<string, { label: string; fabricAspect: 'shell' | 'lining'; rows: Map<string, DayResourceHourRow> }>();

  for (const row of rows) {
    const qty = Number(row.output_qty) || 0;
    if (qty <= 0) continue;
    const operationId = row.order_route_id || (row.operation_def_id ? `def:${row.operation_def_id}` : `name:${row.operation_name || 'Cutting'}`);
    const fabricAspect: 'shell' | 'lining' = row.is_primary_fabric === false && !row.is_primary_output ? 'lining' : 'shell';
    const logDate = String(row.log_date || '').slice(0, 10);
    const resourceId = row.resource_id || '';
    const rowKey = `${logDate}|${resourceId}|${row.order_id}|${row.colorway_id ?? ''}|${row.lay_no ?? ''}|${fabricAspect}`;

    let section = sectionMaps.get(operationId);
    if (!section) {
      section = {
        label: row.operation_name || 'Cutting',
        fabricAspect: row.is_primary_output ? 'shell' : fabricAspect,
        rows: new Map(),
      };
      sectionMaps.set(operationId, section);
    }

    const existing = section.rows.get(rowKey);
    if (existing) {
      existing.hours[CUTTING_OUTPUT_HOUR] = (existing.hours[CUTTING_OUTPUT_HOUR] || 0) + qty;
      existing.total += qty;
      continue;
    }

    section.rows.set(rowKey, {
      resourceId,
      resourceName: row.resource_name || '—',
      orderId: row.order_id,
      styleName: row.style_name || String(row.order_id || '').slice(0, 8),
      styleRef: row.style_ref || '',
      buyerName: row.buyer_name || '',
      poNumber: row.po_number || '',
      colorwayId: row.colorway_id,
      colorName: row.color_name || '—',
      hours: { [CUTTING_OUTPUT_HOUR]: qty },
      hourTargets: {},
      hourlyTarget: 0,
      total: qty,
      workforce: null,
      workforceBreakdown: [],
      producedMins: 0,
      resourceAvailableMins: 0,
      daysRunning: null,
      plannedEndDate: null,
      efficiencyPct: null,
      productivity: null,
      operationId,
      operationLabel: row.operation_name || 'Cutting',
      fabricAspect,
      layNo: row.lay_no || undefined,
      logDate,
    });
  }

  return [...sectionMaps.entries()]
    .map(([operationId, section]) => ({
      operationId,
      operationLabel: section.label,
      fabricAspect: section.fabricAspect,
      hourColumns: [CUTTING_OUTPUT_HOUR],
      rows: [...section.rows.values()].sort(
        (a, b) =>
          (a.logDate || '').localeCompare(b.logDate || '')
          || a.resourceName.localeCompare(b.resourceName)
          || a.styleName.localeCompare(b.styleName),
      ),
    }))
    .sort((a, b) => a.operationLabel.localeCompare(b.operationLabel));
}

export async function fetchDayCuttingSessionsRpc(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<DayCuttingSessionRpcRow[] | null> {
  const { data, error } = await supabase.rpc('get_day_origin_report', {
    p_factory_id: factoryId,
    p_department_id: departmentId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (!error) return (data || []) as DayCuttingSessionRpcRow[];
  if (!isPostgrestRpcMissing(error)) throw error;

  const fallback = await supabase.rpc('get_day_cutting_sessions', {
    p_factory_id: factoryId,
    p_department_id: departmentId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (!fallback.error) return (fallback.data || []) as DayCuttingSessionRpcRow[];
  if (isPostgrestRpcMissing(fallback.error)) return null;
  throw fallback.error;
}
