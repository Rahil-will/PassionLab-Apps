import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Input, SelectDropdown } from '../../../components/ui';
import { useNotificationStore } from '../../../stores';
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import {
  mmSaveFacility,
  mmSaveMachine,
  type MmV4FacilityKind,
  type MmV4MachineSpecs,
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

type MachineDraft = {
  localId: string;
  id: string | null;
  facilityLocalId: string;
  machine_kind: string;
  code: string;
  name: string;
  is_active: boolean;
  specs: MmV4MachineSpecs;
  dirty: boolean;
};

const KIND_GROUPS: { kind: MmV4FacilityKind; label: string }[] = [
  { kind: 'mill', label: 'Mills' },
  { kind: 'process_unit', label: 'Processing units' },
  { kind: 'warehouse', label: 'Warehouses' },
  { kind: 'vendor', label: 'Fabric vendors' },
];

function emptyFacility(kind: MmV4FacilityKind): FacilityDraft {
  return {
    localId: `tmp_${crypto.randomUUID()}`,
    id: null,
    kind,
    ownership: kind === 'vendor' ? 'external' : 'internal',
    code: '',
    name: '',
    address: '',
    contact: '',
    remarks: '',
    is_active: true,
    process_type_ids: [],
    dirty: true,
  };
}

function emptyMachine(facilityLocalId: string, machineKind: string): MachineDraft {
  return {
    localId: `tmp_${crypto.randomUUID()}`,
    id: null,
    facilityLocalId,
    machine_kind: machineKind,
    code: '',
    name: '',
    is_active: true,
    specs: {},
    dirty: true,
  };
}

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

const MmFacilitiesPage = forwardRef<
  MmFacilitiesHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFacilitiesPage({ onDirtyChange }, ref) {
  const { data, isLoading, error } = useMmV4Config();
  const refresh = useRefreshMmV4Config();
  const { showNotification } = useNotificationStore();

  const [facilities, setFacilities] = useState<FacilityDraft[]>([]);
  const [machines, setMachines] = useState<MachineDraft[]>([]);
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

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
    const nextMachines: MachineDraft[] = (data.machines ?? []).map((m) => ({
      localId: m.id,
      id: m.id,
      facilityLocalId: m.facility_id,
      machine_kind: m.machine_kind ?? '',
      code: m.code ?? '',
      name: m.name != null ? String(m.name) : '',
      is_active: m.is_active !== false,
      specs: (m.specs ?? {}) as MmV4MachineSpecs,
      dirty: false,
    }));
    setFacilities(nextFacilities);
    setMachines(nextMachines);
    setHydrated(true);
    onDirtyChange?.(false);
  }, [data, onDirtyChange]);

  const dirty = useMemo(
    () => facilities.some((f) => f.dirty) || machines.some((m) => m.dirty),
    [facilities, machines],
  );

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange?.(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const selected = facilities.find((f) => f.localId === selectedLocalId) ?? null;
  const selectedMachines = machines.filter((m) => m.facilityLocalId === selectedLocalId);
  const processTypes = data?.process_types ?? [];
  const machineKinds = data?.machine_kinds ?? [];

  const patchFacility = (localId: string, patch: Partial<FacilityDraft>) => {
    setFacilities((rows) =>
      rows.map((row) => (row.localId === localId ? { ...row, ...patch, dirty: true } : row)),
    );
  };

  const patchMachine = (localId: string, patch: Partial<MachineDraft>) => {
    setMachines((rows) =>
      rows.map((row) => (row.localId === localId ? { ...row, ...patch, dirty: true } : row)),
    );
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      const facilityIdByLocal = new Map<string, string>();
      for (const facility of facilities) {
        if (facility.id) facilityIdByLocal.set(facility.localId, facility.id);
      }

      for (const facility of facilities.filter((f) => f.dirty)) {
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
        facilityIdByLocal.set(facility.localId, res.data.id);
      }

      for (const machine of machines.filter((m) => m.dirty)) {
        const facilityId =
          facilityIdByLocal.get(machine.facilityLocalId)
          ?? facilities.find((f) => f.localId === machine.facilityLocalId)?.id
          ?? null;
        if (!facilityId) {
          showNotification('Save the facility before saving its machines', 'error');
          return false;
        }
        if (!machine.code.trim() || !machine.machine_kind.trim()) {
          showNotification('Machine code and kind are required', 'error');
          return false;
        }
        const res = await mmSaveMachine({
          ...(machine.id ? { id: machine.id } : {}),
          facility_id: facilityId,
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

      showNotification('Facilities saved', 'success');
      await refresh();
      return true;
    },
  }), [dirty, facilities, machines, refresh, showNotification]);

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
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h3 className="text-[13px] font-semibold text-slate-900">Facilities & machines</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Mills, processing units, warehouses, and fabric vendors. Machines only on in-house sites.
          </p>
        </div>
        <MmTableSaveButton />
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-[42%] min-w-[260px] border-r border-slate-100 overflow-y-auto thin-scrollbar p-3 space-y-4">
          {KIND_GROUPS.map((group) => {
            const rows = facilities.filter((f) => f.kind === group.kind);
            return (
              <section key={group.kind}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {group.label}
                  </h4>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    icon={Plus}
                    onClick={() => {
                      const row = emptyFacility(group.kind);
                      setFacilities((prev) => [...prev, row]);
                      setSelectedLocalId(row.localId);
                    }}
                  >
                    Add
                  </Button>
                </div>
                <div className="space-y-1">
                  {rows.length === 0 ? (
                    <p className="text-[11px] text-slate-400 px-1 py-2">None yet</p>
                  ) : (
                    rows.map((row) => (
                      <button
                        key={row.localId}
                        type="button"
                        onClick={() => setSelectedLocalId(row.localId)}
                        className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                          selectedLocalId === row.localId
                            ? 'bg-blue-50 border-blue-200 text-blue-800'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">{row.name || row.code || 'Untitled'}</span>
                          <Badge variant={row.ownership === 'internal' ? 'primary' : 'outline'}>
                            {row.ownership === 'internal' ? 'In-house' : 'External'}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-[10px] text-slate-500 flex items-center gap-2">
                          <span>{row.code || '—'}</span>
                          {!row.is_active ? <span className="text-amber-600">Inactive</span> : null}
                          {row.dirty ? <span className="text-blue-600">Unsaved</span> : null}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto thin-scrollbar p-4">
          {!selected ? (
            <p className="text-[12px] text-slate-400">Select a facility to edit, or add one.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                  <Pencil size={14} className="text-slate-400" />
                  Facility
                </h4>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Code"
                  value={selected.code}
                  onChange={(e) => patchFacility(selected.localId, { code: e.target.value })}
                />
                <Input
                  label="Name"
                  value={selected.name}
                  onChange={(e) => patchFacility(selected.localId, { name: e.target.value })}
                />
                <SelectDropdown
                  label="Ownership"
                  value={selected.ownership}
                  onChange={(value) =>
                    patchFacility(selected.localId, { ownership: value as MmV4Ownership })
                  }
                  options={[
                    { value: 'internal', label: 'In-house' },
                    { value: 'external', label: 'External' },
                  ]}
                />
                <label className="flex items-end gap-2 text-[12px] text-slate-700 pb-2">
                  <input
                    type="checkbox"
                    checked={selected.is_active}
                    onChange={(e) => patchFacility(selected.localId, { is_active: e.target.checked })}
                  />
                  Active
                </label>
                <div className="col-span-2">
                  <Input
                    label="Address"
                    value={selected.address}
                    onChange={(e) => patchFacility(selected.localId, { address: e.target.value })}
                  />
                </div>
                <Input
                  label="Contact"
                  value={selected.contact}
                  onChange={(e) => patchFacility(selected.localId, { contact: e.target.value })}
                />
                <Input
                  label="Remarks"
                  value={selected.remarks}
                  onChange={(e) => patchFacility(selected.localId, { remarks: e.target.value })}
                />
              </div>

              {selected.kind === 'process_unit' ? (
                <div>
                  <p className="text-[11px] font-semibold text-slate-600 mb-2">Process types</p>
                  <div className="flex flex-wrap gap-3">
                    {processTypes.map((pt) => (
                      <label key={pt.id} className="text-[11px] text-slate-700 flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selected.process_type_ids.includes(pt.id)}
                          onChange={(e) => {
                            const process_type_ids = e.target.checked
                              ? [...selected.process_type_ids, pt.id]
                              : selected.process_type_ids.filter((id) => id !== pt.id);
                            patchFacility(selected.localId, { process_type_ids });
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

              {selected.ownership === 'internal' ? (
                <div className="border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="text-[13px] font-semibold text-slate-900">Machines</h4>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={Plus}
                      onClick={() => {
                        const kind = machineKinds[0] ?? 'knitting';
                        setMachines((prev) => [...prev, emptyMachine(selected.localId, kind)]);
                      }}
                    >
                      Add machine
                    </Button>
                  </div>
                  {selectedMachines.length === 0 ? (
                    <p className="text-[11px] text-slate-400">No machines on this facility</p>
                  ) : (
                    <div className="space-y-3">
                      {selectedMachines.map((machine) => {
                        const fields = specFieldsForKind(machine.machine_kind);
                        return (
                          <div
                            key={machine.localId}
                            className="border border-slate-200 rounded-lg p-3 space-y-2"
                          >
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                label="Code"
                                value={machine.code}
                                onChange={(e) => patchMachine(machine.localId, { code: e.target.value })}
                              />
                              <Input
                                label="Name"
                                value={machine.name}
                                onChange={(e) => patchMachine(machine.localId, { name: e.target.value })}
                              />
                              <SelectDropdown
                                label="Kind"
                                value={machine.machine_kind}
                                onChange={(value) =>
                                  patchMachine(machine.localId, { machine_kind: value, specs: {} })
                                }
                                options={(machineKinds.length ? machineKinds : [machine.machine_kind || 'knitting']).map(
                                  (k) => ({ value: k, label: k }),
                                )}
                              />
                              <label className="flex items-end gap-2 text-[12px] text-slate-700 pb-2">
                                <input
                                  type="checkbox"
                                  checked={machine.is_active}
                                  onChange={(e) =>
                                    patchMachine(machine.localId, { is_active: e.target.checked })
                                  }
                                />
                                Active
                              </label>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {fields.map((field) => (
                                <Input
                                  key={field.key}
                                  label={field.label}
                                  value={
                                    machine.specs[field.key] != null
                                      ? String(machine.specs[field.key])
                                      : ''
                                  }
                                  onChange={(e) =>
                                    patchMachine(machine.localId, {
                                      specs: {
                                        ...machine.specs,
                                        [field.key]: e.target.value,
                                      },
                                    })
                                  }
                                />
                              ))}
                            </div>
                            {machine.dirty ? (
                              <p className="text-[10px] text-blue-600">Unsaved</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-4">
                  Machines are only configured on in-house facilities.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default MmFacilitiesPage;
