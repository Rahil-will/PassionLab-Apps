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
import { mmSaveMachine, type MmV4MachineSpecs } from '../lib/mmV4Rpc';
import { useMmV4Config, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmMachinesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type MachineDraft = {
  localId: string;
  id: string | null;
  facilityId: string;
  machine_kind: string;
  code: string;
  name: string;
  is_active: boolean;
  specs: MmV4MachineSpecs;
  dirty: boolean;
};

function specFieldsForKind(kind: string): { key: keyof MmV4MachineSpecs & string; label: string }[] {
  const k = kind.toLowerCase();
  if (k.includes('knit')) {
    return [
      { key: 'dia', label: 'Dia' },
      { key: 'gauge', label: 'Gauge' },
      { key: 'feeders', label: 'Feeders' },
    ];
  }
  if (k.includes('loom') || k.includes('woven')) {
    return [
      { key: 'reed', label: 'Reed' },
      { key: 'width', label: 'Width' },
    ];
  }
  if (k.includes('dye')) {
    return [{ key: 'capacity_kg', label: 'Capacity (kg)' }];
  }
  return [
    { key: 'dia', label: 'Dia' },
    { key: 'gauge', label: 'Gauge' },
    { key: 'feeders', label: 'Feeders' },
    { key: 'reed', label: 'Reed' },
    { key: 'width', label: 'Width' },
    { key: 'capacity_kg', label: 'Capacity (kg)' },
  ];
}

const MmMachinesPage = forwardRef<
  MmMachinesHandle,
  { onDirtyChange?: (dirty: boolean) => void; lockedFacilityId?: string }
>(function MmMachinesPage({ onDirtyChange, lockedFacilityId }, ref) {
  const { data, isLoading, error } = useMmV4Config();
  const refresh = useRefreshMmV4Config();
  const { showNotification } = useNotificationStore();

  const [machines, setMachines] = useState<MachineDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState('');
  const [machineKind, setMachineKind] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [specs, setSpecs] = useState<MmV4MachineSpecs>({});

  const internalFacilities = useMemo(
    () => (data?.facilities ?? []).filter((f) => f.ownership === 'internal' && f.is_active !== false),
    [data?.facilities],
  );

  const machineKinds = data?.machine_kinds ?? [];
  const facilityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of data?.facilities ?? []) {
      map.set(f.id, f.name || f.code || f.id);
    }
    return map;
  }, [data?.facilities]);

  useEffect(() => {
    if (!data) return;
    const next: MachineDraft[] = (data.machines ?? []).map((m) => ({
      localId: m.id,
      id: m.id,
      facilityId: m.facility_id,
      machine_kind: m.machine_kind ?? '',
      code: m.code ?? '',
      name: m.name != null ? String(m.name) : '',
      is_active: m.is_active !== false,
      specs: (m.specs ?? {}) as MmV4MachineSpecs,
      dirty: false,
    }));
    setMachines(next);
    setHydrated(true);
    onDirtyChange?.(false);
  }, [data, onDirtyChange]);

  const formDirty = useMemo(() => {
    if (editingLocalId) {
      const row = machines.find((m) => m.localId === editingLocalId);
      if (!row) return false;
      return (
        row.facilityId !== facilityId
        || row.machine_kind !== machineKind
        || row.code !== code
        || row.name !== name
        || row.is_active !== isActive
        || JSON.stringify(row.specs ?? {}) !== JSON.stringify(specs ?? {})
      );
    }
    // Default machine kind alone must not count as unsaved.
    return Boolean((lockedFacilityId ? '' : facilityId) || code.trim() || name.trim());
  }, [
    lockedFacilityId,
    editingLocalId,
    machines,
    facilityId,
    machineKind,
    code,
    name,
    isActive,
    specs,
  ]);

  const dirty = useMemo(
    () => machines.some((m) => m.dirty) || formDirty,
    [machines, formDirty],
  );

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange?.(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const visible = machines.filter((m) => m.is_active && (!lockedFacilityId || m.facilityId === lockedFacilityId));
  const specFields = specFieldsForKind(machineKind);

  const resetForm = () => {
    setEditingLocalId(null);
    setFacilityId(lockedFacilityId ?? '');
    setMachineKind(machineKinds[0] ?? '');
    setCode('');
    setName('');
    setIsActive(true);
    setSpecs({});
  };

  useEffect(() => {
    if (!editingLocalId && !machineKind && machineKinds[0]) {
      setMachineKind(machineKinds[0]);
    }
  }, [machineKinds, machineKind, editingLocalId]);

  const loadMachine = (row: MachineDraft) => {
    setEditingLocalId(row.localId);
    setFacilityId(row.facilityId);
    setMachineKind(row.machine_kind);
    setCode(row.code);
    setName(row.name);
    setIsActive(row.is_active);
    setSpecs({ ...row.specs });
  };

  const chosenFacilityId = lockedFacilityId || facilityId;

  const submitForm = () => {
    const trimmedCode = code.trim();
    if (!chosenFacilityId) {
      showNotification('Select a mill', 'error');
      return;
    }
    if (!trimmedCode || !machineKind.trim()) {
      showNotification('Machine code and kind are required', 'error');
      return;
    }
    const payload = {
      facilityId: chosenFacilityId,
      machine_kind: machineKind.trim(),
      code: trimmedCode,
      name: name.trim(),
      is_active: isActive,
      specs,
      dirty: true,
    };
    if (editingLocalId) {
      setMachines((rows) => rows.map((row) => (
        row.localId === editingLocalId ? { ...row, ...payload } : row
      )));
    } else {
      setMachines((rows) => [
        ...rows,
        { localId: `tmp_${crypto.randomUUID()}`, id: null, ...payload },
      ]);
    }
    resetForm();
  };

  const removeMachine = (row: MachineDraft) => {
    if (!row.id) {
      setMachines((rows) => rows.filter((r) => r.localId !== row.localId));
    } else {
      setMachines((rows) => rows.map((r) => (
        r.localId === row.localId ? { ...r, is_active: false, dirty: true } : r
      )));
    }
    if (editingLocalId === row.localId) resetForm();
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      let pending = machines;
      const trimmedCode = code.trim();
      const saveFacilityId = lockedFacilityId || facilityId;
      if (trimmedCode || name.trim() || (!lockedFacilityId && facilityId)) {
        if (!saveFacilityId) {
          showNotification('Select a mill', 'error');
          return false;
        }
        if (!trimmedCode || !machineKind.trim()) {
          showNotification('Machine code and kind are required', 'error');
          return false;
        }
        const payload = {
          facilityId: saveFacilityId,
          machine_kind: machineKind.trim(),
          code: trimmedCode,
          name: name.trim(),
          is_active: isActive,
          specs,
          dirty: true,
        };
        if (editingLocalId) {
          pending = pending.map((row) => (
            row.localId === editingLocalId ? { ...row, ...payload } : row
          ));
        } else {
          pending = [
            ...pending,
            { localId: `tmp_${crypto.randomUUID()}`, id: null, ...payload },
          ];
        }
        setMachines(pending);
        resetForm();
      }

      for (const machine of pending.filter((m) => (m.dirty || !m.id) && (!lockedFacilityId || m.facilityId === lockedFacilityId))) {
        if (!machine.facilityId || !machine.code.trim() || !machine.machine_kind.trim()) {
          showNotification('Machine mill, code, and kind are required', 'error');
          return false;
        }
        const res = await mmSaveMachine({
          ...(machine.id ? { id: machine.id } : {}),
          facility_id: machine.facilityId,
          machine_kind: machine.machine_kind.trim(),
          code: machine.code.trim(),
          name: machine.name.trim() || null,
          specs: machine.specs,
          is_active: machine.is_active,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          return false;
        }
      }

      showNotification('Machines saved', 'success');
      await refresh();
      return true;
    },
  }), [
    dirty,
    machines,
    facilityId,
    code,
    name,
    machineKind,
    isActive,
    specs,
    editingLocalId,
    lockedFacilityId,
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
        {error instanceof Error ? error.message : 'Could not load machines'}
      </p>
    );
  }

  return (
    <EditorSplitLayout
      scrollable={false}
      leftScrollable
      rightScrollable
      fillHeight={!lockedFacilityId}
      left={(
        <DesktopWriteGate>
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingLocalId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingLocalId ? 'Edit machine' : 'Add machine'}
              </h4>
            </div>
            {lockedFacilityId ? null : (
              <>
                <SelectDropdown
                  label="Mill"
                  value={facilityId}
                  onChange={setFacilityId}
                  options={[
                    { value: '', label: 'Select mill…' },
                    ...internalFacilities.map((f) => ({
                      value: f.id,
                      label: f.name || f.code || f.id,
                    })),
                  ]}
                />
                {internalFacilities.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    Add a mill under Settings → Material → Mills.
                  </p>
                ) : null}
              </>
            )}
            <SelectDropdown
              label="Kind"
              value={machineKind}
              onChange={(value) => {
                setMachineKind(value);
                setSpecs({});
              }}
              options={(machineKinds.length ? machineKinds : [machineKind || 'knitting']).map((k) => ({
                value: k,
                label: k,
              }))}
            />
            <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitForm()}
            />
            <label className="flex items-center gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>
            {specFields.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-slate-600">Specs</p>
                {specFields.map((field) => (
                  <Input
                    key={field.key}
                    label={field.label}
                    value={specs[field.key] != null ? String(specs[field.key]) : ''}
                    onChange={(e) => setSpecs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                ))}
              </div>
            ) : null}
            <div className="flex flex-col gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                icon={editingLocalId ? Pencil : Plus}
                disabled={!chosenFacilityId || !code.trim() || !machineKind.trim()}
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
                      const row = machines.find((r) => r.localId === editingLocalId);
                      if (row) removeMachine(row);
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
            title="Machines"
            subtitle={lockedFacilityId ? 'Machines on this mill. Click a row to edit.' : 'In-house machines only. Click a row to edit.'}
            isEmpty={visible.length === 0}
            emptyMessage={lockedFacilityId ? 'No machines on this mill yet.' : 'No machines yet.'}
            headerAction={<MmTableSaveButton />}
          >
            <CatalogTable headers={lockedFacilityId ? ['S.No', 'Code', 'Name', 'Kind', 'Active', ''] : ['S.No', 'Code', 'Name', 'Mill', 'Kind', 'Active', '']}>
              {visible.map((row, idx) => (
                <CatalogTableRow
                  key={row.localId}
                  onClick={() => loadMachine(row)}
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
                  {lockedFacilityId ? null : (
                    <CatalogTableCell className="text-slate-600 truncate">
                      {facilityNameById.get(row.facilityId) ?? '—'}
                    </CatalogTableCell>
                  )}
                  <CatalogTableCell className="text-slate-600">{row.machine_kind || '—'}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">
                    {row.is_active ? 'Yes' : 'No'}
                  </CatalogTableCell>
                  <CatalogTableCell>
                    <DesktopWriteGate>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeMachine(row);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                        aria-label={`Remove ${row.name || row.code || 'machine'}`}
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

export default MmMachinesPage;
