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
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import {
  mmSavePartner,
  mmSaveProcess,
  type MmOutputUnitForm,
} from '../lib/mmV4Rpc';
import { useMmPartners, useMmProcesses, useMmV4Config, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmProcessVendorsHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type ProcessDraft = {
  localId: string;
  id: string | null;
  name: string;
  outputStageCode: string | null;
  outputStageLabel: string | null;
  outputForm: MmOutputUnitForm;
  active: boolean;
  sortOrder: number;
  vendorCount: number;
  dirty: boolean;
};

type VendorDraft = {
  localId: string;
  id: string | null;
  name: string;
  contact: string;
  processIds: string[];
  active: boolean;
  rowVersion: number;
  dirty: boolean;
};

let localSeq = 1;
const nextKey = () => `new-${localSeq++}`;

function asForm(value: string | null | undefined): MmOutputUnitForm {
  if (value === 'roll' || value === 'lap') return value;
  return 'keep';
}

function comesBackLabel(form: MmOutputUnitForm): string {
  if (form === 'roll') return 'Roll';
  if (form === 'lap') return 'Lap';
  return 'Same';
}

const MmProcessVendorsPage = forwardRef<
  MmProcessVendorsHandle,
  { onDirtyChange: (dirty: boolean) => void }
>(function MmProcessVendorsPage({ onDirtyChange }, ref) {
  const showNotification = useNotificationStore((s) => s.showNotification);
  const refreshV4 = useRefreshMmV4Config();
  const { data: v4 } = useMmV4Config();
  const processesQ = useMmProcesses();
  const vendorsQ = useMmPartners('process_vendor', true);

  const [processes, setProcesses] = useState<ProcessDraft[]>([]);
  const [vendors, setVendors] = useState<VendorDraft[]>([]);
  const [baselineProcesses, setBaselineProcesses] = useState<ProcessDraft[]>([]);
  const [baselineVendors, setBaselineVendors] = useState<VendorDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [processName, setProcessName] = useState('');
  const [outputStageCode, setOutputStageCode] = useState('');
  const [outputForm, setOutputForm] = useState<MmOutputUnitForm>('keep');
  const [processActive, setProcessActive] = useState(true);

  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorContact, setVendorContact] = useState('');
  const [vendorProcessIds, setVendorProcessIds] = useState<string[]>([]);
  const [vendorActive, setVendorActive] = useState(true);

  const stages = useMemo(
    () => (v4?.stages ?? []).filter((stage) => stage.is_active !== false),
    [v4?.stages],
  );

  useEffect(() => {
    if (!processesQ.data || !vendorsQ.data) return;
    const nextProcesses: ProcessDraft[] = [...processesQ.data]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((row) => ({
        localId: row.id,
        id: row.id,
        name: row.name,
        outputStageCode: row.output_stage_code ?? null,
        outputStageLabel: row.output_stage_label ?? null,
        outputForm: asForm(row.output_unit_form),
        active: row.active !== false,
        sortOrder: row.sort_order ?? 0,
        vendorCount: row.vendor_count ?? 0,
        dirty: false,
      }));
    const nextVendors: VendorDraft[] = vendorsQ.data.map((row) => ({
      localId: row.id,
      id: row.id,
      name: row.name,
      contact: row.contact ?? '',
      processIds: row.process_type_ids ?? [],
      active: row.is_active !== false,
      rowVersion: Number(row.row_version ?? 1),
      dirty: false,
    }));
    setProcesses(nextProcesses);
    setVendors(nextVendors);
    setBaselineProcesses(nextProcesses);
    setBaselineVendors(nextVendors);
    setHydrated(true);
    setEditingProcessId(null);
    setProcessName('');
    setOutputStageCode('');
    setOutputForm('keep');
    setProcessActive(true);
    setEditingVendorId(null);
    setVendorName('');
    setVendorContact('');
    setVendorProcessIds([]);
    setVendorActive(true);
    onDirtyChange(false);
  }, [processesQ.data, vendorsQ.data, onDirtyChange]);

  const processFormDirty = useMemo(() => {
    if (editingProcessId) {
      const row = processes.find((item) => item.localId === editingProcessId);
      if (!row) return false;
      return (
        row.name !== processName
        || (row.outputStageCode ?? '') !== outputStageCode
        || row.outputForm !== outputForm
        || row.active !== processActive
      );
    }
    return Boolean(processName.trim());
  }, [editingProcessId, processes, processName, outputStageCode, outputForm, processActive]);

  const vendorFormDirty = useMemo(() => {
    if (editingVendorId) {
      const row = vendors.find((item) => item.localId === editingVendorId);
      if (!row) return false;
      return (
        row.name !== vendorName
        || row.contact !== vendorContact
        || row.active !== vendorActive
        || JSON.stringify(row.processIds) !== JSON.stringify(vendorProcessIds)
      );
    }
    return Boolean(vendorName.trim() || vendorContact.trim() || vendorProcessIds.length > 0);
  }, [editingVendorId, vendors, vendorName, vendorContact, vendorActive, vendorProcessIds]);

  const dirty = useMemo(() => {
    if (!hydrated) return false;
    return (
      JSON.stringify(processes) !== JSON.stringify(baselineProcesses)
      || JSON.stringify(vendors) !== JSON.stringify(baselineVendors)
      || processFormDirty
      || vendorFormDirty
    );
  }, [hydrated, processes, vendors, baselineProcesses, baselineVendors, processFormDirty, vendorFormDirty]);

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const stageLabel = (code: string | null) => {
    if (!code) return 'No change';
    return stages.find((stage) => stage.code === code)?.label || code;
  };

  const processNameById = (id: string) => processes.find((row) => row.localId === id || row.id === id)?.name ?? '';

  const checkboxProcesses = useMemo(() => {
    const selected = new Set(vendorProcessIds);
    return processes.filter((row) => row.name.trim() && (row.active || selected.has(row.localId) || (row.id != null && selected.has(row.id))));
  }, [processes, vendorProcessIds]);

  const resetProcessForm = () => {
    setEditingProcessId(null);
    setProcessName('');
    setOutputStageCode('');
    setOutputForm('keep');
    setProcessActive(true);
  };

  const resetVendorForm = () => {
    setEditingVendorId(null);
    setVendorName('');
    setVendorContact('');
    setVendorProcessIds([]);
    setVendorActive(true);
  };

  const loadProcess = (row: ProcessDraft) => {
    setEditingProcessId(row.localId);
    setProcessName(row.name);
    setOutputStageCode(row.outputStageCode ?? '');
    setOutputForm(row.outputForm);
    setProcessActive(row.active);
  };

  const loadVendor = (row: VendorDraft) => {
    setEditingVendorId(row.localId);
    setVendorName(row.name);
    setVendorContact(row.contact);
    setVendorProcessIds([...row.processIds]);
    setVendorActive(row.active);
  };

  const toggleProcess = (id: string) => {
    setVendorProcessIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const snapshot = useRef({
    processes,
    vendors,
    processName,
    outputStageCode,
    outputForm,
    processActive,
    editingProcessId,
    vendorName,
    vendorContact,
    vendorProcessIds,
    vendorActive,
    editingVendorId,
    stages,
  });
  snapshot.current = {
    processes,
    vendors,
    processName,
    outputStageCode,
    outputForm,
    processActive,
    editingProcessId,
    vendorName,
    vendorContact,
    vendorProcessIds,
    vendorActive,
    editingVendorId,
    stages,
  };

  const applyProcessForm = (rows: ProcessDraft[]): ProcessDraft[] | null => {
    const form = snapshot.current;
    const trimmed = form.processName.trim();
    if (!trimmed) {
      if (form.editingProcessId || form.outputStageCode || form.outputForm !== 'keep' || !form.processActive) {
        showNotification('Enter a process name before saving', 'error');
        return null;
      }
      return rows;
    }
    if (rows.some((row) => row.localId !== form.editingProcessId && row.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      showNotification('That process already exists', 'error');
      return null;
    }
    const stage = form.stages.find((item) => item.code === form.outputStageCode);
    const next: Omit<ProcessDraft, 'localId' | 'id' | 'sortOrder' | 'vendorCount'> = {
      name: trimmed,
      outputStageCode: form.outputStageCode || null,
      outputStageLabel: form.outputStageCode ? (stage?.label ?? form.outputStageCode) : null,
      outputForm: form.outputForm,
      active: form.processActive,
      dirty: true,
    };
    if (form.editingProcessId) {
      const existing = rows.find((row) => row.localId === form.editingProcessId);
      if (
        existing
        && existing.name === trimmed
        && (existing.outputStageCode ?? '') === form.outputStageCode
        && existing.outputForm === form.outputForm
        && existing.active === form.processActive
      ) return rows;
      return rows.map((row) => (row.localId === form.editingProcessId ? { ...row, ...next } : row));
    }
    const sortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
    return [
      ...rows,
      { localId: nextKey(), id: null, sortOrder, vendorCount: 0, ...next },
    ];
  };

  const applyVendorForm = (rows: VendorDraft[]): VendorDraft[] | null => {
    const form = snapshot.current;
    const trimmed = form.vendorName.trim();
    const contact = form.vendorContact.trim();
    if (!trimmed) {
      if (form.editingVendorId || contact || form.vendorProcessIds.length > 0 || !form.vendorActive) {
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

  const submitProcessForm = () => {
    const next = applyProcessForm(processes);
    if (!next) return;
    setProcesses(next);
    resetProcessForm();
  };

  const submitVendorForm = () => {
    const next = applyVendorForm(vendors);
    if (!next) return;
    setVendors(next);
    resetVendorForm();
  };

  const removeProcess = (row: ProcessDraft) => {
    if (!row.id) setProcesses((rows) => rows.filter((item) => item.localId !== row.localId));
    else setProcesses((rows) => rows.map((item) => (item.localId === row.localId ? { ...item, active: false, dirty: true } : item)));
    if (editingProcessId === row.localId) resetProcessForm();
  };

  const removeVendor = (row: VendorDraft) => {
    if (!row.id) setVendors((rows) => rows.filter((item) => item.localId !== row.localId));
    else setVendors((rows) => rows.map((item) => (item.localId === row.localId ? { ...item, active: false, dirty: true } : item)));
    if (editingVendorId === row.localId) resetVendorForm();
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      const current = snapshot.current;
      let pendingProcesses = applyProcessForm(current.processes);
      if (!pendingProcesses) return false;
      let pendingVendors = applyVendorForm(current.vendors);
      if (!pendingVendors) return false;
      if (pendingProcesses.some((row) => !row.name.trim())) {
        showNotification('Process name is required', 'error');
        return false;
      }
      if (pendingVendors.some((row) => !row.name.trim())) {
        showNotification('Process vendor name is required', 'error');
        return false;
      }
      setProcesses(pendingProcesses);
      setVendors(pendingVendors);
      resetProcessForm();
      resetVendorForm();

      const idByLocal = new Map<string, string>();
      for (const row of pendingProcesses) {
        if (row.id && !row.dirty) {
          idByLocal.set(row.localId, row.id);
          continue;
        }
        const res = await mmSaveProcess({
          ...(row.id ? { id: row.id } : {}),
          name: row.name.trim(),
          output_stage_code: row.outputStageCode,
          output_unit_form: row.outputForm,
          active: row.active,
          sort_order: row.sortOrder,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          await processesQ.refetch();
          return false;
        }
        idByLocal.set(row.localId, res.data.id);
        if (row.id) idByLocal.set(row.id, res.data.id);
      }

      for (const row of pendingVendors) {
        if (row.id && !row.dirty) continue;
        const processTypeIds = row.processIds.map((key) => idByLocal.get(key) ?? key).filter((id) => !id.startsWith('new-'));
        if (processTypeIds.length === 0) {
          showNotification('Select at least one process', 'error');
          return false;
        }
        const res = await mmSavePartner({
          ...(row.id ? { id: row.id, row_version: row.rowVersion } : {}),
          kind: 'process_vendor',
          name: row.name.trim(),
          contact: row.contact.trim() || null,
          is_active: row.active,
          process_type_ids: processTypeIds,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          await processesQ.refetch();
          await vendorsQ.refetch();
          return false;
        }
      }

      showNotification('Process vendors saved', 'success');
      await Promise.all([processesQ.refetch(), vendorsQ.refetch(), refreshV4()]);
      return true;
    },
  }), [dirty, showNotification, processesQ, vendorsQ, refreshV4, stages]);

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

  const stageOptions = [
    { value: '', label: 'No change' },
    ...stages.map((stage) => ({ value: stage.code, label: stage.label || stage.code })),
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto thin-scrollbar flex flex-col gap-3 pr-1">
      <p className="text-[11px] text-slate-500">
        Processes your fabric goes through, and which vendor can do each. In-house processing = a vendor named In-house.
      </p>
      <EditorSplitLayout
        panelHeight="min(420px, 48vh)"
        leftScrollable
        rightScrollable
        left={(
          <DesktopWriteGate>
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingProcessId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingProcessId ? 'Edit process' : 'Add process'}
              </h4>
              <Input
                label="Name *"
                value={processName}
                onChange={(e) => setProcessName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitProcessForm()}
              />
              <SelectDropdown
                label="Output stage"
                value={outputStageCode}
                onChange={setOutputStageCode}
                options={stageOptions}
              />
              <SelectDropdown
                label="Comes back as"
                value={outputForm}
                onChange={(value) => setOutputForm(asForm(value))}
                options={[
                  { value: 'keep', label: 'Same as sent' },
                  { value: 'roll', label: 'Roll' },
                  { value: 'lap', label: 'Lap' },
                ]}
              />
              <label className="flex items-center gap-2 text-[11px] text-slate-700">
                <input type="checkbox" checked={processActive} onChange={(e) => setProcessActive(e.target.checked)} />
                Active
              </label>
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  icon={editingProcessId ? Pencil : Plus}
                  disabled={!processName.trim()}
                  onClick={submitProcessForm}
                  className="w-full"
                >
                  {editingProcessId ? 'Update in table' : 'Add to table'}
                </Button>
                {editingProcessId ? (
                  <>
                    <Button
                      variant="danger-light"
                      size="sm"
                      icon={Trash2}
                      onClick={() => {
                        const row = processes.find((item) => item.localId === editingProcessId);
                        if (row) removeProcess(row);
                      }}
                      className="w-full"
                    >
                      Remove from table
                    </Button>
                    <Button size="sm" variant="secondary" icon={X} onClick={resetProcessForm} className="w-full">
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
              title="Processes"
              subtitle="Click a row to edit."
              isEmpty={processes.length === 0}
              emptyMessage="No processes yet."
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={['S.No', 'Process', 'Output stage', 'Comes back as', 'Vendors', 'Active', '']}>
                {processes.map((row, idx) => (
                  <CatalogTableRow key={row.localId} onClick={() => loadProcess(row)} selected={editingProcessId === row.localId}>
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 truncate">
                      {row.name || '—'}
                      {!row.id ? <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span> : null}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">
                      {row.outputStageLabel || stageLabel(row.outputStageCode)}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-600">{comesBackLabel(row.outputForm)}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 tabular-nums">{row.vendorCount}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600">{row.active ? 'Yes' : 'No'}</CatalogTableCell>
                    <CatalogTableCell>
                      <DesktopWriteGate>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeProcess(row);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                          aria-label={`Remove ${row.name || 'process'}`}
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

      <EditorSplitLayout
        panelHeight="min(420px, 48vh)"
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
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-slate-600">Processes *</p>
                {checkboxProcesses.length === 0 ? (
                  <p className="text-[11px] text-slate-400">Add a process above first.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                    {checkboxProcesses.map((row) => (
                      <label key={row.localId} className="flex items-center gap-2 text-[11px] text-slate-700">
                        <input
                          type="checkbox"
                          checked={vendorProcessIds.includes(row.localId) || (row.id != null && vendorProcessIds.includes(row.id))}
                          onChange={() => toggleProcess(row.id && vendorProcessIds.includes(row.id) ? row.id : row.localId)}
                        />
                        {row.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-700">
                <input type="checkbox" checked={vendorActive} onChange={(e) => setVendorActive(e.target.checked)} />
                Active
              </label>
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
              title="Vendors"
              subtitle="Click a row to edit."
              isEmpty={vendors.length === 0}
              emptyMessage="No process vendors yet."
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={['S.No', 'Vendor', 'Contact', 'Processes', 'Active', '']}>
                {vendors.map((row, idx) => (
                  <CatalogTableRow key={row.localId} onClick={() => loadVendor(row)} selected={editingVendorId === row.localId}>
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 truncate">
                      {row.name || '—'}
                      {!row.id ? <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span> : null}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">{row.contact || '—'}</CatalogTableCell>
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
