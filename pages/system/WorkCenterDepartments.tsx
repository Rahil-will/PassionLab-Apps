import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSettingsStore,
  useNavigationStore,
  useNotificationStore,
  useDataStore,
  withMutedSettingsSaveToasts,
} from '../../stores';
import { useDepartmentsCatalog, refetchSettingsCatalogSlice } from '../../lib/queries/settingsSlices';
import { useSettingsScopeLoading } from '../../lib/queries/settings';
import {
  Building2,
  Plus,
  Trash2,
  Save,
  ChevronRight,
  LayoutList,
  X,
  Loader2,
} from 'lucide-react';
import { Button, Modal } from '../../components/ui';
import { PageShell } from '../../components/layout/PageShell';
import { DepartmentEditor, UnsavedChangesModal } from '../../components/settings';
import { DesktopWriteGate } from '../../components/DesktopWriteGate';
import { duplicateNameError, duplicateNamesInList } from '../../lib/settingsValidation';
import { getErrorMessage } from '../../lib/assignedResourceDb';
import { WorkCenterEditorCard } from '../../components/layout/WorkCenterEditorCard';
import type { DefectItem, DepartmentEntity, FabricComponent } from '../../types/settings';
import type { WorkforceRateVersionDraft } from '../../lib/departmentWorkforceRates';
import { supervisorAppliesToPath } from '../../lib/departmentProductionPath';
import { deriveDepartmentAppColumnsForSave } from '../../lib/departmentAppsFromOperations';
import { composeDepartmentApps } from '../../lib/departmentAppColumns';
import {
  isOutsourcePlanningDepartment,
  isStoragePlanningDepartment,
  planningModeLabel,
  planningModePillClass,
  resolvePlanningMode,
} from '../../lib/departmentFilters';
import { DEFAULT_WORKER_ROLE_LABELS } from '../../lib/workforceCategories';

function deriveDepartmentSavePayload(
  formData: DepartmentEntity,
  store: ReturnType<typeof useSettingsStore.getState>,
) {
  const deptId = formData.id as string;
  const operationsSession = store.departmentOperationsSession;
  const ops =
    operationsSession?.deptId === deptId
      ? operationsSession.draft
      : store.getOperationsForDepartment(deptId);
  const resolvedMode = resolvePlanningMode({
    role: formData.role,
    planning_mode: formData.planning_mode,
  });
  const deptRole = (formData.role || 'standard') as DepartmentEntity['role'];
  const derived = deriveDepartmentAppColumnsForSave(ops, {
    role: deptRole,
    isNative: formData.isNative,
    planning_mode: formData.planning_mode,
    transactionEnabled: formData.transactionEnabled ?? true,
  });
  const dataToSave = {
    ...formData,
    planning_mode:
      deptRole === 'standard'
        ? resolvedMode === 'storage' || resolvedMode === 'outsource'
          ? resolvedMode
          : 'production'
        : formData.planning_mode,
    apps: composeDepartmentApps(derived),
    productionApps: derived.productionApps,
    productionPath: derived.productionPath,
    supervisorEnabled: derived.supervisorEnabled,
    auditEnabled: derived.auditEnabled,
    transactionEnabled: derived.transactionEnabled,
  };
  const isNew = (dataToSave.id as string)?.startsWith('temp_');
  return { deptId, derived, resolvedMode, dataToSave, isNew };
}

export function WorkCenterDepartments({ tabBar }: { tabBar?: React.ReactNode } = {}) {
  const store = useSettingsStore();
  const queryClient = useQueryClient();
  const refreshAssignedResources = useDataStore((s) => s.refreshAssignedResources);
  const departmentResourceSession = useSettingsStore((s) => s.departmentResourceSession);
  const departmentOperationsSession = useSettingsStore((s) => s.departmentOperationsSession);
  const { factoryId, setUnsaved: setNavUnsaved, setPendingSaveAction } = useNavigationStore();
  const { showNotification } = useNotificationStore();
  const { departments, loading: deptLoading } = useDepartmentsCatalog(factoryId, 'full');
  const settingsLoading = useSettingsScopeLoading(factoryId, 'full');
  const pageLoading = settingsLoading || deptLoading;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<DepartmentEntity | null>(null);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saveRevision, setSaveRevision] = useState(0);
  const [defectsDirty, setDefectsDirty] = useState(false);
  const [fabricCategoriesDirty, setFabricCategoriesDirty] = useState(false);
  const [ratesDirty, setRatesDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [defectsDraft, setDefectsDraft] = useState<DefectItem[]>([]);
  const [fabricCategoriesDraft, setFabricCategoriesDraft] = useState<FabricComponent[]>([]);
  const [ratesDraft, setRatesDraft] = useState<WorkforceRateVersionDraft[]>([]);

  const listItems = useMemo(() => departments, [departments]);
  const operationsDirty =
    Boolean(formData?.id)
    && (
      formData.role === 'terminal'
      || (formData.role === 'standard'
        && (resolvePlanningMode({ role: formData.role, planning_mode: formData.planning_mode }) === 'production'
          || resolvePlanningMode({ role: formData.role, planning_mode: formData.planning_mode }) === 'outsource'))
    )
    && departmentOperationsSession?.deptId === formData.id
    && Boolean(departmentOperationsSession?.draftTouched);
  const hasPendingUnsaved = isUnsaved || defectsDirty || fabricCategoriesDirty || ratesDirty || operationsDirty;

  const doSelect = (id: string, item: DepartmentEntity) => {
    const data = JSON.parse(JSON.stringify(item)) as DepartmentEntity;
    store.selectDepartmentForEdit(id);
    setDefectsDirty(false);
    setFabricCategoriesDirty(false);
    setRatesDirty(false);
    if (!id.startsWith('temp_')) {
      const isStore = isStoragePlanningDepartment({ role: data.role, planning_mode: data.planning_mode });
      if (data.role !== 'terminal' && !isStore) {
        void store.loadDepartmentResources(id, data.name as string).catch((err) => {
          showNotification(getErrorMessage(err, 'Failed to load department resources'), 'error');
        });
      }
      store.loadDepartmentOperations(id);
    }
    setSelectedId(id);
    setFormData(data);
    setIsUnsaved(false);
    setNavUnsaved(false);
  };

  const handleSelect = (id: string, item: DepartmentEntity) => {
    if (hasPendingUnsaved) {
      setPendingAction(() => () => doSelect(id, item));
      setShowUnsavedDialog(true);
      return;
    }
    doSelect(id, item);
  };

  const doCreate = () => {
    const newItem: DepartmentEntity = {
      factory_id: factoryId!,
      name: '',
      apps: ['transaction'],
      productionApps: [],
      transactionEnabled: true,
      auditEnabled: true,
      supervisorEnabled: false,
      productionPath: 'none',
      planning_mode: 'production',
      workerRoles: [...DEFAULT_WORKER_ROLE_LABELS],
      id: 'temp_' + crypto.randomUUID(),
      role: 'standard',
    };
    store.selectDepartmentForEdit(newItem.id);
    setSelectedId(newItem.id);
    setFormData(newItem);
    setIsUnsaved(true);
    setNavUnsaved(true);
  };

  const handleCreate = () => {
    if (hasPendingUnsaved) {
      setPendingAction(() => () => doCreate());
      setShowUnsavedDialog(true);
      return;
    }
    doCreate();
  };

  const handleSetFormData = (newData: Record<string, unknown>) => {
    if (newData._init) {
      const { _init, ...rest } = newData;
      setFormData((prev) => (prev ? { ...prev, ...rest } as DepartmentEntity : null));
      return;
    }
    setFormData((prev) => (prev ? { ...prev, ...newData } as DepartmentEntity : null));
    setIsUnsaved(true);
    setNavUnsaved(true);
  };

  const validateBeforeSave = (): string | null => {
    if (!formData) return null;
    const err = duplicateNameError(departments, formData.name as string, formData.id as string, 'Department name');
    if (err) return err;
    const draftResources =
      departmentResourceSession?.deptId === formData.id
        ? departmentResourceSession.draft
        : [];
    const resErr = duplicateNamesInList(draftResources, 'Resource name');
    if (resErr) return resErr;

    const { derived, resolvedMode } = deriveDepartmentSavePayload(formData, store);
    const isStore = resolvedMode === 'storage';
    const isOutsource = resolvedMode === 'outsource';
    if (
      !isStore
      && !isOutsource
      && derived.productionPath === 'hourly'
      && (formData.role || 'standard') !== 'terminal'
      && supervisorAppliesToPath(derived.productionPath)
      && !derived.supervisorEnabled
    ) {
      return 'Hourly production requires the supervisory app';
    }
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
    let savedDeptId = formData.id as string;
    try {
      const { dataToSave, resolvedMode, isNew, deptId: initialDeptId } = deriveDepartmentSavePayload(
      formData,
      store,
    );

    await withMutedSettingsSaveToasts(async () => {
      const operationsSession = departmentOperationsSession;
      let deptId = initialDeptId;

        if (isNew) {
          const { id: _id, ...rest } = dataToSave;
          deptId = await store.addDepartment({
            ...rest,
            factory_id: factoryId!,
            id: crypto.randomUUID(),
          }, defectsDirty ? defectsDraft : undefined);
          store.promoteDepartmentResourceSession(deptId);
          store.promoteDepartmentOperationsSession(deptId);
        } else {
          await store.updateDepartment(
            deptId,
            dataToSave,
            defectsDirty ? defectsDraft : undefined,
            ratesDirty ? ratesDraft : undefined,
          );
        }

        const resourceSession = departmentResourceSession;
        if (resourceSession?.deptId === deptId) {
          const resourceType = isOutsourcePlanningDepartment({
            role: formData.role,
            planning_mode: dataToSave.planning_mode as DepartmentEntity['planning_mode'],
          })
            ? 'outsourced'
            : 'inhouse';
          await store.syncDepartmentResources(
            deptId,
            factoryId!,
            { resourceType },
          );
        }

        if (
          operationsSession?.deptId === deptId
          && operationsSession.draftTouched
          && (resolvePlanningMode({ role: formData.role, planning_mode: formData.planning_mode }) === 'production'
            || resolvePlanningMode({ role: formData.role, planning_mode: formData.planning_mode }) === 'outsource'
            || resolvePlanningMode({ role: formData.role, planning_mode: formData.planning_mode }) === 'storage')
        ) {
          await store.syncDepartmentOperations(deptId, factoryId!);
        }

        if (ratesDirty) {
          await store.refreshDepartmentWorkforceRates(deptId);
        }

        if (
          fabricCategoriesDirty
          && factoryId
          && resolvePlanningMode({ role: formData.role, planning_mode: formData.planning_mode }) === 'native_cutting'
        ) {
          await store.saveFabricComponents(
            factoryId,
            deptId,
            fabricCategoriesDraft,
            store.fabricComponents,
          );
        }

        await refreshAssignedResources();
        savedDeptId = deptId;
      });

      const refreshedDepts = await refetchSettingsCatalogSlice<DepartmentEntity[]>(
        queryClient,
        factoryId!,
        'departments',
      );
      const refreshedDept = refreshedDepts.find((d) => d.id === savedDeptId);
      if (refreshedDept) {
        setSelectedId(savedDeptId);
        setFormData({ ...refreshedDept });
      }

      showNotification('Changes saved successfully', 'success');
      setIsUnsaved(false);
      setNavUnsaved(false);
      setDefectsDirty(false);
      setFabricCategoriesDirty(false);
      setRatesDirty(false);
      setSaveRevision((n) => n + 1);
      return true;
    } catch (error) {
      showNotification(getErrorMessage(error, 'Failed to save changes'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Register save handler so WorkCenters parent can trigger it from the tab-switch modal
  useEffect(() => {
    setPendingSaveAction(async () => { await handleSave(); });
    return () => setPendingSaveAction(null);
  }, [
    formData,
    factoryId,
    defectsDirty,
    defectsDraft,
    fabricCategoriesDirty,
    fabricCategoriesDraft,
    ratesDirty,
    ratesDraft,
    departmentResourceSession,
    departmentOperationsSession,
    setPendingSaveAction,
  ]);

  const requestDelete = (id: string) => {
    const dept = departments.find((d) => d.id === id);
    if (dept?.isNative) {
      showNotification('Origin and Shipment work centers cannot be deleted', 'error');
      return;
    }
    const label = (formData?.name as string) || 'this work center';
    setDeleteTarget({ id, label });
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
        store.clearDepartmentResourceSession();
        store.clearDepartmentOperationsSession();
      }
      setShowDeleteDialog(false);
      setDeleteTarget(null);
      return;
    }

    setDeleting(true);
    try {
      await store.deleteDepartment(id);
      await refreshAssignedResources();
      if (selectedId === id) {
        setSelectedId(null);
        setFormData(null);
        setIsUnsaved(false);
      }
      showNotification('Work center deleted', 'success');
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete work center';
      showNotification(message, 'error');
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
    setDefectsDirty(false);
    setFabricCategoriesDirty(false);
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
                onClick={() => requestDelete(formData.id as string)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-xs font-medium"
              >
                <Trash2 size={14} />
                Delete
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || !hasPendingUnsaved}
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
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Departments</span>
            <DesktopWriteGate>
            <button
              onClick={handleCreate}
              className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus size={16} />
            </button>
            </DesktopWriteGate>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-2 space-y-1">
            {listItems.length > 0 ? (
              listItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item.id, item)}
                  className={`p-3 rounded-lg cursor-pointer text-xs transition-all group ${
                    selectedId === item.id
                      ? 'bg-blue-50 text-blue-700 border-blue-200 border'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="font-bold truncate min-w-0">
                      {item.name || <span className="text-slate-400 italic">Untitled</span>}
                    </div>
                    <ChevronRight
                      size={14}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 ${
                        selectedId === item.id ? 'opacity-100 text-blue-500' : 'text-slate-400'
                      }`}
                    />
                  </div>
                  <div className="mt-1.5">
                    <span
                      className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${planningModePillClass(resolvePlanningMode(item))}`}
                    >
                      {planningModeLabel(resolvePlanningMode(item))}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-slate-400 italic">
                No departments yet. Click + to add.
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 w-full min-w-0 min-h-0 overflow-y-auto thin-scrollbar">
          {settingsLoading && formData ? (
            <WorkCenterEditorCard>
              <div className="flex items-center justify-center py-24 text-slate-400">
                <Loader2 size={24} className="animate-spin mr-2" />
                <span className="text-xs">Loading work center data…</span>
              </div>
            </WorkCenterEditorCard>
          ) : formData ? (
            <WorkCenterEditorCard>
            <DepartmentEditor
              formData={formData}
              resources={
                departmentResourceSession?.deptId === formData.id
                  ? departmentResourceSession.draft
                  : []
              }
              resourcesLoading={
                departmentResourceSession?.deptId === formData.id
                && departmentResourceSession.status === 'loading'
              }
              onResourcesChange={(resources) => {
                store.setDepartmentResourceDraft(resources);
                setIsUnsaved(true);
              }}
              setFormData={handleSetFormData}
              onDefectsDirtyChange={setDefectsDirty}
              onDefectsDraftChange={setDefectsDraft}
              onFabricCategoriesDirtyChange={setFabricCategoriesDirty}
              onFabricCategoriesDraftChange={setFabricCategoriesDraft}
              onRatesDirtyChange={setRatesDirty}
              onRatesDraftChange={setRatesDraft}
              saveRevision={saveRevision}
            />
            </WorkCenterEditorCard>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <LayoutList size={64} className="mb-4 opacity-20" />
              <p className="text-xs font-medium text-slate-400">Select a work center to configure</p>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
        <div className="relative">
          <button
            onClick={() => setShowDeleteDialog(false)}
            className="absolute top-4 right-4 text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full"
          >
            <X size={20} />
          </button>
          <div className="flex flex-col items-center p-8 pb-4 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ring-red-50">
              <Trash2 size={32} />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-2">Delete work center?</h3>
            <p className="text-slate-500 text-xs max-w-[280px] leading-relaxed">
              <span className="font-medium text-slate-700">{deleteTarget?.label}</span> will be
              permanently removed.
              <span className="block mt-2 text-amber-700 font-medium">
                Workers, defect catalogs, and assigned resources will also be deleted.
              </span>
            </p>
          </div>
          <div className="p-6 pt-2 flex flex-col gap-3">
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting} className="w-full py-2.5 text-xs">
              {deleting ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Delete'}
            </Button>
            <Button variant="secondary" onClick={() => setShowDeleteDialog(false)} className="w-full text-xs">
              Cancel
            </Button>
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
