import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSettingsStore,
  useNavigationStore,
  useNotificationStore,
} from '../../stores';
import {
  GitMerge,
  Plus,
  Trash2,
  Save,
  ChevronRight,
  LayoutList,
  X,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Button, Modal } from '../../components/ui';
import { PageShell } from '../../components/layout/PageShell';
import { ProcessFlowEditor, UnsavedChangesModal } from '../../components/settings';
import { DesktopWriteGate } from '../../components/DesktopWriteGate';
import {
  useCatalogOperations,
  useDepartmentsCatalog,
  useProcessFlowsCatalog,
  useFactoryProfileCatalog,
  refetchSettingsCatalogSlice,
} from '../../lib/queries/settingsSlices';
import { useSettingsScopeLoading } from '../../lib/queries/settings';
import { isLibraryTemplate } from '../../lib/processFlowDb';
import { duplicateNameError } from '../../lib/settingsValidation';
import {
  captureAppValidForRouteStep,
  effectiveRouteStepFromCatalog,
  explainCaptureAppValidationFailure,
  findCatalogOpForFlowStep,
  findDepartmentForFlowStep,
} from '../../lib/floorApps';
import { supabaseErrorMessage } from '../../lib/supabaseError';
import { validateAllVisits } from '../../lib/visitPlanning';
import type { FactoryEntitlements } from '../../lib/factoryEntitlements';
import type { OperationRow } from '../../lib/operationsDb';
import type { DepartmentEntity, ProcessFlow, ProcessFlowStep } from '../../types/settings';

function newProcessFlowDraft(factoryId: string): ProcessFlow {
  return {
    factory_id: factoryId,
    name: '',
    description: '',
    steps: [],
    id: 'temp_' + crypto.randomUUID(),
  };
}

function normalizeStepsForSave(
  steps: ProcessFlowStep[] | undefined,
  departments: DepartmentEntity[],
  entitlements: FactoryEntitlements,
  catalogOperations: OperationRow[],
): ProcessFlowStep[] {
  return (steps ?? []).map((step) => {
    const dept = findDepartmentForFlowStep(step, departments);
    const catalogOp = findCatalogOpForFlowStep(step, catalogOperations, departments);
    const { stepType, captureApp } = effectiveRouteStepFromCatalog(
      step,
      catalogOp,
      dept,
      entitlements,
    );
    const needsNewId = !step.id || step.id.startsWith('temp_') || step.id.startsWith('new_');
    if (needsNewId) {
      step.id = crypto.randomUUID();
    }
    return {
      ...step,
      id: step.id,
      dept_id: dept?.id ?? step.dept_id,
      dept_name: dept?.name ?? step.dept_name,
      operation_def_id: catalogOp?.id ?? step.operation_def_id,
      step_label: catalogOp?.name ?? step.step_label ?? step.dept_name ?? dept?.name ?? '',
      step_type: stepType,
      capture_app: captureApp,
    };
  });
}

export function WorkCenterProcessFlows({ tabBar }: { tabBar?: React.ReactNode } = {}) {
  const store = useSettingsStore();
  const queryClient = useQueryClient();
  const { factoryId, setUnsaved: setNavUnsaved, setPendingSaveAction } = useNavigationStore();
  const { showNotification } = useNotificationStore();
  const { processFlows, loading: flowsLoading } = useProcessFlowsCatalog(factoryId);
  const { departments, loading: deptLoading } = useDepartmentsCatalog(factoryId, 'full');
  const { catalogOperations } = useCatalogOperations(factoryId);
  const { factoryEntitlements } = useFactoryProfileCatalog(factoryId);
  const settingsLoading = useSettingsScopeLoading(factoryId, 'full');
  const pageLoading = settingsLoading || flowsLoading || deptLoading;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProcessFlow | null>(null);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const listItems = useMemo(
    () => processFlows.filter((pf) => isLibraryTemplate(pf as ProcessFlow)),
    [processFlows],
  );

  const doSelect = (id: string, item: ProcessFlow) => {
    setSelectedId(id);
    const cloned = JSON.parse(JSON.stringify(item)) as ProcessFlow;
    cloned.steps = normalizeStepsForSave(
      cloned.steps,
      departments,
      factoryEntitlements,
      catalogOperations,
    );
    setFormData(cloned);
    setIsUnsaved(false);
    setNavUnsaved(false);
  };

  const handleSelect = (id: string, item: ProcessFlow) => {
    if (isUnsaved) {
      setPendingAction(() => () => doSelect(id, item));
      setShowUnsavedDialog(true);
      return;
    }
    doSelect(id, item);
  };

  const doCreate = () => {
    const newItem = newProcessFlowDraft(factoryId!);
    setSelectedId(newItem.id);
    setFormData(newItem);
    setIsUnsaved(true);
    setNavUnsaved(true);
  };

  const handleCreate = () => {
    if (isUnsaved) {
      setPendingAction(() => () => doCreate());
      setShowUnsavedDialog(true);
      return;
    }
    doCreate();
  };

  const handleSetFormData = (newData: Parameters<typeof ProcessFlowEditor>[0]['formData']) => {
    setFormData((prev) => (prev ? { ...prev, ...newData } : null));
    setIsUnsaved(true);
    setNavUnsaved(true);
  };

  const validateBeforeSave = (): string | null => {
    if (!formData) return null;
    if (!formData.name?.trim()) {
      return 'Process flow name is required';
    }
    const peers = processFlows.filter((pf) =>
      isLibraryTemplate(pf as ProcessFlow),
    );
    const nameErr = duplicateNameError(peers, formData.name, formData.id, 'Process flow name');
    if (nameErr) return nameErr;
    const steps = normalizeStepsForSave(
      formData.steps,
      departments,
      factoryEntitlements,
      catalogOperations,
    );
    const getStepType = (s: ProcessFlowStep) =>
      findCatalogOpForFlowStep(s, catalogOperations, departments)?.step_type ??
      s.step_type ??
      'produce';

    for (const step of steps) {
      const dept = findDepartmentForFlowStep(step, departments);
      const catalogOp = findCatalogOpForFlowStep(step, catalogOperations, departments);
      if (!captureAppValidForRouteStep(
        step,
        dept,
        factoryEntitlements,
        catalogOp,
        catalogOperations,
      )) {
        return explainCaptureAppValidationFailure(
          step,
          dept,
          factoryEntitlements,
          catalogOp,
          catalogOperations,
        );
      }
      const catalogOps = dept ? store.getOperationsForDepartment(dept.id) : [];
      if (catalogOps.length > 0) {
        const match = findCatalogOpForFlowStep(step, catalogOps, departments);
        if (!match) {
          const label = catalogOp?.name ?? step.step_label ?? step.dept_name ?? 'Unknown';
          return `Operation "${label}" must exist in the ${dept?.name ?? step.dept_name} catalog`;
        }
      }
    }
    const labelCounts = new Map<string, { count: number; label: string; visitId: string }>();
    for (const step of steps) {
      const catalogOp = findCatalogOpForFlowStep(step, catalogOperations, departments);
      const label = (catalogOp?.name ?? step.step_label ?? '').trim().toLowerCase();
      if (!label) continue;
      const visitId = String(step.visit_id ?? '__none__');
      const key = `${visitId}|${label}`;
      const existing = labelCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        labelCounts.set(key, { count: 1, label, visitId });
      }
    }
    const dup = [...labelCounts.values()].find((v) => v.count > 1);
    if (dup) {
      return `Duplicate operation label "${dup.label}" in visit ${dup.visitId}. Each step in a visit must have a unique label.`;
    }
    const visitErr = validateAllVisits(steps, getStepType);
    if (visitErr) return visitErr;
    return null;
  };

  const handleSave = async (): Promise<boolean> => {
    if (!formData) return false;
    const validationError = validateBeforeSave();
    if (validationError) {
      showNotification(validationError, 'error');
      return false;
    }

    setSaving(true);
    try {
      const dataToSave = {
        ...formData,
        factory_id: formData.factory_id || factoryId!,
        steps: normalizeStepsForSave(
          formData.steps,
          departments,
          factoryEntitlements,
          catalogOperations,
        ),
      };
      if (!dataToSave.factory_id) {
        showNotification('Factory not selected', 'error');
        return false;
      }

      if (dataToSave.id?.startsWith('temp_')) {
        const { id: _id, ...rest } = dataToSave;
        const newId = await store.addProcessFlow({
          ...rest,
          name: dataToSave.name.trim(),
        });
        const refreshedFlows = await refetchSettingsCatalogSlice<ProcessFlow[]>(
          queryClient,
          factoryId!,
          'processFlows',
        );
        const saved = refreshedFlows.find((pf) => pf.id === newId);
        setSelectedId(newId);
        setFormData(saved ? (JSON.parse(JSON.stringify(saved)) as ProcessFlow) : { ...dataToSave, id: newId });
      } else {
        await store.updateProcessFlow(dataToSave.id, {
          ...dataToSave,
          name: dataToSave.name.trim(),
        });
      }

      showNotification('Changes saved successfully', 'success');
      setIsUnsaved(false);
      setNavUnsaved(false);
      return true;
    } catch (err) {
      showNotification(supabaseErrorMessage(err), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Register save handler so WorkCenters parent can trigger it from the tab-switch modal
  useEffect(() => {
    setPendingSaveAction(async () => { await handleSave(); });
    return () => setPendingSaveAction(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, factoryId]);

  const requestDelete = (id: string) => {
    setDeleteTarget({ id, label: formData?.name || 'this flow' });
    setShowDeleteDialog(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;

    if (id.startsWith('temp_')) {
      if (selectedId === id) {
        setSelectedId(null);
        setFormData(null);
        setIsUnsaved(false);
      }
      setShowDeleteDialog(false);
      setDeleteTarget(null);
      return;
    }

    setDeleting(true);
    try {
      await store.deleteProcessFlow(id);
      if (selectedId === id) {
        setSelectedId(null);
        setFormData(null);
        setIsUnsaved(false);
      }
      showNotification('Process flow deleted', 'success');
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    } catch {
      showNotification('Failed to delete process flow', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const confirmSave = async () => {
    const saved = await handleSave();
    if (!saved) return;
    setShowUnsavedDialog(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const confirmDiscard = () => {
    setShowUnsavedDialog(false);
    setIsUnsaved(false);
    setNavUnsaved(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const cancelNavigation = () => {
    setShowUnsavedDialog(false);
    setPendingAction(null);
  };

  return (
    <PageShell loading={pageLoading} skeleton="list" className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden bg-slate-50">
      <div className="shrink-0 z-20 bg-slate-50 pt-3 pb-3">
        <div className="flex items-center justify-between bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-1 px-1.5">
            {tabBar}
          </div>
          {formData && (
            <DesktopWriteGate>
            <div className="flex items-center gap-2 px-2">
              <button
                onClick={() => requestDelete(formData.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-xs font-medium"
              >
                <Trash2 size={14} />
                Delete
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || !formData.name || !isUnsaved}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </div>
            </DesktopWriteGate>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden gap-6">
        <div className="w-72 max-h-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Process Flows</span>
              <DesktopWriteGate>
              <button
                onClick={handleCreate}
                className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Plus size={16} />
              </button>
              </DesktopWriteGate>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-2 space-y-1">
            {listItems.length > 0 ? (
              listItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item.id, item as ProcessFlow)}
                  className={`p-3 rounded-lg cursor-pointer text-xs transition-all group ${
                    selectedId === item.id
                      ? 'bg-blue-50 text-blue-700 border-blue-200 border'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="font-bold flex justify-between items-center">
                    <span>
                      {item.name || <span className="text-slate-400 italic">Untitled</span>}
                    </span>
                    <ChevronRight
                      size={14}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                        selectedId === item.id ? 'opacity-100 text-blue-500' : 'text-slate-400'
                      }`}
                    />
                  </div>
                  {item.steps && (
                    <div className="text-[10px] opacity-70 mt-0.5">
                      {new Set(item.steps.map((s) => s.visit_id)).size} visits · {item.steps.length} steps
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-slate-400 italic">
                No process flows yet. Click + to add.
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 w-full min-w-0 min-h-0 overflow-y-auto thin-scrollbar">
          {formData ? (
            <div>
              <ProcessFlowEditor
              formData={formData}
              setFormData={handleSetFormData}
              />
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <LayoutList size={64} className="mb-4 opacity-20" />
              <p className="text-xs font-medium text-slate-400">Select a process flow to edit</p>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
        <div className="relative">
          <button onClick={() => setShowDeleteDialog(false)} className="absolute top-4 right-4 text-slate-400 hover:text-red-600 p-1 hover:bg-red-50 rounded-full">
            <X size={20} />
          </button>
          <div className="flex flex-col items-center p-8 pb-4 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4">
              <Trash2 size={32} />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-2">Delete process flow?</h3>
            <p className="text-slate-500 text-xs">
              <span className="font-medium text-slate-700">{deleteTarget?.label}</span> will be permanently removed.
            </p>
          </div>
          <div className="p-6 pt-2 flex flex-col gap-3">
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting} className="w-full text-xs">
              {deleting ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Delete'}
            </Button>
            <Button variant="secondary" onClick={() => setShowDeleteDialog(false)} className="w-full text-xs">Cancel</Button>
          </div>
        </div>
      </Modal>

      <UnsavedChangesModal
        isOpen={showUnsavedDialog}
        onClose={cancelNavigation}
        onSave={confirmSave}
        onDiscard={confirmDiscard}
      />
    </PageShell>
  );
}
