import React, { useState, useEffect, useMemo } from 'react';
import { Input, Button, Spinner, SelectDropdown } from '../ui';
import { tokens } from '../../lib/designTokens';
import { editorFormClass } from './editorFormStyles';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from './CatalogTablePanel';
import { useSettingsStore, useNavigationStore } from '../../stores';
import {
  useAppConfigurationCatalog,
  useCatalogOperations,
  useFactoryProfileCatalog,
  useShiftsCatalog,
} from '../../lib/queries/settingsSlices';
import type { DepartmentResource } from '../../types/settings';
import { EditorSplitLayout } from './EditorSplitLayout';
import { departmentEditorAppOptions } from '../../lib/floorApps';
import { DEFAULT_WORKER_ROLE_LABELS } from '../../lib/workforceCategories';
import {
  normalizeProductionPath,
  supervisorAppliesToPath,
  type DepartmentProductionPath,
} from '../../lib/departmentProductionPath';
import {
  deriveDepartmentAppColumnsForSave,
  derivePassiveDepartmentAppColumns,
} from '../../lib/departmentAppsFromOperations';
import {
  buildReferenceOperationDraft,
} from '../../lib/departmentReferenceOperations';
import {
  fetchDepartmentWorkforceRates,
  ratesToVersionDrafts,
  startOfMonth,
  type WorkforceRateVersionDraft,
} from '../../lib/departmentWorkforceRates';
import { composeDepartmentApps } from '../../lib/departmentAppColumns';
import { DefectsEditor } from './DefectsEditor';
import { FabricComponentsEditor } from './FabricComponentsEditor';
import { DepartmentOperationsPanel } from './DepartmentOperationsPanel';
import { DepartmentWorkforcePanel } from './DepartmentWorkforcePanel';
import { DesktopWriteGate } from '../DesktopWriteGate';
import type { OperationRow } from '../../lib/operationsDb';
import { departmentRoleLabel, isOutsourcePlanningDepartment, isStoragePlanningDepartment, planningModeLabel, planningModePillClass, resolvePlanningMode } from '../../lib/departmentFilters';
import type { DefectItem, DepartmentPlanningMode, FabricComponent } from '../../types/settings';
import {
  Factory,
  Plus,
  Trash2,
  X,
  ClipboardList,
  Bug,
  Pencil,
  Check,
  Layers,
} from 'lucide-react';

interface DepartmentEditorProps {
  formData: {
    id: string;
    name: string;
    sequence?: number;
    apps?: string[];
    workerRoles?: string[];
    role?: 'origin' | 'standard' | 'terminal';
    productionPath?: DepartmentProductionPath;
    isNative?: boolean;
    transactionEnabled?: boolean;
    auditEnabled?: boolean;
    supervisorEnabled?: boolean;
    productionApps?: string[];
    planning_mode?: DepartmentPlanningMode;
  };
  resources: DepartmentResource[];
  resourcesLoading: boolean;
  onResourcesChange: (resources: DepartmentResource[]) => void;
  setFormData: (d: Record<string, unknown>) => void;
  onDefectsDirtyChange?: (dirty: boolean) => void;
  onDefectsDraftChange?: (defects: DefectItem[]) => void;
  onFabricCategoriesDirtyChange?: (dirty: boolean) => void;
  onFabricCategoriesDraftChange?: (rows: FabricComponent[]) => void;
  onRatesDirtyChange?: (dirty: boolean) => void;
  onRatesDraftChange?: (drafts: WorkforceRateVersionDraft[]) => void;
  saveRevision?: number;
}

type DeptSectionTab = 'operations' | 'resources' | 'fabric-categories' | 'defects';

const DEPT_SECTION_TABS: { id: DeptSectionTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'operations', label: 'Operations', icon: ClipboardList },
  { id: 'resources', label: 'Resources', icon: Factory },
  { id: 'fabric-categories', label: 'Fabric categories', icon: Layers },
  { id: 'defects', label: 'Defects', icon: Bug },
];

type SelectablePlanningMode = 'production' | 'storage' | 'outsource';

const PLANNING_MODE_OPTIONS: { value: SelectablePlanningMode; label: string }[] = [
  { value: 'production', label: 'Production' },
  { value: 'storage', label: 'Store' },
  { value: 'outsource', label: 'Outsource' },
];

function formPlanningMode(formData: DepartmentEditorProps['formData']): SelectablePlanningMode {
  const mode = formData.planning_mode;
  if (mode === 'storage') return 'storage';
  if (mode === 'outsource') return 'outsource';
  return 'production';
}

export const DepartmentEditor: React.FC<DepartmentEditorProps> = ({
  formData,
  resources,
  resourcesLoading,
  onResourcesChange,
  setFormData,
  onDefectsDirtyChange,
  onDefectsDraftChange,
  onFabricCategoriesDirtyChange,
  onFabricCategoriesDraftChange,
  onRatesDirtyChange,
  onRatesDraftChange,
  saveRevision = 0,
}) => {
  const [lineForm, setLineForm] = useState<Partial<DepartmentResource> | null>(null);
  const [sectionTab, setSectionTab] = useState<DeptSectionTab>('operations');
  const [editingName, setEditingName] = useState(false);
  const [nameBeforeEdit, setNameBeforeEdit] = useState('');
  const [roleRates, setRoleRates] = useState<WorkforceRateVersionDraft[]>([]);
  const [ratesLoaded, setRatesLoaded] = useState(false);

  const factoryId = useNavigationStore((s) => s.factoryId);
  const { factoryEntitlements } = useFactoryProfileCatalog(factoryId);
  const { shifts, loading: shiftsLoading } = useShiftsCatalog(factoryId, 'full');
  const { catalogOperations, loading: opsLoading } = useCatalogOperations(factoryId);
  const { appConfiguration } = useAppConfigurationCatalog(factoryId);
  const settingsLoading = shiftsLoading || opsLoading;
  const departmentWorkforceByDept = useSettingsStore((s) => s.departmentWorkforceByDept);
  const setDepartmentWorkforceDrafts = useSettingsStore((s) => s.setDepartmentWorkforceDrafts);
  const departmentOperationsSession = useSettingsStore((s) => s.departmentOperationsSession);
  const setDepartmentOperationsDraft = useSettingsStore((s) => s.setDepartmentOperationsDraft);

  const isNative = Boolean(formData.isNative);
  const deptRole = formData.role || 'standard';
  const isTerminal = deptRole === 'terminal';
  const isNameLocked = isNative;
  const isTempDept = !formData.id || formData.id.startsWith('temp_');
  const effectivePlanningMode = resolvePlanningMode({ role: deptRole, planning_mode: formData.planning_mode });
  const isStoreDept = isStoragePlanningDepartment({ role: deptRole, planning_mode: formData.planning_mode });
  const isOutsourceDept = isOutsourcePlanningDepartment({ role: deptRole, planning_mode: formData.planning_mode });
  const showOperationsTab = !isTempDept;
  const canEditPlanningMode = deptRole === 'standard' && !isNameLocked;

  const departmentOperations = useMemo(() => {
    if (!formData.id) return [];
    if (departmentOperationsSession?.deptId === formData.id) {
      return departmentOperationsSession.draft;
    }
    return catalogOperations.filter((o) => o.department_id === formData.id);
  }, [formData.id, departmentOperationsSession, catalogOperations]);

  const derivedFromOps = useMemo(
    () => deriveDepartmentAppColumnsForSave(departmentOperations, {
      role: deptRole,
      isNative,
      planning_mode: formData.planning_mode,
      transactionEnabled: formData.transactionEnabled ?? true,
    }),
    [departmentOperations, deptRole, isNative, formData.planning_mode, formData.transactionEnabled],
  );

  const productionPath = normalizeProductionPath(
    derivedFromOps.productionPath,
    derivedFromOps.productionApps,
    deptRole,
    isNative,
  );
  const isCuttingOrigin = effectivePlanningMode === 'native_cutting';
  const showWorkforce = !isStoreDept && !isOutsourceDept && !isTerminal
    && supervisorAppliesToPath(productionPath);
  const showSupervisorInOps = showWorkforce && !isCuttingOrigin;

  const showAudit = useMemo(
    () => departmentEditorAppOptions(factoryEntitlements).some((o) => o.id === 'audit'),
    [factoryEntitlements],
  );

  const applyDerivedToForm = (
    derived: ReturnType<typeof deriveDepartmentAppColumnsForSave>,
    extra: Record<string, unknown> = {},
  ) => {
    setFormData({
      ...formData,
      ...extra,
      apps: composeDepartmentApps(derived),
      productionApps: derived.productionApps,
      productionPath: derived.productionPath,
      transactionEnabled: derived.transactionEnabled,
      auditEnabled: derived.auditEnabled,
      supervisorEnabled: derived.supervisorEnabled,
    });
  };

  const handlePlanningModeChange = (mode: SelectablePlanningMode) => {
    if (formData.id && factoryId && !formData.id.startsWith('temp_')) {
      if (mode === 'storage') {
        setDepartmentOperationsDraft([
          buildReferenceOperationDraft(factoryId, formData.id, 'store'),
        ]);
      } else if (mode === 'outsource') {
        const hasOutsource = departmentOperations.some((op) => op.step_type === 'outsource');
        if (!hasOutsource) {
          setDepartmentOperationsDraft([
            ...departmentOperations.filter((op) => op.step_type !== 'store'),
            buildReferenceOperationDraft(factoryId, formData.id, 'outsource'),
          ]);
        }
      } else if (mode === 'production') {
        setDepartmentOperationsDraft(
          departmentOperations.filter((op) => op.step_type === 'loading' || op.step_type === 'produce'),
        );
      }
    }
    const derived = mode === 'storage' || mode === 'outsource'
      ? derivePassiveDepartmentAppColumns({
        transactionEnabled: formData.transactionEnabled ?? true,
        planning_mode: mode,
        operations: departmentOperations,
      })
      : deriveDepartmentAppColumnsForSave(departmentOperations, {
        role: deptRole,
        isNative,
        planning_mode: 'production',
        transactionEnabled: formData.transactionEnabled ?? true,
      });
    applyDerivedToForm(derived, { planning_mode: mode });
  };

  const handleOperationsChange = (operations: OperationRow[]) => {
    setDepartmentOperationsDraft(operations);
    const derived = deriveDepartmentAppColumnsForSave(operations, {
      role: deptRole,
      isNative,
      planning_mode: formData.planning_mode,
      transactionEnabled: formData.transactionEnabled ?? true,
    });
    applyDerivedToForm(derived);
  };

  useEffect(() => {
    if (!formData.id || formData.id.startsWith('temp_')) {
      setRoleRates(
        DEFAULT_WORKER_ROLE_LABELS.map((label, i) => ({
          id: `temp_${i}`,
          label,
          effectiveFrom: startOfMonth(),
          isCurrent: true,
          sortOrder: i,
          ratesByShift: {},
        })),
      );
      setRatesLoaded(true);
      return;
    }
    if (settingsLoading) {
      setRatesLoaded(false);
      return;
    }
    const cached = departmentWorkforceByDept[formData.id];
    if (cached) {
      setRoleRates(cached);
      onRatesDraftChange?.(cached);
      setRatesLoaded(true);
      return;
    }
    setRatesLoaded(false);
    let cancelled = false;
    void fetchDepartmentWorkforceRates(formData.id, { currentOnly: false })
      .then((rows) => {
        if (cancelled) return;
        const drafts = ratesToVersionDrafts(rows);
        setDepartmentWorkforceDrafts(formData.id, drafts);
        setRoleRates(drafts);
        onRatesDraftChange?.(drafts);
        setRatesLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setRatesLoaded(true);
      });
    return () => { cancelled = true; };
  }, [formData.id, saveRevision, settingsLoading, departmentWorkforceByDept, setDepartmentWorkforceDrafts]);

  const addResourceLocally = () => {
    if (!lineForm || !lineForm.resourceName?.trim()) return;
    const trimmedName = lineForm.resourceName.trim();
    const nameKey = trimmedName.toLowerCase();
    if (resources.some(
      (r) => r.id !== lineForm.id && String(r.resourceName).trim().toLowerCase() === nameKey,
    )) {
      return;
    }
    const newResource: DepartmentResource = {
      id: lineForm.id || crypto.randomUUID(),
      resourceName: trimmedName,
      description: (lineForm.description ?? '').trim(),
      departmentName: formData.name,
      departmentId: formData.id,
      defaultPcs: lineForm.defaultPcs || 500,
    };
    const next = lineForm.id
      ? resources.map((r) => (r.id === lineForm.id ? newResource : r))
      : [...resources, newResource];
    onResourcesChange(next);
    setLineForm(null);
  };

  const deleteResourceLocally = (id: string) => {
    onResourcesChange(resources.filter((r) => r.id !== id));
  };

  const visibleSectionTabs = useMemo(() => {
    if (isTerminal) {
      return DEPT_SECTION_TABS.filter((tab) => tab.id === 'operations' || tab.id === 'defects');
    }
    return DEPT_SECTION_TABS.filter((tab) => {
      if (tab.id === 'operations') return showOperationsTab;
      if (tab.id === 'resources') return !isStoreDept;
      if (tab.id === 'fabric-categories') {
        return isCuttingOrigin && !isTempDept && Boolean(onFabricCategoriesDirtyChange);
      }
      if (tab.id === 'defects') {
        return !isTempDept && Boolean(onDefectsDirtyChange) && !isStoreDept;
      }
      return true;
    });
  }, [
    isTempDept,
    onDefectsDirtyChange,
    onFabricCategoriesDirtyChange,
    deptRole,
    isTerminal,
    showOperationsTab,
    isStoreDept,
    isCuttingOrigin,
  ]);

  useEffect(() => {
    if (!visibleSectionTabs.some((t) => t.id === sectionTab)) {
      setSectionTab(visibleSectionTabs[0]?.id ?? 'operations');
    }
  }, [visibleSectionTabs, sectionTab, formData.id]);

  useEffect(() => {
    if (isTempDept) {
      setSectionTab(isStoreDept ? 'operations' : 'resources');
    } else if (isTerminal) {
      setSectionTab('operations');
    } else if (isStoreDept) {
      setSectionTab('operations');
    } else if (isOutsourceDept) {
      setSectionTab('operations');
    } else {
      setSectionTab('operations');
    }
  }, [formData.id, isTempDept, isTerminal, isStoreDept, isOutsourceDept]);

  useEffect(() => {
    setEditingName(isTempDept);
  }, [formData.id, isTempDept, saveRevision]);

  const finishNameEdit = () => {
    if (isTempDept || !formData.name.trim()) return;
    setEditingName(false);
  };

  const cancelNameEdit = () => {
    setFormData({ ...formData, name: nameBeforeEdit });
    setEditingName(false);
  };

  const startNameEdit = () => {
    setNameBeforeEdit(formData.name);
    setEditingName(true);
  };

  const resourceEntityLabel = isOutsourceDept ? 'Vendor' : 'Resource';
  const resourceEntityLabelLower = resourceEntityLabel.toLowerCase();
  const assignedResourceTypeLabel = isOutsourceDept ? 'Outsourced' : 'In-house';
  const isEditingResource = Boolean(
    lineForm?.id && resources.some((r) => r.id === lineForm.id),
  );

  return (
    <div className={`space-y-4 w-full max-w-full pb-8 ${editorFormClass}`}>
      <div className="pb-2 border-b border-slate-100 space-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight truncate flex-1 min-w-0">
            {formData.name?.trim() || 'New work center'}
          </h2>
          {!isNameLocked && !isTempDept && !editingName && (
            <button
              type="button"
              onClick={startNameEdit}
              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 shrink-0"
              title="Edit work center"
            >
              <Pencil size={15} />
            </button>
          )}
        </div>

        {editingName && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-72 shrink-0">
              <label
                htmlFor="dept-editor-name"
                className="block font-medium text-slate-700 mb-1.5"
                style={{ fontSize: tokens.fontSize.body }}
              >
                Department name
              </label>
              <input
                id="dept-editor-name"
                type="text"
                placeholder="e.g. Cutting"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishNameEdit();
                  if (e.key === 'Escape') cancelNameEdit();
                }}
                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-100 focus:border-primary-500 shadow-sm"
                disabled={isNameLocked}
                autoFocus
              />
            </div>
            {canEditPlanningMode && (
              <div className="w-44 shrink-0">
                <SelectDropdown
                  label="Work center type"
                  value={formPlanningMode(formData)}
                  options={PLANNING_MODE_OPTIONS}
                  labelVariant="form"
                  onChange={(v) => {
                    if (v === 'production' || v === 'storage' || v === 'outsource') {
                      handlePlanningModeChange(v);
                    }
                  }}
                  className="w-full"
                />
              </div>
            )}
            {!isTempDept && (
              <DesktopWriteGate>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={finishNameEdit}
                  disabled={!formData.name.trim()}
                  className="h-[34px] w-9 inline-flex items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 border border-emerald-200 disabled:opacity-40"
                  title="Save name"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  onClick={cancelNameEdit}
                  className="h-[34px] w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 border border-slate-200"
                  title="Discard"
                >
                  <X size={16} />
                </button>
              </div>
              </DesktopWriteGate>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span
            className={`inline-flex items-center text-[10px] font-semibold px-2.5 py-1 rounded-full border ${planningModePillClass(effectivePlanningMode)}`}
          >
            {planningModeLabel(effectivePlanningMode)}
            {isStoreDept ? ' · transaction only' : ''}
            {isOutsourceDept ? ' · window planning' : ''}
          </span>
          <span
            className={`inline-flex items-center text-[10px] font-semibold px-2.5 py-1 rounded-full border ${
              deptRole === 'origin'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : deptRole === 'terminal'
                  ? 'bg-violet-50 text-violet-700 border-violet-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
            }`}
          >
            {departmentRoleLabel(deptRole)}
            {isNameLocked ? ' · name fixed' : ''}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-0.5 border-b border-slate-200 pb-0 -mt-1">
        {visibleSectionTabs.map((tab) => {
          const Icon = tab.icon;
          const active = sectionTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSectionTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors ${
                active
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {sectionTab === 'operations' && showOperationsTab && formData.id && factoryId && (
        <div className="pt-2">
          <DepartmentOperationsPanel
            factoryId={factoryId}
            departmentId={formData.id}
            departmentRole={deptRole}
            departmentPlanningMode={formData.planning_mode}
            rows={departmentOperations}
            factoryAllowedApps={appConfiguration}
            onOperationsChange={handleOperationsChange}
            showAudit={showAudit}
            showSupervisor={showSupervisorInOps}
            readOnly={isTerminal}
            terminalShipmentApps={isTerminal ? factoryEntitlements.shipment : undefined}
          />
        </div>
      )}

      {sectionTab === 'resources' && (
        <div className="pt-2 space-y-8">
          <EditorSplitLayout
            scrollable={false}
            left={(
              <DesktopWriteGate>
              <div className="space-y-3">
                <div>
                  <h5 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                    {isEditingResource ? <Pencil size={14} /> : <Plus size={14} />}
                    {isEditingResource ? `Edit ${resourceEntityLabelLower}` : `Add ${resourceEntityLabelLower}`}
                  </h5>
                  {isOutsourceDept && (
                    <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      Outsource work centers use vendors as planning resources — one row per vendor you send work to.
                    </p>
                  )}
                </div>
                <Input
                  label={`${resourceEntityLabel} name`}
                  placeholder={isOutsourceDept ? 'e.g. ABC Garments' : 'e.g. Line A'}
                  value={lineForm?.resourceName || ''}
                  onChange={(e) => setLineForm({
                    ...(lineForm || { departmentName: formData.name, departmentId: formData.id }),
                    resourceName: e.target.value,
                  })}
                  className="bg-white"
                />
                {!isNative && (
                  <Input
                    label="Capacity (pcs/day)"
                    type="number"
                    placeholder="500"
                    value={lineForm?.defaultPcs?.toString() || ''}
                    onChange={(e) => setLineForm({
                      ...(lineForm || { departmentName: formData.name, departmentId: formData.id }),
                      defaultPcs: parseInt(e.target.value, 10) || 0,
                    })}
                    className="bg-white"
                  />
                )}
                <div>
                  <label className="block font-medium text-slate-700 mb-1.5" style={{ fontSize: tokens.fontSize.body }}>
                    Description
                  </label>
                  <textarea
                    rows={2}
                    value={lineForm?.description || ''}
                    onChange={(e) => setLineForm({
                      ...(lineForm || { departmentName: formData.name, departmentId: formData.id }),
                      description: e.target.value,
                    })}
                    placeholder={isOutsourceDept ? 'Vendor contact, location, etc.' : 'Line notes, etc.'}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-none shadow-none text-[11px]"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    onClick={addResourceLocally}
                    disabled={
                      !lineForm?.resourceName?.trim()
                      || resources.some(
                        (r) =>
                          r.id !== lineForm?.id
                          && String(r.resourceName).trim().toLowerCase()
                            === String(lineForm?.resourceName).trim().toLowerCase(),
                      )
                    }
                    className="w-full"
                  >
                    {isEditingResource ? `Update ${resourceEntityLabelLower}` : `Add ${resourceEntityLabelLower}`}
                  </Button>
                  {lineForm && (
                    <>
                      {isEditingResource && (
                        <Button
                          size="sm"
                          variant="danger-light"
                          onClick={() => {
                            deleteResourceLocally(lineForm.id!);
                            setLineForm(null);
                          }}
                          className="w-full"
                        >
                          <Trash2 size={14} className="mr-1.5" />
                          {`Remove ${resourceEntityLabelLower}`}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setLineForm(null)} className="w-full">
                        <X size={14} className="mr-1.5" />
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
              </DesktopWriteGate>
            )}
            right={(
              resourcesLoading ? (
                <div className="flex items-center justify-center py-12 min-h-[280px]">
                  <Spinner size="md" />
                </div>
              ) : (
                <div className="flex flex-col min-h-[280px] max-h-[min(360px,42vh)]">
                  <CatalogTablePanel
                    title={isOutsourceDept ? 'Vendor catalog' : 'Resource catalog'}
                    icon={Factory}
                    isEmpty={resources.length === 0}
                    emptyMessage={isOutsourceDept ? 'No vendors yet.' : 'No resources yet.'}
                  >
                    <CatalogTable headers={['S.No', 'Name', 'Type', 'Capacity', 'Description']}>
                      {resources.map((res, idx) => (
                        <CatalogTableRow
                          key={res.id}
                          onClick={() => setLineForm(res)}
                          selected={lineForm?.id === res.id}
                        >
                          <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                          <CatalogTableCell className="font-medium text-slate-800 truncate">
                            {res.resourceName}
                          </CatalogTableCell>
                          <CatalogTableCell className="min-w-0">
                            <span
                              className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                isOutsourceDept
                                  ? 'bg-sky-50 text-sky-700 border-sky-200'
                                  : 'bg-slate-50 text-slate-600 border-slate-200'
                              }`}
                            >
                              {assignedResourceTypeLabel}
                            </span>
                          </CatalogTableCell>
                          <CatalogTableCell className="text-slate-500 tabular-nums">
                            {res.defaultPcs?.toLocaleString() || 0} pcs/day
                          </CatalogTableCell>
                          <CatalogTableCell className="text-slate-500 truncate">
                            {res.description || '—'}
                          </CatalogTableCell>
                        </CatalogTableRow>
                      ))}
                    </CatalogTable>
                  </CatalogTablePanel>
                </div>
              )
            )}
          />

          {!isTerminal && (
            <>
              {isStoreDept ? (
                <p className="text-[10px] text-slate-500 leading-relaxed px-1 py-2 border-t border-slate-200 pt-4">
                  Store work centers use the Operations tab for the reference Store step. Transaction handoffs are supervisor-driven — no workforce categories.
                </p>
              ) : isOutsourceDept ? (
                <p className="text-[10px] text-slate-500 leading-relaxed px-1 py-2 border-t border-slate-200 pt-4">
                  Outsource work centers use window planning — vendor, dates, and qty per order. No workforce categories.
                </p>
              ) : isTempDept ? (
                <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 border-t border-slate-200 pt-4 mt-0">
                  Save this work center first, then add workforce categories.
                </p>
              ) : !showWorkforce ? (
                <p className="text-[10px] text-slate-500 leading-relaxed px-1 py-2 border-t border-slate-200 pt-4">
                  Workforce categories apply when an operation uses hourly, batch, or cutting capture.
                </p>
              ) : !ratesLoaded ? (
                <p className="text-[10px] text-slate-400 border-t border-slate-200 pt-4">Loading workforce…</p>
              ) : shifts.length === 0 ? (
                <p className="text-[10px] text-slate-400 italic border-t border-slate-200 pt-4">
                  Add shifts in factory settings first.
                </p>
              ) : (
                <DepartmentWorkforcePanel
                  shifts={shifts}
                  drafts={roleRates}
                  onChange={(next) => {
                    setRoleRates(next);
                    onRatesDirtyChange?.(true);
                    onRatesDraftChange?.(next);
                  }}
                  subtitle={isCuttingOrigin
                    ? 'Headcount categories for the lay report app — same as batch, logged inside each lay session. Supervisors on this work center handle handover only.'
                    : undefined}
                />
              )}
            </>
          )}
        </div>
      )}

      {isTempDept && sectionTab !== 'resources' && (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-[10px] text-slate-500">
          Save this work center before adding operations or defects.
        </div>
      )}

      {sectionTab === 'fabric-categories' && !isTempDept && isCuttingOrigin
        && onFabricCategoriesDirtyChange && onFabricCategoriesDraftChange && (
        <div className="pt-2">
          <FabricComponentsEditor
            originDepartmentId={formData.id}
            factoryId={factoryId}
            onDirtyChange={onFabricCategoriesDirtyChange}
            onChange={onFabricCategoriesDraftChange}
            saveRevision={saveRevision}
            embedded
          />
        </div>
      )}

      {sectionTab === 'defects' && !isTempDept && onDefectsDirtyChange && onDefectsDraftChange && (
        <div className="pt-2">
          <DefectsEditor
            selectedDeptId={formData.id}
            onDirtyChange={onDefectsDirtyChange}
            onChange={onDefectsDraftChange}
            saveRevision={saveRevision}
            embedded
          />
        </div>
      )}
    </div>
  );
};
