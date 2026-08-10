import type { ProductionSummaryRow } from '../types';
import type { CutToShipJourneyRow, StyleJourneyDept } from './mesReportsApi';
import type { VisitFlowMetrics } from './orderFlowMetrics';
import type { OrderRoutingStepLike } from './orderRoutingFlow';
import { resolveRoutingDeptId } from './orderRoutingFlow';
import type { SizeMap } from './mesSizeDisplay';

/** First route step (by seq) in an origin work center — cut qty source for cut-to-ship. */
export interface OriginCutRouteStep {
  stepId: string;
  visitId: string | null;
  deptId: string;
  deptName: string;
  operationLabel: string;
}

type RoutingStepInput = OrderRoutingStepLike & {
  id?: string;
  seq?: number;
  dept_id?: string;
  visit_id?: string | null;
  step_label?: string;
  operation_name?: string;
  is_primary_output?: boolean | null;
};

/** Primary garment WIP at origin — routing step with is_primary_output or non-lining aspect. */

function isOriginStep(
  step: RoutingStepInput,
  originDeptIds: Set<string>,
  departments: Array<{ id: string; role?: string; name?: string }>,
): boolean {
  const deptId = step.dept_id || resolveRoutingDeptId(
    step,
    departments as Array<{ id: string; name: string }>,
  );
  return Boolean(deptId && originDeptIds.has(deptId) && step.id);
}

/**
 * Cut qty source = first origin produce step for primary-fabric WIP.
 * Lining cuts are parallel fabric work — excluded from cut-to-ship vs order qty.
 */
export function firstOriginRouteStep(
  steps: RoutingStepInput[],
  departments: Array<{ id: string; role?: string }>,
): OriginCutRouteStep | null {
  const originDeptIds = new Set(
    departments.filter((d) => d.role === 'origin').map((d) => d.id),
  );
  if (originDeptIds.size === 0) return null;

  const sorted = [...steps].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const originSteps = sorted.filter((s) => isOriginStep(s, originDeptIds, departments));
  if (originSteps.length === 0) return null;

  const primaryStep =
    originSteps.find((s) => s.is_primary_output)
    ?? originSteps[0];

  const deptId = primaryStep.dept_id || resolveRoutingDeptId(
    primaryStep,
    departments as Array<{ id: string; name: string }>,
  );
  if (!deptId || !primaryStep.id) return null;

  return {
    stepId: primaryStep.id,
    visitId: primaryStep.visit_id ?? null,
    deptId,
    deptName: primaryStep.dept_name || primaryStep.step_label || '',
    operationLabel: primaryStep.step_label || primaryStep.operation_name || primaryStep.dept_name || '',
  };
}

export function originCutProducedFromSummary(
  rows: ProductionSummaryRow[],
  origin: OriginCutRouteStep,
  orderId: string,
  colorwayId?: string | null,
): number {
  return rows
    .filter((r) => {
      if (r.order_id !== orderId) return false;
      if (colorwayId && r.colorway_id && r.colorway_id !== colorwayId) return false;
      return r.operation_id === origin.stepId;
    })
    .reduce((sum, r) => sum + (r.total_passed || r.total_scanned || 0), 0);
}

export function originCutProducedFromFlowDepts(
  flowDepts: StyleJourneyDept[],
  origin: OriginCutRouteStep,
): number {
  const match = flowDepts.find((d) =>
    origin.visitId ? d.visitId === origin.visitId : d.deptId === origin.deptId,
  );
  return match?.produced ?? 0;
}

export function originCutProducedFromFlow(
  flowMetrics: VisitFlowMetrics[],
  origin: OriginCutRouteStep,
): number {
  const match = flowMetrics.find((m) =>
    origin.visitId ? m.visitId === origin.visitId : m.deptId === origin.deptId,
  );
  return match?.produced ?? 0;
}

export function originCutProducedFromJourney(
  journey: CutToShipJourneyRow[],
  origin: OriginCutRouteStep,
  colorwayId?: string | null,
): number {
  const rows = journey.filter((r) => {
    if (colorwayId && r.colorway_id && r.colorway_id !== colorwayId) return false;
    if (origin.visitId && r.visit_id) return r.visit_id === origin.visitId;
    return r.dept_id === origin.deptId;
  });
  return rows.reduce((sum, r) => sum + (r.qty_produced ?? 0), 0);
}

/**
 * Cut qty = output from the first origin-department operation in route order.
 * Cut-to-ship compares this against terminal-department shipment totals.
 */
export function resolveOriginCutQty(args: {
  steps: RoutingStepInput[];
  departments: Array<{ id: string; role?: string }>;
  orderId: string;
  colorwayId?: string | null;
  productionSummary?: ProductionSummaryRow[];
  flowMetrics?: VisitFlowMetrics[];
  journey?: CutToShipJourneyRow[];
  flowDepts?: StyleJourneyDept[];
  fallbackCutQty?: number;
  /** When bundle reconciliation has captured primary-fabric cut qty. */
  capturedCutQty?: number;
  cutQtySource?: string;
}): number {
  if (args.cutQtySource === 'captured' && (args.capturedCutQty ?? 0) > 0) {
    return args.capturedCutQty!;
  }

  const origin = firstOriginRouteStep(args.steps, args.departments);
  if (!origin) return args.fallbackCutQty ?? 0;

  if (args.flowMetrics?.length) {
    const fromFlow = originCutProducedFromFlow(args.flowMetrics, origin);
    if (fromFlow > 0) return fromFlow;
  }

  if (args.journey?.length) {
    const fromJourney = originCutProducedFromJourney(
      args.journey,
      origin,
      args.colorwayId,
    );
    if (fromJourney > 0) return fromJourney;
  }

  if (args.flowDepts?.length) {
    const fromDepts = originCutProducedFromFlowDepts(args.flowDepts, origin);
    if (fromDepts > 0) return fromDepts;
  }

  if (args.productionSummary?.length) {
    const fromSummary = originCutProducedFromSummary(
      args.productionSummary,
      origin,
      args.orderId,
      args.colorwayId,
    );
    if (fromSummary > 0) return fromSummary;
  }

  return args.fallbackCutQty ?? 0;
}

export function originCutQtyBySize(
  getVisitSizeCount: (
    colorwayId: string | undefined,
    visitId: string,
    size: string,
  ) => number,
  origin: OriginCutRouteStep | null,
  colorwayId: string | undefined,
  sizeKeys: string[],
): SizeMap {
  if (!origin?.visitId) return {};
  const out: SizeMap = {};
  for (const size of sizeKeys) {
    const qty = getVisitSizeCount(colorwayId, origin.visitId, size);
    if (qty > 0) out[size] = qty;
  }
  return out;
}
