import type { ProductionSummaryRow } from '../types';
import type { FlowStepRef } from './orderSizeProgress';

export interface OrderRoutingStepLike {
  id?: string;
  seq?: number;
  dept_id?: string;
  dept_name: string;
  step_label?: string;
  operation_name?: string;
  visit_id?: string | null;
  operation_def_id?: string;
  step_type?: 'loading' | 'produce' | 'store' | 'outsource' | string | null;
  is_primary_output?: boolean | null;
}

export interface PipelineStepRef {
  label: string;
  deptName: string;
  deptId: string;
  routingStepId?: string;
}

/** Resolve missing dept_id from factory department master when routing rows only have names. */
export function resolveRoutingDeptId(
  step: Pick<OrderRoutingStepLike, 'dept_id' | 'dept_name' | 'operation_name'>,
  departments?: Array<{ id: string; name: string }>,
): string {
  const existing = (step.dept_id || '').trim();
  if (existing) return existing;
  if (!departments?.length) return '';
  const names = [step.dept_name, step.operation_name].filter(Boolean) as string[];
  for (const name of names) {
    const hit = departments.find(
      (d) => d.name === name || d.name.toLowerCase() === name.toLowerCase(),
    );
    if (hit) return hit.id;
  }
  return '';
}

export function routingStepsToFlowRefs(
  steps: OrderRoutingStepLike[],
  departments?: Array<{ id: string; name: string }>,
): FlowStepRef[] {
  return steps.map((s) => {
    const deptId = resolveRoutingDeptId(s, departments);
    return {
      dept_id: deptId,
      dept_name: s.dept_name || s.operation_name || '',
    };
  });
}

export function routingStepsToPipelineRefs(
  steps: OrderRoutingStepLike[],
  departments?: Array<{ id: string; name: string }>,
): PipelineStepRef[] {
  return steps.map((s) => ({
    label: s.operation_name || s.dept_name,
    deptName: s.dept_name || s.operation_name || '',
    deptId: resolveRoutingDeptId(s, departments),
    routingStepId: s.id,
  }));
}

export function findRoutingStepForPlanningRow(
  steps: OrderRoutingStepLike[],
  row: { operationId?: string; flowStep?: number; department?: string },
): OrderRoutingStepLike | undefined {
  if (row.operationId) {
    const byId = steps.find((s) => s.id === row.operationId);
    if (byId) return byId;
  }
  if (row.flowStep != null) {
    const bySeq = steps.find((s) => s.seq === row.flowStep);
    if (bySeq) return bySeq;
  }
  const dept = (row.department || '').trim();
  if (!dept) return undefined;
  return steps.find(
    (s) =>
      s.dept_name === dept ||
      s.operation_name === dept,
  );
}

export function productionSummaryMatchesStep(
  row: ProductionSummaryRow,
  step: Pick<PipelineStepRef, 'deptId' | 'deptName' | 'label' | 'routingStepId'>,
  orderId: string,
  colorwayId?: string,
): boolean {
  if (row.order_id !== orderId) return false;
  if (colorwayId && row.colorway_id && row.colorway_id !== colorwayId) return false;
  if (step.routingStepId && row.operation_id) {
    return row.operation_id === step.routingStepId;
  }
  if (step.deptId && row.department_id === step.deptId) return true;
  const dept = row.department || '';
  return dept === step.deptName || dept === step.label;
}

export function sumProductionSummaryForStep(
  rows: ProductionSummaryRow[],
  step: Pick<PipelineStepRef, 'deptId' | 'deptName' | 'label' | 'routingStepId'>,
  orderId: string,
  colorwayId?: string,
): number {
  return rows
    .filter((r) => productionSummaryMatchesStep(r, step, orderId, colorwayId))
    .reduce((sum, r) => sum + (r.total_passed || r.total_scanned || 0), 0);
}

/** Visit-primary pipeline cell for Status Tracker / order details. */
export interface VisitPipelineCell {
  visitId: string;
  deptId: string;
  /** Main display name (department). */
  deptName: string;
  /** Operation names within the visit (secondary line). */
  activitiesLabel: string;
  /** @deprecated use deptName + activitiesLabel */
  label: string;
  /** Primary produce order_routing_steps.id — counts use this only. */
  primaryRouteId?: string;
  routeIds: string[];
  /** Step type of the primary operation (loading/produce/store/outsource). */
  stepType?: string | null;
  /** Capture app of the primary operation (hourly/qc_log/batch/transaction/shipment_log). */
  primaryCaptureApp?: string | null;
}

export function visitPipelineCellsFromRouting(
  steps: Array<OrderRoutingStepLike & {
    visit_id?: string | null;
    is_primary_output?: boolean | null;
    step_type?: string | null;
    capture_app?: string | null;
  }>,
  departments?: Array<{ id: string; name: string }>,
): VisitPipelineCell[] {
  const sorted = [...steps].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  // Group consecutive same-department steps into one visit (never one card per operation).
  // Stable visit keys — do not use step.id or random UUIDs.
  type StepRow = (typeof sorted)[number] & { deptKey: string };
  const enriched: StepRow[] = sorted.map((s, i) => {
    const deptId = s.dept_id || resolveRoutingDeptId(s, departments) || '';
    const deptName = s.dept_name || '';
    return {
      ...s,
      id: s.id || `step-${i}`,
      dept_id: deptId,
      dept_name: deptName,
      deptKey: (deptId || deptName).trim().toLowerCase(),
    };
  });

  const groups: StepRow[][] = [];
  let block: StepRow[] = [];
  for (const s of enriched) {
    if (block.length === 0 || block[0].deptKey === s.deptKey) {
      block.push(s);
    } else {
      groups.push(block);
      block = [s];
    }
  }
  if (block.length > 0) groups.push(block);

  return groups.map((visitSteps, gi) => {
    const primary =
      visitSteps.find((s) => s.is_primary_output)
      ?? [...visitSteps].reverse().find((s) => s.step_type === 'produce')
      ?? visitSteps[visitSteps.length - 1];
    const deptId = primary.dept_id || resolveRoutingDeptId(primary, departments) || '';
    const deptName = primary.dept_name || primary.operation_name || '';
    const activityLabels = visitSteps
      .map((s) => s.operation_name || '')
      .filter((name) => name && name !== deptName);
    const activitiesLabel = activityLabels.join(' · ');
    // Prefer the shared visit_id from DB; fall back to the primary step id so the
    // client-side visit key matches order_dept_progress_rows / get_order_detail_bundle.
    const sharedVisit =
      primary.visit_id ??
      primary.id ??
      `visit-${deptId || deptName}-${gi}`;
    return {
      visitId: sharedVisit,
      deptId,
      deptName,
      activitiesLabel,
      label: activitiesLabel ? `${deptName} (${activitiesLabel})` : deptName,
      primaryRouteId: primary.id,
      primaryCaptureApp: primary.capture_app,
      routeIds: visitSteps.map((s) => s.id).filter((id): id is string => Boolean(id)),
      stepType: primary.step_type,
    };
  });
}

/** Terminal visit primary route for shipment / rejection capture. */
export function terminalVisitFromRouting(
  steps: Array<OrderRoutingStepLike & {
    visit_id?: string | null;
    is_primary_output?: boolean | null;
    step_type?: string | null;
  }>,
  departments: Array<{ id: string; name: string; role?: string }>,
): VisitPipelineCell | null {
  const cells = visitPipelineCellsFromRouting(steps, departments);
  const terminalDeptIds = new Set(
    departments.filter((d) => d.role === 'terminal').map((d) => d.id),
  );
  const terminal = [...cells].reverse().find((c) => terminalDeptIds.has(c.deptId));
  return terminal ?? cells[cells.length - 1] ?? null;
}

export function sumProductionSummaryForVisit(
  rows: ProductionSummaryRow[],
  cell: VisitPipelineCell,
  orderId: string,
  colorwayId?: string,
): number {
  if (cell.primaryRouteId) {
    return rows
      .filter((r) => {
        if (r.order_id !== orderId) return false;
        if (colorwayId && r.colorway_id && r.colorway_id !== colorwayId) return false;
        return r.operation_id === cell.primaryRouteId;
      })
      .reduce((sum, r) => sum + (r.total_passed || r.total_scanned || 0), 0);
  }

  if (cell.routeIds.length > 0) {
    const routeSet = new Set(cell.routeIds);
    return rows
      .filter((r) => {
        if (r.order_id !== orderId) return false;
        if (colorwayId && r.colorway_id && r.colorway_id !== colorwayId) return false;
        return Boolean(r.operation_id && routeSet.has(r.operation_id));
      })
      .reduce((sum, r) => sum + (r.total_passed || r.total_scanned || 0), 0);
  }

  return sumProductionSummaryForStep(
    rows,
    { deptId: cell.deptId, deptName: cell.deptName, label: cell.label },
    orderId,
    colorwayId,
  );
}
