import type { ProductionMatrixVisitCol } from '../components/production/ProductionMatrixTable';

type RoutingStepLike = {
  id?: string;
  seq?: number;
  visit_id?: string | null;
  dept_id?: string;
  dept_name?: string;
  step_label?: string;
  operation_name?: string;
  is_primary_output?: boolean | null;
  step_type?: string | null;
};

/** One matrix column per routing step — multiple operations in one visit get separate columns. */
export function matrixColumnsFromRoutingSteps(
  steps: RoutingStepLike[],
): ProductionMatrixVisitCol[] {
  return [...steps]
    .filter((s): s is RoutingStepLike & { id: string } => Boolean(s.id))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map((s) => ({
      stepId: s.id,
      visitId: s.visit_id || s.id,
      deptId: s.dept_id || '',
      deptName: s.dept_name || s.operation_name || 'Department',
      activitiesLabel: (s.operation_name || '').trim() || undefined,
    }));
}

/** Dept header spans all operations that share the same visit_id. */
export function buildMatrixDeptHeaderGroups(
  cols: ProductionMatrixVisitCol[],
): Array<{ deptName: string; cols: ProductionMatrixVisitCol[] }> {
  const groups: Array<{ deptName: string; cols: ProductionMatrixVisitCol[] }> = [];
  for (const col of cols) {
    const last = groups[groups.length - 1];
    if (last && last.cols[0].visitId === col.visitId) {
      last.cols.push(col);
    } else {
      groups.push({ deptName: col.deptName, cols: [col] });
    }
  }
  return groups;
}

export function operationHeaderLabel(col: ProductionMatrixVisitCol): string {
  return col.activitiesLabel?.trim() || col.deptName;
}

export function primaryStepIdForVisit(
  steps: RoutingStepLike[],
  visitId: string,
): string | null {
  const inVisit = steps.filter((s) => s.visit_id === visitId && s.id);
  if (inVisit.length === 0) return null;
  const primary =
    inVisit.find((s) => s.is_primary_output)
    ?? [...inVisit].reverse().find((s) => s.step_type === 'produce')
    ?? inVisit[inVisit.length - 1];
  return primary?.id ?? null;
}

export function matrixColumnKey(col: ProductionMatrixVisitCol): string {
  return col.stepId;
}

type SizeProgressReader = {
  getVisitSizeCount?: (colorwayId: string | undefined, visitId: string, size: string) => number;
  getVisitTotal?: (colorwayId: string | undefined, visitId: string) => number;
  getRouteSizeCount?: (colorwayId: string | undefined, routeStepId: string, size: string) => number;
};

/** Per-operation size counts. When route-level lookup is available, never roll visit totals into the primary column. */
export function sumMatrixColumnSize(
  col: ProductionMatrixVisitCol,
  size: string,
  allCols: ProductionMatrixVisitCol[],
  steps: RoutingStepLike[],
  colorwayIds: string[],
  sizeProgress: SizeProgressReader | undefined,
): number {
  // Use exact route/step counts when the progress source supports them.
  if (sizeProgress?.getRouteSizeCount) {
    let total = 0;
    for (const cwId of colorwayIds) {
      total += sizeProgress.getRouteSizeCount(cwId, col.stepId, size) ?? 0;
    }
    return total;
  }

  // Legacy fallback for progress sources without route-level keys.
  let routeTotal = 0;
  for (const cwId of colorwayIds) {
    routeTotal += sizeProgress?.getRouteSizeCount?.(cwId, col.stepId, size) ?? 0;
  }
  if (routeTotal > 0) return routeTotal;

  const stepsInVisit = allCols.filter((c) => c.visitId === col.visitId);
  const primaryId = primaryStepIdForVisit(steps, col.visitId);
  if (stepsInVisit.length > 1 && col.stepId !== primaryId) return 0;

  let total = 0;
  for (const cwId of colorwayIds) {
    const n = sizeProgress?.getVisitSizeCount?.(cwId, col.visitId, size);
    total += typeof n === 'number' ? n : 0;
  }
  return total;
}

export function sumMatrixColumnTotal(
  col: ProductionMatrixVisitCol,
  allCols: ProductionMatrixVisitCol[],
  steps: RoutingStepLike[],
  colorwayIds: string[],
  sizeKeys: string[],
  sizeProgress: SizeProgressReader | undefined,
): number {
  return sizeKeys.reduce(
    (sum, size) => sum + sumMatrixColumnSize(col, size, allCols, steps, colorwayIds, sizeProgress),
    0,
  );
}
