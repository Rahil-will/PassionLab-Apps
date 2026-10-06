import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
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
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import {
  mmSaveFacility,
  type MmV4FacilityKind,
  type MmV4Ownership,
} from '../lib/mmV4Rpc';
import { useMmV4Config, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmFacilitiesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type FacilityDraft = {
  localId: string;
  id: string | null;
  kind: MmV4FacilityKind;
  ownership: MmV4Ownership;
  code: string;
  name: string;
  address: string;
  contact: string;
  remarks: string;
  is_active: boolean;
  process_type_ids: string[];
  dirty: boolean;
};

const KIND_OPTIONS: { value: MmV4FacilityKind; label: string }[] = [
  { value: 'mill', label: 'Mill' },
  { value: 'process_unit', label: 'Processing unit' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'vendor', label: 'Fabric vendor' },
];

function kindLabel(kind: MmV4FacilityKind): string {
  return KIND_OPTIONS.find((k) => k.value === kind)?.label ?? kind;
}

const MmFacilitiesPage = forwardRef<
  MmFacilitiesHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFacilitiesPage({ onDirtyChange }, ref) {
  const { data, isLoading, error } = useMmV4Config();
  const refresh = useRefreshMmV4Config();
  const { showNotification } = useNotificationStore();

  const [facilities, setFacilities] = useState<FacilityDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [kind, setKind] = useState<MmV4FacilityKind>('mill');
  const [ownership, setOwnership] = useState<MmV4Ownership>('internal');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [remarks, setRemarks] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [processTypeIds, setProcessTypeIds] = useState<string[]>([]);

  useEffect(() => {
    if (!data) return;
    const nextFacilities: FacilityDraft[] = (data.facilities ?? []).map((f) => ({
      localId: f.id,
      id: f.id,
      kind: f.kind as MmV4FacilityKind,
      ownership: f.ownership as MmV4Ownership,
      code: f.code ?? '',
      name: f.name ?? '',
      address: f.address != null ? String(f.address) : '',
      contact: f.contact != null ? String(f.contact) : '',
      remarks: f.remarks != null ? String(f.remarks) : '',
      is_active: f.is_active !== false,
      process_type_ids: Array.isArray(f.process_type_ids) ? f.process_type_ids.map(String) : [],
      dirty: false,
    }));
    setFacilities(nextFacilities);
    setHydrated(true);
    onDirtyChange?.(false);
  }, [data, onDirtyChange]);

  const formDirty = Boolean(
    code.trim() || name.trim() || address.trim() || contact.trim() || remarks.trim() || processTypeIds.length > 0,
  );

  const dirty = useMemo(
    () => facilities.some((f) => f.dirty) || formDirty,
    [facilities, formDirty],
  );

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange?.(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const processTypes = data?.process_types ?? [];
  const visible = facilities.filter((f) => f.is_active);

  const resetForm = () => {
    setEditingLocalId(null);
    setKind('mill');
    setOwnership('internal');
    setCode('');
    setName('');
    setAddress('');
    setContact('');
    setRemarks('');
    setIsActive(true);
    setProcessTypeIds([]);
  };

  const loadFacility = (row: FacilityDraft) => {
    setEditingLocalId(row.localId);
    setKind(row.kind);
    setOwnership(row.ownership);
    setCode(row.code);
    setName(row.name);
    setAddress(row.address);
    setContact(row.contact);
    setRemarks(row.remarks);
    setIsActive(row.is_active);
    setProcessTypeIds([...row.process_type_ids]);
  };

  const submitForm = () => {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode || !trimmedName) {
      showNotification('Facility code and name are required', 'error');
      return;
    }
    if (facilities.some((f) => (
      f.localId !== editingLocalId
      && f.code.toLowerCase() === trimmedCode.toLowerCase()
    ))) {
      showNotification('That facility code already exists', 'error');
      return;
    }
    const payload = {
      kind,
      ownership,
      code: trimmedCode,
      name: trimmedName,
      address: address.trim(),
      contact: contact.trim(),
      remarks: remarks.trim(),
      is_active: isActive,
      process_type_ids: kind === 'process_unit' ? processTypeIds : [],
      dirty: true,
    };
    if (editingLocalId) {
      setFacilities((rows) => rows.map((row) => (
        row.localId === editingLocalId ? { ...row, ...payload } : row
      )));
      resetForm();
    } else {
      setFacilities((rows) => [
        ...rows,
        { localId: `tmp_${crypto.randomUUID()}`, id: null, ...payload },
      ]);
      resetForm();
    }
  };

  const removeFacility = (row: FacilityDraft) => {
    if (!row.id) {
      setFacilities((rows) => rows.filter((r) => r.localId !== row.localId));
    } else {
      setFacilities((rows) => rows.map((r) => (
        r.localId === row.localId ? { ...r, is_active: false, dirty: true } : r
      )));
    }
    if (editingLocalId === row.localId) resetForm();
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      let pendingFacilities = facilities;

      const trimmedCode = code.trim();
      const trimmedName = name.trim();
      if (trimmedCode || trimmedName || address.trim() || contact.trim() || remarks.trim()) {
        if (!trimmedCode || !trimmedName) {
          showNotification('Facility code and name are required', 'error');
          return false;
        }
        const payload = {
          kind,
          ownership,
          code: trimmedCode,
          name: trimmedName,
          address: address.trim(),
          contact: contact.trim(),
          remarks: remarks.trim(),
          is_active: isActive,
          process_type_ids: kind === 'process_unit' ? processTypeIds : [],
          dirty: true,
        };
        if (editingLocalId) {
          pendingFacilities = pendingFacilities.map((row) => (
            row.localId === editingLocalId ? { ...row, ...payload } : row
          ));
        } else {
          pendingFacilities = [
            ...pendingFacilities,
            { localId: `tmp_${crypto.randomUUID()}`, id: null, ...payload },
          ];
        }
        setFacilities(pendingFacilities);
        resetForm();
      }

      for (const facility of pendingFacilities.filter((f) => f.dirty || !f.id)) {
        if (!facility.code.trim() || !facility.name.trim()) {
          showNotification('Facility code and name are required', 'error');
          return false;
        }
        const res = await mmSaveFacility({
          ...(facility.id ? { id: facility.id } : {}),
          kind: facility.kind,
          ownership: facility.ownership,
          code: facility.code.trim(),
          name: facility.name.trim(),
          address: facility.address.trim() || null,
          contact: facility.contact.trim() || null,
          remarks: facility.remarks.trim() || null,
          is_active: facility.is_active,
          process_type_ids:
            facility.kind === 'process_unit' ? facility.process_type_ids : undefined,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          return false;
        }
      }

      showNotification('Facilities saved', 'success');
      await refresh();
      return true;
    },
  }), [
    dirty,
    facilities,
    code,
    name,
    address,
    contact,
    remarks,
    kind,
    ownership,
    isActive,
    processTypeIds,
    editingLocalId,
    refresh,
    showNotification,
  ]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[12px] text-red-600 p-4">
        {error instanceof Error ? error.message : 'Could not load facilities'}
      </p>
    );
  }

  return (
    <EditorSplitLayout
      scrollable={false}
      leftScrollable
      rightScrollable
      fillHeight
      left={(
        <DesktopWriteGate>
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingLocalId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingLocalId ? 'Edit facility' : 'Add facility'}
              </h4>
            </div>
            <SelectDropdown
              label="Kind"
              value={kind}
              onChange={(value) => {
                const next = value as MmV4FacilityKind;
                setKind(next);
                if (next === 'vendor') setOwnership('external');
                else if (ownership === 'external') setOwnership('internal');
                if (next !== 'process_unit') setProcessTypeIds([]);
              }}
              options={KIND_OPTIONS}
            />
            <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitForm()}
            />
            <SelectDropdown
              label="Ownership"
              value={ownership}
              onChange={(value) => setOwnership(value as MmV4Ownership)}
              options={[
                { value: 'internal', label: 'In-house' },
                { value: 'external', label: 'External' },
              ]}
            />
            <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
            <Input label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} />
            <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            <label className="flex items-center gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>
            {kind === 'process_unit' ? (
              <div>
                <p className="text-[10px] font-semibold text-slate-600 mb-1">Process types</p>
                <div className="flex flex-col gap-1.5">
                  {processTypes.map((pt) => (
                    <label key={pt.id} className="text-[11px] text-slate-700 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={processTypeIds.includes(pt.id)}
                        onChange={(e) => {
                          setProcessTypeIds((prev) => (
                            e.target.checked
                              ? [...prev, pt.id]
                              : prev.filter((id) => id !== pt.id)
                          ));
                        }}
                      />
                      {pt.name}
                    </label>
                  ))}
                  {processTypes.length === 0 ? (
                    <p className="text-[11px] text-slate-400">No process types in config yet</p>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                icon={editingLocalId ? Pencil : Plus}
                disabled={!code.trim() || !name.trim()}
                onClick={submitForm}
                className="w-full"
              >
                {editingLocalId ? 'Update in table' : 'Add to table'}
              </Button>
              {editingLocalId ? (
                <>
                  <Button
                    variant="danger-light"
                    size="sm"
                    icon={Trash2}
                    onClick={() => {
                      const row = facilities.find((r) => r.localId === editingLocalId);
                      if (row) removeFacility(row);
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
            title="Facilities"
            subtitle="Mills, processing units, warehouses, and fabric vendors"
            isEmpty={visible.length === 0}
            emptyMessage="No facilities yet."
            headerAction={<MmTableSaveButton />}
          >
            <CatalogTable headers={['S.No', 'Code', 'Name', 'Kind', 'Ownership', 'Active', '']}>
              {visible.map((row, idx) => (
                <CatalogTableRow
                  key={row.localId}
                  onClick={() => loadFacility(row)}
                  selected={editingLocalId === row.localId}
                >
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 truncate">
                    {row.code || '—'}
                    {!row.id ? (
                      <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                    ) : null}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-800 truncate">{row.name || '—'}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">{kindLabel(row.kind)}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">
                    {row.ownership === 'internal' ? 'In-house' : 'External'}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">
                    {row.is_active ? 'Yes' : 'No'}
                  </CatalogTableCell>
                  <CatalogTableCell>
                    <DesktopWriteGate>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFacility(row);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                        aria-label={`Remove ${row.name || row.code || 'facility'}`}
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
  );
});

export default MmFacilitiesPage;
