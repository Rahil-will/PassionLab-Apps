import React, { useState, useMemo } from 'react';
import {
  useSettingsStore,
  useNavigationStore,
  useNotificationStore,
} from '../stores';
import { useSupportDropdownsCatalog } from '../lib/queries/settingsSlices';
import { useSettingsScopeLoading } from '../lib/queries/settings';
import {
  Trash2,
  ChevronRight,
  LayoutList,
  X,
  Loader2,
  ListChecks,
  Building2,
} from 'lucide-react';
import { Button, Spinner, Modal } from '../components/ui';
import { PageShell } from '../components/layout/PageShell';
import {
  SupportDropdownEditor,
  UnsavedChangesModal,
  FactorySettingsPanel,
} from '../components/settings';
import { DesktopWriteGate } from '../components/DesktopWriteGate';
import { SUPPORT_DROPDOWN_CATALOG } from '../lib/supportDropdownCatalog';
import { duplicateNameError } from '../lib/settingsValidation';
import type { SupportDropdown } from '../types/settings';

type SupportDropdownForm = SupportDropdown & { id: string };

export function Settings() {
  const addSupportDropdown = useSettingsStore((s) => s.addSupportDropdown);
  const updateSupportDropdown = useSettingsStore((s) => s.updateSupportDropdown);
  const deleteSupportDropdown = useSettingsStore((s) => s.deleteSupportDropdown);
  const { factoryId, setUnsaved: setNavUnsaved } = useNavigationStore();
  const { supportDropdowns } = useSupportDropdownsCatalog(factoryId);
  const settingsLoading = useSettingsScopeLoading(factoryId, 'full');
  const { showNotification } = useNotificationStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown> | null>(null);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [activeTab, setActiveTab] = useState<'factory' | 'support'>('factory');

  const requestTab = (tab: 'factory' | 'support') => {
    if (tab === activeTab) return;
    if (isUnsaved) {
      setPendingAction(() => () => setActiveTab(tab));
      setShowUnsavedDialog(true);
      return;
    }
    setActiveTab(tab);
  };

  const listItems = useMemo(() => supportDropdowns, [supportDropdowns]);
  const hasPendingUnsaved = isUnsaved;

  const doSelect = (id: string, item: Record<string, unknown>) => {
    const data = JSON.parse(JSON.stringify(item));
    setSelectedId(id);
    setFormData(data);
    setIsUnsaved(false);
    setNavUnsaved(false);
  };

  const handleSelect = (id: string, item: Record<string, unknown>) => {
    if (hasPendingUnsaved) {
      setPendingAction(() => () => doSelect(id, item));
      setShowUnsavedDialog(true);
      return;
    }
    doSelect(id, item);
  };

  const doCreate = () => {
    const missing = SUPPORT_DROPDOWN_CATALOG.find(
      (def) => !supportDropdowns.some((sd: { category: string }) => sd.category === def.category),
    );
    if (!missing) {
      showNotification('All standard dropdowns are already configured.', 'error');
      return;
    }
    const newItem = {
      factory_id: factoryId,
      category: missing.category,
      app_name: missing.appName,
      values: [...missing.defaultValues],
      id: 'temp_' + crypto.randomUUID(),
    };
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
      setFormData(rest);
      return;
    }
    setFormData(newData);
    setIsUnsaved(true);
    setNavUnsaved(true);
  };

  const validateBeforeSave = (): string | null => {
    if (!formData) return null;
    const category = (formData.category as string) || '';
    const peers = supportDropdowns.filter(
      (d: { app_name?: string }) => d.app_name === formData.app_name,
    );
    return duplicateNameError(peers, category, String(formData.id || ''), 'Dropdown category');
  };

  const handleSave = async (): Promise<boolean> => {
    if (!formData) return false;
    if (!factoryId) {
      showNotification('Select a factory before saving', 'error');
      return false;
    }

    const validationError = validateBeforeSave();
    if (validationError) {
      showNotification(validationError, 'error');
      return false;
    }

    setSaving(true);
    const dataToSave = { ...formData, factory_id: factoryId } as SupportDropdownForm;

    try {
      if (dataToSave.id.startsWith('temp_')) {
        const { id: _id, ...rest } = dataToSave;
        await addSupportDropdown({ ...rest, id: crypto.randomUUID() });
      } else {
        await updateSupportDropdown(dataToSave.id, dataToSave);
      }

      showNotification('Changes saved successfully', 'success');
      setIsUnsaved(false);
      setNavUnsaved(false);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes';
      showNotification(message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (id: string) => {
    const label = (formData?.category as string) || 'this dropdown';
    setDeleteTarget({ id, label });
    setShowDeleteDialog(true);
  };

  const cancelDelete = () => {
    setShowDeleteDialog(false);
    setDeleteTarget(null);
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
      await deleteSupportDropdown(id);
      if (selectedId === id) {
        setSelectedId(null);
        setFormData(null);
        setIsUnsaved(false);
      }
      showNotification('Item deleted successfully', 'success');
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    } catch {
      showNotification('Failed to delete item', 'error');
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
    <PageShell loading={settingsLoading} skeleton="list" className="flex flex-col h-[calc(100vh-2rem)] overflow-hidden bg-slate-50">
      <div className="shrink-0 z-20 bg-slate-50 pt-3 pb-3">
        <div className="flex items-center justify-between bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-1 px-1.5">
            {[
              { id: 'factory', label: 'Factory Settings', icon: Building2 },
              { id: 'support', label: 'Support Dropdowns', icon: ListChecks },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => requestTab(tab.id as 'factory' | 'support')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab === 'factory' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FactorySettingsPanel />
        </div>
      )}

      {activeTab === 'support' && (
        <>
          <div className="flex flex-1 min-h-0 gap-6">
            <div className="w-72 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col shrink-0 min-h-0 overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Dropdowns</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {listItems.length > 0 ? (
                  listItems.map((item: { id: string; app_name?: string; category?: string; values?: unknown[] }) => (
                    <div
                      key={item.id}
                      onClick={() => handleSelect(item.id, item)}
                      className={`px-3 py-2 rounded-lg cursor-pointer text-xs transition-all group flex items-center justify-between ${
                        selectedId === item.id
                          ? 'bg-blue-50 text-blue-700 border-blue-200 border'
                          : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <span className="font-bold truncate pr-2">
                        {item.app_name || item.category || <span className="text-slate-400 italic">Untitled</span>}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.values && <span className="text-[10px] opacity-70">{item.values.length} values</span>}
                        <ChevronRight
                          size={14}
                          className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                            selectedId === item.id ? 'opacity-100 text-blue-500' : 'text-slate-400'
                          }`}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400 italic">
                    No dropdowns found.
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 w-full min-w-0 min-h-0 overflow-y-auto pr-1">
              {formData ? (
                <div className="w-full animate-in fade-in zoom-in-95 duration-200" key={String(formData.id)}>
                  <SupportDropdownEditor
                    formData={formData}
                    setFormData={handleSetFormData}
                    onSave={handleSave}
                    saving={saving}
                    onDelete={() => requestDelete(String(formData.id))}
                  />
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  <LayoutList size={64} className="mb-4 opacity-20" />
                  <p className="text-xs font-medium text-slate-400">
                    Select a dropdown to configure
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <Modal isOpen={showDeleteDialog} onClose={cancelDelete}>
        <div className="relative">
          <button
            onClick={cancelDelete}
            className="absolute top-4 right-4 text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full"
          >
            <X size={20} />
          </button>

          <div className="flex flex-col items-center p-8 pb-4 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ring-red-50">
              <Trash2 size={32} />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-2">Delete dropdown?</h3>
            <p className="text-slate-500 text-xs max-w-[280px] leading-relaxed">
              <span className="font-medium text-slate-700">{deleteTarget?.label}</span> will be
              permanently removed. This cannot be undone.
            </p>
          </div>

          <div className="p-6 pt-2 flex flex-col gap-3">
            <DesktopWriteGate>
            <Button
              variant="danger"
              onClick={confirmDelete}
              disabled={deleting}
              className="w-full py-2.5 text-xs"
            >
              {deleting ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Delete'}
            </Button>
            </DesktopWriteGate>
            <Button variant="secondary" onClick={cancelDelete} className="w-full text-xs">
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
