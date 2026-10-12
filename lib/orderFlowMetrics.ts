import { supabase } from './supabase';
import type { CutToShipJourneyRow } from './reports';
import {
  visitPipelineCellsFromRouting,
  type VisitPipelineCell,
} from './orderRoutingFlow';
import { fetchOrderRoutingSteps } from './orderRoutingEditor';
import { fetchDepartmentsTable } from './settingsTableFetchers';

export interface VisitFlowMetrics {
  visitId: string;
  deptId: string;
  deptName: string;
  activitiesLabel: string;
  label: string;
  primaryRouteId?: string;
  deptRole?: string | null;
  received: number;
  produced: number;
  sent: number;
  wip: number;
  inTransit?: number;
  missingInTransit?: number;
}

/** Shipment/dispatch has no next department, so captured qty lives in produced. */
export function isShipmentFlowDept(row: {
  deptName: string;
  activitiesLabel?: string | null;
  deptRole?: string | null;
}): boolean {
  if (row.deptRole === 'terminal') return true;
  return /\bshipment\b|\bdispatch\b/i.test(`${row.deptName} ${row.activitiesLabel || ''}`);
}

/** Show dispatched qty in Sent (not Produced) and WIP as still-on-hand. */
export function shipmentFlowDisplayQty(row: {
  deptName: string;
  activitiesLabel?: string | null;
  deptRole?: string | null;
  produced: number;
  sent: number;
  received: number;
  wip: number;
}): { produced: number; sent: number; wip: number; isShipment: boolean } {
  if (!isShipmentFlowDept(row)) {
    return { produced: row.produced, sent: row.sent, wip: row.wip, isShipment: false };
  }
  const sent = row.sent > 0 ? row.sent : row.produced;
  return {
    produced: 0,
    sent,
    wip: Math.max(0, row.received - sent),
    isShipment: true,
  };
}

function journeyForDept(
  journey: CutToShipJourneyRow[],
  deptId: string,
  colorwayId?: string | null,
  visitId?: string | null,
): { received: number; produced: number; sent: number; wip: number; inTransit: number; missingInTransit: number } {
  const rows = journey.filter((r) => {
    if (visitId && r.visit_id) {
      if (r.visit_id !== visitId) return false;
    } else if (r.dept_id !== deptId) {
      return false;
    }
    if (colorwayId && r.colorway_id && r.colorway_id !== colorwayId) return false;
    return true;
  });
  if (rows.length === 0) {
    return { received: 0, produced: 0, sent: 0, wip: 0, inTransit: 0, missingInTransit: 0 };
  }
  let received = 0;
  let produced = 0;
  let sent = 0;
  let wip = 0;
  let inTransit = 0;
  let missingInTransit = 0;
  for (const r of rows) {
    received += Number(r.qty_received) || 0;
    produced += Number(r.qty_produced) || 0;
    sent += Number(r.qty_sent) || 0;
    wip += Number(r.wip_qty) || 0;
    inTransit += Number(r.qty_in_transit) || 0;
    missingInTransit += Number(r.qty_missing_in_transit) || 0;
  }
  return { received, produced, sent, wip, inTransit, missingInTransit };
}

/**
 * Visit-level received / produced / sent for an order (optional colorway).
 * Uses cut-to-ship journey + routing visit groups.
 */
function routingStepsToCells(
  routingSteps: Awaited<ReturnType<typeof fetchOrderRoutingSteps>>,
  departments: Array<{ id: string; name: string }>,
): VisitPipelineCell[] {
  return visitPipelineCellsFromRouting(
    routingSteps.map((s) => ({
      id: s.id,
      seq: s.seq,
      dept_id: s.dept_id,
      dept_name: s.dept_name,
      step_label: s.operation_name,
      operation_name: s.operation_name,
      visit_id: s.visit_id,
      is_primary_output: s.is_primary_output,
      step_type: s.step_type,
    })),
    departments,
  );
}

function cellsToFlowMetrics(
  cells: VisitPipelineCell[],
  journey: CutToShipJourneyRow[],
  colorwayId?: string | null,
): VisitFlowMetrics[] {
  return cells.map((cell) => {
    const m = journeyForDept(journey, cell.deptId, colorwayId, cell.visitId);
    return {
      visitId: cell.visitId,
      deptId: cell.deptId,
      deptName: cell.deptName,
      activitiesLabel: cell.activitiesLabel,
      label: cell.label,
      primaryRouteId: cell.primaryRouteId,
      received: m.received,
      produced: m.produced,
      sent: m.sent,
      wip: m.wip > 0 ? m.wip : Math.max(0, m.received - m.sent),
      inTransit: m.inTransit,
      missingInTransit: m.missingInTransit,
    };
  });
}

export async function fetchOrderFlowMetrics(
  factoryId: string,
  orderId: string,
  colorwayId?: string | null,
): Promise<VisitFlowMetrics[]> {
  const batch = await fetchOrderFlowMetricsBatch(factoryId, orderId, colorwayId ? [colorwayId] : []);
  if (colorwayId) return batch.byColor[colorwayId] ?? [];
  return batch.order;
}

/** One routing + journey fetch; build order-level and per-colorway visit metrics. */
export async function fetchOrderFlowMetricsBatch(
  factoryId: string,
  orderId: string,
  colorwayIds: string[],
): Promise<{ order: VisitFlowMetrics[]; byColor: Record<string, VisitFlowMetrics[]> }> {
  const [routingSteps, deptRows] = await Promise.all([
    fetchOrderRoutingSteps(orderId, factoryId),
    fetchDepartmentsTable(factoryId).catch(async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .eq('factory_id', factoryId);
      if (error) throw error;
      return (data ?? []).map((d) => ({ id: d.id as string, name: d.name as string }));
    }),
  ]);

  const deptRes = {
    data: deptRows.map((d) => ({ id: d.id, name: d.name })),
  };

  const cells = routingStepsToCells(routingSteps, deptRes.data || []);
  const emptyJourney: CutToShipJourneyRow[] = [];
  const order = cellsToFlowMetrics(cells, emptyJourney);
  const byColor: Record<string, VisitFlowMetrics[]> = {};
  for (const cwId of colorwayIds) {
    byColor[cwId] = cellsToFlowMetrics(cells, emptyJourney, cwId);
  }
  return { order, byColor };
}

export function visitCellsFromOrderRouting(
  routingSteps: Array<{
    id?: string;
    seq?: number;
    dept_id?: string;
    dept_name?: string;
    operation_name?: string;
    visit_id?: string | null;
    is_primary_output?: boolean | null;
    step_type?: string | null;
  }>,
  departments: Array<{ id: string; name: string }>,
): VisitPipelineCell[] {
  return visitPipelineCellsFromRouting(
    routingSteps.map((s) => ({
      ...s,
      dept_name: s.dept_name || s.operation_name || '',
    })),
    departments,
  );
}
