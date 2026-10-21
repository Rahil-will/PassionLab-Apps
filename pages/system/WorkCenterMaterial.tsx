import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Layers, LayoutList, Package, Scissors, Workflow } from 'lucide-react';
import { PageShell } from '../../components/layout/PageShell';
import { WorkCenterEditorCard } from '../../components/layout/WorkCenterEditorCard';
import { UnsavedChangesModal } from '../../components/settings';
import { useModuleEnabled } from '../../core/modules/useModuleEnabled';
import { useMmMaterialFeatures } from '../../modules/material/lib/useMmFeature';
import { useNavigationStore, useNotificationStore } from '../../stores';
import { useMmConfigBundle } from '../../modules/material/lib/useMmConfigBundle';
import { MmPageSaveProvider } from '../../modules/material/components/MmTableSaveButton';
import { RoutePath } from '../../types';
import MmFabricCategoriesPage, {
  type MmFabricCategoriesHandle,
} from '../../modules/material/pages/MmFabricCategoriesPage';
import MmFabricTypesPage, {
  type MmFabricTypesHandle,
} from '../../modules/material/pages/MmFabricTypesPage';
import MmFabricTestingPage, {
  type MmFabricTestingHandle,
} from '../../modules/material/pages/MmFabricTestingPage';
import MmTrimParamsPage, {
  type MmTrimParamsHandle,
} from '../../modules/material/pages/MmTrimParamsPage';
import MmRackMasterPage, {
  type MmRackMasterHandle,
} from '../../modules/material/pages/MmRackMasterPage';
import MmProcessesPage, {
  type MmProcessesHandle,
} from '../../modules/material/pages/MmProcessesPage';
import MmProcessFormPage, {
  type MmProcessFormHandle,
} from '../../modules/material/pages/MmProcessFormPage';
import MmProcessVendorsPage, {
  type MmProcessVendorsHandle,
} from '../../modules/material/pages/MmProcessVendorsPage';
import MmFabricVendorsPage, {
  type MmFabricVendorsHandle,
} from '../../modules/material/pages/MmFabricVendorsPage';
import MmFabricStagesPage, {
  type MmFabricStagesHandle,
} from '../../modules/material/pages/MmFabricStagesPage';
import FabricFormSchemaEditor, {
  type FabricFormSchemaEditorHandle,
} from '../../modules/material/pages/fabrics/FabricFormSchemaEditor';
import ReceiptFormSchemaEditor, {
  type ReceiptFormSchemaEditorHandle,
} from '../../modules/material/pages/fabrics/ReceiptFormSchemaEditor';

type MaterialSection =
  | 'types'
  | 'fabric-form'
  | 'fabric-receiving-form'
  | 'categories'
  | 'test-fabric'
  | 'trim-params'
  | 'racks'
  | 'processes'
  | 'process-form'
  | 'process-vendors'
  | 'fabric-vendors'
  | 'fabric-stages';

type MaterialTab = 'fabric' | 'trims' | 'processing';

const TABS: { id: MaterialTab; label: string; icon: React.ElementType }[] = [
  { id: 'fabric', label: 'Fabric', icon: Layers },
  { id: 'trims', label: 'Trims', icon: Scissors },
  { id: 'processing', label: 'Processing', icon: Workflow },
];

const SECTION_TAB: Record<MaterialSection, MaterialTab> = {
  types: 'fabric',
  'fabric-form': 'fabric',
  'fabric-receiving-form': 'fabric',
  categories: 'fabric',
  'test-fabric': 'fabric',
  'fabric-stages': 'fabric',
  'fabric-vendors': 'fabric',
  'trim-params': 'trims',
  processes: 'processing',
  'process-form': 'processing',
  'process-vendors': 'processing',
  racks: 'fabric',
};

const SECTIONS: { id: MaterialSection; label: string; hint: string }[] = [
  { id: 'types', label: 'Fabric types', hint: 'Each type, and the constructions that belong to it.' },
  {
    id: 'fabric-form',
    label: 'Fabric requirement form',
    hint: 'Fields on the fabric form. A dropdown with values, or a text or number input.',
  },
  {
    id: 'fabric-receiving-form',
    label: 'Fabric receiving form',
    hint: 'What to capture when fabric arrives: receipt details and per-roll columns.',
  },
  { id: 'categories', label: 'Fabric categories', hint: 'Where it is used (shell, lining, pocketing).' },
  { id: 'test-fabric', label: 'Fabric testing parameters', hint: 'What to record when a roll is tested.' },
  {
    id: 'fabric-stages',
    label: 'Fabric stages',
    hint: 'Stage order, labels, and which stages are finished and ready to cut.',
  },
  {
    id: 'fabric-vendors',
    label: 'Fabric vendors',
    hint: 'In-house and external suppliers. One default vendor for each source.',
  },
  { id: 'trim-params', label: 'Trim requirement parameters', hint: 'Trim categories and types used on the order.' },
  {
    id: 'processes',
    label: 'Processes',
    hint: 'Add a process and where it is done.',
  },
  {
    id: 'process-form',
    label: 'Process requirement form',
    hint: '',
  },
  {
    id: 'process-vendors',
    label: 'Process vendors',
    hint: 'Which vendor does each process. In-house processing is the In-house vendor.',
  },
  { id: 'racks', label: 'Rack management', hint: 'Create racks and bins, and set how many rolls each holds.' },
];

const FABRIC_SECTIONS = new Set<MaterialSection>([
  'types',
  'fabric-form',
  'fabric-receiving-form',
  'categories',
  'test-fabric',
  'fabric-stages',
  'fabric-vendors',
  'racks',
]);

function resolveSection(raw: string | undefined): MaterialSection | null {
  if (!raw) return null;
  if (raw === 'types' || raw === 'fabric-types') return 'types';
  if (raw === 'fabric-form' || raw === 'params' || raw === 'form-setup') return 'fabric-form';
  if (raw === 'fabric-receiving-form' || raw === 'receiving-form') return 'fabric-receiving-form';
  if (raw === 'test-fabric') return 'test-fabric';
  if (raw === 'trim-params') return 'trim-params';
  if (raw === 'categories') return 'categories';
  if (raw === 'racks') return 'racks';
  if (raw === 'processes' || raw === 'process') return 'processes';
  if (raw === 'process-form' || raw === 'process-requirement') return 'process-form';
  if (raw === 'process-vendors') return 'process-vendors';
  if (raw === 'fabric-vendors') return 'fabric-vendors';
  if (raw === 'processing-facilities') return 'process-vendors';
  if (raw === 'facilities' || raw === 'facilities-machines' || raw === 'machines' || raw === 'production-facilities') return 'fabric-vendors';
  if (raw === 'fabric-stages' || raw === 'stages') return 'fabric-stages';
  return null;
}

export function WorkCenterMaterial() {
  const enabled = useModuleEnabled('material');
  const materialFeatures = useMmMaterialFeatures(enabled);
  const featuresReady = materialFeatures.isSuccess;
  const warehouseOn = !featuresReady || Boolean(materialFeatures.data?.fabric_warehouse);
  const fabricOn = !featuresReady || Boolean(materialFeatures.data?.fabric_warehouse);
  const trimsOn = !featuresReady || Boolean(materialFeatures.data?.trims);
  const sections = SECTIONS.filter((item) => {
    if (item.id === 'trim-params') return trimsOn;
    if (item.id === 'fabric-vendors' || item.id === 'racks') return warehouseOn;
    if (FABRIC_SECTIONS.has(item.id)) return fabricOn;
    return true;
  });
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const setNavUnsaved = useNavigationStore((s) => s.setUnsaved);
  const setPendingSaveAction = useNavigationStore((s) => s.setPendingSaveAction);
  const routeSection = useNavigationStore((s) => s.routeParams.section);
  const { showNotification } = useNotificationStore();
  const { isLoading: bundleLoading } = useMmConfigBundle(enabled);

  const initialSection = resolveSection(routeSection);
  const [section, setSection] = useState<MaterialSection | null>(initialSection);
  const [tab, setTab] = useState<MaterialTab>(initialSection ? SECTION_TAB[initialSection] : 'fabric');
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const typesRef = useRef<MmFabricTypesHandle>(null);
  const formRef = useRef<FabricFormSchemaEditorHandle>(null);
  const receiptFormRef = useRef<ReceiptFormSchemaEditorHandle>(null);
  const categoriesRef = useRef<MmFabricCategoriesHandle>(null);
  const testingRef = useRef<MmFabricTestingHandle>(null);
  const trimRef = useRef<MmTrimParamsHandle>(null);
  const racksRef = useRef<MmRackMasterHandle>(null);
  const processesRef = useRef<MmProcessesHandle>(null);
  const processFormRef = useRef<MmProcessFormHandle>(null);
  const processRef = useRef<MmProcessVendorsHandle>(null);
  const fabricVendorsRef = useRef<MmFabricVendorsHandle>(null);
  const stagesRef = useRef<MmFabricStagesHandle>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);

  const pageLoading = enabled && bundleLoading && (
    section === 'types' || section === 'test-fabric'
  );

  useEffect(() => {
    if (routeSection === 'fabrics' || routeSection === 'fabric-master') {
      requestNavigate(RoutePath.MATERIAL_FABRICS);
      return;
    }
    const next = resolveSection(routeSection);
    if (next) {
      setSection(next);
      setTab(SECTION_TAB[next]);
    }
  }, [routeSection, requestNavigate]);

  useEffect(() => {
    if (!section) return;
    if (section === 'trim-params' && !trimsOn) setSection(null);
    else if (section === 'fabric-vendors' && !warehouseOn) setSection(null);
    else if (FABRIC_SECTIONS.has(section) && !fabricOn) setSection(null);
  }, [section, fabricOn, warehouseOn, trimsOn]);


  const visibleTabs = TABS.filter((item) => sections.some((row) => SECTION_TAB[row.id] === item.id));
  const activeTab = visibleTabs.some((item) => item.id === tab) ? tab : (visibleTabs[0]?.id ?? 'fabric');
  const tabSections = sections.filter((item) => SECTION_TAB[item.id] === activeTab);
  const activeTabLabel = TABS.find((item) => item.id === activeTab)?.label ?? 'Material';

  const doSelect = (id: MaterialSection) => {
    setSection(id);
    setIsUnsaved(false);
    setNavUnsaved(false);
  };

  const handleSelect = (id: MaterialSection) => {
    if (id === section) return;
    if (isUnsaved) {
      setPendingAction(() => () => doSelect(id));
      setShowUnsavedDialog(true);
      return;
    }
    doSelect(id);
  };

  const handleTab = (id: MaterialTab) => {
    if (id === activeTab) return;
    const first = sections.find((item) => SECTION_TAB[item.id] === id);
    if (!first) return;
    const apply = () => {
      setTab(id);
      doSelect(first.id);
    };
    if (isUnsaved) {
      setPendingAction(() => apply);
      setShowUnsavedDialog(true);
      return;
    }
    apply();
  };

  const markDirty = useCallback((value: boolean) => {
    setIsUnsaved(value);
    setNavUnsaved(value);
  }, [setNavUnsaved]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!section) return false;
    setSaving(true);
    try {
      let ok = true;
      if (section === 'types') ok = (await typesRef.current?.save()) ?? false;
      else if (section === 'fabric-form') ok = (await formRef.current?.save()) ?? false;
      else if (section === 'fabric-receiving-form') ok = (await receiptFormRef.current?.save()) ?? false;
      else if (section === 'categories') ok = (await categoriesRef.current?.save()) ?? false;
      else if (section === 'test-fabric') ok = (await testingRef.current?.save()) ?? false;
      else if (section === 'racks') ok = (await racksRef.current?.save()) ?? false;
      else if (section === 'processes') ok = (await processesRef.current?.save()) ?? false;
      else if (section === 'process-form') ok = (await processFormRef.current?.save()) ?? false;
      else if (section === 'process-vendors') ok = (await processRef.current?.save()) ?? false;
      else if (section === 'fabric-vendors') ok = (await fabricVendorsRef.current?.save()) ?? false;
      else if (section === 'fabric-stages') ok = (await stagesRef.current?.save()) ?? false;
      else ok = (await trimRef.current?.save()) ?? false;
      if (ok) {
        setIsUnsaved(false);
        setNavUnsaved(false);
      }
      return ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes';
      showNotification(message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [section, setNavUnsaved, showNotification]);

  saveRef.current = handleSave;

  useEffect(() => {
    setPendingSaveAction(async () => saveRef.current());
    return () => setPendingSaveAction(null);
  }, [setPendingSaveAction]);

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
    <PageShell
      loading={pageLoading}
      skeleton="list"
      className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden bg-slate-50"
    >
      {!enabled ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 mb-2 mt-3">
          <Package size={48} className="mb-3 opacity-30" />
          <p className="text-sm font-medium text-slate-600">Material module is off</p>
          <p className="text-xs text-slate-400 mt-1">
            Turn it on under Settings → Factory Settings → Modules.
          </p>
          <button
            type="button"
            className="mt-4 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            onClick={() => requestNavigate(RoutePath.SETTINGS)}
          >
            Open Factory Settings
          </button>
        </div>
      ) : (
        <MmPageSaveProvider
          value={{
            save: () => { void handleSave(); },
            saving,
            unsaved: isUnsaved,
          }}
        >
        <div className="shrink-0 z-20 bg-slate-50 pt-3 pb-3">
          <div className="flex items-center justify-between bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-0.5 px-1.5">
              {visibleTabs.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleTab(item.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon size={13} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-1 min-h-0 overflow-hidden gap-6">
          <div className="w-72 max-h-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col shrink-0 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{activeTabLabel}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-2 space-y-1">
              {tabSections.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item.id)}
                  className={`p-3 rounded-lg cursor-pointer text-xs transition-all group ${
                    section === item.id
                      ? 'bg-blue-50 text-blue-700 border-blue-200 border'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="font-bold flex justify-between items-start gap-2">
                    <span>{item.label}</span>
                    <ChevronRight
                      size={14}
                      className={`shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                        section === item.id ? 'opacity-100 text-blue-500' : 'text-slate-400'
                      }`}
                    />
                  </div>
                  {item.hint ? (
                    <p
                      className={`mt-1 text-[10px] font-normal leading-snug ${
                        section === item.id ? 'text-blue-600/80' : 'text-slate-500'
                      }`}
                    >
                      {item.hint}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 w-full min-w-0 min-h-0 overflow-hidden">
            {section ? (
              <WorkCenterEditorCard fill>
                {section === 'types' ? (
                  <MmFabricTypesPage ref={typesRef} onDirtyChange={markDirty} />
                ) : section === 'fabric-form' ? (
                  <FabricFormSchemaEditor ref={formRef} onDirtyChange={markDirty} />
                ) : section === 'fabric-receiving-form' ? (
                  <ReceiptFormSchemaEditor ref={receiptFormRef} onDirtyChange={markDirty} />
                ) : section === 'categories' ? (
                  <MmFabricCategoriesPage ref={categoriesRef} onDirtyChange={markDirty} />
                ) : section === 'test-fabric' ? (
                  <MmFabricTestingPage ref={testingRef} onDirtyChange={markDirty} />
                ) : section === 'racks' ? (
                  <MmRackMasterPage ref={racksRef} onDirtyChange={markDirty} />
                ) : section === 'processes' ? (
                  <MmProcessesPage ref={processesRef} onDirtyChange={markDirty} />
                ) : section === 'process-form' ? (
                  <MmProcessFormPage ref={processFormRef} onDirtyChange={markDirty} />
                ) : section === 'process-vendors' ? (
                  <MmProcessVendorsPage ref={processRef} onDirtyChange={markDirty} />
                ) : section === 'fabric-vendors' ? (
                  <MmFabricVendorsPage ref={fabricVendorsRef} onDirtyChange={markDirty} />
                ) : section === 'fabric-stages' ? (
                  <MmFabricStagesPage ref={stagesRef} onDirtyChange={markDirty} />
                ) : (
                  <MmTrimParamsPage ref={trimRef} onDirtyChange={markDirty} />
                )}
              </WorkCenterEditorCard>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <LayoutList size={64} className="mb-4 opacity-20" />
                <p className="text-xs font-medium text-slate-400">Select a section to configure</p>
              </div>
            )}
          </div>
        </div>
        </MmPageSaveProvider>
      )}

      <UnsavedChangesModal
        isOpen={showUnsavedDialog}
        onClose={cancelNavigation}
        onSave={confirmSave}
        onDiscard={confirmDiscard}
      />
    </PageShell>
  );
}
