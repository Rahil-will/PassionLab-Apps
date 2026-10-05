import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, LayoutList, Package } from 'lucide-react';
import { PageShell } from '../../components/layout/PageShell';
import { WorkCenterEditorCard } from '../../components/layout/WorkCenterEditorCard';
import { UnsavedChangesModal } from '../../components/settings';
import { useModuleEnabled } from '../../core/modules/useModuleEnabled';
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
import MmMaterialParamsPage, {
  type MmMaterialParamsHandle,
} from '../../modules/material/pages/MmMaterialParamsPage';
import MmTrimParamsPage, {
  type MmTrimParamsHandle,
} from '../../modules/material/pages/MmTrimParamsPage';
import MmRackMasterPage, {
  type MmRackMasterHandle,
} from '../../modules/material/pages/MmRackMasterPage';
import MmProcessVendorsPage, {
  type MmProcessVendorsHandle,
} from '../../modules/material/pages/MmProcessVendorsPage';
import MmFacilitiesPage, {
  type MmFacilitiesHandle,
} from '../../modules/material/pages/MmFacilitiesPage';
import MmFabricStagesPage, {
  type MmFabricStagesHandle,
} from '../../modules/material/pages/MmFabricStagesPage';

type MaterialSection =
  | 'types'
  | 'categories'
  | 'test-fabric'
  | 'params'
  | 'trim-params'
  | 'racks'
  | 'process-vendors'
  | 'facilities'
  | 'fabric-stages';

const SECTIONS: { id: MaterialSection; label: string; hint: string }[] = [
  { id: 'types', label: 'Fabric types', hint: 'Construction of the fabric (knit, woven, denim).' },
  { id: 'categories', label: 'Fabric categories', hint: 'Where it is used (shell, lining, pocketing).' },
  { id: 'params', label: 'Fabric requirement parameters', hint: 'Fields asked on the order for each fabric type.' },
  { id: 'test-fabric', label: 'Fabric testing parameters', hint: 'What to record when a roll is tested.' },
  { id: 'trim-params', label: 'Trim requirement parameters', hint: 'Trim categories and types used on the order.' },
  { id: 'racks', label: 'Fabric rack management', hint: 'Create racks and bins, and set how many rolls each holds.' },
  { id: 'process-vendors', label: 'Process vendors', hint: 'Who dyes, prints, or otherwise processes greige, and which processes they do.' },
  {
    id: 'facilities',
    label: 'Facilities & machines',
    hint: 'Mills, processing units, warehouses, fabric vendors, and in-house machines (Fabric v4).',
  },
  {
    id: 'fabric-stages',
    label: 'Fabric stages',
    hint: 'Ordered greige → finished stages and which ones can be cut (Fabric v4).',
  },
];

function resolveSection(raw: string | undefined): MaterialSection | null {
  if (!raw) return null;
  if (raw === 'types' || raw === 'fabric-types') return 'types';
  if (raw === 'test-fabric') return 'test-fabric';
  if (raw === 'params') return 'params';
  if (raw === 'trim-params') return 'trim-params';
  if (raw === 'categories') return 'categories';
  if (raw === 'racks') return 'racks';
  if (raw === 'process-vendors') return 'process-vendors';
  if (raw === 'facilities' || raw === 'facilities-machines') return 'facilities';
  if (raw === 'fabric-stages' || raw === 'stages') return 'fabric-stages';
  return null;
}

export function WorkCenterMaterial() {
  const enabled = useModuleEnabled('material');
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const setNavUnsaved = useNavigationStore((s) => s.setUnsaved);
  const setPendingSaveAction = useNavigationStore((s) => s.setPendingSaveAction);
  const routeSection = useNavigationStore((s) => s.routeParams.section);
  const { showNotification } = useNotificationStore();
  const { isLoading: bundleLoading } = useMmConfigBundle(enabled);

  const [section, setSection] = useState<MaterialSection | null>(resolveSection(routeSection));
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const typesRef = useRef<MmFabricTypesHandle>(null);
  const categoriesRef = useRef<MmFabricCategoriesHandle>(null);
  const testingRef = useRef<MmFabricTestingHandle>(null);
  const paramsRef = useRef<MmMaterialParamsHandle>(null);
  const trimRef = useRef<MmTrimParamsHandle>(null);
  const racksRef = useRef<MmRackMasterHandle>(null);
  const processRef = useRef<MmProcessVendorsHandle>(null);
  const facilitiesRef = useRef<MmFacilitiesHandle>(null);
  const stagesRef = useRef<MmFabricStagesHandle>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);

  const pageLoading = enabled && bundleLoading && (
    section === 'types' || section === 'test-fabric' || section === 'params'
  );

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
      else if (section === 'categories') ok = (await categoriesRef.current?.save()) ?? false;
      else if (section === 'test-fabric') ok = (await testingRef.current?.save()) ?? false;
      else if (section === 'params') ok = (await paramsRef.current?.save()) ?? false;
      else if (section === 'racks') ok = (await racksRef.current?.save()) ?? false;
      else if (section === 'process-vendors') ok = (await processRef.current?.save()) ?? false;
      else if (section === 'facilities') ok = (await facilitiesRef.current?.save()) ?? false;
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
        <div className="flex flex-1 min-h-0 overflow-hidden gap-6 pt-3">
          <div className="w-72 max-h-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col shrink-0 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Material</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar p-2 space-y-1">
              {SECTIONS.map((item) => (
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
                  <p
                    className={`mt-1 text-[10px] font-normal leading-snug ${
                      section === item.id ? 'text-blue-600/80' : 'text-slate-500'
                    }`}
                  >
                    {item.hint}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 w-full min-w-0 min-h-0 overflow-hidden">
            {section ? (
              <WorkCenterEditorCard fill>
                {section === 'types' ? (
                  <MmFabricTypesPage ref={typesRef} onDirtyChange={markDirty} />
                ) : section === 'categories' ? (
                  <MmFabricCategoriesPage ref={categoriesRef} onDirtyChange={markDirty} />
                ) : section === 'params' ? (
                  <MmMaterialParamsPage ref={paramsRef} onDirtyChange={markDirty} />
                ) : section === 'test-fabric' ? (
                  <MmFabricTestingPage ref={testingRef} onDirtyChange={markDirty} />
                ) : section === 'racks' ? (
                  <MmRackMasterPage ref={racksRef} onDirtyChange={markDirty} />
                ) : section === 'process-vendors' ? (
                  <MmProcessVendorsPage ref={processRef} onDirtyChange={markDirty} />
                ) : section === 'facilities' ? (
                  <MmFacilitiesPage ref={facilitiesRef} onDirtyChange={markDirty} />
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
