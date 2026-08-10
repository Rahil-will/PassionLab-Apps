import type { LineAllocation, StyleOrder } from '../types';

/** SAM from a line_allocations row (column preferred; kpi_inputs fallback for legacy rows). */
export function allocationSamValue(row: {
  sam?: number | null;
  kpiInputs?: { sam?: number } | null;
  kpi_inputs?: { sam?: number } | null;
}): number {
  const direct = row.sam != null ? Number(row.sam) : NaN;
  if (!Number.isNaN(direct) && direct > 0) return direct;
  const kpi = row.kpiInputs ?? row.kpi_inputs;
  return Number(kpi?.sam) || 0;
}
export function allocationColorwayId(alloc: LineAllocation): string {
  return alloc.colorwayId || alloc.orderId;
}

export function allocationsForColorway(
  allocations: LineAllocation[],
  colorwayId: string,
): LineAllocation[] {
  return allocations.filter((a) => allocationColorwayId(a) === colorwayId);
}

/** Resolve the parent StyleOrder for an allocation. */
export function allocationOrder(
  alloc: LineAllocation,
  orders: StyleOrder[],
): StyleOrder | undefined {
  return orders.find((o) => o.id === alloc.orderId);
}

/** Resolve the colorway name from the canonical colorways table (via the order). */
export function allocationColorwayName(
  alloc: LineAllocation,
  orders: StyleOrder[],
): string {
  const order = allocationOrder(alloc, orders);
  const colorway = order?.colorways?.find((cw) => cw.id === alloc.colorwayId);
  return colorway?.name || '';
}

/** Resolve style_name from the canonical style_orders table. */
export function allocationStyleName(
  alloc: LineAllocation,
  orders: StyleOrder[],
): string {
  return allocationOrder(alloc, orders)?.styleName || '';
}

/** Resolve po_number from the canonical style_orders table. */
export function allocationPoNumber(
  alloc: LineAllocation,
  orders: StyleOrder[],
): string {
  return allocationOrder(alloc, orders)?.poNumber || '';
}

/** Routing steps for an allocation (visit_id is primary; operationId is legacy). */
export function routingStepsForAllocation(
  alloc: LineAllocation,
  orders: StyleOrder[],
): NonNullable<StyleOrder['routingSteps']> {
  const order = allocationOrder(alloc, orders);
  const steps = order?.routingSteps ?? [];
  if (alloc.visitId) {
    return steps.filter((s) => s.visit_id === alloc.visitId);
  }
  if (alloc.operationId) {
    const step = steps.find((s) => s.id === alloc.operationId);
    return step ? [step] : [];
  }
  return [];
}

/** Operation labels for an allocation from order routing (all steps in the visit). */
export function allocationOperationNames(
  alloc: LineAllocation,
  orders: StyleOrder[],
): string[] {
  return routingStepsForAllocation(alloc, orders)
    .map((s) => s.operation_name || s.dept_name || '')
    .filter(Boolean);
}

/** Resolve the primary routing step for an allocation (produce step in visit, else last step). */
export function allocationRoutingStep(
  alloc: LineAllocation,
  orders: StyleOrder[],
) {
  const steps = routingStepsForAllocation(alloc, orders);
  if (steps.length === 0) return undefined;
  const produce = steps.filter((s) => s.step_type === 'produce');
  return produce[produce.length - 1] ?? steps[steps.length - 1];
}

/** Combined operation label for display (e.g. gantt bar title). */
export function allocationOperationName(
  alloc: LineAllocation,
  orders: StyleOrder[],
): string {
  const names = allocationOperationNames(alloc, orders);
  return names.length > 1 ? names.join(' + ') : names[0] || '';
}

/** Resolve department_id from order_routing_steps.dept_id. */
export function allocationDepartmentId(
  alloc: LineAllocation,
  orders: StyleOrder[],
): string {
  if (alloc.departmentId) return alloc.departmentId;
  const step = allocationRoutingStep(alloc, orders);
  return step?.dept_id || '';
}

/** Resolve department_name from order_routing_steps.dept_name (snapshot). */
export function allocationDepartmentName(
  alloc: LineAllocation,
  orders: StyleOrder[],
): string {
  const step = allocationRoutingStep(alloc, orders);
  return step?.dept_name || '';
}
