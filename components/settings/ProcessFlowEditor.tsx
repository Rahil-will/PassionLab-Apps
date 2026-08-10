import React, { useEffect, useMemo, useState } from 'react';
import { useNavigationStore } from '../../stores';
import {
  useCatalogOperations,
  useDepartmentsCatalog,
  useFactoryProfileCatalog,
} from '../../lib/queries/settingsSlices';
import { Input, SelectDropdown } from '../ui';
import { DesktopWriteGate } from '../DesktopWriteGate';
import type { FactoryEntitlements } from '../../lib/factoryEntitlements';
import type { ProcessFlowStep, ProcessFlowStepType } from '../../types/settings';
import type { OperationCaptureAppId } from '../../lib/floorApps';
import {
  departmentHasAudit,
  findCatalogOpForFlowStep,
  labelForCaptureApp,
  resolveRouteStepCaptureApp,
} from '../../lib/floorApps';
import { routeStepTypeDisplay } from '../../lib/routeStepDisplay';
import { newOperationStep } from '../../lib/processFlowDb';
import {
  duplicateRouteOperationVisitIndices,
  validateNoAdjacentSameDeptVisits,
  validateNoDuplicateRouteOperations,
  validateVisitSteps,
} from '../../lib/visitPlanning';
import {
  adjustInsertForProduceLast,
  deptBlockBounds,
  ensureEndpointSteps,
  ensureVisitIds,
  flowBuilderDepartments,
  pinRouteVisitOrder,
  primaryOutputIndices,
  reorderVisitGroupsByIndex,
  resolveNewVisitInsertIndex,
  transactionIndices,
  validateInsertStep,
  visitBlockBounds,
} from '../../lib/processFlowStepFlags';
import { editorFormClass } from './editorFormStyles';
import {
  ChevronDown,
  ChevronUp,
  GitMerge,
  FileText,
  Plus,
  X,
} from 'lucide-react';

interface ProcessFlowEditorProps {
  formData: {
    name?: string;
    description?: string;
    steps?: ProcessFlowStep[];
  };
  setFormData: (d: ProcessFlowEditorProps['formData']) => void;
  mode?: 'template' | 'colorway';
}

function appNameFromOperation(
  raw: string | null | undefined,
  stepType?: ProcessFlowStepType,
): string {
  const id = (raw || '').trim();
  if (!id) return 'none';
  const label = labelForCaptureApp(id, stepType);
  if (label !== id) return label;
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function stepFromCatalogOp(
  dept: { id: string; name: string; apps?: string[]; role?: 'origin' | 'standard' | 'terminal' },
  op: { id: string; name: string; step_type: ProcessFlowStepType; capture_app: string | null },
  flowStep: number,
  visitId: string,
  entitlements: FactoryEntitlements,
): ProcessFlowStep {
  const stepType = op.step_type;
  return {
    ...newOperationStep(dept, flowStep, op.name),
    operation_def_id: op.id,
    step_type: stepType,
    capture_app: resolveRouteStepCaptureApp(op.capture_app, stepType, dept, entitlements),
    visit_id: visitId,
  };
}

function zoneForStep(
  step: ProcessFlowStep,
  originIds: Set<string>,
  terminalIds: Set<string>,
): 'origin' | 'middle' | 'terminal' {
  if (originIds.has(step.dept_id)) return 'origin';
  if (terminalIds.has(step.dept_id)) return 'terminal';
  return 'middle';
}

function outputRoleLabel(step: ProcessFlowStep, idx: number, primary: Set<number>): string {
  if ((step.step_type || 'produce') === 'produce') {
    return primary.has(idx) ? 'Primary' : 'Secondary';
  }
  return 'Secondary';
}

function RouteStepMeta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex flex-col items-start shrink-0 whitespace-nowrap leading-tight">
      <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-[10px] font-medium text-slate-700">{children}</span>
    </span>
  );
}

function VisitFooter({
  transactionOn,
  hasAudit,
  error,
}: {
  transactionOn: boolean;
  hasAudit: boolean;
  error?: string | null;
}) {
  return (
    <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-6 text-[9px] text-slate-500">
      {error ? (
        <p className="text-[10px] text-red-600 font-medium mr-auto">{error}</p>
      ) : null}
      <span>
        Transaction{' '}
        <span className={transactionOn ? 'font-semibold text-emerald-700' : 'font-medium text-slate-400'}>
          {transactionOn ? 'On' : 'Off'}
        </span>
      </span>
      <span>
        Audit{' '}
        <span className={hasAudit ? 'font-semibold text-emerald-700' : 'font-medium text-slate-400'}>
          {hasAudit ? 'On' : 'Off'}
        </span>
      </span>
    </div>
  );
}

export const ProcessFlowEditor: React.FC<ProcessFlowEditorProps> = ({
  formData,
  setFormData,
  mode = 'template',
}) => {
  const { factoryId } = useNavigationStore();
  const { departments } = useDepartmentsCatalog(factoryId, 'full');
  const { catalogOperations } = useCatalogOperations(factoryId);
  const { factoryEntitlements } = useFactoryProfileCatalog(factoryId);
  const [selectedStepIdx, setSelectedStepIdx] = useState<number | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const getOperationsForDepartment = React.useCallback(
    (deptId: string) => catalogOperations.filter((o) => o.department_id === deptId),
    [catalogOperations],
  );

  const isReadOnly = false;

  const catalogOpForStep = React.useCallback(
    (step: ProcessFlowStep) =>
      findCatalogOpForFlowStep(step, catalogOperations, departments),
    [catalogOperations, departments],
  );

  const getStepType = React.useCallback(
    (step: ProcessFlowStep) =>
      (catalogOpForStep(step)?.step_type as ProcessFlowStepType) ?? step.step_type ?? 'produce',
    [catalogOpForStep],
  );

  const steps: ProcessFlowStep[] = useMemo(
    () =>
      (formData.steps || []).map((step, idx) => {
        const op = catalogOpForStep(step);
        const dept = departments.find((d) => d.id === step.dept_id);
        const stepType = (op?.step_type as ProcessFlowStepType) || step.step_type || 'produce';
        const captureApp = op
          ? (resolveRouteStepCaptureApp(
              op.capture_app,
              stepType,
              dept,
              factoryEntitlements,
            ) as OperationCaptureAppId)
          : step.capture_app || 'transaction';
        return {
          id: step.id || crypto.randomUUID(),
          flow_step: step.flow_step || idx + 1,
          dept_id: step.dept_id || '',
          dept_name: dept?.name || step.dept_name || '',
          step_label: op?.name || step.step_label || step.dept_name || dept?.name || '',
          step_type: stepType,
          capture_app: captureApp,
          operation_def_id: op?.id || step.operation_def_id,
          visit_id: step.visit_id,
        };
      }),
    [formData.steps, catalogOperations, departments, factoryEntitlements],
  );

  const { origin, standard, terminal } = useMemo(
    () => flowBuilderDepartments(departments),
    [departments],
  );

  const originIds = useMemo(() => new Set(origin.map((d) => d.id)), [origin]);
  const terminalIds = useMemo(() => new Set(terminal.map((d) => d.id)), [terminal]);

  const primaryIdx = useMemo(() => primaryOutputIndices(steps, getStepType), [steps, getStepType]);
  const transactionIdx = useMemo(() => transactionIndices(steps, getStepType), [steps, getStepType]);

  const setSteps = (next: ProcessFlowStep[]) => {
    const withVisits = ensureVisitIds(next);
    const pinned = pinRouteVisitOrder(withVisits, departments);
    setFormData({
      ...formData,
      steps: pinned.map((s, i) => ({ ...s, flow_step: i + 1 })),
    });
  };

  useEffect(() => {
    if (isReadOnly || steps.length > 0) return;
    const seeded = ensureEndpointSteps(
      [],
      departments,
      (deptId) => getOperationsForDepartment(deptId),
      factoryEntitlements,
    );
    if (seeded.length > 0) setSteps(seeded);
  }, [isReadOnly, steps.length, departments]);

  const departmentsWithOps = useMemo(() => {
    const all = [...origin, ...standard, ...terminal];
    return all.filter((dept) => getOperationsForDepartment(dept.id).length > 0);
  }, [origin, standard, terminal, catalogOperations]);

  const insertStepAt = (insertAt: number, newStep: ProcessFlowStep) => {
    let at = insertAt;
    at = adjustInsertForProduceLast(steps, at, newStep, getStepType);
    const err = validateInsertStep(steps, at, newStep, getStepType);
    if (err) {
      setRouteError(err);
      return;
    }
    setRouteError(null);
    const next = [...steps];
    next.splice(at, 0, newStep);
    setSteps(next);
    setSelectedStepIdx(at);
  };

  const addDepartmentVisit = (deptId: string) => {
    if (isReadOnly) return;
    const dept = departments.find((d) => d.id === deptId);
    if (!dept) return;
    const usedInRoute = new Set(
      steps.map((s) => s.operation_def_id).filter((id): id is string => Boolean(id)),
    );
    const catalog = getOperationsForDepartment(deptId);

    const findIncompleteVisit = (): { start: number; end: number } | null => {
      let found: { start: number; end: number } | null = null;
      let i = 0;
      while (i < steps.length) {
        const bounds = visitBlockBounds(steps, i);
        if (steps[bounds.start].dept_id === deptId) {
          const visitSteps = steps.slice(bounds.start, bounds.end + 1);
          const hasProduce = visitSteps.some((s) => (getStepType(s) || 'produce') === 'produce');
          if (!hasProduce) found = bounds;
        }
        i = bounds.end + 1;
      }
      return found;
    };

    const incomplete = findIncompleteVisit();
    if (incomplete) {
      addOperationToVisit({ ...incomplete, deptId });
      return;
    }

    const op = catalog.find((o) => !usedInRoute.has(o.id));
    if (!op) {
      setRouteError('Every catalog operation for this work center is already in the route.');
      return;
    }

    const insertAt = resolveNewVisitInsertIndex(steps, selectedStepIdx, terminalIds);
    const visitId = crypto.randomUUID();
    insertStepAt(insertAt, stepFromCatalogOp(dept, op, steps.length + 1, visitId, factoryEntitlements));
  };

  const addOperationToVisit = (group: { start: number; end: number; deptId: string }) => {
    if (isReadOnly) return;
    const dept = departments.find((d) => d.id === group.deptId);
    if (!dept) return;
    const visitId = steps[group.start]?.visit_id || crypto.randomUUID();
    const visitSteps = steps.slice(group.start, group.end + 1);
    const usedInVisit = new Set(
      visitSteps
        .map((s) => s.operation_def_id)
        .filter((id): id is string => Boolean(id)),
    );
    const usedInRoute = new Set(
      steps.map((s) => s.operation_def_id).filter((id): id is string => Boolean(id)),
    );
    const available = getOperationsForDepartment(group.deptId)
      .filter((o) => !usedInVisit.has(o.id) && !usedInRoute.has(o.id));
    const hasLoading = visitSteps.some((s) => getStepType(s) === 'loading');
    const hasProduce = visitSteps.some((s) => (getStepType(s) || 'produce') === 'produce');
    const op =
      (!hasLoading ? available.find((o) => o.step_type === 'loading') : undefined) ||
      (hasLoading && !hasProduce ? available.find((o) => o.step_type === 'produce') : undefined) ||
      available.find((o) => (o.step_type || 'produce') !== 'produce') ||
      available[0];
    if (!op) {
      setRouteError(
        hasProduce
          ? 'Only one produce per visit — add another visit for a second produce operation.'
          : 'No more catalog operations for this visit.',
      );
      return;
    }
    if (hasProduce && (op.step_type || 'produce') === 'produce') {
      setRouteError('Only one produce per visit — add another visit for a second produce operation.');
      return;
    }
    insertStepAt(group.end + 1, stepFromCatalogOp(dept, op, steps.length + 1, visitId, factoryEntitlements));
  };

  const updateStep = (idx: number, patch: Partial<ProcessFlowStep>) => {
    const merged = { ...steps[idx], ...patch };
    const next = steps.map((s, i) => (i === idx ? merged : s));
    setRouteError(null);
    setSteps(next);
  };

  const canRemoveStep = (idx: number): boolean => {
    if (isReadOnly) return false;
    const zone = zoneForStep(steps[idx], originIds, terminalIds);
    if (zone === 'middle') return true;
    return steps.filter((s) => s.dept_id === steps[idx].dept_id).length > 1;
  };

  const removeStep = (idx: number) => {
    if (!canRemoveStep(idx)) return;
    setRouteError(null);
    setSteps(steps.filter((_, i) => i !== idx));
    if (selectedStepIdx === idx) setSelectedStepIdx(null);
  };

  const visitGroups = useMemo(() => {
    const groups: { start: number; end: number; deptName: string; deptId: string; zone: 'origin' | 'middle' | 'terminal' }[] = [];
    let i = 0;
    while (i < steps.length) {
      const { start, end } = visitBlockBounds(steps, i);
      const dept = departments.find((d) => d.id === steps[start].dept_id);
      groups.push({
        start,
        end,
        deptId: steps[start].dept_id,
        deptName: dept?.name || steps[start].dept_name,
        zone: zoneForStep(steps[start], originIds, terminalIds),
      });
      i = end + 1;
    }
    return groups;
  }, [steps, originIds, terminalIds, departments]);

  const firstOriginVisitGi = useMemo(
    () => visitGroups.findIndex((g) => originIds.has(g.deptId)),
    [visitGroups, originIds],
  );

  const canReorderVisit = (gi: number): boolean => {
    if (visitGroups[gi]?.zone === 'terminal') return false;
    if (gi === firstOriginVisitGi && firstOriginVisitGi >= 0) return false;
    return true;
  };

  const reorderVisitGroup = (fromGi: number, toGi: number) => {
    if (fromGi === toGi || isReadOnly) return;
    const from = visitGroups[fromGi];
    const to = visitGroups[toGi];
    if (from.zone === 'terminal' || to.zone === 'terminal') return;
    const result = reorderVisitGroupsByIndex(
      steps,
      visitGroups.map((g) => ({ start: g.start, end: g.end })),
      fromGi,
      toGi,
    );
    if (typeof result === 'string') {
      setRouteError(result);
      return;
    }
    setRouteError(null);
    setSteps(result);
  };

  const canMoveVisit = (gi: number, direction: -1 | 1): boolean => {
    const targetGi = gi + direction;
    if (targetGi < 0 || targetGi >= visitGroups.length) return false;
    if (!canReorderVisit(gi) || !canReorderVisit(targetGi)) return false;
    const g = visitGroups[gi];
    const t = visitGroups[targetGi];
    if (g.zone === 'terminal' || t.zone === 'terminal') return false;
    if (targetGi === firstOriginVisitGi || gi === firstOriginVisitGi) return false;
    return true;
  };

  const moveVisit = (gi: number, direction: -1 | 1) => {
    const targetGi = gi + direction;
    if (!canMoveVisit(gi, direction)) return;
    reorderVisitGroup(gi, targetGi);
  };

  const duplicateVisitGi = useMemo(
    () => duplicateRouteOperationVisitIndices(steps),
    [steps],
  );

  const visitErrors = useMemo(() => {
    const map = new Map<number, string>();
    const dupRoute = validateNoDuplicateRouteOperations(steps);
    const adjacentRoute = validateNoAdjacentSameDeptVisits(steps);
    for (let gi = 0; gi < visitGroups.length; gi += 1) {
      const g = visitGroups[gi];
      const blockErr = validateVisitSteps(steps, g.start, g.end, undefined, getStepType);
      if (blockErr) map.set(gi, blockErr);
      else if (dupRoute && duplicateVisitGi.has(gi)) map.set(gi, dupRoute);
      else if (adjacentRoute) {
        const prevSame = gi > 0 && visitGroups[gi - 1].deptId === g.deptId;
        const nextSame = gi < visitGroups.length - 1 && visitGroups[gi + 1].deptId === g.deptId;
        if (prevSame || nextSame) map.set(gi, adjacentRoute);
      }
    }
    return map;
  }, [steps, visitGroups, duplicateVisitGi, getStepType]);

  return (
    <div className={`flex flex-row bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${editorFormClass}`}>
      <div className="w-[34%] max-w-xs shrink-0 flex flex-col border-r border-slate-100">
        <div className="shrink-0 px-4 py-4 border-b border-slate-100 space-y-4">
          <div>
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              <GitMerge size={15} />
              {mode === 'colorway' ? 'Color routing' : 'Routing template'}
            </h4>
            <p className="text-[10px] text-slate-400 mt-1">
              Add work centers only. Pick operations in the route builder. Store visits hold WIP between departments.
            </p>
          </div>
          <Input
            label="Name"
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Standard Production"
            disabled={isReadOnly}
            className="bg-white"
          />
          <div>
            <label className="block font-medium text-slate-700 mb-1.5 flex items-center gap-1.5 text-[11px]">
              <FileText size={12} className="text-slate-400" />
              Description
            </label>
            <textarea
              rows={3}
              placeholder="When should planners use this routing?"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              disabled={isReadOnly}
              className="w-full px-3 py-2 rounded-lg border bg-white border-slate-300 focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 disabled:bg-slate-50 resize-none text-[11px]"
            />
          </div>
        </div>

        <DesktopWriteGate>
        {!isReadOnly && (
          <div className="px-4 py-6 pb-8 border-t border-slate-100 space-y-5 flex-1 overflow-y-auto thin-scrollbar">
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 block mb-4">Add work center</span>
            <div className="flex flex-wrap gap-2">
              {departmentsWithOps.map((dept) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => addDepartmentVisit(dept.id)}
                  className="px-2.5 py-1.5 text-[10px] font-medium rounded-full border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50"
                >
                  + {dept.name}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Click a work center to add a visit. One produce per visit; repeat a work center in a new visit with a different catalog operation. Use + Operation inside the card for loading or other steps in the same visit.
            </p>
            {routeError && <p className="text-[10px] text-red-600">{routeError}</p>}
          </div>
        )}
        </DesktopWriteGate>
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between shrink-0">
          <h4 className="text-xs font-bold text-slate-800">Route sequence</h4>
          <span className="text-[10px] text-slate-500">{steps.length} operations</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-3 space-y-1 w-full">
          {steps.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-6 text-center">No steps yet.</p>
          ) : (
            visitGroups.map((group, gi) => {
              const dept = departments.find((d) => d.id === group.deptId);
              const hasAudit = departmentHasAudit(dept?.apps, factoryEntitlements);
              const visitTxOn = transactionIdx.has(group.end);
              const hasVisitError = visitErrors.has(gi);

              return (
                <div key={`${group.deptName}-${group.start}`}>
                  <div className={`rounded-lg border overflow-hidden ${
                    hasVisitError
                      ? 'border-red-300 ring-1 ring-red-200'
                      : group.zone === 'origin'
                        ? 'border-emerald-200'
                        : group.zone === 'terminal'
                          ? 'border-violet-200'
                          : 'border-slate-200'
                  }`}>
                    <div className={`px-3 py-1.5 text-[10px] font-bold border-b flex items-center justify-between gap-2 ${
                      hasVisitError
                        ? 'bg-red-50 text-red-800 border-red-100'
                        : group.zone === 'origin'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                          : group.zone === 'terminal'
                            ? 'bg-violet-50 text-violet-800 border-violet-100'
                            : 'bg-slate-50 text-slate-800 border-slate-100'
                    }`}>
                      <span className="truncate min-w-0">{group.deptName}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        <DesktopWriteGate>
                        {!isReadOnly && canReorderVisit(gi) && (
                          <>
                            <button
                              type="button"
                              disabled={!canMoveVisit(gi, -1)}
                              onClick={() => moveVisit(gi, -1)}
                              className="p-0.5 rounded hover:bg-white/80 disabled:opacity-30"
                              title="Move visit up"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              disabled={!canMoveVisit(gi, 1)}
                              onClick={() => moveVisit(gi, 1)}
                              className="p-0.5 rounded hover:bg-white/80 disabled:opacity-30"
                              title="Move visit down"
                            >
                              <ChevronDown size={12} />
                            </button>
                          </>
                        )}
                        </DesktopWriteGate>
                        <DesktopWriteGate>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => addOperationToVisit(group)}
                            className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[9px] font-semibold rounded-full border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"
                          >
                            <Plus size={10} /> Operation
                          </button>
                        )}
                        </DesktopWriteGate>
                      </span>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {steps.slice(group.start, group.end + 1).map((step, offset) => {
                        const idx = group.start + offset;
                        const catalogOpts = getOperationsForDepartment(step.dept_id);
                        const resolvedOp =
                          findCatalogOpForFlowStep(step, catalogOpts, departments) ||
                          catalogOpts[0];
                        const resolvedStepType =
                          (resolvedOp?.step_type as ProcessFlowStepType) || step.step_type || 'produce';
                        const visitProduceCount = steps
                          .slice(group.start, group.end + 1)
                          .filter((s) => (getStepType(s) || 'produce') === 'produce').length;
                        const roleLabel = outputRoleLabel(step, idx, primaryIdx);
                        const showOutputTag =
                          visitProduceCount >= 2 && resolvedStepType === 'produce';
                        const resolvedOpId = resolvedOp?.id || '';
                        const isTerminalStep = group.zone === 'terminal';

                        const isSelected = selectedStepIdx === idx;

                        return (
                          <div
                            key={`${idx}-${step.operation_def_id}`}
                            onClick={() => !isReadOnly && setSelectedStepIdx(idx)}
                            className={`px-3 py-2 ${isSelected ? 'bg-blue-50/60' : 'bg-white'} ${!isReadOnly ? 'cursor-pointer' : ''}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                                {step.flow_step}
                              </span>
                              <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto no-scrollbar">
                                <div className="w-[12rem] shrink-0">
                                  {isReadOnly ? (
                                    <p className="text-[11px] font-semibold text-slate-800 truncate px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200">
                                      {resolvedOp?.name || step.step_label}
                                    </p>
                                  ) : (
                                    <DesktopWriteGate>
                                    <SelectDropdown
                                      value={resolvedOpId}
                                      options={catalogOpts.map((o) => ({ value: o.id, label: o.name }))}
                                      onChange={(opId) => {
                                        const op = catalogOpts.find((o) => o.id === opId);
                                        if (!op) return;
                                        const dept = departments.find((d) => d.id === step.dept_id);
                                        updateStep(idx, {
                                          operation_def_id: op.id,
                                          step_label: op.name,
                                          step_type: op.step_type,
                                          capture_app: resolveRouteStepCaptureApp(
                                            op.capture_app,
                                            op.step_type,
                                            dept,
                                            factoryEntitlements,
                                          ),
                                        });
                                      }}
                                      size="compact"
                                      className="w-full"
                                    />
                                    </DesktopWriteGate>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0 text-[10px] border-l border-slate-200 pl-3 ml-2">
                                  <RouteStepMeta label="Step">
                                    {routeStepTypeDisplay(resolvedStepType, isTerminalStep)}
                                  </RouteStepMeta>
                                  <span className="w-px h-5 bg-slate-200" aria-hidden />
                                  <RouteStepMeta label="App">
                                    {appNameFromOperation(
                                      resolvedOp?.capture_app || step.capture_app,
                                      resolvedStepType,
                                    )}
                                  </RouteStepMeta>
                                  {!isTerminalStep && resolvedStepType !== 'loading' && showOutputTag && (
                                    <>
                                      <span className="w-px h-5 bg-slate-200" aria-hidden />
                                      <RouteStepMeta label="Output">
                                        <span className={`inline-block font-semibold px-1.5 py-0.5 rounded-full text-[9px] ${
                                          primaryIdx.has(idx) ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'
                                        }`}>
                                          {roleLabel}
                                        </span>
                                      </RouteStepMeta>
                                    </>
                                  )}
                                </div>
                              </div>
                              <DesktopWriteGate>
                              {!isReadOnly && canRemoveStep(idx) && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); removeStep(idx); }}
                                  className="p-0.5 text-slate-400 hover:text-red-600 shrink-0 ml-auto"
                                >
                                  <X size={12} />
                                </button>
                              )}
                              </DesktopWriteGate>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <VisitFooter
                      transactionOn={visitTxOn}
                      hasAudit={hasAudit}
                      error={visitErrors.get(gi)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
