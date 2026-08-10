import type { CutToShipJourneyRow, CutToShipRow, StyleJourneyDept } from './mesReportsApi';
import type { ProductionSummaryRow } from '../types';
import { isAuditDept, isQcDept } from './reportDeptUtils';
import { sumSizeMap, type SizeMap } from './mesSizeDisplay';
import { productionSummaryMatchesStep } from './orderRoutingFlow';

export type OrderFlowStatus = 'not_started' | 'in_progress' | 'ready_to_ship' | 'shipped_complete';

export interface OrderCutToShipSummary {
  orderId: string;
  styleName: string;
  poNumber: string | null;
  buyerName: string | null;
  cutQty: number;
  shippedQty: number;
  rejectedQty: number;
  wipQty: number;
  gap: number;
  isBalanced: boolean;
  flowStatus: OrderFlowStatus;
  colorwayCount: number;
}

export function flowStatusFromJourney(journey: CutToShipJourneyRow[]): OrderFlowStatus {
  const inFlow = journey.filter((j) => j.is_in_flow);
  if (inFlow.length === 0) return 'not_started';

  const last = inFlow.reduce((a, b) =>
    (a.flow_step ?? 0) >= (b.flow_step ?? 0) ? a : b,
  );

  const totalWip = inFlow.reduce((s, j) => s + (j.wip_qty ?? 0), 0);
  const lastDone = last.status === 'completed' && (last.wip_qty ?? 0) === 0;

  if (lastDone && totalWip === 0) return 'ready_to_ship';
  if (inFlow.some((j) => (j.qty_received ?? 0) > 0 || (j.qty_produced ?? 0) > 0)) return 'in_progress';
  return 'not_started';
}

export function flowStatusFromRows(orderRows: CutToShipRow[]): OrderFlowStatus {
  const cutQty = orderRows.reduce((s, r) => s + r.cut_qty, 0);
  const wipQty = orderRows.reduce((s, r) => s + r.wip_qty, 0);
  if (orderRows.length > 0 && orderRows.every((r) => r.is_balanced)) return 'shipped_complete';
  if (cutQty > 0 && wipQty === 0) return 'ready_to_ship';
  if (cutQty > 0 || orderRows.some((r) => r.shipped_qty > 0)) return 'in_progress';
  return 'not_started';
}

export function summarizeOrders(
  rows: CutToShipRow[],
  journeyByOrder?: Map<string, CutToShipJourneyRow[]>,
): OrderCutToShipSummary[] {
  const byOrder = new Map<string, CutToShipRow[]>();
  for (const row of rows) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push(row);
    byOrder.set(row.order_id, list);
  }

  const out: OrderCutToShipSummary[] = [];
  for (const [orderId, orderRows] of byOrder) {
    const first = orderRows[0];
    const cutQty = orderRows.reduce((s, r) => s + r.cut_qty, 0);
    const shippedQty = orderRows.reduce((s, r) => s + r.shipped_qty, 0);
    const rejectedQty = orderRows.reduce((s, r) => s + r.rejected_qty, 0);
    const wipQty = orderRows.reduce((s, r) => s + r.wip_qty, 0);
    const gap = orderRows.reduce((s, r) => s + r.reconciliation_gap, 0);
    const isBalanced = orderRows.every((r) => r.is_balanced);
    const journey = journeyByOrder?.get(orderId);
    const flowStatus = journey?.length
      ? flowStatusFromJourney(journey)
      : flowStatusFromRows(orderRows);

    out.push({
      orderId,
      styleName: first.style_name,
      poNumber: first.po_number,
      buyerName: first.buyer_name,
      cutQty,
      shippedQty,
      rejectedQty,
      wipQty,
      gap,
      isBalanced,
      flowStatus,
      colorwayCount: orderRows.length,
    });
  }

  return out.sort((a, b) => a.styleName.localeCompare(b.styleName));
}

export function remainingBySize(
  recon: CutToShipRow | null,
  planned: SizeMap,
): SizeMap {
  const keys = new Set([
    ...Object.keys(planned),
    ...Object.keys(recon?.cut_qty_by_size ?? {}),
  ]);
  const out: SizeMap = {};
  for (const size of keys) {
    const cut = recon?.cut_qty_by_size?.[size] ?? planned[size] ?? 0;
    const shipped = recon?.shipped_qty_by_size?.[size] ?? 0;
    const rejected = recon?.rejected_qty_by_size?.[size] ?? 0;
    out[size] = Math.max(cut - shipped - rejected, 0);
  }
  return out;
}

/** Balance still to ship: last-dept output minus logged rejections and shipments. */
export function balanceToShipBySize(
  sizeKeys: string[],
  lastDeptQtyBySize: SizeMap,
  rejectedBySize: SizeMap,
  shippedBySize: SizeMap,
): SizeMap {
  const out: SizeMap = {};
  for (const size of sizeKeys) {
    const ready = lastDeptQtyBySize[size] ?? 0;
    const rejected = rejectedBySize[size] ?? 0;
    const shipped = shippedBySize[size] ?? 0;
    out[size] = Math.max(ready - rejected - shipped, 0);
  }
  return out;
}

export function proportionalDistribute(total: number, planned: SizeMap): SizeMap {
  const keys = Object.keys(planned);
  if (keys.length === 0 || total <= 0) return {};
  const planSum = sumSizeMap(planned);
  if (planSum <= 0) return {};
  const out: SizeMap = {};
  let allocated = 0;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) {
      out[k] = Math.max(0, total - allocated);
    } else {
      const n = Math.floor((total * (planned[k] ?? 0)) / planSum);
      out[k] = n;
      allocated += n;
    }
  });
  return out;
}

export interface ProcessFlowDeptRow {
  step: number;
  deptId: string;
  deptName: string;
  produced: number;
  received: number;
  sent: number;
  rejected: number;
  disputed: number;
  wip: number;
  status: string;
  inFlow: boolean;
}

export function buildProcessFlowDeptRows(
  flowSteps: Array<{ dept_id: string; dept_name: string }>,
  journey: CutToShipJourneyRow[],
  colorwayId: string | null,
  productionSummary: ProductionSummaryRow[],
  orderId: string,
  disputedByDeptId?: Map<string, number>,
): ProcessFlowDeptRow[] {
  const journeyForCw = journey.filter(
    (j) => !colorwayId || j.colorway_id === colorwayId || j.colorway_id == null,
  );

  return flowSteps.map((step, idx) => {
    const deptName = step.dept_name;
    const jRows = journeyForCw.filter(
      (j) => j.dept_id === step.dept_id || j.dept_name === deptName,
    );
    const jRow = jRows[0];

    const summaryQty = productionSummary
      .filter(
        (r) =>
          productionSummaryMatchesStep(
            r,
            { deptId: step.dept_id, deptName, label: deptName },
            orderId,
            colorwayId ?? undefined,
          ),
      )
      .reduce((s, r) => s + (r.total_passed || r.total_scanned || 0), 0);

    const producedSum = jRows.reduce((s, j) => s + (j.qty_produced ?? 0), 0);
    const receivedSum = jRows.reduce((s, j) => s + (j.qty_received ?? 0), 0);
    const sentSum = jRows.reduce((s, j) => s + (j.qty_sent ?? 0), 0);
    const rejectedSum = jRows.reduce((s, j) => s + (j.qty_rejected ?? 0), 0);
    const wipSum = jRows.reduce((s, j) => s + (j.wip_qty ?? 0), 0);

    const produced = producedSum || (jRow?.qty_produced ?? summaryQty);
    const received = receivedSum || (jRow?.qty_received ?? 0);
    const sent = sentSum || (jRow?.qty_sent ?? 0);
    const rejected = rejectedSum || (jRow?.qty_rejected ?? 0);
    const wip = wipSum || (jRow?.wip_qty ?? 0);

    return {
      step: jRow?.flow_step ?? idx + 1,
      deptId: step.dept_id,
      deptName,
      produced,
      received,
      sent,
      rejected,
      disputed: disputedByDeptId?.get(step.dept_id) ?? 0,
      wip,
      status: jRow?.status ?? (produced > 0 ? 'in_progress' : 'pending'),
      inFlow: jRow?.is_in_flow ?? true,
    };
  });
}

/** Map order-completion process-flow rows to Style Report journey dept shape. */
export function processFlowRowsToJourneyDepts(
  rows: ProcessFlowDeptRow[],
  deptAppsById: Map<string, string[]>,
  adjQty: number,
): StyleJourneyDept[] {
  return rows.map((r) => {
    const apps = deptAppsById.get(r.deptId) ?? null;
    const inProgress = r.produced > 0 || r.received > 0 || r.sent > 0;
    return {
      deptId: r.deptId,
      deptName: r.deptName,
      visitId: `dept-${r.deptId}`,
      flowStep: r.step,
      isQcDept: isQcDept(apps),
      isAuditDept: isAuditDept(apps),
      produced: r.produced,
      sent: r.sent,
      received: r.received,
      remaining: Math.max(0, adjQty - r.produced),
      wip: r.wip,
      inTransit: 0,
      missingInTransit: 0,
      status:
        r.status === 'completed' || r.status === 'complete'
          ? 'complete'
          : inProgress
            ? 'in_progress'
            : 'not_started',
      completedAt: null,
      startDate: null,
      endDate: null,
      plannedSam: null,
      lineBreakdown: [],
    };
  });
}

export function syntheticCutRowFromColorway(
  order: { id: string; styleName: string; poNumber: string; buyer: string },
  colorway: { id: string; name: string; sizes: Array<{ size: string; adj_qty?: number; order_qty?: number }> },
): CutToShipRow {
  const cutBySize: SizeMap = {};
  for (const s of colorway.sizes) {
    cutBySize[s.size] = s.order_qty ?? 0;
  }
  const cutQty = sumSizeMap(cutBySize);
  return {
    factory_id: '',
    order_id: order.id,
    colorway_id: colorway.id,
    style_name: order.styleName,
    buyer_name: order.buyer,
    po_number: order.poNumber,
    order_qty: cutQty,
    cut_qty: cutQty,
    cut_qty_source: 'order',
    shipped_qty: 0,
    rejected_qty: 0,
    wip_qty: cutQty,
    reconciliation_gap: 0,
    is_balanced: false,
    completion_pct: null,
    order_status: null,
    last_shipment_date: null,
    cut_qty_by_size: cutBySize,
    shipped_qty_by_size: {},
    rejected_qty_by_size: {},
    wip_qty_by_size: cutBySize,
  };
}
