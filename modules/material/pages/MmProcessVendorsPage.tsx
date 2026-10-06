import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Input, Modal, SelectDropdown } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { EditorSplitLayout } from '../../../components/settings/EditorSplitLayout';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from '../../../components/settings/CatalogTablePanel';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import { mmListProcessTypes, mmListProcessVendors, mmSaveProcessCatalog } from '../lib/mmRpc';

export interface MmProcessVendorsHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type TypeRow = {
  key: string;
  id: string | null;
  name: string;
  active: boolean;
};

type VendorRow = {
  key: string;
  id: string | null;
  name: string;
  active: boolean;
  typeKeys: string[];
};

let localSeq = 1;
const nextKey = () => `new-${localSeq++}`;

const MmProcessVendorsPage = forwardRef<
  MmProcessVendorsHandle,
  { onDirtyChange: (dirty: boolean) => void }
>(function MmProcessVendorsPage({ onDirtyChange }, ref) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [types, setTypes] = useState<TypeRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [baselineTypes, setBaselineTypes] = useState<TypeRow[]>([]);
  const [baselineVendors, setBaselineVendors] = useState<VendorRow[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [editingVendorKey, setEditingVendorKey] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorActive, setVendorActive] = useState(true);
  const [vendorTypeKeys, setVendorTypeKeys] = useState<string[]>([]);
  const [pickTypeKey, setPickTypeKey] = useState('');

  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');

  const query = useQuery({
    queryKey: ['mm', factoryId ?? '', 'ops', 'processCatalog'],
    queryFn: async () => {
      const [typeRes, vendorRes] = await Promise.all([mmListProcessTypes(), mmListProcessVendors()]);
      if (typeRes.ok === false) throw new Error(typeRes.message);
      if (vendorRes.ok === false) throw new Error(vendorRes.message);
      return {
        types: Array.isArray(typeRes.data) ? typeRes.data : [],
        vendors: Array.isArray(vendorRes.data) ? vendorRes.data : [],
      };
    },
    enabled: Boolean(factoryId),
  });

  useEffect(() => {
    if (!query.data) return;
    const nextTypes: TypeRow[] = query.data.types.map((type) => ({
      key: type.id,
      id: type.id,
      name: type.name,
      active: type.active,
    }));
    const nextVendors: VendorRow[] = query.data.vendors.map((vendor) => ({
      key: vendor.id,
      id: vendor.id,
      name: vendor.name,
      active: vendor.active,
      typeKeys: vendor.type_ids,
    }));
    setTypes(nextTypes);
    setVendors(nextVendors);
    setBaselineTypes(nextTypes);
    setBaselineVendors(nextVendors);
    setHydrated(true);
    onDirtyChange(false);
  }, [query.data, onDirtyChange]);

  const formDirty = Boolean(vendorName.trim() || vendorTypeKeys.length > 0);

  const dirty = useMemo(() => {
    if (!hydrated) return false;
    return (
      JSON.stringify(types) !== JSON.stringify(baselineTypes)
      || JSON.stringify(vendors) !== JSON.stringify(baselineVendors)
      || formDirty
    );
  }, [types, vendors, baselineTypes, baselineVendors, formDirty, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const activeTypes = useMemo(
    () => types.filter((t) => t.active && t.name.trim()),
    [types],
  );

  const availableToPick = useMemo(
    () => activeTypes.filter((t) => !vendorTypeKeys.includes(t.key)),
    [activeTypes, vendorTypeKeys],
  );

  const pickOptions = useMemo(
    () => [
      { value: '', label: 'Select process type…' },
      ...availableToPick.map((t) => ({ value: t.key, label: t.name })),
    ],
    [availableToPick],
  );

  const resetForm = () => {
    setEditingVendorKey(null);
    setVendorName('');
    setVendorActive(true);
    setVendorTypeKeys([]);
    setPickTypeKey('');
  };

  const loadVendor = (row: VendorRow) => {
    setEditingVendorKey(row.key);
    setVendorName(row.name);
    setVendorActive(row.active);
    setVendorTypeKeys([...row.typeKeys]);
    setPickTypeKey('');
  };

  const addPickedType = () => {
    if (!pickTypeKey) return;
    if (vendorTypeKeys.includes(pickTypeKey)) return;
    setVendorTypeKeys((prev) => [...prev, pickTypeKey]);
    setPickTypeKey('');
  };

  const removeCapability = (typeKey: string) => {
    setVendorTypeKeys((prev) => prev.filter((k) => k !== typeKey));
  };

  const submitVendorForm = () => {
    const trimmed = vendorName.trim();
    if (!trimmed) return;
    if (vendors.some((v) => v.key !== editingVendorKey && v.name.toLowerCase() === trimmed.toLowerCase())) {
      showNotification('That process vendor already exists', 'error');
      return;
    }
    if (editingVendorKey) {
      setVendors((rows) => rows.map((row) => (
        row.key === editingVendorKey
          ? { ...row, name: trimmed, active: vendorActive, typeKeys: vendorTypeKeys }
          : row
      )));
    } else {
      setVendors((rows) => [
        ...rows,
        {
          key: nextKey(),
          id: null,
          name: trimmed,
          active: vendorActive,
          typeKeys: vendorTypeKeys,
        },
      ]);
    }
    resetForm();
  };

  const removeVendor = (row: VendorRow) => {
    setVendors((rows) => rows.filter((r) => r.key !== row.key));
    if (editingVendorKey === row.key) resetForm();
  };

  const createProcessType = () => {
    const trimmed = newTypeName.trim();
    if (!trimmed) return;
    if (types.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      showNotification('That process type already exists', 'error');
      return;
    }
    const key = nextKey();
    setTypes((rows) => [...rows, { key, id: null, name: trimmed, active: true }]);
    setVendorTypeKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setNewTypeName('');
    setTypeModalOpen(false);
    setPickTypeKey('');
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      let pendingTypes = types;
      let pendingVendors = vendors;

      const pendingName = vendorName.trim();
      if (pendingName) {
        if (pendingVendors.some((v) => v.key !== editingVendorKey && v.name.toLowerCase() === pendingName.toLowerCase())) {
          showNotification('That process vendor already exists', 'error');
          return false;
        }
        if (editingVendorKey) {
          pendingVendors = pendingVendors.map((row) => (
            row.key === editingVendorKey
              ? { ...row, name: pendingName, active: vendorActive, typeKeys: vendorTypeKeys }
              : row
          ));
        } else {
          pendingVendors = [
            ...pendingVendors,
            {
              key: nextKey(),
              id: null,
              name: pendingName,
              active: vendorActive,
              typeKeys: vendorTypeKeys,
            },
          ];
        }
        setVendors(pendingVendors);
        resetForm();
      }

      if (pendingVendors.some((v) => !v.name.trim())) {
        showNotification('Process vendor name is required', 'error');
        return false;
      }
      if (pendingTypes.some((t) => !t.name.trim())) {
        showNotification('Process type name is required', 'error');
        return false;
      }

      const res = await mmSaveProcessCatalog({
        types: pendingTypes.map((type, index) => ({
          key: type.key,
          id: type.id,
          name: type.name.trim(),
          active: type.active,
          sort_order: index + 1,
        })),
        vendors: pendingVendors.map((vendor) => ({
          id: vendor.id,
          name: vendor.name.trim(),
          active: vendor.active,
          type_keys: vendor.typeKeys,
        })),
      });
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return false;
      }

      showNotification('Process vendors saved', 'success');
      await query.refetch();
      return true;
    },
  }), [
    dirty,
    types,
    vendors,
    vendorName,
    vendorActive,
    vendorTypeKeys,
    editingVendorKey,
    showNotification,
    query,
  ]);

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (query.error) {
    return (
      <p className="text-[12px] text-red-600 p-2">
        {query.error instanceof Error ? query.error.message : 'Could not load process vendors'}
      </p>
    );
  }

  return (
    <>
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
                  {editingVendorKey ? <Pencil size={14} /> : <Plus size={14} />}
                  {editingVendorKey ? 'Edit process vendor' : 'Add process vendor'}
                </h4>
              </div>
              <Input
                label="Vendor name"
                placeholder="Vendor name"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitVendorForm()}
              />
              <label className="flex items-center gap-2 text-[11px] text-slate-700">
                <input
                  type="checkbox"
                  checked={vendorActive}
                  onChange={(e) => setVendorActive(e.target.checked)}
                />
                Active
              </label>

              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-slate-600">Process capabilities</p>
                <div className="flex gap-2 items-end">
                  <div className="flex-1 min-w-0">
                    <SelectDropdown
                      label="Process type"
                      value={pickTypeKey}
                      onChange={setPickTypeKey}
                      options={pickOptions}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!pickTypeKey}
                    onClick={addPickedType}
                  >
                    Add
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewTypeName('');
                    setTypeModalOpen(true);
                  }}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                >
                  + New process type
                </button>
                {vendorTypeKeys.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No processes selected yet</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {vendorTypeKeys.map((key) => {
                      const type = types.find((t) => t.key === key);
                      return (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                        >
                          {type?.name ?? '—'}
                          <button
                            type="button"
                            onClick={() => removeCapability(key)}
                            className="text-slate-400 hover:text-red-600"
                            aria-label={`Remove ${type?.name ?? 'process'}`}
                          >
                            <X size={12} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  icon={editingVendorKey ? Pencil : Plus}
                  disabled={!vendorName.trim()}
                  onClick={submitVendorForm}
                  className="w-full"
                >
                  {editingVendorKey ? 'Update in table' : 'Add to table'}
                </Button>
                {editingVendorKey ? (
                  <>
                    <Button
                      variant="danger-light"
                      size="sm"
                      icon={Trash2}
                      onClick={() => {
                        const row = vendors.find((r) => r.key === editingVendorKey);
                        if (row) removeVendor(row);
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
              title="Process vendors"
              subtitle="Click a row to edit. Capabilities are the processes this vendor can run."
              isEmpty={vendors.length === 0}
              emptyMessage="No process vendors yet."
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={['S.No', 'Vendor', 'Processes', 'Active', '']}>
                {vendors.map((row, idx) => {
                  const processLabels = row.typeKeys
                    .map((key) => types.find((t) => t.key === key)?.name)
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <CatalogTableRow
                      key={row.key}
                      onClick={() => loadVendor(row)}
                      selected={editingVendorKey === row.key}
                    >
                      <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                      <CatalogTableCell className="font-medium text-slate-800 truncate">
                        {row.name || '—'}
                        {!row.id ? (
                          <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                        ) : null}
                      </CatalogTableCell>
                      <CatalogTableCell className="text-slate-600 truncate">
                        {processLabels || '—'}
                      </CatalogTableCell>
                      <CatalogTableCell className="text-slate-600">
                        {row.active ? 'Yes' : 'No'}
                      </CatalogTableCell>
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
                  );
                })}
              </CatalogTable>
            </CatalogTablePanel>
          </div>
        )}
      />

      <Modal isOpen={typeModalOpen} onClose={() => setTypeModalOpen(false)} className="max-w-sm">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">New process type</h3>
          <p className="text-[11px] text-slate-500">
            Fabric processes only — e.g. dyeing, printing, washing, finishing.
          </p>
          <Input
            label="Process name"
            placeholder="e.g. Dyeing"
            value={newTypeName}
            onChange={(e) => setNewTypeName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createProcessType()}
          />
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" size="sm" variant="secondary" onClick={() => setTypeModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={!newTypeName.trim()}
              onClick={createProcessType}
            >
              Add type
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
});

export default MmProcessVendorsPage;
