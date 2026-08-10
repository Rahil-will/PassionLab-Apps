import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  GitMerge,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { LineAllocation, StyleOrder } from '../../types/production';
import type { DepartmentEntity, ProcessFlow } from '../../types/settings';
import { SelectDropdown, Modal } from '../ui';
import { libraryProcessFlows, newOperationStep } from '../../lib/processFlowDb';
import { saveOrderRoutingSteps } from '../../lib/colorwayRouting';
import { supabase } from '../../lib/supabase';
import {
  enrichRoutingStepDept,
  mergeLockedDepartments,
  resequenceRoutingSteps,
  routingStepsFromTemplate,
  applyTransactionAppFlags,
  computeTransactionAppFlags,
  fetchOrderRoutingSteps,
  enrichRoutingStepsWithCatalog,
  enrichRoutingStepFromCatalog,
  parseCaptureApp,
  parseRoutingStepType,
  type OrderRoutingStepRow,
} from '../../lib/orderRoutingEditor';
import { routeAppDisplay, routeStepTypeDisplay } from '../../lib/routeStepDisplay';
import { sortDepartmentsForDisplay } from '../../lib/departmentFilters';
import {
  operationsByDepartmentId,
  type OperationRow,
} from '../../lib/operationsDb';
import {
  departmentHasAudit,
  labelForCaptureApp,
} from '../../lib/floorApps';
import { OPERATION_STEP_TYPE_LABELS } from '../../lib/operationsDb';
import {
  affectedVisitIdsAfterRouteSave,
  collectRouteValidationAlerts,
  ensureRoutingVisitIds,
  groupRoutingRowsByVisit,
  groupStepsByVisit,
  routingRowToFlowStep,
  sortVisitStepsForDisplay,
  validateAllVisits,
  validateNoAdjacentSameDeptVisits,
  type RouteVisitGroup,
} from '../../lib/visitPlanning';
import { useNavigationStore, useNotificationStore } from '../../stores';
import { useFactoryProfileCatalog, useCatalogOperations } from '../../lib/queries/settingsSlices';

const ROUTING_CARD_H = 'h-[9rem]';

function RouteCardFooter({
  transactionOn,
  hasAudit,
  locked,
}: {
  transactionOn: boolean;
  hasAudit: boolean;
  locked?: boolean;
}) {
  return (
    <div className="px-3 py-2 shrink-0 border-t border-slate-100 bg-slate-50/80 flex flex-col gap-1 text-[9px] text-slate-500">
      <div className="flex items-center justify-end gap-4">
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
      {locked && (
        <div className="text-right">
          <span className="font-medium text-amber-600" title="Production has started for this department">
            Locked
          </span>
        </div>
      )}
    </div>
  );
}

interface OrderRoutingEditorProps {
  order: StyleOrder;
  processFlows: ProcessFlow[];
  departments: DepartmentEntity[];
  savedSteps: OrderRoutingStepRow[];
  lockedDeptIds: Set<string>;
  planAllocations?: LineAllocation[];
  onRoutingUpdated: (affectedVisitIds: string[]) => void | Promise<void>;
}

function productionCaptureLabel(captureApp: string, stepType?: string): string {
  if (captureApp === 'transaction') return '—';
  return labelForCaptureApp(captureApp, stepType as 'loading' | 'produce' | 'store' | 'outsource' | undefined);
}

function stepCompositeKey(s: Pick<OrderRoutingStepRow, 'dept_id' | 'dept_name' | 'operation_name'>): string {
  const dept = (s.dept_id || s.dept_name || '').trim().toLowerCase();
  const op = (s.operation_name || '').trim().toLowerCase();
  return `${dept}|${op}`;
}

/** Catalog ops selectable for a step — excludes ops already used elsewhere in the route. */
function operationDropdownOptions(
  step: OrderRoutingStepRow,
  visitSteps: OrderRoutingStepRow[],
  allSteps: OrderRoutingStepRow[],
  deptOps: OperationRow[],
): Array<{ value: string; label: string }> {
  const usedElsewhere = new Set(
    allSteps
      .filter((x) => x.id !== step.id && x.operation_def_id)
      .map((x) => x.operation_def_id as string),
  );
  const visitHasOtherProduce = visitSteps.some(
    (x) => x.id !== step.id && (x.step_type || 'produce') === 'produce',
  );

  const filtered = deptOps.filter((op) => {
    if (usedElsewhere.has(op.id)) return false;
    if (
      visitHasOtherProduce
      && (op.step_type || 'produce') === 'produce'
      && step.operation_def_id !== op.id
    ) {
      return false;
    }
    return true;
  });

  const currentId = step.operation_def_id;
  if (currentId && !filtered.some((o) => o.id === currentId)) {
    const current = deptOps.find((o) => o.id === currentId);
    if (current) filtered.unshift(current);
  }

  return filtered.map((op) => ({ value: op.id, label: op.name }));
}

function reorderVisitGroupsInSteps(
  steps: OrderRoutingStepRow[],
  fromGi: number,
  toGi: number,
): OrderRoutingStepRow[] | string {
  if (fromGi === toGi || fromGi < 0 || toGi < 0) return steps;
  const groups = groupStepsByVisit(steps);
  if (fromGi >= groups.length || toGi >= groups.length) return steps;
  const blocks = groups.map((g) => steps.slice(g.start, g.end + 1));
  const [removed] = blocks.splice(fromGi, 1);
  blocks.splice(toGi, 0, removed);
  const next = resequenceRoutingSteps(blocks.flat());
  const adjacent = validateNoAdjacentSameDeptVisits(next.map(routingRowToFlowStep));
  if (adjacent) return adjacent;
  return next;
}

export const OrderRoutingEditor: React.FC<OrderRoutingEditorProps> = ({
  order,
  processFlows,
  departments,
  savedSteps,
  lockedDeptIds,
  planAllocations = [],
  onRoutingUpdated,
}) => {
  const { showNotification } = useNotificationStore();
  const { factoryId } = useNavigationStore();
  const { factoryEntitlements } = useFactoryProfileCatalog(factoryId);
  const { catalogOperations: catalogOpsFromQuery } = useCatalogOperations(factoryId);

  const [busy, setBusy] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [draftSteps, setDraftSteps] = useState<OrderRoutingStepRow[]>([]);
  const [draggedVisitGi, setDraggedVisitGi] = useState<number | null>(null);
  const [dropVisitGi, setDropVisitGi] = useState<number | null>(null);
  const [catalogOps, setCatalogOps] = useState<OperationRow[]>([]);
  const [showPlanOverwriteModal, setShowPlanOverwriteModal] = useState(false);
  const [pendingAffectedVisitIds, setPendingAffectedVisitIds] = useState<string[]>([]);

  useEffect(() => {
    if (!factoryId) {
      setCatalogOps([]);
      return;
    }
    setCatalogOps(catalogOpsFromQuery);
  }, [factoryId, catalogOpsFromQuery]);

  // Refresh catalog ops when starting to edit (bootstrap order-form scope loads via App)
  useEffect(() => {
    if (!factoryId || !isEditing) return;
    setCatalogOps(catalogOpsFromQuery);
  }, [factoryId, isEditing, catalogOpsFromQuery]);

  const catalogOpsByDept = useMemo(
    () => operationsByDepartmentId(catalogOps),
    [catalogOps],
  );

  const templates = useMemo(
    () => libraryProcessFlows(processFlows),
    [processFlows],
  );

  const deptList = useMemo(
    () => departments.map((d) => ({ id: d.id, name: d.name, role: d.role })),
    [departments],
  );

  const isRouted = savedSteps.length > 0;

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  const templateOptions = useMemo(
    () => templates.map((t) => ({
      value: t.id,
      label: t.name,
    })),
    [templates],
  );

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  const previewSteps = useMemo(() => {
    if (!selectedTemplate) return [];
    return enrichRoutingStepsWithCatalog(
      routingStepsFromTemplate(selectedTemplate, deptList),
      catalogOps,
    );
  }, [selectedTemplate, deptList, catalogOps]);

  const enrichedSavedSteps = useMemo(
    () => enrichRoutingStepsWithCatalog(
      savedSteps.map((s) => enrichRoutingStepDept(s, deptList)),
      catalogOps,
    ),
    [savedSteps, deptList, catalogOps],
  );

  const displaySteps = useMemo(() => {
    if (!isEditing) {
      if (!isRouted) return [];
      return applyTransactionAppFlags(mergeLockedDepartments(enrichedSavedSteps, lockedDeptIds));
    }
    const base = draftSteps.length > 0
      ? draftSteps
      : isRouted
        ? enrichedSavedSteps
        : previewSteps;
    return applyTransactionAppFlags(mergeLockedDepartments(base, lockedDeptIds));
  }, [isEditing, draftSteps, isRouted, enrichedSavedSteps, previewSteps, lockedDeptIds]);

  const transactionFlags = useMemo(
    () => computeTransactionAppFlags(displaySteps),
    [displaySteps],
  );

  const visitGroups = useMemo(
    () => groupRoutingRowsByVisit(displaySteps),
    [displaySteps],
  );

  const routeAlerts = useMemo(() => {
    if (!isEditing || displaySteps.length === 0) return [];
    const alerts: string[] = [];
    for (const s of displaySteps) {
      if (!s.operation_def_id) {
        const msg = `Select a catalog operation for ${s.dept_name}`;
        if (!alerts.includes(msg)) alerts.push(msg);
      }
    }
    const flowSteps = displaySteps.map(routingRowToFlowStep);
    for (const msg of collectRouteValidationAlerts(flowSteps)) {
      if (!alerts.includes(msg)) alerts.push(msg);
    }
    return alerts;
  }, [isEditing, displaySteps]);

  const sortedDepts = useMemo(
    () => sortDepartmentsForDisplay(departments),
    [departments],
  );

  useEffect(() => {
    setDraftSteps([]);
    setIsEditing(false);
    setSelectedTemplateId('');
  }, [order.id, isRouted, savedSteps]);

  const applyTemplateToDraft = useCallback((templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) {
      setDraftSteps([]);
      return;
    }
    setDraftSteps(
      enrichRoutingStepsWithCatalog(
        routingStepsFromTemplate(tpl, deptList),
        catalogOps,
      ),
    );
  }, [templates, deptList, catalogOps]);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!isEditing) return;
    applyTemplateToDraft(templateId);
  };

  const operationsForDept = (deptId: string | null): OperationRow[] => {
    if (!deptId) return [];
    return catalogOpsByDept.get(deptId) ?? [];
  };

  const buildStepsToSave = useCallback((): OrderRoutingStepRow[] => {
    return applyTransactionAppFlags(
      ensureRoutingVisitIds(
        (draftSteps.length > 0 ? draftSteps : displaySteps).map((s) =>
          enrichRoutingStepDept(s, deptList),
        ),
      ),
    );
  }, [draftSteps, displaySteps, deptList]);

  const updateStep = useCallback((id: string, patch: Partial<OrderRoutingStepRow>) => {
    setDraftSteps((prev) => {
      const base = prev.length > 0 ? prev : displaySteps;
      return base.map((s) => {
        if (s.id !== id || s.locked) return s;
        const next = { ...s, ...patch };
        if (patch.operation_name !== undefined) next.operation_name = patch.operation_name;
        return next;
      });
    });
    if (!isEditing) setIsEditing(true);
  }, [displaySteps, isEditing]);

  const moveVisitDrag = useCallback((fromGi: number, toGi: number) => {
    if (fromGi === toGi) return;
    const lastGi = visitGroups.length - 1;
    // Origin (first) and terminal (last) are pinned — cannot move them or into their slots.
    if (fromGi === 0 || fromGi === lastGi) return;
    if (toGi === 0 || toGi > lastGi - 1) return;
    const fromGroup = visitGroups[fromGi];
    if (fromGroup?.steps.some((s) => s.locked)) return;

    setDraftSteps((prev) => {
      const base = prev.length > 0 ? prev : displaySteps;
      const result = reorderVisitGroupsInSteps(base, fromGi, toGi);
      if (typeof result === 'string') {
        showNotification(result, 'error');
        return base;
      }
      return result;
    });
    if (!isEditing) setIsEditing(true);
  }, [displaySteps, visitGroups, isEditing, showNotification]);

  const removeStep = useCallback((id: string) => {
    setDraftSteps((prev) => {
      const base = prev.length > 0 ? prev : displaySteps;
      const step = base.find((s) => s.id === id);
      if (step?.locked) return base;
      return resequenceRoutingSteps(base.filter((s) => s.id !== id));
    });
    if (!isEditing) setIsEditing(true);
  }, [displaySteps, isEditing]);

  const removeVisit = useCallback((group: RouteVisitGroup<OrderRoutingStepRow>) => {
    if (group.steps.some((s) => s.locked)) return;
    setDraftSteps((prev) => {
      const base = prev.length > 0 ? prev : displaySteps;
      const removeIds = new Set(group.steps.map((s) => s.id));
      return resequenceRoutingSteps(base.filter((s) => !removeIds.has(s.id)));
    });
    if (!isEditing) setIsEditing(true);
  }, [displaySteps, isEditing]);

  const addOperationToVisit = useCallback((group: RouteVisitGroup<OrderRoutingStepRow>) => {
    if (group.steps.some((s) => s.locked)) return;
    const base = draftSteps.length > 0 ? draftSteps : displaySteps;
    const visitSteps = group.steps;
    const deptId = group.deptId;
    const dept = deptById.get(deptId);
    if (!dept) return;

    const usedInVisit = new Set(
      visitSteps.map((s) => s.operation_def_id).filter((id): id is string => Boolean(id)),
    );
    const usedInRoute = new Set(
      base.map((s) => s.operation_def_id).filter((id): id is string => Boolean(id)),
    );
    const deptOps = catalogOpsByDept.get(deptId) ?? [];
    const available = deptOps.filter((o) => !usedInVisit.has(o.id) && !usedInRoute.has(o.id));
    const hasLoading = visitSteps.some((s) => s.step_type === 'loading');
    const hasProduce = visitSteps.some((s) => (s.step_type || 'produce') === 'produce');
    const catalogOp =
      (!hasLoading ? available.find((o) => o.step_type === 'loading') : undefined) ||
      (hasLoading && !hasProduce ? available.find((o) => o.step_type === 'produce') : undefined) ||
      available.find((o) => (o.step_type || 'produce') !== 'produce') ||
      available[0];

    if (!catalogOp) {
      showNotification(
        hasProduce
          ? 'Only one produce per visit — add another visit for a second produce operation.'
          : 'No more operations for this visit.',
        'error',
      );
      return;
    }
    if (hasProduce && (catalogOp.step_type || 'produce') === 'produce') {
      showNotification('Only one produce per visit — add another visit for a second produce operation.', 'error');
      return;
    }

    const lastStep = visitSteps[visitSteps.length - 1];
    const pfStep = newOperationStep(dept, base.length + 1, catalogOp.name);
    const row = enrichRoutingStepFromCatalog(
      enrichRoutingStepDept(
        {
          id: crypto.randomUUID(),
          seq: base.length + 1,
          flow_step: base.length + 1,
          operation_def_id: catalogOp.id,
          dept_id: pfStep.dept_id || null,
          dept_name: pfStep.dept_name,
          step_type: parseRoutingStepType(catalogOp.step_type || pfStep.step_type),
          capture_app: parseCaptureApp(catalogOp.capture_app || pfStep.capture_app),
          operation_name: catalogOp.name,
          visit_id: group.visitId,
        },
        deptList,
      ),
      catalogOpsByDept,
    );

    setDraftSteps((prev) => {
      const cur = prev.length > 0 ? prev : displaySteps;
      const insertIdx = cur.findIndex((s) => s.id === lastStep.id) + 1;
      return resequenceRoutingSteps([...cur.slice(0, insertIdx), row, ...cur.slice(insertIdx)]);
    });
    if (!isEditing) setIsEditing(true);
  }, [
    draftSteps,
    displaySteps,
    deptById,
    catalogOpsByDept,
    deptList,
    isEditing,
    showNotification,
  ]);

  const addDepartment = useCallback((dept: DepartmentEntity) => {
    const base = draftSteps.length > 0 ? draftSteps : displaySteps;
    const usedInRoute = new Set(
      base.map((s) => s.operation_def_id).filter((id): id is string => Boolean(id)),
    );
    const deptOps = catalogOpsByDept.get(dept.id) ?? [];

    const groups = groupRoutingRowsByVisit(base);
    const incomplete = groups.find(
      (g) =>
        g.deptId === dept.id
        && !g.steps.some((s) => (s.step_type || 'produce') === 'produce'),
    );
    if (incomplete) {
      addOperationToVisit(incomplete);
      return;
    }

    const catalogOp = deptOps.find((o) => !usedInRoute.has(o.id));
    if (!catalogOp) {
      showNotification('Every catalog operation for this work center is already in the route.', 'error');
      return;
    }

    const pfStep = newOperationStep(dept, base.length + 1, catalogOp.name);
    const row = enrichRoutingStepFromCatalog(
      enrichRoutingStepDept(
        {
          id: crypto.randomUUID(),
          seq: base.length + 1,
          flow_step: base.length + 1,
          operation_def_id: catalogOp.id,
          dept_id: pfStep.dept_id || null,
          dept_name: pfStep.dept_name,
          step_type: parseRoutingStepType(catalogOp.step_type || pfStep.step_type),
          capture_app: parseCaptureApp(catalogOp.capture_app || pfStep.capture_app),
          operation_name: catalogOp.name,
          visit_id: crypto.randomUUID(),
        },
        deptList,
      ),
      catalogOpsByDept,
    );
    setDraftSteps((prev) => {
      const base = prev.length > 0 ? prev : displaySteps;
      const groups = groupRoutingRowsByVisit(base);
      const terminalGroup = groups.find((g) => {
        const terminalDept = deptList.find((d) => d.id === g.deptId);
        return terminalDept?.role === 'terminal';
      });
      if (terminalGroup?.steps[0]) {
        const insertIdx = base.findIndex((s) => s.id === terminalGroup.steps[0].id);
        if (insertIdx >= 0) {
          return resequenceRoutingSteps([
            ...base.slice(0, insertIdx),
            row,
            ...base.slice(insertIdx),
          ]);
        }
      }
      return resequenceRoutingSteps([...base, row]);
    });
    if (!isEditing) setIsEditing(true);
  }, [
    displaySteps,
    isEditing,
    deptList,
    draftSteps,
    catalogOpsByDept,
    addOperationToVisit,
    showNotification,
  ]);

  const validateSteps = (steps: OrderRoutingStepRow[]): string | null => {
    for (const s of steps) {
      if (!s.operation_def_id) {
        return `Select a catalog operation for ${s.dept_name}`;
      }
    }
    return validateAllVisits(steps.map(routingRowToFlowStep));
  };

  const performSave = async (affectedVisitIds: string[]) => {
    if (!factoryId || displaySteps.length === 0) return;
    const stepsToSave = buildStepsToSave();
    const err = validateSteps(stepsToSave);
    if (err) {
      showNotification(err, 'error');
      return;
    }
    setBusy(true);
    try {
      await saveOrderRoutingSteps(
        factoryId,
        order.id,
        stepsToSave.map((s) => {
          const flow = routingRowToFlowStep(s);
          return {
            ...flow,
            id: s.id,
            operation_name: s.operation_name,
            operation_def_id: s.operation_def_id ?? undefined,
            transaction_app: s.transaction_app,
            visit_id: s.visit_id ?? undefined,
          };
        }),
        undefined,
        savedSteps,
      );
      await onRoutingUpdated(affectedVisitIds);
      setIsEditing(false);
      setDraftSteps([]);
      showNotification(isRouted ? 'Order routing updated' : 'Order routing applied', 'success');
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Failed to save routing', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    if (!factoryId || displaySteps.length === 0) return;
    const stepsToSave = buildStepsToSave();
    const affectedVisitIds = isRouted
      ? affectedVisitIdsAfterRouteSave(enrichedSavedSteps, stepsToSave)
      : [
          ...new Set(
            planAllocations
              .map((a) => a.visitId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
    const affectedAllocationCount = planAllocations.filter(
      (a) => a.visitId && affectedVisitIds.includes(a.visitId),
    ).length;
    if (affectedAllocationCount > 0) {
      setPendingAffectedVisitIds(affectedVisitIds);
      setShowPlanOverwriteModal(true);
      return;
    }
    void performSave(affectedVisitIds);
  };

  const confirmPlanOverwrite = () => {
    setShowPlanOverwriteModal(false);
    void performSave(pendingAffectedVisitIds);
  };

  const pendingAffectedAllocationCount = planAllocations.filter(
    (a) => a.visitId && pendingAffectedVisitIds.includes(a.visitId),
  ).length;

  const startEdit = () => {
    if (isRouted) {
      setDraftSteps(enrichedSavedSteps);
      setSelectedTemplateId('');
    } else {
      const firstTpl = templates[0]?.id ?? '';
      setSelectedTemplateId(firstTpl);
      if (firstTpl) applyTemplateToDraft(firstTpl);
      else setDraftSteps([]);
    }
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraftSteps([]);
    setIsEditing(false);
    setSelectedTemplateId('');
  };

  const canSave = isEditing && displaySteps.length > 0 && routeAlerts.length === 0;
  const saveLabel = isRouted ? 'Save route' : 'Apply route';
  const showEditButton = !isEditing;

  const onVisitDragStart = (e: React.DragEvent, gi: number) => {
    if (!isEditing || visitGroups[gi]?.steps.some((s) => s.locked)) return;
    setDraggedVisitGi(gi);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(gi));
  };

  const onVisitDragOver = (e: React.DragEvent, gi: number) => {
    e.preventDefault();
    if (draggedVisitGi === null || !isEditing) return;
    setDropVisitGi(gi);
  };

  const onVisitDrop = (e: React.DragEvent, gi: number) => {
    e.preventDefault();
    if (draggedVisitGi === null || !isEditing) return;
    moveVisitDrag(draggedVisitGi, gi);
    setDraggedVisitGi(null);
    setDropVisitGi(null);
  };

  const onVisitDragEnd = () => {
    setDraggedVisitGi(null);
    setDropVisitGi(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        {isRouted ? (
          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 inline-flex items-center gap-1 shrink-0">
            <Check size={10} /> Route applied
          </span>
        ) : (
          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 inline-flex items-center gap-1 shrink-0">
            <AlertCircle size={10} /> Apply a route to start planning
          </span>
        )}
        {isEditing && (
          <>
            <SelectDropdown
              value={selectedTemplateId}
              onChange={handleTemplateChange}
              options={[
                { value: '', label: isRouted ? 'Custom' : '— Select template —' },
                ...templateOptions,
              ]}
              size="compact"
              className="w-56"
            />
            {selectedTemplate?.description && (
              <>
                <span className="text-slate-300">|</span>
                <span className="text-[11px] text-slate-500 max-w-md truncate" title={selectedTemplate.description}>
                  {selectedTemplate.description}
                </span>
              </>
            )}
          </>
        )}
        <div className="flex-1" />
        {showEditButton && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <Pencil size={12} /> {isRouted ? 'Edit route' : 'Choose route'}
          </button>
        )}
        {isEditing && (
          <button
            type="button"
            onClick={cancelEdit}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] text-slate-500 hover:text-slate-700"
          >
            <X size={12} /> Cancel edit
          </button>
        )}
      </div>

      {displaySteps.length > 0 ? (
        <div className="pb-2">
          {isEditing && visitGroups.length > 1 && (
            <p className="text-[9px] text-slate-400 mb-1.5">Drag visits left or right to reorder</p>
          )}
          <div
            className={`flex items-stretch py-1 ${
              isEditing ? 'flex-nowrap overflow-x-auto thin-scrollbar gap-y-2' : 'flex-wrap gap-y-2'
            }`}
          >
            {visitGroups.map((group, gi) => {
              const sortedSteps = sortVisitStepsForDisplay<OrderRoutingStepRow>(group.steps);
              const dept = group.deptId ? deptById.get(group.deptId) : undefined;
              const hasAudit = departmentHasAudit(dept?.apps, factoryEntitlements);
              const isLast = gi === visitGroups.length - 1;
              const isFirst = gi === 0;
              const deptName = group.deptName || dept?.name || 'Department';
              const isTerminalDept = dept?.role === 'terminal';
              const isPinned = isFirst || isLast;
              const lastStep = group.steps[group.steps.length - 1];
              const lastFlatIdx = displaySteps.findIndex((s) => s.id === lastStep?.id);
              const transactionOn = transactionFlags[lastFlatIdx] ?? lastStep?.transaction_app ?? true;
              const visitLocked = group.steps.some((s) => s.locked);
              const editable = isEditing && !visitLocked;

              const isDropTarget = dropVisitGi === gi && draggedVisitGi !== null && draggedVisitGi !== gi;
              const isDragging = draggedVisitGi === gi;

              return (
                <div
                  key={group.visitId}
                  className={`flex items-center shrink-0 ${isDragging ? 'opacity-40' : ''} ${
                    isDropTarget ? 'ring-2 ring-blue-400 ring-offset-1 rounded-xl' : ''
                  }`}
                  onDragOver={(e) => onVisitDragOver(e, gi)}
                  onDrop={(e) => onVisitDrop(e, gi)}
                  onDragEnd={onVisitDragEnd}
                >
                  <div
                    title={visitLocked ? 'Production has started for this department' : undefined}
                    className={`flex flex-col ${ROUTING_CARD_H} rounded-xl border-2 overflow-hidden shadow-sm shrink-0 ${
                      group.steps.length > 1 ? 'min-w-[10rem]' : 'w-40'
                    } ${visitLocked ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}
                  >
                    <div className="px-2.5 py-1.5 bg-slate-100/80 border-b border-slate-200 shrink-0 flex items-center justify-between gap-1 min-w-0">
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        {editable && !isPinned && (
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => onVisitDragStart(e, gi)}
                            className="p-0.5 rounded cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 shrink-0 touch-none"
                            title="Drag to reorder"
                          >
                            <GripVertical size={12} />
                          </button>
                        )}
                        <span className="text-[10px] font-bold text-slate-800 truncate" title={deptName}>
                          {deptName}
                        </span>
                        {isPinned && isEditing && (
                          <span className="text-[8px] font-medium text-slate-400 ml-1 shrink-0" title={isFirst ? 'Origin cannot be removed' : 'Terminal cannot be removed'}>
                            {isFirst ? 'Origin' : 'Terminal'}
                          </span>
                        )}
                      </div>
                      {editable && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => addOperationToVisit(group)}
                            className="p-0.5 rounded hover:bg-white/80 text-slate-500 hover:text-blue-600 shrink-0"
                            title="Add operation to this visit"
                          >
                            <Plus size={12} />
                          </button>
                          {!isPinned && (
                            <button
                              type="button"
                              onClick={() => removeVisit(group)}
                              className="p-0.5 rounded hover:bg-white/80 text-slate-400 hover:text-red-500 shrink-0"
                              title="Remove this visit"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-h-0 flex flex-row divide-x divide-slate-100">
                      {sortedSteps.map((s) => {
                        const deptOps = operationsForDept(s.dept_id);
                        const isStorageStep = s.step_type === 'store' || s.step_type === 'outsource';
                        const isLoading = s.step_type === 'loading';
                        const operationName = s.operation_name || deptName;
                        const stepEditable = editable && !s.locked;
                        const typeLabel = routeStepTypeDisplay(s.step_type, isTerminalDept).toUpperCase();
                        const appLabel = routeAppDisplay(
                          s.capture_app || 'transaction',
                          s.step_type,
                          isTerminalDept,
                        );

                        return (
                          <div key={s.id} className="flex-1 min-w-[6.5rem] px-2 py-2 flex flex-col min-h-0">
                            <div className="flex items-start justify-between gap-1">
                              {stepEditable && deptOps.length > 0 ? (
                                <SelectDropdown
                                  value={s.operation_def_id || deptOps[0]?.id || ''}
                                  options={operationDropdownOptions(s, group.steps, displaySteps, deptOps)}
                                  onChange={(opId) => {
                                    const op = deptOps.find((o) => o.id === opId);
                                    if (!op) return;
                                    updateStep(s.id, {
                                      operation_def_id: op.id,
                                      operation_name: op.name,
                                      step_type: parseRoutingStepType(op.step_type),
                                      capture_app: parseCaptureApp(op.capture_app),
                                    });
                                  }}
                                  size="compact"
                                  className="w-full"
                                />
                              ) : (
                                <p className="text-[10px] font-semibold text-slate-800 leading-tight truncate" title={operationName}>
                                  {operationName}
                                </p>
                              )}
                              {stepEditable && !(isPinned && sortedSteps.length <= 1) && (
                                <button
                                  type="button"
                                  onClick={() => removeStep(s.id)}
                                  className="p-0.5 text-slate-400 hover:text-red-500 rounded shrink-0"
                                  title="Remove operation"
                                >
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </div>
                            <p className="text-[9px] font-bold uppercase text-slate-400 mt-1.5">{typeLabel}</p>
                            <div className="mt-1 text-[10px] min-h-[1.25rem]">
                              <span className="font-medium text-slate-600" title="From operation catalog">
                                {appLabel}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <RouteCardFooter transactionOn={transactionOn} hasAudit={hasAudit} locked={visitLocked} />
                  </div>
                  {!isLast && (
                    <div className="flex items-center px-1.5 text-slate-300 shrink-0 self-center">
                      <ArrowRight size={14} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="py-8 text-center text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-lg">
          {isEditing
            ? 'Select a process flow above to preview the route.'
            : isRouted
              ? 'No routing steps to display.'
              : 'No route applied. Choose route to pick a process flow template.'}
        </div>
      )}

      {isEditing && routeAlerts.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 space-y-1">
          {routeAlerts.map((msg) => (
            <p key={msg} className="text-[10px] text-red-700 flex items-start gap-1.5">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{msg}</span>
            </p>
          ))}
        </div>
      )}

      <div className="flex items-end justify-between gap-4 flex-wrap border-t border-slate-100 pt-3">
        {isEditing ? (
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Add department</span>
            <div className="flex flex-wrap gap-1.5">
              {sortedDepts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => addDepartment(d)}
                  className="px-3 py-1.5 text-[10px] font-medium rounded-full border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50"
                >
                  + {d.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <button
          type="button"
          onClick={() => handleSave()}
          disabled={!canSave || busy}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[11px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 shrink-0 shadow-sm"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
          {saveLabel}
        </button>
      </div>

      <Modal isOpen={showPlanOverwriteModal} onClose={() => setShowPlanOverwriteModal(false)}>
        <div className="p-6 max-w-md">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <AlertCircle size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Clear planning for changed visits?</h3>
              <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                {pendingAffectedAllocationCount.toLocaleString()} saved allocation
                {pendingAffectedAllocationCount === 1 ? '' : 's'} on changed or removed visits will be cleared.
                <span className="block text-xs text-slate-500 mt-1">
                  Removing a visit from the route clears its line allocations. Operations can change within a visit without losing the plan.
                </span>
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPlanOverwriteModal(false)}
              className="px-3 py-2 text-[11px] font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmPlanOverwrite}
              disabled={busy}
              className="px-3 py-2 text-[11px] font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              Save route
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export async function fetchOrderRoutingState(
  factoryId: string,
  orderId: string,
): Promise<{ steps: OrderRoutingStepRow[]; lockedDeptIds: Set<string> }> {
  const steps = await fetchOrderRoutingSteps(orderId, factoryId);

  const [
    outputRes,
    qcRes,
    batchRes,
    owmRes,
    cuttingRes,
    shipmentRes,
    lineAllocRes,
  ] = await Promise.all([
    supabase
      .from('hourly_counts')
      .select('line_allocation_id, order_route_id, department_id')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .gt('count', 0),
    supabase
      .from('inspection_sessions')
      .select('line_allocation_id, order_route_id, department_id')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .gt('passed', 0),
    supabase
      .from('batch_production')
      .select('line_allocation_id, order_route_id, department_id')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .gt('produced_qty', 0),
    supabase
      .from('outsource_work_movements')
      .select('line_allocation_id, order_route_id, department_id')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .eq('movement_type', 'vendor_receive')
      .is('voided_at', null)
      .gt('qty', 0),
    supabase
      .from('cutting_sessions')
      .select('line_allocation_id, order_route_id, department_id')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .gt('total_qty', 0),
    supabase
      .from('shipments')
      .select('order_route_id')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId)
      .gt('shipped_qty', 0),
    supabase
      .from('line_allocations')
      .select('id, department_id')
      .eq('factory_id', factoryId)
      .eq('order_id', orderId),
  ]);

  for (const res of [outputRes, qcRes, batchRes, owmRes, cuttingRes, shipmentRes, lineAllocRes]) {
    if (res.error) throw res.error;
  }

  const routeDeptById = new Map(steps.map((s) => [s.id, s.dept_id || '']));
  const lineAllocDeptById = new Map(
    (lineAllocRes.data || []).map((r: { id: string; department_id: string }) => [r.id, r.department_id]),
  );
  const visitsPerDept = new Map<string, Set<string>>();
  for (const step of steps) {
    const deptId = step.dept_id || '';
    if (!deptId) continue;
    const visitKey = step.visit_id || step.id;
    if (!visitsPerDept.has(deptId)) visitsPerDept.set(deptId, new Set());
    visitsPerDept.get(deptId)!.add(visitKey);
  }
  const locked = new Set<string>();

  const addDept = (deptId: string | null | undefined) => {
    if (deptId) locked.add(deptId);
  };

  const resolveDept = (row: {
    line_allocation_id?: string;
    order_route_id?: string;
    department_id?: string;
  }): string | undefined => {
    const fromLine = row.line_allocation_id ? lineAllocDeptById.get(row.line_allocation_id) : undefined;
    if (fromLine) return fromLine;
    const fromRoute = row.order_route_id ? routeDeptById.get(row.order_route_id) : undefined;
    if (fromRoute) return fromRoute;
    if (row.department_id) {
      const visits = visitsPerDept.get(row.department_id);
      if (visits && visits.size === 1) return row.department_id;
    }
    return undefined;
  };

  for (const row of (outputRes.data || []) as { line_allocation_id?: string; order_route_id?: string; department_id?: string }[]) {
    addDept(resolveDept(row));
  }
  for (const row of (qcRes.data || []) as { line_allocation_id?: string; order_route_id?: string; department_id?: string }[]) {
    addDept(resolveDept(row));
  }
  for (const row of (batchRes.data || []) as { line_allocation_id?: string; order_route_id?: string; department_id?: string }[]) {
    addDept(resolveDept(row));
  }
  for (const row of (owmRes.data || []) as { line_allocation_id?: string; order_route_id?: string; department_id?: string }[]) {
    addDept(resolveDept(row));
  }
  for (const row of (cuttingRes.data || []) as { line_allocation_id?: string; order_route_id?: string; department_id?: string }[]) {
    addDept(resolveDept(row));
  }
  for (const row of (shipmentRes.data || []) as { order_route_id?: string }[]) {
    const deptId = routeDeptById.get(row.order_route_id || '');
    if (deptId) locked.add(deptId);
  }

  return {
    steps,
    lockedDeptIds: locked,
  };
}
