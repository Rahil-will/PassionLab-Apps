import React, { useState, useMemo, useEffect } from 'react';
import {
  useSettingsStore,
  useNavigationStore,
  useNotificationStore,
} from '../../stores';
import { useShiftsCatalog } from '../../lib/queries/settingsSlices';
import { useSettingsScopeLoading } from '../../lib/queries/settings';
import {
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
import { ShiftEditor, UnsavedChangesModal } from '../../components/settings';
import { DesktopWriteGate } from '../../components/DesktopWriteGate';
import { duplicateNameError, validateShiftHourBlocks, validateShiftTimeOverlap, type ShiftHourBlockInput } from '../../lib/settingsValidation';
import type { Shift } from '../../types';

export function WorkCenterShifts({ tabBar }: { tabBar?: React.ReactNode } = {}) {
  const store = useSettingsStore();
  const { factoryId, setUnsaved: setNavUnsaved, setPendingSaveAction } = useNavigationStore();
  const { showNotification } = useNotificationStore();
  const { shifts, loading: shiftsLoading } = useShiftsCatalog(factoryId, 'full');
  const settingsLoading = useSettingsScopeLoading(factoryId, 'full');
  const pageLoading = settingsLoading || shiftsLoading;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown> | null>(null);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const listItems = useMemo(
    () =>
      [...shifts].sort((a, b) => {
        if ((a.type || 'Regular') === 'Regular' && (b.type || 'Regular') !== 'Regular') return -1;
        if ((a.type || 'Regular') !== 'Regular' && (b.type || 'Regular') === 'Regular') return 1;
        return 0;
      }),
    [shifts],
  );

  const doSelect = (id: string, item: Record<string, unknown>) => {
    const data = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    setSelectedId(id);
    setFormData(data);
    setIsUnsaved(false);
    setNavUnsaved(false);
  };

  const handleSelect = (id: string, item: Record<string, unknown>) => {
    if (isUnsaved) {
      setPendingAction(() => () => doSelect(id, item));
      setShowUnsavedDialog(true);
      return;
    }
    doSelect(id, item);
  };

  const doCreate = () => {
    const hasRegular = shifts.some((s) => (s.type || 'Regular') === 'Regular');
    const newItem: Record<string, unknown> = {
      factory_id: factoryId,
      name: '',
      type: hasRegular ? 'OT' : 'Regular',
      startTime: '09:00',
      endTime: '17:00',
      hours: [],
      id: 'temp_' + crypto.randomUUID(),
    };
    setSelectedId(newItem.id as string);
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
    const nameErr = duplicateNameError(
      shifts,
      String(formData.name || ''),
      String(formData.id || ''),
      'Shift name',
    );
    if (nameErr) return nameErr;
    const hours = (formData.hours ?? []) as ShiftHourBlockInput[];
    const blockErr = validateShiftHourBlocks(hours);
    if (blockErr) return blockErr;
    return validateShiftTimeOverlap(
      String(formData.id || ''),
      String(formData.name || ''),
      hours,
      shifts,
    );
  };

  const handleSave = async (): Promise<boolean> => {
    if (!formData || !factoryId) {
      showNotification('Select a factory before saving', 'error');
      return false;
    }
    const validationError = validateBeforeSave();
    if (validationError) {
      showNotification(validationError, 'error');
      return false;
    }

    setSaving(true);
    const dataToSave = { ...formData, factory_id: factoryId } as Shift & { factory_id: string };

    try {
      if (String(dataToSave.id).startsWith('temp_')) {
        const { id: _id, ...rest } = dataToSave;
        await store.addShift(rest);
      } else {
        await store.updateShift(String(dataToSave.id), dataToSave);
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

  useEffect(() => {
    setPendingSaveAction(async () => { await handleSave(); });
    return () => setPendingSaveAction(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, factoryId]);

  const requestDelete = (id: string) => {
    setDeleteTarget({ id, label: String(formData?.name || 'this shift') });
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
      await store.deleteShift(id);
      if (selectedId === id) {
        setSelectedId(null);
        setFormData(null);
        setIsUnsaved(false);
      }
      showNotification('Shift deleted', 'success');
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    } catch {
      showNotification('Failed to delete shift', 'error');
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

  return (
    <PageShell loading={pageLoading} skeleton="list" className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden bg-slate-50">
      <div className="shrink-0 z-20 bg-slate-50 pt-3 pb-3">
        <div className="flex items-center justify-between bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-1 px-1.5">{tabBar}</div>
          {formData && (
            <DesktopWriteGate>
            <div className="flex items-center gap-2 px-2">
              <button
                onClick={() => requestDelete(String(formData.id))}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-xs font-medium"
              >
                <Trash2 size={14} />
                Delete
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || !String(formData.name || '').trim() || !isUnsaved}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save shift
              </button>
            </div>
            </DesktopWriteGate>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden gap-6">
        <div className="w-72 max-h-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Shifts</span>
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
                  onClick={() => handleSelect(item.id, item as unknown as Record<string, unknown>)}
                  className={`p-3 rounded-lg cursor-pointer text-xs transition-all group ${
                    selectedId === item.id
                      ? 'bg-blue-50 text-blue-700 border-blue-200 border'
                      : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                  }`}
                >
                  <div className="font-bold flex justify-between items-center">
                    <span>{item.name || <span className="text-slate-400 italic">Untitled</span>}</span>
                    <ChevronRight
                      size={14}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                        selectedId === item.id ? 'opacity-100 text-blue-500' : 'text-slate-400'
                      }`}
                    />
                  </div>
                  {item.type && (
                    <span
                      className={`text-[9px] font-medium mt-0.5 inline-block px-1.5 py-0.5 rounded ${
                        item.type === 'OT' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'
                      }`}
                    >
                      {item.type}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-slate-400 italic">
                No shifts yet. Click + to add.
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 w-full min-w-0 min-h-0 overflow-y-auto thin-scrollbar">
          {formData ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <ShiftEditor
                formData={formData}
                setFormData={handleSetFormData}
                onSave={handleSave}
                onDelete={() => requestDelete(String(formData.id))}
              />
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <LayoutList size={64} className="mb-4 opacity-20" />
              <p className="text-xs font-medium text-slate-400">Select a shift to edit</p>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
        <div className="relative">
          <button
            onClick={() => setShowDeleteDialog(false)}
            className="absolute top-4 right-4 text-slate-400 hover:text-red-600 p-1 hover:bg-red-50 rounded-full"
          >
            <X size={20} />
          </button>
          <div className="flex flex-col items-center p-8 pb-4 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4">
              <Trash2 size={32} />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-2">Delete shift?</h3>
            <p className="text-slate-500 text-xs">
              <span className="font-medium text-slate-700">{deleteTarget?.label}</span> will be permanently removed.
            </p>
          </div>
          <div className="p-6 pt-2 flex flex-col gap-3">
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting} className="w-full text-xs">
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
        onClose={() => { setPendingAction(null); setShowUnsavedDialog(false); }}
        onSave={confirmSave}
        onDiscard={confirmDiscard}
      />
    </PageShell>
  );
}
