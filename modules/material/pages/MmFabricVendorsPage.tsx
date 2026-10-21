import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Input, SelectDropdown } from '../../../components/ui';
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
import { mmSavePartner, type MmPartnerRow } from '../lib/mmV4Rpc';

type QcAtSource = 'none' | 'tested' | 'tested_inspected';

function qcAtSourceOf(value: string | null | undefined): QcAtSource {
  if (value === 'tested' || value === 'tested_inspected') return value;
  return 'none';
}

function qcAtSourceLabel(value: QcAtSource): string {
  if (value === 'tested') return 'Tested';
  if (value === 'tested_inspected') return 'Tested + inspected';
  return 'None';
}
import { useMmConfigBundle } from '../lib/useMmConfigBundle';
import { useMmPartners, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmFabricVendorsHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type VendorDraft = {
  localId: string;
  id: string | null;
  name: string;
  contact: string;
  active: boolean;
  rowVersion: number;
  inhouse: boolean;
  fabricTypeIds: string[];
  qcAtSource: QcAtSource;
  remarks: string;
  isDefault: boolean;
  dirty: boolean;
};

let localSeq = 1;
const nextKey = () => `new-${localSeq++}`;
const ANY_TYPE = '__any__';

function chosenTypeIds(value: string[] | null): string[] {
  if (!value || value.includes(ANY_TYPE)) return [];
  return value;
}

function sameTypeChoice(saved: string[], chosen: string[] | null): boolean {
  if (!chosen) return false;
  const next = chosenTypeIds(chosen);
  return saved.length === next.length && saved.every((id) => next.includes(id));
}

const MmFabricVendorsPage = forwardRef<
  MmFabricVendorsHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFabricVendorsPage({ onDirtyChange }, ref) {
  const showNotification = useNotificationStore((s) => s.showNotification);
  const refreshV4 = useRefreshMmV4Config();
  const vendorsQ = useMmPartners('fabric_vendor', true);
  const inhouseQ = useMmPartners('inhouse', true);
  const configQ = useMmConfigBundle();
  const fabricTypes = useMemo(
    () => (configQ.data?.types ?? []).filter((row) => row.is_active !== false).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
    })),
    [configQ.data?.types],
  );

  const [rows, setRows] = useState<VendorDraft[]>([]);
  const [removed, setRemoved] = useState<VendorDraft[]>([]);
  const [baseline, setBaseline] = useState<VendorDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [active, setActive] = useState(true);
  const [fabricTypeIds, setFabricTypeIds] = useState<string[] | null>(null);
  const [qcAtSource, setQcAtSource] = useState<QcAtSource>('none');
  const [remarks, setRemarks] = useState('');
  const [inhouse, setInhouse] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  const partnerDraft = (row: MmPartnerRow, inhouse: boolean): VendorDraft => ({
    localId: row.id,
    id: row.id,
    name: row.name,
    contact: row.contact ?? '',
    active: row.is_active !== false,
    rowVersion: Number(row.row_version ?? 1),
    inhouse,
    fabricTypeIds: row.fabric_type_ids ?? [],
    qcAtSource: qcAtSourceOf(row.qc_at_source),
    remarks: row.remarks ?? '',
    isDefault: row.is_default === true,
    dirty: false,
  });

  useEffect(() => {
    if (!vendorsQ.data || !inhouseQ.data) return;
    const next: VendorDraft[] = [
      ...inhouseQ.data.map((row) => partnerDraft(row, true)),
      ...vendorsQ.data.filter((row) => row.inhouse !== true).map((row) => partnerDraft(row, false)),
    ].filter((row) => row.active);
    setRows(next);
    setRemoved([]);
    setBaseline(next);
    setHydrated(true);
    setEditingId(null);
    setName('');
    setContact('');
    setActive(true);
    setFabricTypeIds(null);
    setQcAtSource('none');
    setRemarks('');
    setInhouse(false);
    setIsDefault(false);
    onDirtyChange?.(false);
  }, [vendorsQ.data, inhouseQ.data, onDirtyChange]);

  const formDirty = useMemo(() => {
    if (editingId) {
      const row = rows.find((item) => item.localId === editingId);
      if (!row) return false;
      return row.name !== name || row.contact !== contact || row.active !== active
        || row.qcAtSource !== qcAtSource
        || row.remarks !== remarks
        || row.inhouse !== inhouse
        || row.isDefault !== isDefault
        || !sameTypeChoice(row.fabricTypeIds, fabricTypeIds);
    }
    return Boolean(name.trim() || contact.trim() || remarks.trim() || inhouse || isDefault || fabricTypeIds !== null || qcAtSource !== 'none');
  }, [editingId, rows, name, contact, active, fabricTypeIds, qcAtSource, remarks, inhouse, isDefault]);

  const dirty = useMemo(() => {
    if (!hydrated) return false;
    return JSON.stringify(rows) !== JSON.stringify(baseline) || removed.length > 0 || formDirty;
  }, [hydrated, rows, baseline, removed.length, formDirty]);

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange?.(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const snapshot = useRef({ rows, removed, name, contact, active, fabricTypeIds, qcAtSource, remarks, inhouse, isDefault, editingId });
  snapshot.current = { rows, removed, name, contact, active, fabricTypeIds, qcAtSource, remarks, inhouse, isDefault, editingId };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setContact('');
    setActive(true);
    setFabricTypeIds(null);
    setQcAtSource('none');
    setRemarks('');
    setInhouse(false);
    setIsDefault(false);
  };

  const applyForm = (current: VendorDraft[]): VendorDraft[] | null => {
    const form = snapshot.current;
    const trimmed = form.name.trim();
    if (!trimmed) {
      if (form.editingId || form.contact.trim() || form.remarks.trim() || !form.active || form.fabricTypeIds !== null) {
        showNotification('Enter a vendor name before saving', 'error');
        return null;
      }
      return current;
    }
    if (form.fabricTypeIds === null) {
      showNotification('Select the fabric types', 'error');
      return null;
    }
    if (current.some((row) => row.localId !== form.editingId && row.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      showNotification('That fabric vendor already exists', 'error');
      return null;
    }
    const next = {
      name: trimmed,
      contact: form.contact.trim(),
      active: form.active,
      fabricTypeIds: chosenTypeIds(form.fabricTypeIds),
      qcAtSource: form.qcAtSource,
      remarks: form.remarks.trim(),
      inhouse: form.inhouse,
      isDefault: form.isDefault,
      dirty: true,
    };
    const clearOtherDefault = (list: VendorDraft[], keepId: string): VendorDraft[] => {
      if (!next.isDefault) return list;
      return list.map((row) => (
        row.localId !== keepId && row.inhouse === next.inhouse && row.isDefault
          ? { ...row, isDefault: false, dirty: true }
          : row
      ));
    };
    if (form.editingId) {
      const existing = current.find((row) => row.localId === form.editingId);
      if (
        existing
        && existing.name === trimmed
        && existing.contact === form.contact.trim()
        && existing.active === form.active
        && existing.qcAtSource === form.qcAtSource
        && existing.remarks === form.remarks.trim()
        && existing.inhouse === form.inhouse
        && existing.isDefault === form.isDefault
        && sameTypeChoice(existing.fabricTypeIds, form.fabricTypeIds)
      ) return current;
      return clearOtherDefault(
        current.map((row) => (row.localId === form.editingId ? { ...row, ...next } : row)),
        form.editingId,
      );
    }
    const localId = nextKey();
    return clearOtherDefault([...current, { localId, id: null, rowVersion: 1, ...next }], localId);
  };

  const submitForm = () => {
    const next = applyForm(rows);
    if (!next) return;
    setRows(next);
    resetForm();
  };

  const loadRow = (row: VendorDraft) => {
    setEditingId(row.localId);
    setName(row.name);
    setContact(row.contact);
    setActive(row.active);
    setFabricTypeIds(row.fabricTypeIds.length === 0 ? [ANY_TYPE] : row.fabricTypeIds);
    setQcAtSource(row.qcAtSource);
    setRemarks(row.remarks);
    setInhouse(row.inhouse);
    setIsDefault(row.isDefault);
  };

  const removeRow = (row: VendorDraft) => {
    setRows((list) => list.filter((item) => item.localId !== row.localId));
    if (row.id) setRemoved((list) => [...list, { ...row, active: false, dirty: true }]);
    if (editingId === row.localId) resetForm();
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      const pending = applyForm(snapshot.current.rows);
      if (!pending) return false;
      setRows(pending);
      resetForm();
      for (const row of [...pending, ...snapshot.current.removed]) {
        if (row.id && !row.dirty) continue;
        const res = await mmSavePartner({
          ...(row.id ? { id: row.id, row_version: row.rowVersion } : {}),
          kind: row.inhouse ? 'inhouse' : 'fabric_vendor',
          name: row.name.trim(),
          contact: row.contact.trim() || null,
          remarks: row.remarks.trim() || null,
          is_active: row.active,
          fabric_type_ids: row.fabricTypeIds,
          qc_at_source: row.qcAtSource,
          is_default: row.isDefault,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          await vendorsQ.refetch();
          return false;
        }
      }
      showNotification('Fabric vendors saved', 'success');
      await Promise.all([vendorsQ.refetch(), inhouseQ.refetch(), refreshV4()]);
      return true;
    },
  }), [dirty, showNotification, vendorsQ, inhouseQ, refreshV4]);

  const typeLabel = (ids: string[]) => {
    if (ids.length === 0) return 'Any type';
    return ids.map((id) => fabricTypes.find((row) => row.id === id)?.name || id).join(', ');
  };

  const pickFabricTypes = (next: string[]) => {
    if (next.length === 0) {
      setFabricTypeIds(null);
      return;
    }
    const hadAny = fabricTypeIds?.includes(ANY_TYPE) ?? false;
    const hasAny = next.includes(ANY_TYPE);
    if (hasAny && !hadAny) {
      setFabricTypeIds([ANY_TYPE]);
      return;
    }
    if (hasAny && next.length > 1) {
      setFabricTypeIds(next.filter((id) => id !== ANY_TYPE));
      return;
    }
    setFabricTypeIds(next);
  };

  const editingInhouse = Boolean(rows.find((row) => row.localId === editingId)?.inhouse);

  if (vendorsQ.isLoading || inhouseQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (vendorsQ.error || inhouseQ.error) {
    return (
      <p className="text-[12px] text-red-600 p-2">
        {(vendorsQ.error ?? inhouseQ.error) instanceof Error
          ? (vendorsQ.error ?? inhouseQ.error)?.message
          : 'Could not load fabric vendors'}
      </p>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto thin-scrollbar flex flex-col gap-3">
      <EditorSplitLayout
        fillHeight
        leftScrollable
        rightScrollable
        left={(
          <DesktopWriteGate>
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingId ? 'Edit fabric vendor' : 'Add fabric vendor'}
              </h4>
              <Input
                label="Name *"
                value={name}
                disabled={editingInhouse}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitForm()}
              />
              <Input label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
              <div>
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
                <textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y overflow-y-auto text-[11px] leading-4 max-h-24"
                />
              </div>
              <SelectDropdown
                size="compact"
                multiple
                closeOnSelect
                collapseWhenAll={false}
                label="Fabric types supplied"
                value={fabricTypeIds ?? []}
                onChange={pickFabricTypes}
                placeholder="Select"
                options={[
                  { value: ANY_TYPE, label: 'Any type' },
                  ...fabricTypes.map((type) => ({ value: type.id, label: type.name })),
                ]}
              />
              <SelectDropdown size="compact"
                label="QC at source"
                value={qcAtSource}
                onChange={(value) => setQcAtSource(qcAtSourceOf(value))}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'tested', label: 'Tested' },
                  { value: 'tested_inspected', label: 'Tested + inspected' },
                ]}
              />
              <EditorToggle
                label="In-house"
                on={inhouse}
                disabled={Boolean(rows.find((row) => row.localId === editingId)?.id)}
                onChange={setInhouse}
              />
              <EditorToggle
                label="Default for this source"
                on={isDefault}
                onChange={setIsDefault}
              />
              <EditorToggle label="Active" on={active} onChange={setActive} />
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
              title="Fabric vendors"
              subtitle="Click a row to edit."
              isEmpty={rows.length === 0}
              emptyMessage="No fabric vendors yet."
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={['S.No', 'Vendor', 'Source', 'Default', 'Fabric types', 'QC at source', 'Contact', 'Remarks', 'Active']}>
                {rows.map((row, idx) => (
                  <CatalogTableRow key={row.localId} onClick={() => loadRow(row)} selected={editingId === row.localId}>
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 truncate">
                      {row.name || '—'}
                      {!row.id ? <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span> : null}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-600">{row.inhouse ? 'In-house' : 'External'}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600">{row.isDefault ? 'Yes' : '—'}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{typeLabel(row.fabricTypeIds)}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{qcAtSourceLabel(row.qcAtSource)}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{row.contact || '—'}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{row.remarks.trim() || '—'}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600">{row.active ? 'Yes' : 'No'}</CatalogTableCell>
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

export default MmFabricVendorsPage;
