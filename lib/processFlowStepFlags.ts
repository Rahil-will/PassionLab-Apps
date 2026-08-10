import type { DepartmentEntity, ProcessFlowStep } from '../types/settings';
import { resolveRouteStepCaptureApp } from './floorApps';
import { sortDepartmentsForDisplay } from './departmentFilters';
import { validateNoDuplicateRouteOperations, validateVisitSteps, groupStepsByVisit, validateNoAdjacentSameDeptVisits } from './visitPlanning';

export function deptKey(step: Pick<ProcessFlowStep, 'dept_id' | 'dept_name'>): string {
  return (step.dept_id || step.dept_name || '').trim().toLowerCase();
}

export function visitKey(step: ProcessFlowStep, idx: number): string {
  return step.visit_id || `legacy-${deptKey(step)}-${idx}`;
}

/** Bounds of a visit card — grouped by visit_id, falling back to consecutive same dept. */
export function visitBlockBounds(
  steps: ProcessFlowStep[],
  idx: number,
): { start: number; end: number } {
  if (steps[idx]?.visit_id) {
    const vid = steps[idx].visit_id;
    let start = idx;
    while (start > 0 && steps[start - 1].visit_id === vid) start -= 1;
    let end = idx;
    while (end < steps.length - 1 && steps[end + 1].visit_id === vid) end += 1;
    return { start, end };
  }
  return deptBlockBounds(steps, idx);
}

export function ensureVisitIds(steps: ProcessFlowStep[]): ProcessFlowStep[] {
  const next = steps.map((s) => ({ ...s }));
  let i = 0;
  while (i < next.length) {
    const { start, end } = visitBlockBounds(next, i);
    const visitId = next[start].visit_id || crypto.randomUUID();
    for (let k = start; k <= end; k += 1) {
      if (!next[k].visit_id) next[k] = { ...next[k], visit_id: visitId };
    }
    i = end + 1;
  }
  return next;
}

export function deptBlockBounds(
  steps: ProcessFlowStep[],
  idx: number,
): { start: number; end: number } {
  const key = deptKey(steps[idx]);
  let start = idx;
  while (start > 0 && deptKey(steps[start - 1]) === key) start -= 1;
  let end = idx;
  while (end < steps.length - 1 && deptKey(steps[end + 1]) === key) end += 1;
  return { start, end };
}

type StepTypeResolver = (step: ProcessFlowStep) => string | undefined;

/** Last produce step within each consecutive same-dept visit. */
export function primaryOutputIndices(
  steps: ProcessFlowStep[],
  getStepType?: StepTypeResolver,
): Set<number> {
  const out = new Set<number>();
  let i = 0;
  while (i < steps.length) {
    const { start, end } = visitBlockBounds(steps, i);
    let lastProduce = -1;
    for (let k = start; k <= end; k += 1) {
      const stepType = getStepType?.(steps[k]) ?? steps[k].step_type;
      if ((stepType || 'produce') === 'produce') lastProduce = k;
    }
    if (lastProduce >= 0) out.add(lastProduce);
    i = end + 1;
  }
  return out;
}

/** Handover at end of a visit when the next step is a different work center. */
export function transactionIndices(
  steps: ProcessFlowStep[],
  getStepType?: StepTypeResolver,
): Set<number> {
  const primary = primaryOutputIndices(steps, getStepType);
  const out = new Set<number>();
  let i = 0;
  while (i < steps.length) {
    const { start, end } = visitBlockBounds(steps, i);
    const next = steps[end + 1];
    let txIdx = end;
    for (let k = start; k <= end; k += 1) {
      if (primary.has(k)) txIdx = k;
    }
    if (!next) {
      out.add(txIdx);
    } else {
      const sameVisit = steps[start].visit_id
        ? next.visit_id === steps[start].visit_id
        : deptKey(next) === deptKey(steps[start]);
      if (!sameVisit) out.add(txIdx);
    }
    i = end + 1;
  }
  return out;
}

export function validateVisitBlock(
  steps: ProcessFlowStep[],
  idx: number,
  getStepType?: StepTypeResolver,
): string | null {
  const { start, end } = visitBlockBounds(steps, idx);
  return validateVisitSteps(steps, start, end, undefined, getStepType);
}

export function validateInsertStep(
  steps: ProcessFlowStep[],
  insertAt: number,
  newStep: ProcessFlowStep,
  getStepType?: StepTypeResolver,
): string | null {
  const hypothetical = [...steps];
  hypothetical.splice(insertAt, 0, newStep);
  const visitErr = validateVisitBlock(hypothetical, insertAt, getStepType);
  if (visitErr) return visitErr;
  const dup = validateNoDuplicateRouteOperations(hypothetical);
  if (dup) return dup;
  return validateNoAdjacentSameDeptVisits(hypothetical);
}

export function resolveInsertIndex(
  steps: ProcessFlowStep[],
  deptId: string,
  selectedStepIdx: number | null,
  terminalIds: Set<string>,
): number {
  const firstTerminal = steps.findIndex((s) => terminalIds.has(s.dept_id));
  const maxBeforeTerminal = firstTerminal === -1 ? steps.length : firstTerminal;

  if (selectedStepIdx !== null && selectedStepIdx >= 0 && selectedStepIdx < steps.length) {
    const selectedKey = deptKey(steps[selectedStepIdx]);
    const addKey = deptKey({ dept_id: deptId, dept_name: '' });
    const { end } = deptBlockBounds(steps, selectedStepIdx);
    if (selectedKey === addKey) {
      return Math.min(end + 1, maxBeforeTerminal);
    }
    return Math.min(end + 1, maxBeforeTerminal);
  }
  return maxBeforeTerminal;
}

/** WIP/loading/store steps insert before produce when the visit already has produce. */
export function adjustInsertForProduceLast(
  steps: ProcessFlowStep[],
  insertAt: number,
  newStep: ProcessFlowStep,
  getStepType?: StepTypeResolver,
): number {
  const newStepType = getStepType?.(newStep) ?? newStep.step_type;
  if ((newStepType || 'produce') === 'produce') return insertAt;
  const hypothetical = [...steps];
  hypothetical.splice(insertAt, 0, newStep);
  const { start, end } = visitBlockBounds(hypothetical, insertAt);
  for (let k = start; k < end; k += 1) {
    const stepType = getStepType?.(hypothetical[k]) ?? hypothetical[k].step_type;
    if ((stepType || 'produce') === 'produce') return k;
  }
  return insertAt;
}

export function flowBuilderDepartments(departments: DepartmentEntity[]) {
  const origin = departments.filter((d) => d.role === 'origin');
  const terminal = departments.filter((d) => d.role === 'terminal');
  const standard = sortDepartmentsForDisplay(
    departments.filter((d) => d.role !== 'origin' && d.role !== 'terminal'),
  );
  return { origin, standard, terminal };
}

/** Keep terminal departments at the end; preserve user visit order for everything else. */
export function pinTerminalOrderOnly(
  steps: ProcessFlowStep[],
  departments: DepartmentEntity[],
): ProcessFlowStep[] {
  const terminalIds = new Set(departments.filter((d) => d.role === 'terminal').map((d) => d.id));
  const nonTerminal: ProcessFlowStep[] = [];
  const terminal: ProcessFlowStep[] = [];
  for (const s of steps) {
    if (terminalIds.has(s.dept_id)) terminal.push(s);
    else nonTerminal.push(s);
  }
  return [...nonTerminal, ...terminal].map((s, i) => ({
    ...s,
    flow_step: i + 1,
  }));
}

/** Pin the first origin visit at the top, terminal visits at the end; other visits keep user order. */
export function pinRouteVisitOrder(
  steps: ProcessFlowStep[],
  departments: DepartmentEntity[],
): ProcessFlowStep[] {
  if (steps.length === 0) return steps;
  const originIds = new Set(departments.filter((d) => d.role === 'origin').map((d) => d.id));
  const terminalIds = new Set(departments.filter((d) => d.role === 'terminal').map((d) => d.id));
  const groups = groupStepsByVisit(steps);
  const firstOriginIdx = groups.findIndex((g) => originIds.has(g.deptId));

  const middle: typeof groups = [];
  const terminal: typeof groups = [];
  let firstOrigin: (typeof groups)[number] | undefined;

  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    if (terminalIds.has(g.deptId)) terminal.push(g);
    else if (i === firstOriginIdx && firstOriginIdx >= 0) firstOrigin = g;
    else middle.push(g);
  }

  const ordered = [...(firstOrigin ? [firstOrigin] : []), ...middle, ...terminal];
  const flat = ordered.flatMap((g) => g.steps);
  return flat.map((s, i) => ({ ...s, flow_step: i + 1 }));
}

type CatalogOpPick = {
  id: string;
  name: string;
  step_type: ProcessFlowStep['step_type'];
  capture_app: string | null;
};

export function ensureEndpointSteps(
  steps: ProcessFlowStep[],
  departments: DepartmentEntity[],
  getOps: (deptId: string) => CatalogOpPick[],
  entitlements?: import('./factoryEntitlements').FactoryEntitlements,
): ProcessFlowStep[] {
  const { origin, terminal } = flowBuilderDepartments(departments);
  let next = [...steps];

  for (const dept of origin) {
    if (next.some((s) => s.dept_id === dept.id)) continue;
    const op = getOps(dept.id)[0];
    if (!op) continue;
    next.unshift({
      flow_step: 1,
      dept_id: dept.id,
      dept_name: dept.name,
      step_label: op.name,
      step_type: op.step_type,
      capture_app: resolveRouteStepCaptureApp(op.capture_app, op.step_type, dept, entitlements),
      operation_def_id: op.id,
    });
  }

  for (const dept of terminal) {
    if (next.some((s) => s.dept_id === dept.id)) continue;
    const op = getOps(dept.id)[0];
    if (!op) continue;
    next.push({
      flow_step: next.length + 1,
      dept_id: dept.id,
      dept_name: dept.name,
      step_label: op.name,
      step_type: op.step_type,
      capture_app: resolveRouteStepCaptureApp(op.capture_app, op.step_type, dept, entitlements),
      operation_def_id: op.id,
    });
  }

  return pinRouteVisitOrder(next, departments);
}

/** Reorder visit cards by group index (swap / move in the visit list). */
export function reorderVisitGroupsByIndex(
  steps: ProcessFlowStep[],
  groups: { start: number; end: number }[],
  fromGi: number,
  toGi: number,
): ProcessFlowStep[] | string {
  if (fromGi === toGi || fromGi < 0 || toGi < 0 || fromGi >= groups.length || toGi >= groups.length) {
    return steps;
  }
  const blocks = groups.map((g) => steps.slice(g.start, g.end + 1));
  const [removed] = blocks.splice(fromGi, 1);
  blocks.splice(toGi, 0, removed);
  const next = blocks.flat();
  const err = validateNoDuplicateRouteOperations(next);
  if (err) return err;
  const adjacent = validateNoAdjacentSameDeptVisits(next);
  if (adjacent) return adjacent;
  return next;
}

export function resolveNewVisitInsertIndex(
  steps: ProcessFlowStep[],
  selectedStepIdx: number | null,
  terminalIds: Set<string>,
): number {
  const firstTerminal = steps.findIndex((s) => terminalIds.has(s.dept_id));
  const maxBeforeTerminal = firstTerminal === -1 ? steps.length : firstTerminal;

  if (selectedStepIdx !== null && selectedStepIdx >= 0 && selectedStepIdx < steps.length) {
    const { end } = visitBlockBounds(steps, selectedStepIdx);
    return Math.min(end + 1, maxBeforeTerminal);
  }
  return maxBeforeTerminal;
}

/** Operations already used in the target visit (for left-panel filtering). */
export function usedOpsInVisitForDept(
  steps: ProcessFlowStep[],
  deptId: string,
  selectedStepIdx: number | null,
  terminalIds: Set<string>,
): Set<string> {
  const insertAt = resolveInsertIndex(steps, deptId, selectedStepIdx, terminalIds);
  const deptK = deptKey({ dept_id: deptId, dept_name: '' });
  let start = insertAt;
  let end = insertAt - 1;
  if (insertAt > 0 && deptKey(steps[insertAt - 1]) === deptK) {
    const bounds = deptBlockBounds(steps, insertAt - 1);
    start = bounds.start;
    end = bounds.end;
  }
  const used = new Set<string>();
  for (let k = start; k <= end; k += 1) {
    if (steps[k]?.operation_def_id) used.add(steps[k].operation_def_id);
  }
  return used;
}
