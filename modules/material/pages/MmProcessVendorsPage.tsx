import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Input } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { EditorSplitLayout } from '../../../components/settings/EditorSplitLayout';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from '../../../components/settings/CatalogTablePanel';
import { useNotificationStore } from '../../../stores';
import { EditorToggle } from '../components/EditorToggle';
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import { mmSavePartner } from '../lib/mmV4Rpc';
import { useMmPartners, useMmProcesses, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmProcessVendorsHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type VendorDraft = {
  localId: string;
  id: string | null;
  name: string;
  contact: string;
  gstin: string;
  remarks: string;
  processIds: string[];
  active: boolean;
  rowVersion: number;
  dirty: boolean;
};

let localSeq = 1;
const nextKey = () => `new-${localSeq++}`;

const MmProcessVendorsPage = forwardRef<
  MmProcessVendorsHandle,
  { onDirtyChange: (dirty: boolean) => void }
>(function MmProcessVendorsPage({ onDirtyChange }, ref) {
  const showNotification = useNotificationStore((s) => s.showNotification);
  const refreshV4 = useRefreshMmV4Config();
  const processesQ = useMmProcesses();
  const vendorsQ = useMmPartners('process_vendor', true);

  const [vendors, setVendors] = useState<VendorDraft[]>([]);
  const [baselineVendors, setBaselineVendors] = useState<VendorDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorContact, setVendorContact] = useState('');
  const [vendorGstin, setVendorGstin] = useState('');
  const [vendorRemarks, setVendorRemarks] = useState('');
  const [vendorProcessIds, setVendorProcessIds] = useState<string[]>([]);
  const [vendorActive, setVendorActive] = useState(true);

  const processes = processesQ.data ?? [];

  useEffect(() => {
    if (!vendorsQ.data) return;
    const nextVendors: VendorDraft[] = vendorsQ.data.map((row) => ({
      localId: row.id,
      id: row.id,
      name: row.name,
      contact: row.contact ?? '',
      gstin: row.gstin ?? '',
      remarks: row.remarks ?? '',
      processIds: row.process_type_ids ?? [],
      active: row.is_active !== false,
      rowVersion: Number(row.row_version ?? 1),
      dirty: false,
    }));
    setVendors(nextVendors);
    setBaselineVendors(nextVendors);
    setHydrated(true);
    setEditingVendorId(null);
    setVendorName('');
    setVendorContact('');
    setVendorGstin('');
    setVendorRemarks('');
    setVendorProcessIds([]);
    setVendorActive(true);
    onDirtyChange(false);
  }, [vendorsQ.data, onDirtyChange]);

  const vendorFormDirty = useMemo(() => {
    if (editingVendorId) {
      const row = vendors.find((item) => item.localId === editingVendorId);
      if (!row) return false;
      return (
        row.name !== vendorName
        || row.contact !== vendorContact
        || row.gstin !== vendorGstin
        || row.remarks !== vendorRemarks
        || row.active !== vendorActive
        || JSON.stringify(row.processIds) !== JSON.stringify(vendorProcessIds)
      );
    }
    return Boolean(vendorName.trim() || vendorContact.trim() || vendorGstin.trim() || vendorRemarks.trim() || vendorProcessIds.length > 0);
  }, [editingVendorId, vendors, vendorName, vendorContact, vendorGstin, vendorRemarks, vendorActive, vendorProcessIds]);

  const dirty = useMemo(() => {
    if (!hydrated) return false;
    return JSON.stringify(vendors) !== JSON.stringify(baselineVendors) || vendorFormDirty;
  }, [hydrated, vendors, baselineVendors, vendorFormDirty]);

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const processNameById = (id: string) => processes.find((row) => row.id === id)?.name ?? '';

  const checkboxProcesses = useMemo(() => {
    const selected = new Set(vendorProcessIds);
    return processes.filter((row) => row.name.trim() && (row.active !== false || selected.has(row.id)));
  }, [processes, vendorProcessIds]);

  const resetVendorForm = () => {
    setEditingVendorId(null);
    setVendorName('');
    setVendorContact('');
    setVendorGstin('');
    setVendorRemarks('');
    setVendorProcessIds([]);
    setVendorActive(true);
  };

  const loadVendor = (row: VendorDraft) => {
    setEditingVendorId(row.localId);
    setVendorName(row.name);
    setVendorContact(row.contact);
    setVendorGstin(row.gstin);
    setVendorRemarks(row.remarks);
    setVendorProcessIds([...row.processIds]);
    setVendorActive(row.active);
  };

  const toggleProcess = (id: string) => {
    setVendorProcessIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const snapshot = useRef({
    vendors,
    vendorName,
    vendorContact,
    vendorGstin,
    vendorRemarks,
    vendorProcessIds,
    vendorActive,
    editingVendorId,
  });
  snapshot.current = {
    vendors,
    vendorName,
    vendorContact,
    vendorGstin,
    vendorRemarks,
    vendorProcessIds,
    vendorActive,
    editingVendorId,
  };

  const applyVendorForm = (rows: VendorDraft[]): VendorDraft[] | null => {
    const form = snapshot.current;
    const trimmed = form.vendorName.trim();
    const contact = form.vendorContact.trim();
    const gstin = form.vendorGstin.trim().toUpperCase();
    const remarks = form.vendorRemarks.trim();
    if (!trimmed) {
      if (form.editingVendorId || contact || remarks || form.vendorProcessIds.length > 0 || !form.vendorActive) {
        showNotification('Enter a vendor name before saving', 'error');
        return null;
      }
      return rows;
    }
    if (form.vendorProcessIds.length === 0) {
      showNotification('Select at least one process', 'error');
      return null;
    }
    if (rows.some((row) => row.localId !== form.editingVendorId && row.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      showNotification('That process vendor already exists', 'error');
      return null;
    }
    const next = {
      name: trimmed,
      contact,
      gstin,
      remarks,
      processIds: form.vendorProcessIds,
      active: form.vendorActive,
      dirty: true,
    };
    if (form.editingVendorId) {
      const existing = rows.find((row) => row.localId === form.editingVendorId);
      if (
        existing
        && existing.name === trimmed
        && existing.contact === contact
        && existing.gstin === gstin
        && existing.remarks === remarks
        && existing.active === form.vendorActive
        && JSON.stringify(existing.processIds) === JSON.stringify(form.vendorProcessIds)
      ) return rows;
      return rows.map((row) => (row.localId === form.editingVendorId ? { ...row, ...next } : row));
    }
    return [
      ...rows,
      { localId: nextKey(), id: null, rowVersion: 1, ...next },
    ];
  };

  const submitVendorForm = () => {
    const next = applyVendorForm(vendors);
    if (!next) return;
    setVendors(next);
    resetVendorForm();
  };

  const removeVendor = (row: VendorDraft) => {
    if (!row.id) setVendors((rows) => rows.filter((item) => item.localId !== row.localId));
    else setVendors((rows) => rows.map((item) => (item.localId === row.localId ? { ...item, active: false, dirty: true } : item)));
    if (editingVendorId === row.localId) resetVendorForm();
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      const pendingVendors = applyVendorForm(snapshot.current.vendors);
      if (!pendingVendors) return false;
      if (pendingVendors.some((row) => !row.name.trim())) {
        showNotification('Process vendor name is required', 'error');
        return false;
      }
      setVendors(pendingVendors);
      resetVendorForm();

      for (const row of pendingVendors) {
        if (row.id && !row.dirty) continue;
        const processTypeIds = row.processIds.filter((id) => processes.some((process) => process.id === id));
        if (processTypeIds.length === 0) {
          showNotification('Select at least one process', 'error');
          return false;
        }
        const res = await mmSavePartner({
          ...(row.id ? { id: row.id, row_version: row.rowVersion } : {}),
          kind: 'process_vendor',
          name: row.name.trim(),
          contact: row.contact.trim() || null,
          gstin: row.gstin.trim().toUpperCase() || null,
          remarks: row.remarks.trim() || null,
          is_active: row.active,
          process_type_ids: processTypeIds,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          await vendorsQ.refetch();
          return false;
        }
      }

      showNotification('Process vendors saved', 'success');
      await Promise.all([vendorsQ.refetch(), refreshV4()]);
      return true;
    },
  }), [dirty, showNotification, vendorsQ, refreshV4, processes]);

  if (processesQ.isLoading || vendorsQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (processesQ.error || vendorsQ.error) {
    const error = processesQ.error ?? vendorsQ.error;
    return (
      <p className="text-[12px] text-red-600 p-2">
        {error instanceof Error ? error.message : 'Could not load process vendors'}
      </p>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col gap-3">
      <p className="text-[11px] text-slate-500 shrink-0">
        Which vendor does each process. In-house processing is the In-house vendor.
      </p>
      <EditorSplitLayout
        fillHeight
        leftScrollable
        rightScrollable
        left={(
          <DesktopWriteGate>
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingVendorId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingVendorId ? 'Edit vendor' : 'Add vendor'}
              </h4>
              <Input
                label="Name *"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitVendorForm()}
              />
              <Input label="Contact" value={vendorContact} onChange={(e) => setVendorContact(e.target.value)} />
              <Input label="GSTIN" placeholder="27ABCDE1234F1Z5" value={vendorGstin} onChange={(e) => setVendorGstin(e.target.value.toUpperCase())} />
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
                <textarea
                  rows={2}
                  value={vendorRemarks}
                  onChange={(e) => setVendorRemarks(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y overflow-y-auto text-[11px] leading-4 max-h-24"
                />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-slate-600">Processes *</p>
                {checkboxProcesses.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No processes yet. Add them under Processing.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5 min-h-[1.75rem]">
                      {checkboxProcesses.filter((row) => vendorProcessIds.includes(row.id)).map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => toggleProcess(row.id)}
                          className="rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white"
                        >
                          {row.name}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-slate-200" />
                    <div className="flex flex-wrap gap-1.5">
                      {checkboxProcesses.filter((row) => !vendorProcessIds.includes(row.id)).map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => toggleProcess(row.id)}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {row.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <EditorToggle label="Active" on={vendorActive} onChange={setVendorActive} />
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  icon={editingVendorId ? Pencil : Plus}
                  disabled={!vendorName.trim()}
                  onClick={submitVendorForm}
                  className="w-full"
                >
                  {editingVendorId ? 'Update in table' : 'Add to table'}
                </Button>
                {editingVendorId ? (
                  <>
                    <Button
                      variant="danger-light"
                      size="sm"
                      icon={Trash2}
                      onClick={() => {
                        const row = vendors.find((item) => item.localId === editingVendorId);
                        if (row) removeVendor(row);
                      }}
                      className="w-full"
                    >
                      Remove from table
                    </Button>
                    <Button size="sm" variant="secondary" icon={X} onClick={resetVendorForm} className="w-full">
                      Cancel
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </DesktopWriteGate>
        )}
        right={(
          <div className="h-full flex flex-col min-h-0">
            <CatalogTablePanel
              title="Process vendors"
              subtitle="Click a row to edit."
              isEmpty={vendors.length === 0}
              emptyMessage="No process vendors yet."
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={['S.No', 'Vendor', 'GSTIN', 'Contact', 'Remarks', 'Processes', 'Active', '']}>
                {vendors.map((row, idx) => (
                  <CatalogTableRow key={row.localId} onClick={() => loadVendor(row)} selected={editingVendorId === row.localId}>
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 truncate">
                      {row.name || '—'}
                      {!row.id ? <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span> : null}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{row.gstin || '—'}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{row.contact || '—'}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{row.remarks.trim() || '—'}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 whitespace-normal">
                      <span className="flex flex-wrap gap-1">
                        {row.processIds.length === 0 ? '—' : row.processIds.map((id) => (
                          <span key={id} className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700">
                            {processNameById(id) || '—'}
                          </span>
                        ))}
                      </span>
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-600">{row.active ? 'Yes' : 'No'}</CatalogTableCell>
                    <CatalogTableCell>
                      <DesktopWriteGate>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeVendor(row);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                          aria-label={`Remove ${row.name || 'vendor'}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </DesktopWriteGate>
                    </CatalogTableCell>
                  </CatalogTableRow>
                ))}
              </CatalogTable>
            </CatalogTablePanel>
          </div>
        )}
      />
    </div>
  );
});

export default MmProcessVendorsPage;
