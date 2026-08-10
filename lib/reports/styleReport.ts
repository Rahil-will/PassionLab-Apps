import {
  mapFulfillmentShipmentFromDb,
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
import {
  fetchReportMeta,
  type ReportMeta,
} from './reportMeta';
import {
  fetchOrderDeptProgressRows,
  fetchOperationProgressRows,
  type CutToShipJourneyRow,
  type OperationProgressRow,
} from './kpiAndProgress';
import { mapShiftRow, workforceHeadcountFromLog } from './shared/shiftLogUtils';

export interface StyleJourneyDept {
  deptId: string;
  deptName: string;
  /** Work-center visit id — a department revisited later in the flow gets a distinct
   *  visitId per visit; never merge two visits into one row/column by deptId alone. */
  visitId: string;
  /** Primary order_routing_steps.id for this visit — used for route-scoped breakdowns. */
  primaryRouteId?: string;
  /** Operation/step names routed through this specific visit, e.g. "Cutting · Lay marking". */
  activitiesLabel?: string;
  flowStep: number;
  isQcDept: boolean;
  isAuditDept: boolean;
  produced: number;
  sent: number;
  received: number;
  remaining: number;
  wip: number;
  /** Closed handovers where received < sent at this visit. */
  missingInTransit?: number;
  /** Pending handover slips not yet received at this visit. */
  inTransit?: number;
  status: 'not_started' | 'in_progress' | 'complete';
  completedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  /** SAM from line_allocations.sam for this department. */
  plannedSam: number | null;
  /** Primary operation step type for this visit. */
  stepType?: string | null;
  /** Department master role (origin | standard | terminal). */
  deptRole?: string | null;
  /** Primary operation capture app for this visit. */
  primaryCaptureApp?: string | null;
  /** All order_routing_steps.id values inside this visit. */
  routeIds?: string[];
  lineBreakdown: Array<{
    resourceId: string;
    resourceName: string;
    produced: number;
    completedAt: string | null;
  }>;
}

export interface StyleJourneyReport {
  order: {
    id: string;
    styleName: string;
    styleRef: string | null;
    buyerName: string | null;
    poNumber: string;
    orderQty: number;
    adjQty: number;
    orderDate: string | null;
    deliveryDate: string | null;
    jobCardDate: string | null;
    sewingSam: number | null;
    /** @deprecated use sewingSam */
    sam: number | null;
    priority: string | null;
    status: string;
    garmentType: string | null;
    washType: string | null;
    sizeGroupName: string | null;
    sizeLabels: string | null;
    processFlowName: string | null;
    cuttingAllowance: number | null;
    shipmentAllowance: number | null;
    remarks: string | null;
    imageUrl: string | null;
  };
  colorways: Array<{
    id: string;
    name: string;
    colorCode: string | null;
    qty: number;
  }>;
  flowDepts: StyleJourneyDept[];
  sizeProgress: SizeProgressLookup;
  shipmentSummary: {
    shippedQty: number;
    rejectedQty: number;
    balance: number;
    shipments: FulfillmentShipmentRow[];
    rejections: FulfillmentRejectionRow[];
    audits: FulfillmentAuditRow[];
  };
  deptAudits: StyleDeptAuditGroup[];
}

export interface StyleDeptAuditSessionRow {
  date: string;
  lotSize: number;
  sampleSize: number;
  aqlLevel: string | null;
  passed: number;
  failed: number;
  majorFailed: number;
  minorFailed: number;
  result: string | null;
}

export interface StyleDeptAuditGroup {
  deptId: string;
  deptName: string;
  sessions: StyleDeptAuditSessionRow[];
}

function deriveDeptStatus(
  produced: number,
  lineRows: StyleJourneyDept['lineBreakdown'],
): StyleJourneyDept['status'] {
  if (produced <= 0) return 'not_started';
  if (lineRows.length > 0 && lineRows.every((l) => l.completedAt != null)) return 'complete';
  if (lineRows.some((l) => l.completedAt != null)) return 'complete';
  return 'in_progress';
}

function buildSizeProgressFromJourney(
  rows: CutToShipJourneyRow[],
  opRows?: OperationProgressRow[],
): SizeProgressLookup {
  const byColorwayVisit = new Map<string, SizeMap>();
  const byColorwayDept = new Map<string, SizeMap>();
  const byColorwayRoute = new Map<string, SizeMap>();
  const aggregateByRoute = new Map<string, SizeMap>();

  for (const row of rows) {
    if (!row.is_in_flow) continue;
    const colorwayId = row.colorway_id;
    if (!colorwayId) continue;
    const visitId = row.visit_id || `dept-${row.dept_id}`;
    const deptName = row.dept_name || '';
    const produced = row.qty_produced_by_size || {};
    const vKey = `${colorwayId}|${visitId}`;
    const dKey = `${colorwayId}|${deptName}`;
    const vMap = byColorwayVisit.get(vKey) ?? {};
    mergeSizeMaps(vMap, produced);
    byColorwayVisit.set(vKey, vMap);
    const dMap = byColorwayDept.get(dKey) ?? {};
    mergeSizeMaps(dMap, produced);
    byColorwayDept.set(dKey, dMap);
  }

  if (opRows) {
    for (const row of opRows) {
      const colorwayId = row.colorway_id;
      if (!colorwayId) continue;
      const opId = row.operation_id;
      const produced = row.qty_produced_by_size || {};
      const rKey = `${colorwayId}|${opId}`;
      const rMap = byColorwayRoute.get(rKey) ?? {};
      mergeSizeMaps(rMap, produced);
      byColorwayRoute.set(rKey, rMap);
    }
    for (const [key, sizeMap] of byColorwayRoute) {
      const opId = key.split('|').slice(1).join('|');
      const agg = aggregateByRoute.get(opId) ?? {};
      mergeSizeMaps(agg, sizeMap);
      aggregateByRoute.set(opId, agg);
    }
  }

  const aggregateByVisit = new Map<string, SizeMap>();
  const aggregateByDept = new Map<string, SizeMap>();

  for (const [key, sizeMap] of byColorwayVisit) {
    const visitId = key.split('|').slice(1).join('|');
    const agg = aggregateByVisit.get(visitId) ?? {};
    mergeSizeMaps(agg, sizeMap);
    aggregateByVisit.set(visitId, agg);
  }
  for (const [key, sizeMap] of byColorwayDept) {
    const deptName = key.split('|')[1] ?? '';
    const agg = aggregateByDept.get(deptName) ?? {};
    mergeSizeMaps(agg, sizeMap);
    aggregateByDept.set(deptName, agg);
  }

  function mergeSizeMaps(target: SizeMap, source: SizeMap | null | undefined): void {
    for (const [size, qty] of Object.entries(source || {})) {
      target[size] = (target[size] || 0) + (Number(qty) || 0);
    }
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
    getVisitSizeCount(colorwayId, visitId, size) {
      if (colorwayId) {
        return Number(byColorwayVisit.get(`${colorwayId}|${visitId}`)?.[size]) || 0;
      }
      return Number(aggregateByVisit.get(visitId)?.[size]) || 0;
    },
    getVisitTotal(colorwayId, visitId) {
      if (colorwayId) {
        return sumSizeMap(byColorwayVisit.get(`${colorwayId}|${visitId}`));
      }
      return sumSizeMap(aggregateByVisit.get(visitId));
    },
    getRouteSizeCount(colorwayId, routeStepId, size) {
      if (colorwayId) {
        return Number(byColorwayRoute.get(`${colorwayId}|${routeStepId}`)?.[size]) || 0;
      }
      return Number(aggregateByRoute.get(routeStepId)?.[size]) || 0;
    },
    getRouteTotal(colorwayId, routeStepId) {
      if (colorwayId) {
        return sumSizeMap(byColorwayRoute.get(`${colorwayId}|${routeStepId}`));
      }
      return sumSizeMap(aggregateByRoute.get(routeStepId));
    },
  };
}

/** Style lifecycle journey: process flow, line breakdown, and shipment summary. */
export async function fetchStyleJourneyReport(
  factoryId: string,
  orderId: string,
  colorwayId: string | null,
): Promise<StyleJourneyReport> {
  const [orderRes, colorwayRes, journeyRows, opRows, deptRes, routingRes, deliveryRes] = await Promise.all([
    supabase
      .from('style_orders')
      .select(
        `id, style_name, style_ref, buyer_name, po_number, order_qty, adj_qty,
        order_date, job_card_date, sewing_sam, priority, status, garment_type, image_url,
        size_group_name, size_labels,
        cutting_allowance, shipment_allowance, remarks`,
      )
      .eq('factory_id', factoryId)
      .eq('id', orderId)
      .maybeSingle(),
    supabase
      .from('colorways')
      .select('id, name, color_code, qty')
      .eq('order_id', orderId)
      .order('name'),
    fetchOrderDeptProgressRows(factoryId, orderId, colorwayId),
    fetchOperationProgressRows(factoryId, orderId, colorwayId),
    supabase.from('departments').select('id, name, transaction_enabled, supervisor_enabled, role, planning_mode').eq('factory_id', factoryId),
    fetchOrderRoutingSteps(orderId, factoryId),
    supabase
      .from('order_delivery_targets')
      .select('target_date')
      .eq('order_id', orderId)
      .order('target_date', { ascending: false })
      .limit(1),
  ]);

  if (orderRes.error) throw orderRes.error;
  if (colorwayRes.error) throw colorwayRes.error;
  if (deptRes.error) throw deptRes.error;
  if (!orderRes.data) throw new Error('Order not found');

  const deptRoleById = new Map(
    (deptRes.data || []).map((d) => [d.id as string, (d.role as string) || null]),
  );
  const deptApps = new Map(
    (deptRes.data || []).map((d) => [d.id as string, composeDeptAppsFromRow(d)]),
  );
  const deptMeta = (deptRes.data || []).map((d) => ({
    id: d.id as string,
    name: (d.name as string) || '',
    apps: composeDeptAppsFromRow(d),
  }));
  const departmentsForRouting = (deptRes.data || []).map((d) => ({
    id: d.id as string,
    name: (d.name as string) || '',
  }));

  // One cell per work-center VISIT, never per department. A department revisited
  // later in the flow (e.g. Cutting -> Sewing -> Cutting rework) yields two
  // separate, sequentially-ordered cells here — each with its own visitId and its
  // own activitiesLabel scoped to just that visit's operations.
  const visitCells = visitPipelineCellsFromRouting(
    routingRes.map((s) => ({
      id: s.id,
      seq: s.seq,
      dept_id: s.dept_id || undefined,
      dept_name: s.dept_name,
      operation_name: s.operation_name,
      step_type: s.step_type,
      visit_id: s.visit_id,
      is_primary_output: s.is_primary_output,
      capture_app: s.capture_app,
    })),
    departmentsForRouting,
  );
  const routeStepById = new Map(routingRes.map((s) => [s.id, s]));

  let allocQuery = supabase
    .from('line_allocations')
    .select(
      'line_id, department_id, visit_id, start_date, end_date, completed_is_true, updated_at, sam, kpi_inputs',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) allocQuery = allocQuery.eq('colorway_id', colorwayId);

  // line_allocations no longer tracks per-line produced qty (production_produced_qty
  // was dropped — capture output lives on hourly_counts / batch_production). Aggregate
  // per resource+department here to drive the per-line breakdown below.
  let lineOutputQuery = supabase
    .from('hourly_counts')
    .select('resource_id, department_id, count')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) lineOutputQuery = lineOutputQuery.eq('colorway_id', colorwayId);

  let batchLineOutputQuery = supabase
    .from('batch_production')
    .select('resource_id, department_id, produced_qty, order_route_id')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) batchLineOutputQuery = batchLineOutputQuery.eq('colorway_id', colorwayId);

  let shipQuery = supabase
    .from('shipments')
    .select(
      'id, colorway_id, shipment_date, shipped_qty, shipped_qty_by_size, invoice_number, awb_number, destination, shipment_type, notes',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .order('shipment_date', { ascending: false });
  if (colorwayId) shipQuery = shipQuery.eq('colorway_id', colorwayId);

  let rejQuery = supabase
    .from('rejections')
    .select('rejected_date, qty, size, stage, reason_code, reason_detail')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .order('rejected_date', { ascending: false });
  if (colorwayId) rejQuery = rejQuery.eq('colorway_id', colorwayId);

  const [allocRes, lineOutputRes, batchLineOutputRes, shipRes, rejRes, resourceRes, audits, deptAudits] =
    await Promise.all([
    allocQuery,
    lineOutputQuery,
    batchLineOutputQuery,
    shipQuery,
    rejQuery,
    supabase
      .from('assigned_resources')
      .select('id, resource_name')
      .eq('factory_id', factoryId)
      .eq('status', 'active'),
    fetchFulfillmentAudits(factoryId, orderId, colorwayId).catch(() => [] as FulfillmentAuditRow[]),
    fetchStyleOrderDeptAudits(factoryId, orderId, colorwayId, deptMeta).catch(
      () => [] as StyleDeptAuditGroup[],
    ),
  ]);

  if (allocRes.error) throw allocRes.error;
  if (shipRes.error) throw shipRes.error;
  if (rejRes.error) throw rejRes.error;
  if (resourceRes.error) throw resourceRes.error;
  if (lineOutputRes.error) {
    console.warn('[fetchStyleJourneyReport] hourly_counts query:', lineOutputRes.error.message);
  }
  if (batchLineOutputRes.error) {
    console.warn('[fetchStyleJourneyReport] batch_production query:', batchLineOutputRes.error.message);
  }

  const resourceMap = new Map(
    (resourceRes.data || []).map((r) => [r.id as string, (r.resource_name as string) || '']),
  );

  const outputByVisitResource = new Map<string, number>();
  const resourceVisitByDept = new Map<string, string>();

  for (const raw of allocRes.data || []) {
    const deptId = (raw.department_id as string) || '';
    const resourceId = (raw.line_id as string) || '';
    const visitId = (raw.visit_id as string) || '';
    if (deptId && resourceId && visitId) {
      resourceVisitByDept.set(`${deptId}|${resourceId}`, visitId);
    }
  }

  for (const raw of lineOutputRes.data || []) {
    const deptId = (raw.department_id as string) || '';
    const resourceId = (raw.resource_id as string) || '';
    if (!deptId || !resourceId) continue;
    const visitId = resourceVisitByDept.get(`${deptId}|${resourceId}`) || `dept-${deptId}`;
    const key = `${visitId}|${resourceId}`;
    outputByVisitResource.set(key, (outputByVisitResource.get(key) || 0) + (Number(raw.count) || 0));
  }

  for (const raw of batchLineOutputRes.data || []) {
    const deptId = (raw.department_id as string) || '';
    const resourceId = (raw.resource_id as string) || '';
    if (!deptId || !resourceId) continue;
    const routeId = (raw.order_route_id as string) || '';
    const routeStep = routeId ? routeStepById.get(routeId) : undefined;
    const visitId =
      resourceVisitByDept.get(`${deptId}|${resourceId}`)
      || routeStep?.visit_id
      || `dept-${deptId}`;
    const key = `${visitId}|${resourceId}`;
    outputByVisitResource.set(
      key,
      (outputByVisitResource.get(key) || 0) + (Number(raw.produced_qty) || 0),
    );
  }

  const allocByVisit = new Map<string, StyleJourneyDept['lineBreakdown']>();
  const allocDatesByVisit = new Map<string, { startDate: string | null; endDate: string | null }>();
  const samByVisit = new Map<string, number>();

  for (const raw of allocRes.data || []) {
    const deptId = raw.department_id as string;
    const visitId = (raw.visit_id as string) || `dept-${deptId}`;
    const allocSam = allocationSamValue({
      sam: raw.sam as number | null,
      kpi_inputs: raw.kpi_inputs as { sam?: number } | null,
    });
    if (allocSam > 0 && !samByVisit.has(visitId)) samByVisit.set(visitId, allocSam);
    const resourceId = (raw.line_id as string) || '';
    const produced = outputByVisitResource.get(`${visitId}|${resourceId}`) || 0;
    const completedAt = raw.completed_is_true ? (raw.updated_at as string) || null : null;
    const startRaw = (raw.start_date as string) || null;
    const endRaw = (raw.end_date as string) || null;

    const dates = allocDatesByVisit.get(visitId) ?? { startDate: null, endDate: null };
    if (startRaw && (!dates.startDate || startRaw < dates.startDate)) dates.startDate = startRaw;
    if (endRaw && (!dates.endDate || endRaw > dates.endDate)) dates.endDate = endRaw;
    allocDatesByVisit.set(visitId, dates);

    const lines = allocByVisit.get(visitId) ?? [];
    const existing = lines.find((l) => l.resourceId === resourceId);
    if (existing) {
      existing.produced = produced;
      if (completedAt && (!existing.completedAt || completedAt > existing.completedAt)) {
        existing.completedAt = completedAt;
      }
    } else {
      lines.push({
        resourceId,
        resourceName: resourceMap.get(resourceId) || '—',
        produced,
        completedAt,
      });
    }
    allocByVisit.set(visitId, lines);
  }

  // Aggregate journey qty per VISIT (never per department) — order_routing_steps.visit_id
  // is the grouping key; a journey row without one (older data) falls back to dept_id,
  // which only clubs steps that truly have no visit distinction recorded.
  const journeyByVisit = new Map<string, {
    produced: number;
    sent: number;
    received: number;
    wip: number;
    inTransit: number;
    missingInTransit: number;
  }>();

  for (const row of journeyRows) {
    if (!row.is_in_flow) continue;
    const key = row.visit_id || `dept-${row.dept_id}`;
    const cur = journeyByVisit.get(key) ?? {
      produced: 0,
      sent: 0,
      received: 0,
      wip: 0,
      inTransit: 0,
      missingInTransit: 0,
    };
    cur.produced += row.qty_produced ?? 0;
    cur.sent += row.qty_sent ?? 0;
    cur.received += row.qty_received ?? 0;
    cur.wip += row.wip_qty ?? 0;
    cur.inTransit += row.qty_in_transit ?? 0;
    cur.missingInTransit += row.qty_missing_in_transit ?? 0;
    journeyByVisit.set(key, cur);
  }

  // visitCells is already ordered by route seq (visitPipelineCellsFromRouting sorts
  // its input before grouping), so array position IS the correct, unambiguous flow
  // order — the first cell is always the first cut-department operation, regardless
  // of whether that department is revisited later in the flow.
  const flowDepts: StyleJourneyDept[] = visitCells.map((cell, index) => {
    const m =
      journeyByVisit.get(cell.visitId)
      ?? journeyByVisit.get(`dept-${cell.deptId}`)
      ?? { produced: 0, sent: 0, received: 0, wip: 0, inTransit: 0, missingInTransit: 0 };
    const lineBreakdown = (allocByVisit.get(cell.visitId) ?? []).sort(
      (a, b) => b.produced - a.produced,
    );
    const remaining = Math.max(0, m.produced - m.sent);
    const completedAt = lineBreakdown.reduce<string | null>((latest, line) => {
      if (!line.completedAt) return latest;
      if (!latest || line.completedAt > latest) return line.completedAt;
      return latest;
    }, null);

    // Capture apps used within THIS visit only (not every visit this department
    // ever makes) — a department can run hourly output on one visit and QC on another.
    const visitApps = [
      ...new Set(
        cell.routeIds
          .map((id) => routeStepById.get(id)?.capture_app)
          .filter((app): app is NonNullable<typeof app> => Boolean(app)),
      ),
    ];
    const apps = visitApps.length > 0 ? visitApps : deptApps.get(cell.deptId) ?? null;

    const dates = allocDatesByVisit.get(cell.visitId);
    return {
      deptId: cell.deptId,
      deptName: cell.deptName,
      visitId: cell.visitId,
      primaryRouteId: cell.primaryRouteId,
      activitiesLabel: cell.activitiesLabel || undefined,
      flowStep: index + 1,
      isQcDept: isQcDept(apps),
      isAuditDept: isAuditDept(apps),
      produced: m.produced,
      sent: m.sent,
      received: m.received,
      remaining,
      wip: m.wip,
      inTransit: m.inTransit,
      missingInTransit: m.missingInTransit,
      status: deriveDeptStatus(m.produced, lineBreakdown),
      completedAt,
      startDate: dates?.startDate?.split('T')[0] ?? null,
      endDate: dates?.endDate?.split('T')[0] ?? null,
      plannedSam: samByVisit.get(cell.visitId) ?? null,
      stepType: cell.stepType ?? null,
      deptRole: deptRoleById.get(cell.deptId) ?? null,
      primaryCaptureApp: cell.primaryCaptureApp ?? null,
      routeIds: cell.routeIds,
      lineBreakdown,
    };
  });

  const colorwayNameById = new Map(
    (colorwayRes.data || []).map((cw) => [cw.id as string, (cw.name as string) || '']),
  );

  const shipments: FulfillmentShipmentRow[] = (shipRes.data || []).map((s) =>
    mapFulfillmentShipmentFromDb(s as Record<string, unknown>, colorwayNameById),
  );

  const rejections: FulfillmentRejectionRow[] = (rejRes.data || []).map((r) => ({
    date: String(r.rejected_date ?? ''),
    qty: Number(r.qty) || 0,
    size: (r.size as string) || null,
    stage: String(r.stage ?? ''),
    reasonCode: String(r.reason_code ?? ''),
    reasonDetail: (r.reason_detail as string) || null,
  }));

  const shippedQty = shipments.reduce((s, row) => s + row.qty, 0);
  const rejectedQty = rejections.reduce((s, row) => s + row.qty, 0);
  const orderQty = Number(orderRes.data.order_qty) || 0;

  const o = orderRes.data;
  const routingSteps = routingRes;
  const processFlowName =
    routingSteps.length > 0
      ? routingSteps
          .map((s) => s.operation_name || s.dept_name || '')
          .filter(Boolean)
          .join(' → ')
      : null;
  const deliveryDate =
    ((deliveryRes.data || [])[0]?.target_date as string | undefined) || null;

  return {
    order: {
      id: o.id as string,
      styleName: (o.style_name as string) || '',
      styleRef: (o.style_ref as string) || null,
      buyerName: (o.buyer_name as string) || null,
      poNumber: (o.po_number as string) || '',
      orderQty,
      adjQty: Number(o.adj_qty) || 0,
      orderDate: (o.order_date as string) || null,
      deliveryDate,
      jobCardDate: (o.job_card_date as string) || null,
      sewingSam: o.sewing_sam != null ? Number(o.sewing_sam) : null,
      sam: o.sewing_sam != null ? Number(o.sewing_sam) : null,
      priority: (o.priority as string) || 'normal',
      status: (o.status as string) || '',
      garmentType: (o.garment_type as string) || null,
      washType: null,
      sizeGroupName: (o.size_group_name as string) || null,
      sizeLabels: (o.size_labels as string) || null,
      processFlowName,
      cuttingAllowance: o.cutting_allowance != null ? Number(o.cutting_allowance) : null,
      shipmentAllowance: o.shipment_allowance != null ? Number(o.shipment_allowance) : null,
      remarks: (o.remarks as string) || null,
      imageUrl: (o.image_url as string) || null,
    },
    colorways: (colorwayRes.data || []).map((cw) => ({
      id: cw.id as string,
      name: (cw.name as string) || '',
      colorCode: (cw.color_code as string) || null,
      qty: Number(cw.qty) || 0,
    })),
    flowDepts,
    sizeProgress: buildSizeProgressFromJourney(journeyRows, opRows),
    shipmentSummary: {
      shippedQty,
      rejectedQty,
      balance: orderQty - shippedQty - rejectedQty,
      shipments,
      rejections,
      audits,
    },
    deptAudits,
  };
}

export interface StyleDeptDailyRow {
  date: string;
  deptId: string;
  deptName: string;
  output: number;
  target: number;
  dailyAvailableMins: number;
  efficiency: number | null;
  productivity: number | null;
  dhu: number | null;
  defectivePct: number | null;
  operationId?: string;
  operationName?: string;
  isExitOperation?: boolean;
}

/** Floor AQL audit sessions grouped by production department. */
export async function fetchStyleOrderDeptAudits(
  factoryId: string,
  orderId: string,
  colorwayId: string | null,
  deptMeta: Array<{ id: string; name: string; apps: string[] | null }>,
): Promise<StyleDeptAuditGroup[]> {
  const auditDeptIds = new Set(
    deptMeta.filter((d) => isAuditDept(d.apps)).map((d) => d.id),
  );
  if (auditDeptIds.size === 0) return [];

  let query = supabase
    .from('audit_sessions')
    .select(
      'department_id, logged_at, completed_at, lot_size, sample_size, aql_level, passed, failed, major_failed, minor_failed, result, status, departments(name)',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('status', 'completed')
    .order('logged_at', { ascending: false });
  // Floor AQL audit_sessions are order-scoped (no colorway_id column).

  const { data, error } = await query;
  if (error) {
    const code = String(error.code ?? '');
    const msg = String(error.message ?? '');
    if (
      code === '42501' ||
      code === '42P01' ||
      code === 'PGRST205' ||
      msg.includes('permission denied') ||
      msg.includes('does not exist')
    ) {
      return [];
    }
    throw error;
  }

  const deptNameMap = new Map(deptMeta.map((d) => [d.id, d.name]));
  const byDept = new Map<string, StyleDeptAuditSessionRow[]>();

  for (const raw of data || []) {
    const deptId = raw.department_id as string;
    if (!auditDeptIds.has(deptId)) continue;
    const dateRaw =
      (raw.completed_at as string) ||
      (raw.logged_at as string) ||
      '';
    const session: StyleDeptAuditSessionRow = {
      date: dateRaw.split('T')[0],
      lotSize: Number(raw.lot_size) || 0,
      sampleSize: Number(raw.sample_size) || 0,
      aqlLevel: (raw.aql_level as string) || null,
      passed: Number(raw.passed) || 0,
      failed: Number(raw.failed) || 0,
      majorFailed: Number(raw.major_failed) || 0,
      minorFailed: Number(raw.minor_failed) || 0,
      result: (raw.result as string) || null,
    };
    const list = byDept.get(deptId) ?? [];
    list.push(session);
    byDept.set(deptId, list);
  }

  return [...byDept.entries()]
    .map(([deptId, sessions]) => ({
      deptId,
      deptName: deptNameMap.get(deptId) || (sessions.length > 0 ? deptId.slice(0, 8) : 'Department'),
      sessions,
    }))
    .filter((g) => g.sessions.length > 0)
    .sort((a, b) => a.deptName.localeCompare(b.deptName));
}

/** Shipment / buyer QA audits for an order (colorway-scoped via v_daily_audit). */
export async function fetchFulfillmentAudits(
  factoryId: string,
  orderId: string,
  colorwayId?: string | null,
): Promise<FulfillmentAuditRow[]> {
  // v_daily_audit is resource/shift grain; we aggregate to colorway × department × date.
  let auditQuery = supabase
    .from('v_daily_audit')
    .select(
      `colorway_id, department_id, log_date, lots, lots_passed, lots_failed, lots_pass_pct,
       samples_inspected, passed, failed, major_failed, minor_failed, aql_level, defective_pct`,
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .order('log_date', { ascending: false });
  if (colorwayId) auditQuery = auditQuery.eq('colorway_id', colorwayId);

  const { data: auditRows, error: auditError } = await auditQuery;
  if (auditError) {
    console.warn('v_daily_audit unavailable, falling back to shipment_audits', auditError);
  }

  if (!auditError && auditRows && auditRows.length > 0) {
    const grouped = new Map<
      string,
      {
        colorway_id: string;
        department_id: string;
        log_date: string;
        lots: number;
        lots_passed: number;
        lots_failed: number;
        samples_inspected: number;
        passed: number;
        failed: number;
        major_failed: number;
        minor_failed: number;
        aql_level: string | null;
        def_sum: number;
        def_weight: number;
      }
    >();

    for (const row of auditRows) {
      const cw = String(row.colorway_id ?? '');
      const dept = String(row.department_id ?? '');
      const day = String(row.log_date ?? '');
      const key = `${cw}-${dept}-${day}`;
      let agg = grouped.get(key);
      if (!agg) {
        agg = {
          colorway_id: cw,
          department_id: dept,
          log_date: day,
          lots: 0,
          lots_passed: 0,
          lots_failed: 0,
          samples_inspected: 0,
          passed: 0,
          failed: 0,
          major_failed: 0,
          minor_failed: 0,
          aql_level: (row.aql_level as string | null) || null,
          def_sum: 0,
          def_weight: 0,
        };
        grouped.set(key, agg);
      }
      const dayLots = Number(row.lots) || 0;
      const daySamples = Number(row.samples_inspected) || 0;
      agg.lots += dayLots;
      agg.lots_passed += Number(row.lots_passed) || 0;
      agg.lots_failed += Number(row.lots_failed) || 0;
      agg.samples_inspected += daySamples;
      agg.passed += Number(row.passed) || 0;
      agg.failed += Number(row.failed) || 0;
      agg.major_failed += Number(row.major_failed) || 0;
      agg.minor_failed += Number(row.minor_failed) || 0;
      if (!agg.aql_level && row.aql_level) {
        agg.aql_level = String(row.aql_level);
      }
      if (row.defective_pct != null && daySamples > 0) {
        agg.def_sum += Number(row.defective_pct) * daySamples;
        agg.def_weight += daySamples;
      }
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.log_date.localeCompare(a.log_date))
      .map((g) => {
        const piecesSampled = g.samples_inspected;
        const failedPieces = g.failed;
        const lotsTotal = g.lots;
        const lotsFailed = g.lots_failed;
        return {
          id: `${g.colorway_id}-${g.department_id}-${g.log_date}`,
          date: g.log_date,
          auditType: 'Audit',
          colorwayName: '',
          lotSize: lotsTotal,
          sampleSize: piecesSampled,
          aqlLevel: g.aql_level,
          passed: g.passed,
          failed: failedPieces,
          majorFailed: g.major_failed,
          minorFailed: g.minor_failed,
          result:
            lotsTotal > 0 && lotsFailed === 0
              ? 'pass'
              : lotsFailed > 0
                ? 'fail'
                : null,
          status: 'completed',
          notes: null,
        };
      });
  }

  let query = supabase
    .from('shipment_audits')
    .select(
      'id, audit_date, audit_type, lot_size, sample_size, aql_level, passed, failed, major_failed, minor_failed, result, status, notes, colorway_id, colorways(name)',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('status', 'completed')
    .order('audit_date', { ascending: false });
  if (colorwayId) query = query.eq('colorway_id', colorwayId);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      const slim = await supabase
        .from('shipment_audits')
        .select('id, audit_date, audit_type, lot_size, sample_size, aql_level, passed, failed, major_failed, minor_failed, result, status, notes, colorway_id')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId)
        .eq('status', 'completed')
        .order('audit_date', { ascending: false });
      if (slim.error) {
        if (isMissingRelationError(slim.error) || isMissingColumnError(slim.error)) return [];
        throw slim.error;
      }
      return (slim.data || []).map((row) => ({
        id: String(row.id),
        date: String(row.audit_date ?? ''),
        auditType: String(row.audit_type ?? ''),
        colorwayName: '',
        lotSize: Number(row.lot_size) || 0,
        sampleSize: Number(row.sample_size) || 0,
        aqlLevel: (row.aql_level as string) || null,
        passed: Number(row.passed) || 0,
        failed: Number(row.failed) || 0,
        majorFailed: Number(row.major_failed) || 0,
        minorFailed: Number(row.minor_failed) || 0,
        result: (row.result as string) || null,
        status: String(row.status ?? ''),
        notes: (row.notes as string) || null,
      }));
    }
    throw error;
  }

  return (data || []).map((row) => ({
    id: String(row.id),
    date: String(row.audit_date ?? ''),
    auditType: String(row.audit_type ?? ''),
    colorwayName: String((row.colorways as { name?: string } | null)?.name ?? ''),
    lotSize: Number(row.lot_size) || 0,
    sampleSize: Number(row.sample_size) || 0,
    aqlLevel: (row.aql_level as string) || null,
    passed: Number(row.passed) || 0,
    failed: Number(row.failed) || 0,
    majorFailed: Number(row.major_failed) || 0,
    minorFailed: Number(row.minor_failed) || 0,
    result: (row.result as string) || null,
    status: String(row.status ?? ''),
    notes: (row.notes as string) || null,
  }));
}

export interface StyleDeptDefectRow {
  name: string;
  count: number;
}

export interface StyleDeptQualitySummary {
  inspected: number;
  firstTimePass: number;
  reworkPass: number;
  ftrPct: number | null;
  avgDhu: number | null;
  avgDefectivePct: number | null;
  topDefects: StyleDeptDefectRow[];
  dailyDefective: Array<{ date: string; label: string; pct: number | null }>;
}

export interface StyleDeptAuditMetrics {
  totalAudits: number;
  passedAudits: number;
  failedAudits: number;
  passPct: number | null;
  defectivePct: number | null;
  majorDefectivePct: number | null;
  dhu: number | null;
  daily: Array<{
    label: string;
    passPct: number | null;
    defectivePct: number | null;
    majorDefectivePct: number | null;
    auditCount: number;
    passedCount: number;
    failedCount: number;
  }>;
}

function qcFirstTimePassFromRow(raw: Record<string, unknown>): number {
  const explicit = Number(raw.first_time_pass);
  if (!Number.isNaN(explicit) && explicit >= 0) return explicit;
  const passed = Number(raw.passed) || 0;
  const reworkPass = Number(raw.rework_passed ?? raw.rework_pass) || 0;
  return Math.max(passed - reworkPass, 0);
}

function mergeTopDefectsFromView(rows: unknown[]): StyleDeptDefectRow[] {
  const totals = new Map<string, number>();
  for (const raw of rows) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const name = String((item as { name?: string }).name ?? '').trim();
        const count = Number((item as { count?: number }).count) || 0;
        if (name && count > 0) totals.set(name, (totals.get(name) || 0) + count);
      }
    } else if (typeof raw === 'object') {
      for (const [name, count] of Object.entries(raw as Record<string, unknown>)) {
        const n = Number(count) || 0;
        if (n > 0) totals.set(name, (totals.get(name) || 0) + n);
      }
    }
  }
  return [...totals.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);
}

function aggregateQualityViewRows(
  rows: Array<Record<string, unknown>>,
): StyleDeptQualitySummary {
  let inspected = 0;
  let firstTimePass = 0;
  let reworkPass = 0;
  let dhuSum = 0;
  let dhuWeight = 0;
  let defSum = 0;
  let defWeight = 0;
  const byDate = new Map<string, { inspected: number; failed: number }>();
  const topDefectParts: unknown[] = [];

  for (const raw of rows) {
    const date = String(raw.log_date ?? '');
    const rowInspected = Number(raw.inspected) || 0;
    const rowFirst =
      Number(raw.first_time_pass) ||
      qcFirstTimePassFromRow({ passed: raw.passed, rework_pass: raw.rework_pass ?? raw.rework_passed });
    const rowRework = Number(raw.rework_pass ?? raw.rework_passed) || 0;
    const rowFailed = Number(raw.failed) || 0;

    inspected += rowInspected;
    firstTimePass += rowFirst;
    reworkPass += rowRework;

    if (raw.dhu != null && rowInspected > 0) {
      const dhu = Number(raw.dhu);
      if (!Number.isNaN(dhu)) {
        dhuSum += dhu * rowInspected;
        dhuWeight += rowInspected;
      }
    }
    if (raw.defective_pct != null && rowInspected > 0) {
      const def = Number(raw.defective_pct);
      if (!Number.isNaN(def)) {
        defSum += def * rowInspected;
        defWeight += rowInspected;
      }
    }

    if (date) {
      const cur = byDate.get(date) ?? { inspected: 0, failed: 0 };
      cur.inspected += rowInspected;
      cur.failed += rowFailed;
      byDate.set(date, cur);
    }
    if (raw.top_defects) topDefectParts.push(raw.top_defects);
  }

  const ftrPct = inspected > 0 ? (firstTimePass / inspected) * 100 : null;
  const dailyDefective = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      label: date.slice(5),
      pct: d.inspected > 0 ? (d.failed / d.inspected) * 100 : null,
    }));

  return {
    inspected,
    firstTimePass,
    reworkPass,
    ftrPct,
    avgDhu: dhuWeight > 0 ? dhuSum / dhuWeight : null,
    avgDefectivePct: defWeight > 0 ? defSum / defWeight : null,
    topDefects: mergeTopDefectsFromView(topDefectParts),
    dailyDefective,
  };
}

async function fetchStyleDeptTopDefectsFromSessions(
  factoryId: string,
  orderId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  colorwayId?: string | null,
  resourceId?: string | null,
): Promise<StyleDeptDefectRow[]> {
  let query = supabase
    .from('inspection_sessions')
    .select('defect_summary')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('department_id', departmentId)
    .gte('log_date', dateFrom)
    .lte('log_date', dateTo);
  if (colorwayId) {
    const includeNull = await orderHasSingleColorway(orderId);
    query = applyColorwayCaptureFilter(query, colorwayId, includeNull);
  }
  if (resourceId) query = query.eq('resource_id', resourceId);

  const { data, error } = await query;
  if (error) throw error;
  return mergeTopDefectsFromView((data || []).map((r) => r.defect_summary));
}

async function fetchStyleDeptQualityFromSessions(
  factoryId: string,
  orderId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  colorwayId?: string | null,
  resourceId?: string | null,
): Promise<StyleDeptQualitySummary> {
  let query = supabase
    .from('inspection_sessions')
    .select(
      'log_date, total_inspected, passed, rework_passed, first_time_pass, failed, defect_summary, dhu, defective_pct',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('department_id', departmentId)
    .gte('log_date', dateFrom)
    .lte('log_date', dateTo);
  if (colorwayId) {
    const includeNull = await orderHasSingleColorway(orderId);
    query = applyColorwayCaptureFilter(query, colorwayId, includeNull);
  }
  if (resourceId) query = query.eq('resource_id', resourceId);

  let { data, error } = await query;
  if (error && isMissingColumnError(error)) {
    let fallback = supabase
      .from('inspection_sessions')
      .select('log_date, total_inspected, passed, rework_passed, failed, defect_summary')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .eq('department_id', departmentId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo);
    if (colorwayId) {
      const includeNull = await orderHasSingleColorway(orderId);
      fallback = applyColorwayCaptureFilter(fallback, colorwayId, includeNull);
    }
    if (resourceId) fallback = fallback.eq('resource_id', resourceId);
    const res = await fallback;
    data = (res.data ?? []) as typeof data;
    error = res.error;
  }
  if (error) throw error;

  const viewLike: Array<Record<string, unknown>> = [];
  const defectParts: unknown[] = [];

  for (const raw of data || []) {
    const row = raw as Record<string, unknown>;
    const date = String(row.log_date ?? '');
    const rowInspected = Number(row.total_inspected) || 0;
    const rowFirst = qcFirstTimePassFromRow(row);
    const rowRework = Number(row.rework_passed) || 0;
    const rowFailed = Number(row.failed) || 0;
    const defects = sumDefectCountFromSummary(row.defect_summary as Record<string, unknown>);

    viewLike.push({
      log_date: date,
      inspected: rowInspected,
      passed: rowFirst + rowRework,
      first_time_pass: rowFirst,
      rework_pass: rowRework,
      failed: rowFailed,
      dhu: row.dhu ?? (rowInspected > 0 ? (defects / rowInspected) * 100 : null),
      defective_pct:
        row.defective_pct ?? (rowInspected > 0 ? (rowFailed / rowInspected) * 100 : null),
    });

    if (row.defect_summary) defectParts.push(row.defect_summary);
  }

  const summary = aggregateQualityViewRows(viewLike);
  if (summary.topDefects.length === 0 && defectParts.length > 0) {
    summary.topDefects = mergeTopDefectsFromView(defectParts);
  }
  return summary;
}

/** QC department KPIs from v_daily_quality (falls back to inspection_sessions). */
export async function fetchStyleDeptQualitySummary(
  factoryId: string,
  orderId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  colorwayId?: string | null,
  resourceId?: string | null,
): Promise<StyleDeptQualitySummary> {
  const needsSessionGrain = Boolean(colorwayId || resourceId);

  if (!needsSessionGrain) {
    const { data, error } = await supabase
      .from('v_daily_quality')
      .select('log_date, inspected, first_time_pass, rework_pass, total_pass, dhu, defective_pct, top_defects')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .eq('department_id', departmentId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo);

    if (!error && data && data.length > 0) {
      const summary = aggregateQualityViewRows(data as Array<Record<string, unknown>>);
      if (summary.topDefects.length === 0) {
        try {
          summary.topDefects = await fetchStyleDeptTopDefectsFromSessions(
            factoryId,
            orderId,
            departmentId,
            dateFrom,
            dateTo,
          );
        } catch {
          // keep empty top defects
        }
      }
      return summary;
    }

    if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) {
      throw error;
    }
  }

  return fetchStyleDeptQualityFromSessions(
    factoryId,
    orderId,
    departmentId,
    dateFrom,
    dateTo,
    colorwayId,
    resourceId,
  );
}

function formatAuditDayLabel(logDate: string): string {
  try {
    return format(parseISO(logDate), 'd MMM');
  } catch {
    return logDate.slice(5);
  }
}

/** Floor AQL audit KPIs from get_audit_report RPC. */
export async function fetchStyleDeptAuditMetrics(
  factoryId: string,
  orderId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  colorwayId?: string | null,
): Promise<StyleDeptAuditMetrics | null> {
  // get_audit_report returns order/colorway/department/day aggregates.
  // We still reduce those day-grain rows into the StyleDeptAuditMetrics shape.
  const { data, error } = await supabase.rpc('get_audit_report', {
    p_factory_id: factoryId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_colorway_id: colorwayId ?? null,
    p_order_id: orderId,
    p_department_id: departmentId,
  });
  if (error) {
    if (isPostgrestRpcMissing(error) || isMissingRelationError(error)) return null;
    throw error;
  }
  if (!data || data.length === 0) return null;

  const byDate = new Map<
    string,
    {
      lots: number;
      samples: number;
      passed: number;
      failed: number;
      major_failed: number;
      minor_failed: number;
    }
  >();

  let totalLots = 0;
  let totalSample = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalMajor = 0;
  let totalMinor = 0;

  for (const row of data as Record<string, unknown>[]) {
    const day = String(row.log_date ?? '');
    let d = byDate.get(day);
    if (!d) {
      d = { lots: 0, samples: 0, passed: 0, failed: 0, major_failed: 0, minor_failed: 0 };
      byDate.set(day, d);
    }
    const dayLots = Number(row.lots) || 0;
    const daySamples = Number(row.total_samples) || 0;
    const dayPassed = Number(row.total_passed) || 0;
    const dayFailed = Number(row.total_failed) || 0;
    const dayMajor = Number(row.total_major_failed) || 0;
    const dayMinor = Number(row.total_minor_failed) || 0;

    d.lots += dayLots;
    d.samples += daySamples;
    d.passed += dayPassed;
    d.failed += dayFailed;
    d.major_failed += dayMajor;
    d.minor_failed += dayMinor;

    totalLots += dayLots;
    totalSample += daySamples;
    totalPassed += dayPassed;
    totalFailed += dayFailed;
    totalMajor += dayMajor;
    totalMinor += dayMinor;
  }

  const daily = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([logDate, d]) => {
      const passPct = d.samples > 0 ? (d.passed / d.samples) * 100 : null;
      const defectivePct = d.samples > 0 ? (d.failed / d.samples) * 100 : null;
      const majorDefectivePct = d.samples > 0 ? (d.major_failed / d.samples) * 100 : null;
      return {
        label: formatAuditDayLabel(logDate),
        passPct,
        defectivePct,
        majorDefectivePct,
        auditCount: d.lots,
        passedCount: d.passed,
        failedCount: d.failed,
      };
    });

  const passPct = totalSample > 0 ? (totalPassed / totalSample) * 100 : null;
  const defectivePct = totalSample > 0 ? (totalFailed / totalSample) * 100 : null;
  const majorDefectivePct = totalSample > 0 ? (totalMajor / totalSample) * 100 : null;
  // No dhu column in the RPC; approximate from defect rate.
  const dhu = defectivePct;

  return {
    totalAudits: totalLots,
    passedAudits: totalPassed,
    failedAudits: totalFailed,
    passPct,
    defectivePct,
    majorDefectivePct,
    dhu,
    daily,
  };
}

/** First-time-right % for a style in a QC department over a date range. */
export async function fetchStyleDeptQcFtr(
  factoryId: string,
  orderId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  colorwayId?: string | null,
  resourceId?: string | null,
): Promise<number | null> {
  const summary = await fetchStyleDeptQualitySummary(
    factoryId,
    orderId,
    departmentId,
    dateFrom,
    dateTo,
    colorwayId,
    resourceId,
  );
  return summary.ftrPct;
}

function sumDefectCountFromSummary(summary: Record<string, unknown> | null | undefined): number {
  if (!summary || typeof summary !== 'object') return 0;
  return Object.values(summary).reduce<number>(
    (sum, value) => sum + (typeof value === 'number' ? value : parseInt(String(value ?? '0'), 10) || 0),
    0,
  );
}

/** Scope capture queries to a colorway; include NULL colorway rows on single-colorway orders. */
function applyColorwayCaptureFilter<
  Q extends { eq: (col: string, val: string) => Q; or: (filters: string) => Q },
>(query: Q, colorwayId: string, includeNullColorway: boolean): Q {
  if (includeNullColorway) {
    return query.or(`colorway_id.eq.${colorwayId},colorway_id.is.null`);
  }
  return query.eq('colorway_id', colorwayId);
}

async function orderHasSingleColorway(orderId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('colorways')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId);
  if (error) return false;
  return (count ?? 0) <= 1;
}

async function fetchStyleDailyKpisForColorway(
  factoryId: string,
  orderId: string,
  colorwayId: string | null,
  deptMap: Map<string, string>,
): Promise<StyleDeptDailyRow[]> {
  const includeNullColorway = colorwayId ? await orderHasSingleColorway(orderId) : false;

  let hourlyQuery = supabase
    .from('hourly_counts')
    .select('log_date, department_id, count, order_route_id')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) {
    hourlyQuery = applyColorwayCaptureFilter(hourlyQuery, colorwayId, includeNullColorway);
  }

  let qcQuery = supabase
    .from('inspection_sessions')
    .select(
      'log_date, department_id, passed, rework_passed, total_inspected, failed, defect_summary, order_route_id',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) {
    qcQuery = applyColorwayCaptureFilter(qcQuery, colorwayId, includeNullColorway);
  }

  const wfQuery = supabase
    .from('workforce_logs')
    .select('log_date, department_id, headcount_by_category, line_allocation_id, resource_id')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);

  let allocQuery = supabase
    .from('line_allocations')
    .select('department_id, sam, kpi_inputs, daily_target')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) {
    allocQuery = applyColorwayCaptureFilter(allocQuery, colorwayId, includeNullColorway);
  }

  let cutQuery = supabase
    .from('cutting_sessions')
    .select(
      'id, log_date, department_id, order_route_id, total_qty, produced_mins, available_mins, headcount_by_category, colorway_id',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) {
    cutQuery = applyColorwayCaptureFilter(cutQuery, colorwayId, includeNullColorway);
  }

  let cutBundleQuery = supabase
    .from('cutting_bundles')
    .select('qty, session_id, colorway_id')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) {
    cutBundleQuery = applyColorwayCaptureFilter(cutBundleQuery, colorwayId, includeNullColorway);
  }

  let batchQuery = supabase
    .from('batch_production')
    .select(
      'log_date, department_id, order_route_id, produced_qty, produced_mins, available_mins, headcount_by_category',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId);
  if (colorwayId) {
    batchQuery = applyColorwayCaptureFilter(batchQuery, colorwayId, includeNullColorway);
  }

  const shiftQuery = supabase
    .from('shifts')
    .select('id, name, type, hours, productive_mins')
    .eq('factory_id', factoryId);

  const routeQuery = supabase
    .from('order_routing_steps')
    .select('id, dept_id, is_dept_exit_operation, is_primary_output, operation_name, visit_id, step_type, capture_app')
    .eq('order_id', orderId);

  const [hourlyRes, qcRes, wfRes, allocRes, cutRes, cutBundleRes, batchRes, routeRes, shiftRes] =
    await Promise.all([
      hourlyQuery,
      qcQuery,
      wfQuery,
      allocQuery,
      cutQuery,
      cutBundleQuery,
      batchQuery,
      routeQuery,
      shiftQuery,
    ]);

  if (hourlyRes.error) throw hourlyRes.error;
  if (qcRes.error) throw qcRes.error;
  if (shiftRes.error) throw shiftRes.error;
  if (wfRes.error) {
    const code = String(wfRes.error.code ?? '');
    if (code !== '42703') throw wfRes.error;
  }
  if (allocRes.error) {
    const code = String(allocRes.error.code ?? '');
    if (code !== '42703') throw allocRes.error;
  }
  if (cutRes.error) {
    const code = String(cutRes.error.code ?? '');
    if (code !== '42703') throw cutRes.error;
  }
  if (cutBundleRes.error) {
    const code = String(cutBundleRes.error.code ?? '');
    if (code !== '42703') throw cutBundleRes.error;
  }
  if (batchRes.error) {
    const code = String(batchRes.error.code ?? '');
    if (code !== '42703') throw batchRes.error;
  }
  if (routeRes.error) {
    const code = String(routeRes.error.code ?? '');
    if (code !== '42703') throw routeRes.error;
  }

  const routeMap = new Map<
    string,
    { deptId: string; operationName: string; isExitOperation: boolean; isPrimaryOutput: boolean; stepType: string | null; captureApp: string | null }
  >();
  for (const raw of routeRes.data || []) {
    const id = raw.id as string;
    if (!id) continue;
    const isDeptExit = raw.is_dept_exit_operation === true;
    const isPrimary = raw.is_primary_output === true;
    routeMap.set(id, {
      deptId: (raw.dept_id as string) || '',
      operationName: (raw.operation_name as string) || 'Unknown',
      isExitOperation: isDeptExit || (!isDeptExit && isPrimary),
      isPrimaryOutput: isPrimary,
      stepType: (raw.step_type as string) || null,
      captureApp: (raw.capture_app as string) || null,
    });
  }

  const shifts = (shiftRes.data || []).map((s) => mapShiftRow(s as Record<string, unknown>));
  let productiveMinsPerWorker = regularShiftProductiveMins(shifts);
  if (productiveMinsPerWorker <= 0) {
    for (const raw of shiftRes.data || []) {
      const pm = Number((raw as { productive_mins?: number }).productive_mins);
      if (pm > 0) {
        productiveMinsPerWorker = pm;
        break;
      }
    }
  }
  if (productiveMinsPerWorker <= 0) productiveMinsPerWorker = 480;

  const samByDept = new Map<string, number>();
  const targetByDept = new Map<string, number>();
  for (const raw of allocRes.data || []) {
    const deptId = raw.department_id as string;
    const sam = allocationSamValue({
      sam: raw.sam as number | null,
      kpi_inputs: raw.kpi_inputs as { sam?: number } | null,
    });
    if (sam > 0 && !samByDept.has(deptId)) samByDept.set(deptId, sam);
    const target = Number(raw.daily_target) || 0;
    if (target > 0) targetByDept.set(deptId, (targetByDept.get(deptId) || 0) + target);
  }

  const outputByKey = new Map<string, number>();
  for (const raw of hourlyRes.data || []) {
    const date = raw.log_date as string;
    const deptId = raw.department_id as string;
    const routeId = (raw.order_route_id as string) || '';
    const key = `${date}|${deptId}|${routeId}`;
    outputByKey.set(key, (outputByKey.get(key) || 0) + (Number(raw.count) || 0));
  }

  const bundleQtyBySession = new Map<string, number>();
  for (const raw of cutBundleRes.data || []) {
    const sessionId = raw.session_id as string;
    if (!sessionId) continue;
    const qty = Number(raw.qty) || 0;
    bundleQtyBySession.set(sessionId, (bundleQtyBySession.get(sessionId) || 0) + qty);
  }

  const cutOutputByKey = new Map<string, number>();
  const cutProducedMinsByKey = new Map<string, number>();
  const cutAvailableMinsByKey = new Map<string, number>();
  for (const raw of cutRes.data || []) {
    const date = raw.log_date as string;
    const deptId = raw.department_id as string;
    const routeId = (raw.order_route_id as string) || '';
    const key = `${date}|${deptId}|${routeId}`;
    const sessionId = raw.id as string;
    const totalQtyFromSession = Number(raw.total_qty) || 0;
    const totalQty =
      totalQtyFromSession > 0 ? totalQtyFromSession : (bundleQtyBySession.get(sessionId) || 0);
    cutOutputByKey.set(key, (cutOutputByKey.get(key) || 0) + totalQty);
    cutProducedMinsByKey.set(key, (cutProducedMinsByKey.get(key) || 0) + (Number(raw.produced_mins) || 0));
    cutAvailableMinsByKey.set(key, (cutAvailableMinsByKey.get(key) || 0) + (Number(raw.available_mins) || 0));
  }

  const batchOutputByKey = new Map<string, number>();
  const batchProducedMinsByKey = new Map<string, number>();
  const batchAvailableMinsByKey = new Map<string, number>();
  for (const raw of batchRes.data || []) {
    const date = raw.log_date as string;
    const deptId = raw.department_id as string;
    const routeId = (raw.order_route_id as string) || '';
    const key = `${date}|${deptId}|${routeId}`;
    const qty = Number(raw.produced_qty) || 0;
    batchOutputByKey.set(key, (batchOutputByKey.get(key) || 0) + qty);
    batchProducedMinsByKey.set(
      key,
      (batchProducedMinsByKey.get(key) || 0) + (Number(raw.produced_mins) || 0),
    );
    batchAvailableMinsByKey.set(
      key,
      (batchAvailableMinsByKey.get(key) || 0) + (Number(raw.available_mins) || 0),
    );
  }

  const qcByKey = new Map<
    string,
    { inspected: number; defects: number; defectivePieces: number; output: number }
  >();
  for (const raw of qcRes.data || []) {
    const date = raw.log_date as string;
    const deptId = raw.department_id as string;
    const routeId = (raw.order_route_id as string) || '';
    const key = `${date}|${deptId}|${routeId}`;
    const cur = qcByKey.get(key) ?? {
      inspected: 0,
      defects: 0,
      defectivePieces: 0,
      output: 0,
    };
    const passed = qcSessionOutputQty(raw);
    const inspected = Number(raw.total_inspected) || 0;
    const defects = sumDefectCountFromSummary(raw.defect_summary as Record<string, unknown>);
    const defectivePieces = qcSessionDefectiveQty(raw);
    qcByKey.set(key, {
      inspected: cur.inspected + inspected,
      defects: cur.defects + defects,
      defectivePieces: cur.defectivePieces + defectivePieces,
      output: cur.output + passed,
    });
    if (!outputByKey.has(key)) outputByKey.set(key, 0);
    outputByKey.set(key, (outputByKey.get(key) || 0) + passed);
  }

  const workforceByKey = new Map<string, number>();
  for (const raw of wfRes.data || []) {
    const date = raw.log_date as string;
    const deptId = raw.department_id as string;
    const key = `${date}|${deptId}`;
    const headcount = workforceHeadcountFromLog(raw as Record<string, unknown>);
    if (headcount > 0) {
      workforceByKey.set(key, (workforceByKey.get(key) || 0) + headcount);
    }
  }

  for (const raw of cutRes.data || []) {
    const date = raw.log_date as string;
    const deptId = raw.department_id as string;
    const key = `${date}|${deptId}`;
    const headcount = workforceHeadcountFromLog(raw as Record<string, unknown>);
    if (headcount > 0) {
      workforceByKey.set(key, (workforceByKey.get(key) || 0) + headcount);
    }
  }

  for (const raw of batchRes.data || []) {
    const date = raw.log_date as string;
    const deptId = raw.department_id as string;
    const key = `${date}|${deptId}`;
    const headcount = workforceHeadcountFromLog(raw as Record<string, unknown>);
    if (headcount > 0) {
      workforceByKey.set(key, (workforceByKey.get(key) || 0) + headcount);
    }
  }

  const allKeys = new Set<string>([
    ...outputByKey.keys(),
    ...qcByKey.keys(),
    ...cutOutputByKey.keys(),
    ...batchOutputByKey.keys(),
  ]);
  const rows: StyleDeptDailyRow[] = [];

  for (const key of allKeys) {
    const [date, deptId, routeId] = key.split('|');
    const cutOutput = cutOutputByKey.get(key) ?? 0;
    const batchOutput = batchOutputByKey.get(key) ?? 0;
    const output = (outputByKey.get(key) ?? 0) + cutOutput + batchOutput;
    const qc = qcByKey.get(key);
    const workforce = workforceByKey.get(`${date}|${deptId}`) ?? 0;
    const sam = samByDept.get(deptId) ?? 0;
    const cutProduced = cutProducedMinsByKey.get(key) ?? 0;
    const batchProduced = batchProducedMinsByKey.get(key) ?? 0;
    const cutAvailable = cutAvailableMinsByKey.get(key) ?? 0;
    const batchAvailable = batchAvailableMinsByKey.get(key) ?? 0;
    const dailyAvailableMins =
      cutAvailable > 0
        ? cutAvailable
        : batchAvailable > 0
        ? batchAvailable
        : workforce > 0
        ? workforce * productiveMinsPerWorker
        : 0;
    const inspected = qc?.inspected ?? 0;
    const defects = qc?.defects ?? 0;
    const defectivePieces = qc?.defectivePieces ?? 0;
    const producedMins =
      cutProduced > 0 ? cutProduced : batchProduced > 0 ? batchProduced : sam > 0 ? output * sam : 0;
    const efficiency =
      producedMins > 0 && dailyAvailableMins > 0
        ? (producedMins / dailyAvailableMins) * 100
        : null;
    const productivity = workforce > 0 && output > 0 ? output / workforce : null;

    if (output <= 0 && dailyAvailableMins <= 0 && inspected <= 0) continue;

    const routeInfo = routeMap.get(routeId);
    rows.push({
      date,
      deptId,
      deptName: deptMap.get(deptId) || deptId,
      output,
      target: targetByDept.get(deptId) || 0,
      dailyAvailableMins,
      efficiency,
      productivity,
      dhu: inspected > 0 ? (defects / inspected) * 100 : null,
      defectivePct: inspected > 0 ? (defectivePieces / inspected) * 100 : null,
      operationId: routeId,
      operationName: routeInfo?.operationName,
      isExitOperation: routeInfo?.isExitOperation ?? routeInfo?.isPrimaryOutput ?? false,
    });
  }

  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.deptName.localeCompare(b.deptName) ||
      (b.isExitOperation === true ? 1 : 0) - (a.isExitOperation === true ? 1 : 0) ||
      (a.operationName || '').localeCompare(b.operationName || ''),
  );
}

export interface StyleOutsourceDailyPoint {
  date: string;
  vendorId: string;
  vendorName: string;
  /** Date label with vendor, e.g. "30 Jul · Vendor name". */
  label: string;
  sent: number;
  received: number;
}

/** Day-wise outsource send/receive qty per vendor for Style Report dept cards. */
export async function fetchStyleOutsourceDailyMovements(
  factoryId: string,
  orderId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  colorwayId: string | null,
  routeIds?: string[],
): Promise<StyleOutsourceDailyPoint[]> {
  const includeNullColorway = colorwayId ? await orderHasSingleColorway(orderId) : false;

  let query = supabase
    .from('outsource_work_movements')
    .select('occurred_at, movement_type, qty, vendor_resource_id, order_route_id, colorway_id')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('department_id', departmentId)
    .gte('occurred_at', `${dateFrom}T00:00:00`)
    .lte('occurred_at', `${dateTo}T23:59:59.999`);

  if (colorwayId) {
    query = applyColorwayCaptureFilter(query, colorwayId, includeNullColorway);
  }
  if (routeIds && routeIds.length > 0) {
    query = query.in('order_route_id', routeIds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const vendorIds = new Set<string>();
  const byKey = new Map<
    string,
    { date: string; vendorId: string; sent: number; received: number }
  >();

  for (const raw of data || []) {
    const date = String(raw.occurred_at || '').split('T')[0];
    const vendorId = String(raw.vendor_resource_id || '');
    if (!date || !vendorId) continue;
    vendorIds.add(vendorId);
    const key = `${date}|${vendorId}`;
    const cur = byKey.get(key) ?? { date, vendorId, sent: 0, received: 0 };
    const qty = Number(raw.qty) || 0;
    const movement = String(raw.movement_type || '');
    if (movement === 'vendor_send') cur.sent += qty;
    if (movement === 'vendor_receive') cur.received += qty;
    byKey.set(key, cur);
  }

  let nameMap = new Map<string, string>();
  if (vendorIds.size > 0) {
    const resourceRes = await supabase
      .from('assigned_resources')
      .select('id, resource_name')
      .eq('factory_id', factoryId)
      .in('id', [...vendorIds]);
    if (!resourceRes.error) {
      nameMap = new Map(
        (resourceRes.data || []).map((r) => [r.id as string, (r.resource_name as string) || '']),
      );
    }
  }

  return [...byKey.values()]
    .map((p) => {
      const vendorName = nameMap.get(p.vendorId)?.trim() || p.vendorId.slice(0, 8);
      let dateLabel = p.date;
      try {
        dateLabel = format(parseISO(p.date), 'dd MMM');
      } catch {
        /* keep raw */
      }
      return {
        ...p,
        vendorName,
        label: `${dateLabel} · ${vendorName}`,
      };
    })
    .filter((p) => p.sent > 0 || p.received > 0)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.vendorName.localeCompare(b.vendorName),
    );
}

/** Per-dept daily output for one planned resource (all shifts; hourly + QC sessions). */
export async function fetchStyleDeptResourceDailyRows(
  factoryId: string,
  orderId: string,
  departmentId: string,
  resourceId: string,
  colorwayId: string | null,
  baseRows: StyleDeptDailyRow[],
  plannedSam: number | null,
): Promise<StyleDeptDailyRow[]> {
  const includeNullColorway = colorwayId ? await orderHasSingleColorway(orderId) : false;

  let hourlyQuery = supabase
    .from('hourly_counts')
    .select('log_date, count, order_route_id')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('department_id', departmentId)
    .eq('resource_id', resourceId);
  if (colorwayId) {
    hourlyQuery = applyColorwayCaptureFilter(hourlyQuery, colorwayId, includeNullColorway);
  }

  let qcQuery = supabase
    .from('inspection_sessions')
    .select(
      'log_date, passed, rework_passed, total_inspected, failed, defect_summary, order_route_id',
    )
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('department_id', departmentId)
    .eq('resource_id', resourceId);
  if (colorwayId) {
    qcQuery = applyColorwayCaptureFilter(qcQuery, colorwayId, includeNullColorway);
  }

  let batchQuery = supabase
    .from('batch_production')
    .select('log_date, produced_qty, order_route_id, produced_mins, available_mins, headcount_by_category')
    .eq('factory_id', factoryId)
    .eq('order_id', orderId)
    .eq('department_id', departmentId)
    .eq('resource_id', resourceId);
  if (colorwayId) {
    batchQuery = applyColorwayCaptureFilter(batchQuery, colorwayId, includeNullColorway);
  }

  let wfQuery = supabase
    .from('workforce_logs')
    .select('log_date, headcount_by_category, line_allocation_id, resource_id')
    .eq('factory_id', factoryId)
    .eq('department_id', departmentId)
    .eq('order_id', orderId);

  let wfResourceQuery = wfQuery.eq('resource_id', resourceId);

  const shiftQuery = supabase
    .from('shifts')
    .select('id, name, type, hours, productive_mins')
    .eq('factory_id', factoryId);

  const [hourlyRes, qcRes, batchRes, wfResourceRes, wfDeptRes, shiftRes] = await Promise.all([
    hourlyQuery,
    qcQuery,
    batchQuery,
    wfResourceQuery,
    wfQuery,
    shiftQuery,
  ]);

  if (hourlyRes.error) throw hourlyRes.error;
  if (qcRes.error) throw qcRes.error;
  if (batchRes.error) {
    const code = String(batchRes.error.code ?? '');
    if (code !== '42703') throw batchRes.error;
  }
  if (shiftRes.error) throw shiftRes.error;

  if (wfResourceRes.error && wfDeptRes.error) {
    const code = String(wfResourceRes.error.code ?? wfDeptRes.error.code ?? '');
    if (code !== '42703' && !String(wfResourceRes.error.message).includes('resource_id')) {
      throw wfDeptRes.error;
    }
  }

  const shifts = (shiftRes.data || []).map((s) => mapShiftRow(s as Record<string, unknown>));
  let productiveMinsPerWorker = regularShiftProductiveMins(shifts);
  if (productiveMinsPerWorker <= 0) {
    for (const raw of shiftRes.data || []) {
      const pm = Number((raw as { productive_mins?: number }).productive_mins);
      if (pm > 0) {
        productiveMinsPerWorker = pm;
        break;
      }
    }
  }
  if (productiveMinsPerWorker <= 0) productiveMinsPerWorker = 480;

  const routeById = new Map<string, { operationName: string; isExitOperation: boolean }>();
  for (const r of baseRows) {
    if (r.operationId) {
      routeById.set(r.operationId, {
        operationName: r.operationName || 'Unknown',
        isExitOperation: r.isExitOperation ?? false,
      });
    }
  }

  const outputByKey = new Map<string, number>();
  for (const raw of hourlyRes.data || []) {
    const date = raw.log_date as string;
    const routeId = (raw.order_route_id as string) || '';
    const key = `${date}|${routeId}`;
    outputByKey.set(key, (outputByKey.get(key) || 0) + (Number(raw.count) || 0));
  }

  const batchAvailableMinsByKey = new Map<string, number>();
  const batchProducedMinsByKey = new Map<string, number>();
  for (const raw of batchRes.data || []) {
    const date = raw.log_date as string;
    const routeId = (raw.order_route_id as string) || '';
    const key = `${date}|${routeId}`;
    const qty = Number(raw.produced_qty) || 0;
    outputByKey.set(key, (outputByKey.get(key) || 0) + qty);
    batchProducedMinsByKey.set(
      key,
      (batchProducedMinsByKey.get(key) || 0) + (Number(raw.produced_mins) || 0),
    );
    batchAvailableMinsByKey.set(
      key,
      (batchAvailableMinsByKey.get(key) || 0) + (Number(raw.available_mins) || 0),
    );
  }

  const qcByKey = new Map<
    string,
    { inspected: number; defects: number; defectivePieces: number; output: number }
  >();
  for (const raw of qcRes.data || []) {
    const date = raw.log_date as string;
    const routeId = (raw.order_route_id as string) || '';
    const key = `${date}|${routeId}`;
    const cur = qcByKey.get(key) ?? {
      inspected: 0,
      defects: 0,
      defectivePieces: 0,
      output: 0,
    };
    const passed = qcSessionOutputQty(raw);
    const inspected = Number(raw.total_inspected) || 0;
    const defects = sumDefectCountFromSummary(raw.defect_summary as Record<string, unknown>);
    const defectivePieces = qcSessionDefectiveQty(raw);
    qcByKey.set(key, {
      inspected: cur.inspected + inspected,
      defects: cur.defects + defects,
      defectivePieces: cur.defectivePieces + defectivePieces,
      output: cur.output + passed,
    });
    outputByKey.set(key, (outputByKey.get(key) || 0) + passed);
  }

  const workforceByDate = new Map<string, number>();
  const wfRows =
    !wfResourceRes.error && (wfResourceRes.data?.length ?? 0) > 0
      ? wfResourceRes.data
      : wfDeptRes.error
        ? []
        : wfDeptRes.data || [];
  for (const raw of wfRows) {
    const date = raw.log_date as string;
    const headcount = workforceHeadcountFromLog(raw as Record<string, unknown>);
    if (headcount > 0) {
      workforceByDate.set(date, (workforceByDate.get(date) || 0) + headcount);
    }
  }
  for (const raw of batchRes.data || []) {
    const date = raw.log_date as string;
    const headcount = workforceHeadcountFromLog(raw as Record<string, unknown>);
    if (headcount > 0) {
      workforceByDate.set(date, (workforceByDate.get(date) || 0) + headcount);
    }
  }

  const deptName = baseRows[0]?.deptName ?? departmentId;
  const sam = plannedSam ?? 0;
  const baseByKey = new Map<string, StyleDeptDailyRow>(
    baseRows.filter((r) => r.operationId).map((r) => [`${r.date}|${r.operationId}`, r]),
  );
  const allKeys = new Set<string>([
    ...outputByKey.keys(),
    ...qcByKey.keys(),
    ...baseByKey.keys(),
  ]);

  return [...allKeys]
    .map((key) => {
      const [date, routeId] = key.split('|');
      const output = outputByKey.get(key) ?? 0;
      const qc = qcByKey.get(key);
      let workforce = workforceByDate.get(date) ?? 0;
      const base = baseByKey.get(key);
      const batchAvailable = batchAvailableMinsByKey.get(key) ?? 0;
      const batchProduced = batchProducedMinsByKey.get(key) ?? 0;
      let dailyAvailableMins =
        batchAvailable > 0
          ? batchAvailable
          : workforce > 0
          ? workforce * productiveMinsPerWorker
          : 0;
      if (dailyAvailableMins <= 0 && base && base.dailyAvailableMins > 0) {
        const deptOutput = base.output;
        if (deptOutput > 0 && output > 0) {
          dailyAvailableMins = base.dailyAvailableMins * (output / deptOutput);
        } else {
          dailyAvailableMins = base.dailyAvailableMins;
        }
        if (workforce <= 0 && productiveMinsPerWorker > 0) {
          workforce = dailyAvailableMins / productiveMinsPerWorker;
        }
      }
      const inspected = qc?.inspected ?? 0;
      const defects = qc?.defects ?? 0;
      const defectivePieces = qc?.defectivePieces ?? 0;
      const producedMins = batchProduced > 0 ? batchProduced : output * sam;
      const efficiency =
        producedMins > 0 && dailyAvailableMins > 0
          ? (producedMins / dailyAvailableMins) * 100
          : null;
      const productivity = workforce > 0 && output > 0 ? output / workforce : null;

      const routeInfo = routeById.get(routeId);
      return {
        date,
        deptId: departmentId,
        deptName,
        output,
        target: 0,
        dailyAvailableMins,
        efficiency,
        productivity,
        dhu: inspected > 0 ? (defects / inspected) * 100 : null,
        defectivePct: inspected > 0 ? (defectivePieces / inspected) * 100 : null,
        operationId: routeId,
        operationName: routeInfo?.operationName,
        isExitOperation: routeInfo?.isExitOperation ?? false,
      };
    })
    .filter((r) => r.output > 0 || r.dailyAvailableMins > 0 || r.dhu != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Per-dept daily KPI rows for one style order (Style Report Section 2). */
export async function fetchStyleDailyKpis(
  factoryId: string,
  orderId: string,
  meta?: ReportMeta,
  colorwayId?: string | null,
): Promise<StyleDeptDailyRow[]> {
  const reportMeta = meta ?? (await fetchReportMeta(factoryId));
  const deptMap = new Map(reportMeta.departments.map((d) => [d.id, d.name]));

  return fetchStyleDailyKpisForColorway(factoryId, orderId, colorwayId ?? null, deptMap);
}
