import { supabase } from '../supabase';
import { composeDeptAppsFromRow } from '../reportDeptUtils';
import { resolvePlanningMode, sortDepartmentsForDisplay } from '../departmentFilters';
import { productionPathFromApps } from '../departmentProductionPath';
import type { DepartmentPlanningMode } from '../../types/settings';

export interface ReportOrderSummary {
  id: string;
  styleName: string;
  styleRef: string;
  buyerName: string;
  poNumber: string;
  createdAt: string;
}

export interface ReportMetaLite {
  departments: Array<{
    id: string;
    name: string;
    apps: string[] | null;
    role: 'origin' | 'standard' | 'terminal';
    sequence?: number;
    planning_mode: DepartmentPlanningMode | undefined;
    productionPath: import('../departmentProductionPath').DepartmentProductionPath;
    created_at: string;
  }>;
  buyers: Array<{ id: string; name: string }>;
  resources: Array<{ id: string; name: string; departmentId: string | null }>;
}

/** Full report metadata shape — `orders` is empty unless merged from a paginated fetch. */
export interface ReportMeta extends ReportMetaLite {
  orders: ReportOrderSummary[];
}

export interface ReportOrdersPageParams {
  search?: string;
  limit: number;
  offset: number;
}

export interface ReportOrdersPageResult {
  orders: ReportOrderSummary[];
  total: number;
}

export interface ColorwayLabel {
  id: string;
  orderId: string;
  name: string;
  colorCode: string | null;
}

function mapReportOrderRow(o: Record<string, unknown>): ReportOrderSummary {
  return {
    id: o.id as string,
    styleName: (o.style_name as string) || '',
    styleRef: (o.style_ref as string) || '',
    buyerName: (o.buyer_name as string) || '',
    poNumber: (o.po_number as string) || '',
    createdAt: (o.created_at as string) || '',
  };
}

async function fetchDepartmentMeta(factoryId: string): Promise<ReportMetaLite['departments']> {
  const deptExtended = await supabase
    .from('departments')
    .select('id, name, role, sequence, created_at, transaction_enabled, supervisor_enabled, planning_mode, is_native')
    .eq('factory_id', factoryId)
    .order('created_at');
  const deptRes = deptExtended.error
    ? await supabase
        .from('departments')
        .select('id, name, role, sequence, created_at')
        .eq('factory_id', factoryId)
        .order('created_at')
    : deptExtended;

  const opsRes = await supabase
    .from('operations')
    .select('department_id, capture_app')
    .eq('factory_id', factoryId)
    .eq('is_active', true);

  if (deptRes.error) throw deptRes.error;
  if (opsRes.error) {
    console.warn('[fetchReportMetaLite] operations query:', opsRes.error.message);
  }

  const captureByDept = new Map<string, Set<string>>();
  for (const op of opsRes.data || []) {
    const deptId = op.department_id as string | null;
    const cap = op.capture_app as string | null;
    if (!deptId || !cap || cap === 'transaction' || cap === 'none') continue;
    const set = captureByDept.get(deptId) ?? new Set<string>();
    set.add(cap);
    captureByDept.set(deptId, set);
  }

  return sortDepartmentsForDisplay(
    (deptRes.data || []).map((d) => {
      const composed = composeDeptAppsFromRow(d);
      const fromOps = [...(captureByDept.get(d.id as string) ?? [])];
      const apps = [...new Set([...composed, ...fromOps])];
      const rawRole = d.role as string | null;
      const role: 'origin' | 'standard' | 'terminal' =
        rawRole === 'origin' || rawRole === 'terminal' ? rawRole : 'standard';
      const planningMode =
        ((d as { planning_mode?: string | null }).planning_mode as DepartmentPlanningMode | null) ??
        undefined;
      const isNative = Boolean((d as { is_native?: boolean }).is_native);
      let productionPath = productionPathFromApps(apps, role, isNative);
      if (productionPath === 'none' && planningMode) {
        const mode = resolvePlanningMode({ role, planning_mode: planningMode });
        if (mode === 'native_cutting') productionPath = 'native_cutting';
        else if (mode === 'production' || mode === 'outsource') productionPath = 'hourly';
      }
      return {
        id: d.id as string,
        name: d.name as string,
        apps,
        role,
        sequence: d.sequence == null ? undefined : Number(d.sequence),
        planning_mode: planningMode,
        productionPath,
        created_at: (d.created_at as string) || '',
      };
    }),
  );
}

/** Departments, buyers, and resources — no style_orders scan. */
export async function fetchReportMetaLite(factoryId: string): Promise<ReportMetaLite> {
  const [departments, buyerRes, resourceRes] = await Promise.all([
    fetchDepartmentMeta(factoryId),
    supabase.from('buyers').select('id, name').eq('factory_id', factoryId).order('name'),
    supabase
      .from('assigned_resources')
      .select('id, resource_name, department_id')
      .eq('factory_id', factoryId)
      .eq('status', 'active')
      .order('resource_name'),
  ]);

  if (buyerRes.error) throw buyerRes.error;
  if (resourceRes.error) throw resourceRes.error;

  return {
    departments,
    buyers: (buyerRes.data || []).map((b) => ({
      id: b.id as string,
      name: b.name as string,
    })),
    resources: (resourceRes.data || []).map((r) => ({
      id: r.id as string,
      name: (r.resource_name as string) || '',
      departmentId: (r.department_id as string) || null,
    })),
  };
}

/** Load style_orders summaries for a bounded set of ids (day report row enrichment). */
export async function fetchReportOrdersByIds(
  factoryId: string,
  orderIds: string[],
): Promise<ReportOrderSummary[]> {
  const unique = [...new Set(orderIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const { data, error } = await supabase
    .from('style_orders')
    .select('id, style_name, style_ref, buyer_name, po_number, created_at')
    .eq('factory_id', factoryId)
    .in('id', unique);

  if (error) throw error;
  return (data || []).map((row) => mapReportOrderRow(row as Record<string, unknown>));
}

/** Merge meta.orders with on-demand fetches for ids referenced in report rows. */
export async function resolveOrderMap(
  factoryId: string,
  meta: ReportMeta,
  orderIds: Iterable<string>,
): Promise<Map<string, ReportOrderSummary>> {
  const map = new Map(meta.orders.map((order) => [order.id, order]));
  const missing = [...new Set([...orderIds].filter((id) => id && !map.has(id)))];
  if (missing.length === 0) return map;

  const fetched = await fetchReportOrdersByIds(factoryId, missing);
  for (const order of fetched) map.set(order.id, order);
  return map;
}

/** Paginated style_orders for report search and landing lists. */
export async function fetchReportOrdersPage(
  factoryId: string,
  params: ReportOrdersPageParams,
): Promise<ReportOrdersPageResult> {
  const { search, limit, offset } = params;
  const from = offset;
  const to = offset + limit - 1;

  let query = supabase
    .from('style_orders')
    .select('id, style_name, style_ref, buyer_name, po_number, created_at', { count: 'exact' })
    .eq('factory_id', factoryId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    query = query.or(
      `style_name.ilike.${q},po_number.ilike.${q},style_ref.ilike.${q},buyer_name.ilike.${q}`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    orders: (data || []).map((row) => mapReportOrderRow(row as Record<string, unknown>)),
    total: count ?? 0,
  };
}

/** Lite metadata only — orders are always empty; use fetchReportOrdersPage for order lists. */
export async function fetchReportMeta(factoryId: string): Promise<ReportMeta> {
  const lite = await fetchReportMetaLite(factoryId);
  return { ...lite, orders: [] };
}

export interface ColorwayLabelScope {
  /** When set, only load labels for these orders. */
  orderIds?: string[];
  /** Dept + date window — resolves order ids from capture activity in that range. */
  departmentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function fetchColorwayRowsForOrderIds(
  factoryId: string,
  orderIds: string[],
): Promise<ColorwayLabel[]> {
  if (orderIds.length === 0) return [];

  const uniqueIds = [...new Set(orderIds)];
  const batchSize = 40;
  const labels: ColorwayLabel[] = [];

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const batch = uniqueIds.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('colorways')
      .select('id, name, color_code, order_id')
      .eq('factory_id', factoryId)
      .in('order_id', batch);

    if (error) throw error;

    for (const row of data ?? []) {
      labels.push({
        id: row.id as string,
        orderId: row.order_id as string,
        name: (row.name as string) || '',
        colorCode: (row.color_code as string) || null,
      });
    }
  }

  return labels;
}

/** Distinct order ids with capture activity for a department and date window. */
export async function fetchColorwayLabelOrderIdsForDeptRange(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
): Promise<string[]> {
  const [hourlyRes, qcRes, batchRes, handoverRes] = await Promise.all([
    supabase
      .from('hourly_counts')
      .select('order_id')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo),
    supabase
      .from('inspection_sessions')
      .select('order_id')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo),
    supabase
      .from('batch_production')
      .select('order_id')
      .eq('factory_id', factoryId)
      .eq('department_id', departmentId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo),
    supabase
      .from('handover_slips')
      .select('order_id, from_department_id, to_department_id')
      .eq('factory_id', factoryId)
      .gte('sent_at', `${dateFrom}T00:00:00`)
      .lte('sent_at', `${dateTo}T23:59:59`),
  ]);

  if (hourlyRes.error) throw hourlyRes.error;
  if (qcRes.error) throw qcRes.error;
  if (batchRes.error) throw batchRes.error;
  if (handoverRes.error) throw handoverRes.error;

  const ids = new Set<string>();
  for (const row of hourlyRes.data ?? []) {
    if (row.order_id) ids.add(row.order_id as string);
  }
  for (const row of qcRes.data ?? []) {
    if (row.order_id) ids.add(row.order_id as string);
  }
  for (const row of batchRes.data ?? []) {
    if (row.order_id) ids.add(row.order_id as string);
  }
  for (const row of handoverRes.data ?? []) {
    const fromId = row.from_department_id as string | null;
    const toId = row.to_department_id as string | null;
    if (fromId === departmentId || toId === departmentId) {
      if (row.order_id) ids.add(row.order_id as string);
    }
  }

  return [...ids];
}

/**
 * Colorway display labels scoped to report context — never scans the full factory.
 * Provide orderIds directly, or departmentId + dateFrom/dateTo to resolve activity orders.
 */
export async function fetchColorwayLabels(
  factoryId: string,
  scope?: ColorwayLabelScope,
): Promise<ColorwayLabel[]> {
  if (scope?.orderIds?.length) {
    return fetchColorwayRowsForOrderIds(factoryId, scope.orderIds);
  }

  if (scope?.departmentId && scope.dateFrom && scope.dateTo) {
    const orderIds = await fetchColorwayLabelOrderIdsForDeptRange(
      factoryId,
      scope.departmentId,
      scope.dateFrom,
      scope.dateTo,
    );
    return fetchColorwayRowsForOrderIds(factoryId, orderIds);
  }

  return [];
}

export function colorwayDisplayLabel(
  colorwayId: string | null | undefined,
  map: Map<string, ColorwayLabel>,
): string {
  if (!colorwayId) return 'Order (legacy)';
  const cw = map.get(colorwayId);
  if (!cw) return colorwayId.slice(0, 8);
  return cw.colorCode ? `${cw.name} (${cw.colorCode})` : cw.name;
}
