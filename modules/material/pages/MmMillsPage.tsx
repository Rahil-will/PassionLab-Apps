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
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import { mmSavePartner } from '../lib/mmV4Rpc';
import { useMmPartners, useRefreshMmV4Config } from '../lib/useMmV4Config';
import MmMachinesPage, { type MmMachinesHandle } from './MmMachinesPage';

export interface MmMillsHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type MillDraft = {
  localId: string;
  id: string | null;
  name: string;
  contact: string;
  address: string;
  active: boolean;
  rowVersion: number;
  machineCount: number;
  dirty: boolean;
};

let localSeq = 1;
const nextKey = () => `new-${localSeq++}`;

const MmMillsPage = forwardRef<
  MmMillsHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmMillsPage({ onDirtyChange }, ref) {
  const showNotification = useNotificationStore((s) => s.showNotification);
  const refreshV4 = useRefreshMmV4Config();
  const millsQ = useMmPartners('mill', true);
  const machinesRef = useRef<MmMachinesHandle>(null);

  const [rows, setRows] = useState<MillDraft[]>([]);
  const [baseline, setBaseline] = useState<MillDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedMillId, setSelectedMillId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [address, setAddress] = useState('');
  const [active, setActive] = useState(true);
  const [machineDirty, setMachineDirty] = useState(false);

  useEffect(() => {
    if (!millsQ.data) return;
    const next: MillDraft[] = millsQ.data.map((row) => ({
      localId: row.id,
      id: row.id,
      name: row.name,
      contact: row.contact ?? '',
      address: row.address ?? '',
      active: row.is_active !== false,
      rowVersion: Number(row.row_version ?? 1),
      machineCount: row.machine_count ?? 0,
      dirty: false,
    }));
    setRows(next);
    setBaseline(next);
    setHydrated(true);
    onDirtyChange?.(false);
  }, [millsQ.data, onDirtyChange]);

  const formDirty = useMemo(() => {
    if (editingId) {
      const row = rows.find((item) => item.localId === editingId);
      if (!row) return false;
      return row.name !== name || row.contact !== contact || row.address !== address || row.active !== active;
    }
    return Boolean(name.trim() || contact.trim() || address.trim());
  }, [editingId, rows, name, contact, address, active]);

  const millDirty = useMemo(() => {
    if (!hydrated) return false;
    return JSON.stringify(rows) !== JSON.stringify(baseline) || formDirty;
  }, [hydrated, rows, baseline, formDirty]);

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange?.(millDirty || machineDirty);
  }, [millDirty, machineDirty, hydrated, onDirtyChange]);

  useEffect(() => {
    if (!selectedMillId) setMachineDirty(false);
  }, [selectedMillId]);

  const snapshot = useRef({ rows, name, contact, address, active, editingId });
  snapshot.current = { rows, name, contact, address, active, editingId };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setContact('');
    setAddress('');
    setActive(true);
  };

  const applyForm = (current: MillDraft[]): MillDraft[] | null => {
    const form = snapshot.current;
    const trimmed = form.name.trim();
    if (!trimmed) {
      if (form.editingId || form.contact.trim() || form.address.trim() || !form.active) {
        showNotification('Enter a mill name before saving', 'error');
        return null;
      }
      return current;
    }
    if (current.some((row) => row.localId !== form.editingId && row.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      showNotification('That mill already exists', 'error');
      return null;
    }
    const next = {
      name: trimmed,
      contact: form.contact.trim(),
      address: form.address.trim(),
      active: form.active,
      dirty: true,
    };
    if (form.editingId) {
      const existing = current.find((row) => row.localId === form.editingId);
      if (
        existing
        && existing.name === trimmed
        && existing.contact === form.contact.trim()
        && existing.address === form.address.trim()
        && existing.active === form.active
      ) return current;
      return current.map((row) => (row.localId === form.editingId ? { ...row, ...next } : row));
    }
    return [...current, { localId: nextKey(), id: null, rowVersion: 1, machineCount: 0, ...next }];
  };

  const submitForm = () => {
    const next = applyForm(rows);
    if (!next) return;
    setRows(next);
    resetForm();
  };

  const loadRow = (row: MillDraft) => {
    if (machineDirty && row.id !== selectedMillId) {
      showNotification('Save machine changes before switching mills', 'error');
      return;
    }
    setEditingId(row.localId);
    setSelectedMillId(row.id);
    setName(row.name);
    setContact(row.contact);
    setAddress(row.address);
    setActive(row.active);
  };

  const removeRow = (row: MillDraft) => {
    if (!row.id) setRows((list) => list.filter((item) => item.localId !== row.localId));
    else setRows((list) => list.map((item) => (item.localId === row.localId ? { ...item, active: false, dirty: true } : item)));
    if (editingId === row.localId) resetForm();
    if (selectedMillId === row.id) setSelectedMillId(null);
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => millDirty || machineDirty || Boolean(machinesRef.current?.isDirty()),
    save: async () => {
      const pending = applyForm(snapshot.current.rows);
      if (!pending) return false;
      setRows(pending);
      resetForm();
      let wroteMill = false;
      for (const row of pending) {
        if (row.id && !row.dirty) continue;
        wroteMill = true;
        const res = await mmSavePartner({
          ...(row.id ? { id: row.id, row_version: row.rowVersion } : {}),
          kind: 'mill',
          name: row.name.trim(),
          contact: row.contact.trim() || null,
          address: row.address.trim() || null,
          is_active: row.active,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          await millsQ.refetch();
          return false;
        }
      }
      if (wroteMill) showNotification('Mills saved', 'success');
      if (machinesRef.current?.isDirty()) {
        const machinesOk = await machinesRef.current.save();
        if (!machinesOk) return false;
      }
      await Promise.all([millsQ.refetch(), refreshV4()]);
      return true;
    },
  }), [millDirty, machineDirty, showNotification, millsQ, refreshV4]);

  if (millsQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (millsQ.error) {
    return (
      <p className="text-[12px] text-red-600 p-2">
        {millsQ.error instanceof Error ? millsQ.error.message : 'Could not load mills'}
      </p>
    );
  }

  const selected = rows.find((row) => row.id === selectedMillId) ?? null;

  return (
    <div className="h-full min-h-0 overflow-y-auto thin-scrollbar flex flex-col gap-4 pr-1">
      <EditorSplitLayout
        panelHeight="min(380px, 46vh)"
        leftScrollable
        rightScrollable
        left={(
          <DesktopWriteGate>
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingId ? 'Edit mill' : 'Add mill'}
              </h4>
              <Input
                label="Name *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitForm()}
              />
              <Input label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Address</label>
                <textarea
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y min-h-[4.5rem] text-[11px]"
                />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-700">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Active
              </label>
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  icon={editingId ? Pencil : Plus}
                  disabled={!name.trim()}
                  onClick={submitForm}
                  className="w-full"
                >
                  {editingId ? 'Update in table' : 'Add to table'}
                </Button>
                {editingId ? (
                  <>
                    <Button
                      variant="danger-light"
                      size="sm"
                      icon={Trash2}
                      onClick={() => {
                        const row = rows.find((item) => item.localId === editingId);
                        if (row) removeRow(row);
                      }}
                      className="w-full"
                    >
                      Remove from table
                    </Button>
                    <Button size="sm" variant="secondary" icon={X} onClick={resetForm} className="w-full">
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
              title="Mills"
              subtitle="Click a mill to edit it and see its machines."
              isEmpty={rows.length === 0}
              emptyMessage="No mills yet."
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={['S.No', 'Mill', 'Contact', 'Machines', 'Active', '']}>
                {rows.map((row, idx) => (
                  <CatalogTableRow key={row.localId} onClick={() => loadRow(row)} selected={editingId === row.localId}>
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 truncate">
                      {row.name || '—'}
                      {!row.id ? <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span> : null}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{row.contact || '—'}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 tabular-nums">{row.machineCount}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600">{row.active ? 'Yes' : 'No'}</CatalogTableCell>
                    <CatalogTableCell>
                      <DesktopWriteGate>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRow(row);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                          aria-label={`Remove ${row.name || 'mill'}`}
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

      {selected ? (
        <MmMachinesPage
          key={selected.id ?? selected.localId}
          ref={machinesRef}
          lockedFacilityId={selected.id ?? undefined}
          onDirtyChange={setMachineDirty}
        />
      ) : (
        <p className="text-[11px] text-slate-400">Select a mill to see its machines.</p>
      )}
    </div>
  );
});

export default MmMillsPage;
