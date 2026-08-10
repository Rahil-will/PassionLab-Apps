import format from 'date-fns/format';
import subDays from 'date-fns/subDays';
import { handoverQtyGap } from './handoverStatus';
import { supabase } from './supabase';
import type { ShiftHourBlock } from '../types';

export interface HandoverReportRow {
  id: string;
  orderId: string;
  colorwayId: string | null;
  fromDepartmentId: string;
  toDepartmentId: string;
  sentQty: number;
  receivedQty: number | null;
  qtyBySize: Record<string, number>;
  receivedQtyBySize: Record<string, number>;
  sentAt: string;
  receivedAt: string | null;
  status: 'pending' | 'received' | 'disputed' | 'received_disputed';
  challanNumber: string | null;
  notes: string | null;
  receivedNotes: string | null;
  sentBy: string | null;
  receivedBy: string | null;
  styleName: string;
  poNumber: string;
  colorwayName: string | null;
  colorCode: string | null;
  fromDepartmentName: string;
  toDepartmentName: string;
  sentByName: string | null;
  receivedByName: string | null;
  fromProduceOperationNames: string | null;
  toProduceOperationNames: string | null;
  fromResourceName: string | null;
  toResourceName: string | null;
  lossClosedBy: string | null;
  lossClosedByName: string | null;
  lossClosedAt: string | null;
  lossRemark: string | null;
  lossRejectionId: string | null;
  logDate: string;
  shiftId: string | null;
  shiftName: string | null;
  hourSlot: string;
  missingInTransit?: number | null;
}

export interface HandoverReportFilters {
  dateFrom?: string;
  dateTo?: string;
  fromDepartmentId?: string | null;
  toDepartmentId?: string | null;
  status?: 'pending' | 'received' | 'disputed' | 'received_disputed' | null;
  orderId?: string | null;
  colorwayId?: string | null;
  search?: string;
}

export interface HourSlotGroup {
  hourSlot: string;
  rows: HandoverReportRow[];
  totalQty: number;
}

export interface ShiftGroup {
  shiftId: string | null;
  shiftName: string;
  hourSlotGroups: HourSlotGroup[];
  totalQty: number;
}

export interface DateGroup {
  logDate: string;
  shiftGroups: ShiftGroup[];
  totalQty: number;
}

const SHIFT_KEY_SEP = '\u001f';

function mapSizeJson(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (!Number.isNaN(n)) out[k] = n;
  }
  return out;
}

function mapRow(r: Record<string, unknown>): HandoverReportRow {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    colorwayId: (r.colorway_id as string) ?? null,
    fromDepartmentId: r.from_department_id as string,
    toDepartmentId: r.to_department_id as string,
    sentQty: (r.sent_qty as number) ?? 0,
    receivedQty: (r.received_qty as number) ?? null,
    qtyBySize: mapSizeJson(r.qty_by_size),
    receivedQtyBySize: mapSizeJson(r.received_qty_by_size),
    sentAt: r.sent_at as string,
    receivedAt: (r.received_at as string) ?? null,
    status: (r.status as HandoverReportRow['status']) ?? 'pending',
    challanNumber: (r.challan_number as string) ?? null,
    notes: (r.notes as string) ?? null,
    receivedNotes: (r.received_notes as string) ?? null,
    sentBy: (r.sent_by as string) ?? null,
    receivedBy: (r.received_by as string) ?? null,
    styleName: (r.style_name as string) ?? '',
    poNumber: (r.po_number as string) ?? '',
    colorwayName: (r.colorway_name as string) ?? null,
    colorCode: (r.color_code as string) ?? null,
    fromDepartmentName: (r.from_department_name as string) ?? '',
    toDepartmentName: (r.to_department_name as string) ?? '',
    sentByName: (r.sent_by_name as string) ?? null,
    receivedByName: (r.received_by_name as string) ?? null,
    fromProduceOperationNames: (r.from_produce_operation_names as string) ?? null,
    toProduceOperationNames: (r.to_produce_operation_names as string) ?? null,
    fromResourceName: (r.from_resource_name as string) ?? null,
    toResourceName: (r.to_resource_name as string) ?? null,
    lossClosedBy: (r.loss_closed_by as string) ?? null,
    lossClosedByName: (r.loss_closed_by_name as string) ?? null,
    lossClosedAt: (r.loss_closed_at as string) ?? null,
    lossRemark: (r.loss_remark as string) ?? null,
    lossRejectionId: (r.loss_rejection_id as string) ?? null,
    logDate: (r.log_date as string) ?? '',
    shiftId: (r.shift_id as string) ?? null,
    shiftName: (r.shift_name as string) ?? null,
    hourSlot: (r.hour_slot as string) ?? '',
    missingInTransit:
      (r.missing_in_transit as number | null) ??
      handoverQtyGap(
        (r.sent_qty as number) ?? 0,
        (r.received_qty as number | null) ?? null,
        (r.status as string) ?? 'pending',
      ),
  };
}

function shiftKey(row: HandoverReportRow): string {
  const id = row.shiftId ?? '';
  const name = (row.shiftName ?? 'Unallocated').trim() || 'Unallocated';
  return `${id}${SHIFT_KEY_SEP}${name}`;
}

function parseShiftKey(key: string): { shiftId: string | null; shiftName: string } {
  const idx = key.indexOf(SHIFT_KEY_SEP);
  if (idx < 0) return { shiftId: null, shiftName: key || 'Unallocated' };
  const id = key.slice(0, idx);
  const name = key.slice(idx + SHIFT_KEY_SEP.length) || 'Unallocated';
  return { shiftId: id || null, shiftName: name };
}

/** Hour bucket from sent_at (calendar hour) — reliable for UI grouping. */
export function hourSlotFromSentAt(sentAt: string, fallback = ''): string {
  try {
    const d = new Date(sentAt);
    if (Number.isNaN(d.getTime())) return fallback || '—';
    const h = d.getHours();
    const nextH = (h + 1) % 24;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(h)}:00-${pad(nextH)}:00`;
  } catch {
    return fallback || '—';
  }
}

function hourSlotSortKey(slot: string): number {
  const start = slot.split('-')[0]?.trim() || slot;
  const [hh, mm] = start.split(':').map((p) => parseInt(p, 10));
  if (!Number.isFinite(hh)) return Number.MAX_SAFE_INTEGER;
  return hh * 60 + (Number.isFinite(mm) ? mm : 0);
}

/** Group by calendar day, then factory shift (not hour slot). */
export function groupHandoverRows(
  rows: HandoverReportRow[],
  shiftOrder: string[] = [],
): DateGroup[] {
  const dateMap = new Map<string, HandoverReportRow[]>();
  for (const row of rows) {
    const key = row.logDate;
    const list = dateMap.get(key) ?? [];
    list.push(row);
    dateMap.set(key, list);
  }

  const dates = [...dateMap.keys()].sort((a, b) => b.localeCompare(a));

  return dates.map((logDate) => {
    const dayRows = dateMap.get(logDate) ?? [];
    const shiftMap = new Map<string, HandoverReportRow[]>();

    for (const row of dayRows) {
      const key = shiftKey(row);
      const list = shiftMap.get(key) ?? [];
      list.push(row);
      shiftMap.set(key, list);
    }

    const shiftRank = (g: ShiftGroup): number => {
      if (!g.shiftId) return Number.MAX_SAFE_INTEGER;
      const idx = shiftOrder.indexOf(g.shiftId);
      return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER - 1;
    };

    const shiftGroups: ShiftGroup[] = [...shiftMap.entries()]
      .map(([key, shiftRows]) => {
        const { shiftId, shiftName } = parseShiftKey(key);
        const hourMap = new Map<string, HandoverReportRow[]>();

        for (const row of shiftRows) {
          const hourKey = hourSlotFromSentAt(row.sentAt, row.hourSlot);
          const list = hourMap.get(hourKey) ?? [];
          list.push(row);
          hourMap.set(hourKey, list);
        }

        const hourSlotGroups: HourSlotGroup[] = [...hourMap.entries()]
          .map(([hourSlot, slotRows]) => {
            const sorted = [...slotRows].sort(
              (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
            );
            return {
              hourSlot,
              rows: sorted,
              totalQty: sorted.reduce((s, r) => s + r.sentQty, 0),
            };
          })
          .sort((a, b) => hourSlotSortKey(a.hourSlot) - hourSlotSortKey(b.hourSlot));

        return {
          shiftId,
          shiftName,
          hourSlotGroups,
          totalQty: shiftRows.reduce((s, r) => s + r.sentQty, 0),
        };
      })
      .sort((a, b) => {
        const diff = shiftRank(a) - shiftRank(b);
        return diff !== 0 ? diff : a.shiftName.localeCompare(b.shiftName);
      });

    return {
      logDate,
      shiftGroups,
      totalQty: dayRows.reduce((s, r) => s + r.sentQty, 0),
    };
  });
}

export function defaultTransactionReportRange(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  return {
    dateFrom: format(subDays(today, 30), 'yyyy-MM-dd'),
    dateTo: format(today, 'yyyy-MM-dd'),
  };
}

type ShiftLookup = { id: string; name: string; hours: ShiftHourBlock[] };

function timeInActiveSlot(d: Date, start: string, end: string): boolean {
  const toMins = (hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const tm = d.getHours() * 60 + d.getMinutes();
  const sm = toMins(start);
  const em = toMins(end);
  if (sm <= em) return tm >= sm && tm < em;
  return tm >= sm || tm < em;
}

function inferShiftForTimestamp(
  shifts: ShiftLookup[],
  ts: string,
): { shiftId: string | null; shiftName: string | null } {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return { shiftId: null, shiftName: null };
  for (const shift of shifts) {
    for (const slot of shift.hours ?? []) {
      if (
        slot.type === 'active' &&
        slot.start &&
        slot.end &&
        timeInActiveSlot(d, slot.start, slot.end)
      ) {
        return { shiftId: shift.id, shiftName: shift.name };
      }
    }
  }
  return { shiftId: null, shiftName: null };
}

function matchesHandoverSearch(
  row: Pick<
    HandoverReportRow,
    | 'styleName'
    | 'poNumber'
    | 'challanNumber'
    | 'fromDepartmentName'
    | 'toDepartmentName'
  >,
  search: string,
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.styleName,
    row.poNumber,
    row.challanNumber ?? '',
    row.fromDepartmentName,
    row.toDepartmentName,
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

// Replacement for fetchHandoverReportFromTables in lib/transactionReportApi.ts
// Resolves fromProduceOperationNames / toProduceOperationNames / fromResourceName /
// toResourceName the same way get_handover_report does server-side, instead of
// nulling them out. Everything else in the function is unchanged.

async function fetchHandoverReportFromTables(
  factoryId: string,
  filters: HandoverReportFilters,
): Promise<HandoverReportRow[]> {
  const defaults = defaultTransactionReportRange();
  const dateFrom = filters.dateFrom ?? defaults.dateFrom;
  const dateTo = filters.dateTo ?? defaults.dateTo;

  const fromT = `${dateFrom}T00:00:00`;
  const toT = `${dateTo}T23:59:59.999Z`;

  let query = supabase
    .from('handover_slips')
    .select('*')
    .eq('factory_id', factoryId)
    .gte('sent_at', fromT)
    .lte('sent_at', toT)
    .order('sent_at', { ascending: false })
    .limit(2000);

  if (filters.fromDepartmentId) query = query.eq('from_department_id', filters.fromDepartmentId);
  if (filters.toDepartmentId) query = query.eq('to_department_id', filters.toDepartmentId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.orderId) query = query.eq('order_id', filters.orderId);
  if (filters.colorwayId) query = query.eq('colorway_id', filters.colorwayId);

  const { data: slips, error } = await query;
  if (error) throw error;
  if (!slips?.length) return [];

  const orderIds = [...new Set(slips.map((s) => s.order_id as string))];
  const colorwayIds = [
    ...new Set(slips.map((s) => s.colorway_id as string | null).filter(Boolean)),
  ] as string[];
  const deptIds = [
    ...new Set(slips.flatMap((s) => [s.from_department_id as string, s.to_department_id as string])),
  ];
  const profileIds = [
    ...new Set(
      slips.flatMap((s) =>
        [s.sent_by as string | null, s.received_by as string | null, s.loss_closed_by as string | null].filter(Boolean),
      ),
    ),
  ] as string[];
  const fromLineAllocIds = [
    ...new Set(slips.map((s) => s.from_line_allocation_id as string | null).filter(Boolean)),
  ] as string[];

  const [ordersRes, colorwaysRes, deptsRes, profilesRes, shiftsRes, routeStepsRes, lineAllocsRes] =
    await Promise.all([
      supabase.from('style_orders').select('id, style_name, po_number').in('id', orderIds),
      colorwayIds.length
        ? supabase.from('colorways').select('id, name, color_code').in('id', colorwayIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      supabase.from('departments').select('id, name').in('id', deptIds),
      profileIds.length
        ? supabase.from('profiles').select('id, full_name').in('id', profileIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      supabase.from('shifts').select('id, name, hours').eq('factory_id', factoryId),
      // every produce-step operation name, per order+visit -- mirrors the
      // from_produce_ops/to_produce_ops LATERAL in get_handover_report
      supabase
        .from('order_routing_steps')
        .select('order_id, visit_id, operation_name, step_type')
        .in('order_id', orderIds)
        .eq('step_type', 'produce'),
      // every planning row per order -- mirrors the from_allocation/target_allocation
      // joins in get_handover_report; used to resolve resource names on both sides
      supabase
        .from('line_allocations')
        .select('id, order_id, colorway_id, visit_id, line_id, updated_at, created_at')
        .in('order_id', orderIds),
    ]);

  if (ordersRes.error) throw ordersRes.error;
  if (deptsRes.error) throw deptsRes.error;
  if (colorwaysRes.error) throw colorwaysRes.error;
  if (shiftsRes.error) throw shiftsRes.error;
  if (routeStepsRes.error) throw routeStepsRes.error;
  if (lineAllocsRes.error) throw lineAllocsRes.error;

  const orderMap = new Map((ordersRes.data ?? []).map((o) => [o.id as string, o as Record<string, unknown>]));
  const colorwayMap = new Map(
    (colorwaysRes.data ?? []).map((c): [string, Record<string, unknown>] => [c.id as string, c as Record<string, unknown>]),
  );
  const deptMap = new Map((deptsRes.data ?? []).map((d) => [d.id as string, d.name as string]));
  const profileMap = new Map<string, string>();
  if (!profilesRes.error) {
    for (const p of profilesRes.data ?? []) profileMap.set(p.id as string, (p.full_name as string) || '');
  }

  // produce-step operation names, grouped by "orderId|visitId", comma-joined,
  // matching the string_agg(DISTINCT ... ORDER BY operation_name) behavior server-side
  const produceOpNamesByVisit = new Map<string, string>();
  for (const step of routeStepsRes.data ?? []) {
    const orderId = step.order_id as string;
    const visitId = step.visit_id as string | null;
    const opName = step.operation_name as string | null;
    if (!visitId || !opName) continue;
    const key = `${orderId}|${visitId}`;
    const existing = produceOpNamesByVisit.get(key);
    const names = existing ? new Set(existing.split(', ')) : new Set<string>();
    names.add(opName);
    produceOpNamesByVisit.set(key, [...names].sort().join(', '));
  }

  // line_allocations lookups: by id (for from_line_allocation_id -> resource),
  // and by "orderId|visitId" (for the receiving side, no direct FK available)
  const lineAllocById = new Map<string, Record<string, unknown>>(
    (lineAllocsRes.data ?? []).map((la): [string, Record<string, unknown>] => [la.id as string, la]),
  );
  const lineAllocsByOrderVisit = new Map<string, Array<Record<string, unknown>>>();
  for (const la of lineAllocsRes.data ?? []) {
    const key = `${la.order_id as string}|${la.visit_id as string}`;
    const list = lineAllocsByOrderVisit.get(key) ?? [];
    list.push(la);
    lineAllocsByOrderVisit.set(key, list);
  }

  const resourceIdsNeeded = new Set<string>();
  for (const la of lineAllocsRes.data ?? []) {
    if (la.line_id) resourceIdsNeeded.add(la.line_id as string);
  }
  const resourcesRes = resourceIdsNeeded.size
    ? await supabase.from('assigned_resources').select('id, resource_name').in('id', [...resourceIdsNeeded])
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (resourcesRes.error) throw resourcesRes.error;
  const resourceNameById = new Map<string, string>(
    (resourcesRes.data ?? []).map((r): [string, string] => [r.id as string, r.resource_name as string]),
  );

  /** Mirrors get_handover_report's target_allocation lookup: same order+visit,
   *  colorway match preferred (falls back to any), most recently updated first. */
  function resolveToResourceName(orderId: string, toVisitId: string | null, colorwayId: string | null): string | null {
    if (!toVisitId) return null;
    const candidates = lineAllocsByOrderVisit.get(`${orderId}|${toVisitId}`) ?? [];
    if (candidates.length === 0) return null;
    const scored = [...candidates].sort((a, b) => {
      const aMatch = (a.colorway_id ?? null) === colorwayId ? 0 : 1;
      const bMatch = (b.colorway_id ?? null) === colorwayId ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const aTime = (a.updated_at as string) ?? (a.created_at as string) ?? '';
      const bTime = (b.updated_at as string) ?? (b.created_at as string) ?? '';
      return bTime.localeCompare(aTime);
    });
    const lineIdValue = scored[0]?.line_id;
    const lineId = typeof lineIdValue === 'string' ? lineIdValue : undefined;
    return lineId ? resourceNameById.get(lineId) ?? null : null;
  }

  const shifts: ShiftLookup[] = (shiftsRes.data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    hours: (s.hours as ShiftHourBlock[]) ?? [],
  }));

  const search = filters.search?.trim() ?? '';

  return slips
    .map((slip) => {
      const order = orderMap.get(slip.order_id as string);
      const colorway = slip.colorway_id ? colorwayMap.get(slip.colorway_id as string) : undefined;
      const sentAt = slip.sent_at as string;
      const { shiftId, shiftName } = inferShiftForTimestamp(shifts, sentAt);

      const orderId = slip.order_id as string;
      const colorwayId = (slip.colorway_id as string) ?? null;
      const fromVisitId = (slip.from_visit_id as string) ?? null;
      const toVisitId = (slip.to_visit_id as string) ?? null;
      const fromLineAllocId = (slip.from_line_allocation_id as string) ?? null;

      const fromProduceOperationNames = fromVisitId
        ? produceOpNamesByVisit.get(`${orderId}|${fromVisitId}`) ?? null
        : null;
      const toProduceOperationNames = toVisitId
        ? produceOpNamesByVisit.get(`${orderId}|${toVisitId}`) ?? null
        : null;

      const fromLineId = fromLineAllocId ? (lineAllocById.get(fromLineAllocId)?.line_id as string | undefined) : undefined;
      const fromResourceName = fromLineId ? resourceNameById.get(fromLineId) ?? null : null;
      const toResourceName = resolveToResourceName(orderId, toVisitId, colorwayId);

      return {
        id: slip.id as string,
        orderId,
        colorwayId,
        fromDepartmentId: slip.from_department_id as string,
        toDepartmentId: slip.to_department_id as string,
        sentQty: (slip.sent_qty as number) ?? 0,
        receivedQty: (slip.received_qty as number) ?? null,
        qtyBySize: mapSizeJson(slip.qty_by_size),
        receivedQtyBySize: mapSizeJson(slip.received_qty_by_size),
        sentAt,
        receivedAt: (slip.received_at as string) ?? null,
        status: (slip.status as HandoverReportRow['status']) ?? 'pending',
        challanNumber: (slip.challan_number as string) ?? null,
        notes: (slip.notes as string) ?? null,
        receivedNotes: (slip.received_notes as string) ?? null,
        sentBy: (slip.sent_by as string) ?? null,
        receivedBy: (slip.received_by as string) ?? null,
        styleName: (order?.style_name as string) ?? '',
        poNumber: (order?.po_number as string) ?? '',
        colorwayName: (colorway?.name as string) ?? null,
        colorCode: (colorway?.color_code as string) ?? null,
        fromDepartmentName: deptMap.get(slip.from_department_id as string) ?? '',
        toDepartmentName: deptMap.get(slip.to_department_id as string) ?? '',
        sentByName: slip.sent_by ? profileMap.get(slip.sent_by as string) ?? null : null,
        receivedByName: slip.received_by ? profileMap.get(slip.received_by as string) ?? null : null,
        fromProduceOperationNames,
        toProduceOperationNames,
        fromResourceName,
        toResourceName,
        lossClosedBy: (slip.loss_closed_by as string) ?? null,
        lossClosedByName: slip.loss_closed_by ? profileMap.get(slip.loss_closed_by as string) ?? null : null,
        lossClosedAt: (slip.loss_closed_at as string) ?? null,
        lossRemark: (slip.loss_remark as string) ?? null,
        lossRejectionId: (slip.loss_rejection_id as string) ?? null,
        logDate: sentAt.slice(0, 10),
        shiftId,
        shiftName,
        hourSlot: hourSlotFromSentAt(sentAt),
        missingInTransit: handoverQtyGap(
          (slip.sent_qty as number) ?? 0,
          (slip.received_qty as number | null) ?? null,
          (slip.status as string) ?? 'pending',
        ),
      } satisfies HandoverReportRow;
    })
    .filter((row) => matchesHandoverSearch(row, search));
}

export async function fetchHandoverReport(
  factoryId: string,
  filters: HandoverReportFilters = {},
): Promise<HandoverReportRow[]> {
  const defaults = defaultTransactionReportRange();
  const { data, error } = await supabase.rpc('get_handover_report', {
    p_factory_id: factoryId,
    p_date_from: filters.dateFrom ?? defaults.dateFrom,
    p_date_to: filters.dateTo ?? defaults.dateTo,
    p_from_department_id: filters.fromDepartmentId ?? null,
    p_to_department_id: filters.toDepartmentId ?? null,
    p_status: filters.status ?? null,
    p_order_id: filters.orderId ?? null,
    p_colorway_id: filters.colorwayId ?? null,
    p_search: filters.search?.trim() || null,
  });

  if (!error) return ((data as Record<string, unknown>[]) ?? []).map(mapRow);

  console.warn('get_handover_report RPC failed, falling back to handover_slips', error);
  return fetchHandoverReportFromTables(factoryId, filters);
}
