import type { DepartmentEntity, ProcessFlowStep } from '../types/settings';
import type { OrderRoutingStepRow } from './orderRoutingEditor';
import {
  planningProfileForStep,
  profileUsesKpis,
  profileUsesPlannedQty,
  type PlanningStepProfile,
} from './planningStepProfile';
import type { PlanningRow } from '../pages/planning/types';
import { departmentOrderPlanningEligible, departmentPlanningTableEligible, resolvePlanningMode } from './departmentFilters';

export type VisitStepLike = Pick<
  ProcessFlowStep,
  'id' | 'dept_name' | 'step_type' | 'flow_step' | 'capture_app'
> & {
  visit_id?: string | null;
  dept_id?: string | null;
  /** DB / routing rows use null; normalize to undefined when building ProcessFlowStep. */
  operation_def_id?: string | null;
  operation_name?: string;
  seq?: number;
};

export interface RouteVisitGroup<T extends VisitStepLike = VisitStepLike> {
  visitId: string;
  deptId: string;
  deptName: string;
  start: number;
  end: number;
  steps: T[];
}

function deptKey(step: Pick<VisitStepLike, 'dept_id' | 'dept_name'>): string {
  return (step.dept_id || step.dept_name || '').trim().toLowerCase();
}

export function visitKeyForStep(step: VisitStepLike, idx: number): string {
  return step.visit_id || `legacy-${deptKey(step)}-${idx}`;
}

/** Consecutive same-dept steps share one visit_id (fixes split loading+produce cards). */
export function normalizeRouteVisitIds<T extends VisitStepLike>(steps: T[]): T[] {
  if (steps.length === 0) return steps;
  const next = steps.map((s) => ({ ...s }));
  let blockStart = 0;
  for (let i = 1; i <= next.length; i += 1) {
    const endBlock = i === next.length || deptKey(next[i]) !== deptKey(next[blockStart]);
    if (!endBlock) continue;
    const existing = next.slice(blockStart, i).find((s) => s.visit_id)?.visit_id;
    const vid = existing || crypto.randomUUID();
    for (let k = blockStart; k < i; k += 1) {
      next[k] = { ...next[k], visit_id: vid };
    }
    blockStart = i;
  }
  return next;
}

/** Group consecutive steps with the same visit_id (or legacy consecutive same-dept run). */
export function groupStepsByVisit<T extends VisitStepLike>(steps: T[]): RouteVisitGroup<T>[] {
  const groups: RouteVisitGroup<T>[] = [];
  let i = 0;
  while (i < steps.length) {
    const vid = steps[i].visit_id;
    let end = i;
    if (vid) {
      while (end + 1 < steps.length && steps[end + 1].visit_id === vid) {
        end += 1;
      }
    } else {
      const key = deptKey(steps[i]);
      while (
        end + 1 < steps.length
        && !steps[end + 1].visit_id
        && deptKey(steps[end + 1]) === key
      ) {
        end += 1;
      }
    }
    const groupVisitId = vid || `legacy-${deptKey(steps[i])}-${i}`;
    groups.push({
      visitId: vid || groupVisitId,
      deptId: steps[i].dept_id || '',
      deptName: steps[i].dept_name || '',
      start: i,
      end,
      steps: steps.slice(i, end + 1),
    });
    i = end + 1;
  }
  return groups;
}

export function ensureStepVisitIds<T extends VisitStepLike>(steps: T[]): T[] {
  const normalized = normalizeRouteVisitIds(steps);
  const groups = groupStepsByVisit(normalized);
  const next = steps.map((s) => ({ ...s }));
  for (const g of groups) {
    const vid = g.steps[0]?.visit_id || crypto.randomUUID();
    for (let k = g.start; k <= g.end; k += 1) {
      next[k] = { ...next[k], visit_id: vid };
    }
  }
  return next;
}

const VISIT_STEP_TYPE_ORDER: Record<string, number> = {
  loading: 0,
  store: 1,
  outsource: 1,
  inspect: 1,
  produce: 2,
};

/** Loading left, produce right within a visit card. */
export function sortVisitStepsForDisplay<T extends Pick<VisitStepLike, 'step_type'>>(steps: T[]): T[] {
  return [...steps].sort((a, b) => {
    const ao = VISIT_STEP_TYPE_ORDER[a.step_type || 'produce'] ?? 1;
    const bo = VISIT_STEP_TYPE_ORDER[b.step_type || 'produce'] ?? 1;
    return ao - bo;
  });
}

export function visitProduceStep<T extends Pick<VisitStepLike, 'step_type' | 'id'>>(steps: T[]): T | undefined {
  const produce = steps.filter((s) => (s.step_type || 'produce') === 'produce');
  return produce.length > 0 ? produce[produce.length - 1] : undefined;
}

export function visitLoadingStep<T extends Pick<VisitStepLike, 'step_type' | 'id'>>(steps: T[]): T | undefined {
  return steps.find((s) => s.step_type === 'loading');
}

/** Primary route step for a visit — used for capture FK resolution in UI. */
export function visitPlanRouteStep<T extends VisitStepLike>(steps: T[]): T | undefined {
  const produce = visitProduceStep(steps);
  if (produce) return produce;
  if (steps.length === 1) return steps[0];
  return steps[steps.length - 1];
}

export function visitPlanningProfile(
  steps: VisitStepLike[],
  dept?: Pick<DepartmentEntity, 'role' | 'planning_mode'>,
): PlanningStepProfile {
  if (dept && resolvePlanningMode(dept) === 'outsource') return 'window';
  const produce = visitProduceStep(steps);
  if (produce) return planningProfileForStep(produce, dept);
  const loading = visitLoadingStep(steps);
  if (loading) return 'loading';
  const rep = steps[steps.length - 1] || steps[0];
  return rep ? planningProfileForStep(rep, dept) : 'produce';
}

export function validateVisitSteps(
  steps: VisitStepLike[],
  start: number,
  end: number,
  opts?: { forSave?: boolean },
  getStepType?: (step: VisitStepLike) => string | undefined,
): string | null {
  let produceCount = 0;
  let lastProduce = -1;
  let hasLoading = false;

  for (let k = start; k <= end; k += 1) {
    const t = getStepType?.(steps[k]) ?? steps[k].step_type ?? 'produce';
    if (t === 'loading') {
      hasLoading = true;
      for (let j = k + 1; j <= end; j += 1) {
        const after = getStepType?.(steps[j]) ?? steps[j].step_type ?? 'produce';
        if (after === 'store' || after === 'outsource') {
          return 'Store or outsource cannot follow loading in the same visit — add produce.';
        }
      }
    }
    if (t === 'produce') {
      produceCount += 1;
      lastProduce = k;
    }
  }

  if (opts?.forSave && hasLoading && produceCount === 0) {
    return 'Loading requires a produce operation in the same visit.';
  }
  if (produceCount > 1) return 'Only one produce operation per visit.';
  if (produceCount === 1 && lastProduce !== end) {
    return 'Produce must be the last step in a visit.';
  }

  const seenOpIds = new Set<string>();
  const seenNames = new Set<string>();
  for (let k = start; k <= end; k += 1) {
    const opId = steps[k].operation_def_id;
    if (opId) {
      if (seenOpIds.has(opId)) return 'Each catalog operation can only appear once per visit.';
      seenOpIds.add(opId);
    }
    const name = (steps[k].operation_name || '').trim().toLowerCase();
    if (name) {
      if (seenNames.has(name)) return 'Operation names must be unique within a visit.';
      seenNames.add(name);
    }
  }
  return null;
}

/** Same work center cannot appear in consecutive visits. */
export function validateNoAdjacentSameDeptVisits(steps: VisitStepLike[]): string | null {
  const groups = groupStepsByVisit(steps);
  for (let i = 1; i < groups.length; i += 1) {
    const prev = deptKey(groups[i - 1].steps[0] ?? { dept_id: groups[i - 1].deptId, dept_name: groups[i - 1].deptName });
    const curr = deptKey(groups[i].steps[0] ?? { dept_id: groups[i].deptId, dept_name: groups[i].deptName });
    if (prev && curr === prev) {
      return `"${groups[i].deptName}" cannot follow "${groups[i - 1].deptName}" — the same work center cannot appear in consecutive visits.`;
    }
  }
  return null;
}

/** Each catalog operation (operation_def_id) may appear at most once in a route. */
export function validateNoDuplicateRouteOperations(steps: VisitStepLike[]): string | null {
  const seen = new Set<string>();
  for (const s of steps) {
    const opId = s.operation_def_id;
    if (!opId) continue;
    if (seen.has(opId)) {
      return `"${s.operation_name || s.dept_name || 'This operation'}" is already in this route — each catalog operation can only be used once.`;
    }
    seen.add(opId);
  }
  return null;
}

/** Visit group indices where a catalog operation repeats in the route. */
export function duplicateRouteOperationVisitIndices(steps: VisitStepLike[]): Set<number> {
  const seen = new Set<string>();
  const dup = new Set<number>();
  const groups = groupStepsByVisit(steps);
  groups.forEach((g, gi) => {
    for (const s of g.steps) {
      const opId = s.operation_def_id;
      if (!opId) continue;
      if (seen.has(opId)) dup.add(gi);
      seen.add(opId);
    }
  });
  return dup;
}

export function validateAllVisits(
  steps: VisitStepLike[],
  getStepType?: (step: VisitStepLike) => string | undefined,
): string | null {
  const alerts = collectRouteValidationAlerts(steps, getStepType);
  return alerts[0] ?? null;
}

/** All distinct route validation messages (for inline alerts in the order routing editor). */
export function collectRouteValidationAlerts(
  steps: VisitStepLike[],
  getStepType?: (step: VisitStepLike) => string | undefined,
): string[] {
  const alerts: string[] = [];
  const push = (msg: string | null | undefined) => {
    if (msg && !alerts.includes(msg)) alerts.push(msg);
  };
  push(validateNoDuplicateRouteOperations(steps));
  push(validateNoAdjacentSameDeptVisits(steps));
  const groups = groupStepsByVisit(steps);
  for (const g of groups) {
    push(validateVisitSteps(steps, g.start, g.end, { forSave: true }, getStepType));
  }
  return alerts;
}

export interface PlanningVisitGroup {
  visitId: string;
  deptId: string;
  deptName: string;
  label: string;
  steps: ProcessFlowStep[];
  profile: PlanningStepProfile;
  produceStep?: ProcessFlowStep;
  loadingStep?: ProcessFlowStep;
  planRouteStep: ProcessFlowStep;
  usesKpis: boolean;
  usesQty: boolean;
}

export function buildPlanningVisitGroups(
  flowSteps: ProcessFlowStep[],
  deptById: Map<string, DepartmentEntity>,
): PlanningVisitGroup[] {
  const withVisits = ensureStepVisitIds(flowSteps);
  return groupStepsByVisit(withVisits)
    .filter((g) => {
      const dept = g.deptId ? deptById.get(g.deptId) : undefined;
      return departmentPlanningTableEligible(dept);
    })
    .map((g) => {
    const dept = g.deptId ? deptById.get(g.deptId) : undefined;
    const profile = visitPlanningProfile(g.steps, dept);
    const produceStep = visitProduceStep(g.steps);
    const loadingStep = visitLoadingStep(g.steps);
    const planRouteStep = visitPlanRouteStep(g.steps)!;
    const label =
      g.steps.length > 1
        ? `${g.deptName} (${g.steps.map((s) => s.operation_name || s.dept_name).join(' + ')})`
        : (planRouteStep.operation_name || g.deptName);
    const kpiEligible = departmentOrderPlanningEligible(dept);
    return {
      visitId: g.visitId,
      deptId: g.deptId,
      deptName: g.deptName,
      label,
      steps: g.steps,
      profile,
      produceStep,
      loadingStep,
      planRouteStep,
      usesKpis: kpiEligible && profileUsesKpis(profile),
      usesQty: profileUsesPlannedQty(profile),
    };
  });
}

export function rowsForVisit(rows: PlanningRow[], visit: PlanningVisitGroup): PlanningRow[] {
  return rows.filter((r) => {
    if (r.visitId && visit.visitId) return r.visitId === visit.visitId;
    // Row is pinned to another visit — never fall back to dept/operation name matching.
    if (r.visitId) return false;
    if (r.operationId && visit.planRouteStep.id) return r.operationId === visit.planRouteStep.id;
    if (r.department === visit.label) return true;
    if (visit.planRouteStep.operation_name && r.department === visit.planRouteStep.operation_name) {
      return true;
    }
    return false;
  });
}

export function routingRowToFlowStep(row: OrderRoutingStepRow): ProcessFlowStep {
  return {
    id: row.id,
    flow_step: row.seq,
    dept_id: row.dept_id || '',
    dept_name: row.dept_name,
    step_label: row.operation_name || row.dept_name,
    step_type: (row.step_type || 'produce') as ProcessFlowStep['step_type'],
    capture_app: row.capture_app as ProcessFlowStep['capture_app'],
    operation_def_id: row.operation_def_id || undefined,
    visit_id: row.visit_id,
  };
}

export function ensureRoutingVisitIds(rows: OrderRoutingStepRow[]): OrderRoutingStepRow[] {
  const flow = normalizeRouteVisitIds(rows.map(routingRowToFlowStep));
  const ensured = ensureStepVisitIds(flow);
  return rows.map((s, i) => ({ ...s, visit_id: ensured[i].visit_id }));
}

/** Stable fingerprint of catalog ops in a visit — used for route-save diff. */
export function visitOperationsSignature(
  steps: Array<{ operation_def_id?: string | null; capture_app?: string | null }>,
): string {
  return [...steps]
    .map((s) => `${s.operation_def_id || ''}:${s.capture_app || ''}`)
    .filter((sig) => sig !== ':')
    .sort()
    .join('|');
}

/** Visit ids whose line_allocations should be cleared — only when a visit is removed entirely. */
export function affectedVisitIdsAfterRouteSave<T extends { visit_id?: string | null; operation_def_id?: string | null; capture_app?: string | null }>(
  existingSteps: T[],
  nextSteps: T[],
): string[] {
  const visitIds = (steps: T[]): Set<string> => {
    const ids = new Set<string>();
    for (const s of steps) {
      if (s.visit_id) ids.add(s.visit_id);
    }
    return ids;
  };

  const oldVisitIds = visitIds(existingSteps);
  const newVisitIds = visitIds(nextSteps);
  const removed: string[] = [];
  for (const vid of oldVisitIds) {
    if (!newVisitIds.has(vid)) removed.push(vid);
  }
  return removed;
}

export function groupRoutingRowsByVisit(rows: OrderRoutingStepRow[]): RouteVisitGroup<OrderRoutingStepRow>[] {
  const ensured = ensureRoutingVisitIds(rows);
  return groupStepsByVisit(
    ensured.map((r) => ({
      ...routingRowToFlowStep(r),
      ...r,
    })),
  );
}
