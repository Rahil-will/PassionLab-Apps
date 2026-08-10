import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSettingsStore,
  useNavigationStore,
  useNotificationStore,
} from '../../stores';
import { useBuyersCatalog, useSizeGroupsCatalog, refetchSettingsCatalogSlice } from '../../lib/queries/settingsSlices';
import { useSettingsScopeLoading } from '../../lib/queries/settings';
import { countOrdersForBuyer } from '../../lib/buyerOrderCount';
import {
  User,
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
import { BuyerEditor, UnsavedChangesModal } from '../../components/settings';
import { DesktopWriteGate } from '../../components/DesktopWriteGate';
import { duplicateNameError, duplicateNamesInList } from '../../lib/settingsValidation';
import type { Buyer, SizeGroup } from '../../types/settings';

export function WorkCenterBuyers({ tabBar }: { tabBar?: React.ReactNode } = {}) {
  const store = useSettingsStore();
  const queryClient = useQueryClient();
  const { factoryId, setUnsaved: setNavUnsaved, setPendingSaveAction } = useNavigationStore();
  const { showNotification } = useNotificationStore();
  const { buyers, loading: buyersLoading } = useBuyersCatalog(factoryId, 'full');
  const { sizeGroups } = useSizeGroupsCatalog(factoryId);
  const settingsLoading = useSettingsScopeLoading(factoryId, 'full');
  const pageLoading = settingsLoading || buyersLoading;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown> | null>(null);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const listItems = buyers;

  const doSelect = (id: string, item: Buyer) => {
    const data = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    data._sizeGroups = id.startsWith('temp_')
      ? (data._sizeGroups || [])
      : sizeGroups
          .filter((sg) => sg.buyerId === id)
          .map((sg) => ({ ...sg, sizes: [...sg.sizes] }));
    setSelectedId(id);
    setFormData(data);
    setIsUnsaved(false);
    setNavUnsaved(false);
  };

  const handleSelect = (id: string, item: Buyer) => {
    if (isUnsaved) {
      setPendingAction(() => () => doSelect(id, item));
      setShowUnsavedDialog(true);
      return;
    }
    doSelect(id, item);
  };

  const doCreate = () => {
    const newItem: Record<string, unknown> = {
      factory_id: factoryId,
      name: '',
      code: '',
      shipModeOptions: [],
      shipmentTypeOptions: [],
      _sizeGroups: [],
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
    const err = duplicateNameError(buyers, String(formData.name || ''), String(formData.id || ''), 'Buyer name');
    if (err) return err;
    const groups = (formData._sizeGroups as Array<{ name: string }>) || [];
    return duplicateNamesInList(groups, 'Size group name');
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
    const dataToSave: Record<string, unknown> = { ...formData, factory_id: factoryId };
    const sizeGroupsToSave = (dataToSave._sizeGroups || []) as Array<{
      id: string;
      name: string;
      sizes: string[];
    }>;

    try {
      let buyerId = dataToSave.id as string;
      const buyerPayload: Partial<Buyer> = {
        name: String(dataToSave.name || ''),
        code: (dataToSave.code as string) || null,
        country: (dataToSave.country as string) || null,
        type: (dataToSave.type as string) || null,
        status: (dataToSave.status as string) || null,
        contactName: (dataToSave.contactName as string) || null,
        contactEmail: (dataToSave.contactEmail as string) || null,
        contactPhone: (dataToSave.contactPhone as string) || null,
        contactRole: (dataToSave.contactRole as string) || null,
        overShipmentAllowance: Number(dataToSave.overShipmentAllowance) || 0,
        underShipmentAllowance: Number(dataToSave.underShipmentAllowance) || 0,
        shipModeOptions: (dataToSave.shipModeOptions as string[]) || [],
        shipmentTypeOptions: (dataToSave.shipmentTypeOptions as string[]) || [],
        destinationCountries: (dataToSave.destinationCountries as string[]) || [],
      };

      if (buyerId?.startsWith('temp_')) {
        buyerId = await store.addBuyer({ ...buyerPayload, factory_id: factoryId, name: String(buyerPayload.name || '') });
      } else {
        await store.updateBuyer(buyerId, buyerPayload);
      }

      const existingForBuyer = sizeGroups.filter((sg) => sg.buyerId === buyerId);
      const newIds = new Set(sizeGroupsToSave.map((sg) => sg.id));

      for (const sg of existingForBuyer) {
        if (!newIds.has(sg.id)) await store.deleteSizeGroup(sg.id);
      }

      for (const sg of sizeGroupsToSave) {
        const payload = {
          id: sg.id,
          factory_id: factoryId,
          buyerId,
          name: sg.name,
          sizes: sg.sizes,
        };
        const existsInDb = sizeGroups.some((ex) => ex.id === sg.id);
        if (existsInDb) {
          await store.updateSizeGroup(sg.id, payload);
        } else {
          await store.addSizeGroup(payload);
        }
      }

      const [refreshedBuyers, refreshedGroups] = await Promise.all([
        refetchSettingsCatalogSlice<Buyer[]>(queryClient, factoryId, 'buyers'),
        refetchSettingsCatalogSlice<SizeGroup[]>(queryClient, factoryId, 'sizeGroups'),
      ]);
      const refreshedBuyer = refreshedBuyers.find((b) => b.id === buyerId);
      const refreshedGroupsForBuyer = refreshedGroups.filter((sg) => sg.buyerId === buyerId);
      if (refreshedBuyer) {
        setSelectedId(buyerId);
        setFormData({ ...refreshedBuyer, _sizeGroups: refreshedGroupsForBuyer });
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

  // Register save handler so WorkCenters parent can trigger it from the tab-switch modal
  useEffect(() => {
    setPendingSaveAction(async () => { await handleSave(); });
    return () => setPendingSaveAction(null);
  }, [formData, factoryId, sizeGroups, setPendingSaveAction]);

  const requestDelete = async (id: string) => {
    const buyerName = buyers.find((b) => b.id === id)?.name;
    if (!id.startsWith('temp_') && factoryId) {
      try {
        const inUseCount = await countOrdersForBuyer(factoryId, id, buyerName);
        if (inUseCount > 0) {
          showNotification('Cannot delete buyer: one or more orders still reference it.', 'error');
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not verify buyer usage';
        showNotification(message, 'error');
        return;
      }
    }
    setDeleteTarget({ id, label: String(formData?.name || 'this buyer') });
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
      await store.deleteBuyer(id);
      if (selectedId === id) {
        setSelectedId(null);
        setFormData(null);
        setIsUnsaved(false);
      }
      showNotification('Buyer deleted', 'success');
      setShowDeleteDialog(false);
      setDeleteTarget(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete buyer';
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
                Save buyer
              </button>
            </div>
            </DesktopWriteGate>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden gap-6">
        <div className="w-72 max-h-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Buyers</span>
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
                  <div className="font-bold flex justify-between items-center">
                    <span>{item.name || <span className="text-slate-400 italic">Untitled</span>}</span>
                    <ChevronRight
                      size={14}
                      className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                        selectedId === item.id ? 'opacity-100 text-blue-500' : 'text-slate-400'
                      }`}
                    />
                  </div>
                  {item.code && <div className="text-[10px] opacity-70 mt-0.5 font-mono">{item.code}</div>}
                </div>
              ))
            ) : (
              <div className="p-4 text-center text-xs text-slate-400 italic">
                No buyers yet. Click + to add.
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 w-full min-w-0 min-h-0 overflow-y-auto thin-scrollbar">
          {formData ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <BuyerEditor formData={formData} setFormData={handleSetFormData} />
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
              <LayoutList size={64} className="mb-4 opacity-20" />
              <p className="text-xs font-medium text-slate-400">Select a buyer to edit</p>
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
            <h3 className="text-base font-bold text-slate-900 mb-2">Delete buyer?</h3>
            <p className="text-slate-500 text-xs">
              <span className="font-medium text-slate-700">{deleteTarget?.label}</span> and all size groups will be removed.
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
