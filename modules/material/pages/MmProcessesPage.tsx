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
import {
  mmSaveProcess,
  type MmChallanField,
} from '../lib/mmV4Rpc';
import { useMmProcesses, useMmV4Config, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmProcessesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type ProcessDraft = {
  localId: string;
  id: string | null;
  name: string;
  outputStageCode: string | null;
  outputStageLabel: string | null;
  active: boolean;
  sortOrder: number;
  vendorCount: number;
  doneInhouse: boolean;
  doneExternal: boolean;
  challanFields: MmChallanField[];
  dirty: boolean;
};

let localSeq = 1;
const nextKey = () => `new-${localSeq++}`;

function doneAtOf(inhouse: boolean, external: boolean): 'inhouse' | 'external' | 'both' {
  if (inhouse && external) return 'both';
  if (external) return 'external';
  return 'inhouse';
}

function doneAtLabel(row: Pick<ProcessDraft, 'doneInhouse' | 'doneExternal'>): string {
  if (row.doneInhouse && row.doneExternal) return 'Both';
  if (row.doneInhouse) return 'In-house';
  if (row.doneExternal) return 'External';
  return '—';
}

const MmProcessesPage = forwardRef<
  MmProcessesHandle,
  { onDirtyChange: (dirty: boolean) => void }
>(function MmProcessesPage({ onDirtyChange }, ref) {
  const showNotification = useNotificationStore((s) => s.showNotification);
  const refreshV4 = useRefreshMmV4Config();
  const { data: v4 } = useMmV4Config();
  const processesQ = useMmProcesses();

  const [processes, setProcesses] = useState<ProcessDraft[]>([]);
  const [baselineProcesses, setBaselineProcesses] = useState<ProcessDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [processName, setProcessName] = useState('');
  const [outputStageCode, setOutputStageCode] = useState('');
  const [processActive, setProcessActive] = useState(true);
  const [doneAt, setDoneAt] = useState<'inhouse' | 'external' | 'both'>('inhouse');
  const [showInactive, setShowInactive] = useState(false);

  const stages = useMemo(
    () => (v4?.stages ?? []).filter((stage) => stage.is_active !== false),
    [v4?.stages],
  );

  useEffect(() => {
    if (!processesQ.data) return;
    const nextProcesses: ProcessDraft[] = [...processesQ.data]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((row) => ({
        localId: row.id,
        id: row.id,
        name: row.name,
        outputStageCode: row.output_stage_code ?? null,
        outputStageLabel: row.output_stage_label ?? null,
        active: row.active !== false,
        sortOrder: row.sort_order ?? 0,
        vendorCount: row.vendor_count ?? 0,
        doneInhouse: row.done_inhouse === true,
        doneExternal: row.done_external === true,
        challanFields: row.challan_fields ?? [],
        dirty: false,
      }));
    setProcesses(nextProcesses);
    setBaselineProcesses(nextProcesses);
    setHydrated(true);
    setEditingProcessId(null);
    setProcessName('');
    setOutputStageCode('');
    setProcessActive(true);
    setDoneAt('inhouse');
    onDirtyChange(false);
  }, [processesQ.data, onDirtyChange]);

  const processFormDirty = useMemo(() => {
    if (editingProcessId) {
      const row = processes.find((item) => item.localId === editingProcessId);
      if (!row) return false;
      return (
        row.name !== processName
        || (row.outputStageCode ?? '') !== outputStageCode
        || row.active !== processActive
        || doneAtOf(row.doneInhouse, row.doneExternal) !== doneAt
      );
    }
    return Boolean(processName.trim());
  }, [editingProcessId, processes, processName, outputStageCode, processActive, doneAt]);

  const dirty = useMemo(() => {
    if (!hydrated) return false;
    return JSON.stringify(processes) !== JSON.stringify(baselineProcesses) || processFormDirty;
  }, [hydrated, processes, baselineProcesses, processFormDirty]);

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const stageLabel = (code: string | null) => {
    if (!code) return 'No change';
    return stages.find((stage) => stage.code === code)?.label || code;
  };

  const resetProcessForm = () => {
    setEditingProcessId(null);
    setProcessName('');
    setOutputStageCode('');
    setProcessActive(true);
    setDoneAt('inhouse');
  };

  const loadProcess = (row: ProcessDraft) => {
    setEditingProcessId(row.localId);
    setProcessName(row.name);
    setOutputStageCode(row.outputStageCode ?? '');
    setProcessActive(row.active);
    setDoneAt(doneAtOf(row.doneInhouse, row.doneExternal));
  };

  const snapshot = useRef({
    processes,
    processName,
    outputStageCode,
    processActive,
    doneAt,
    editingProcessId,
    stages,
  });
  snapshot.current = {
    processes,
    processName,
    outputStageCode,
    processActive,
    doneAt,
    editingProcessId,
    stages,
  };

  const applyProcessForm = (rows: ProcessDraft[]): ProcessDraft[] | null => {
    const form = snapshot.current;
    const trimmed = form.processName.trim();
    if (!trimmed) {
      if (form.editingProcessId) {
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
    const doneInhouse = form.doneAt !== 'external';
    const doneExternal = form.doneAt !== 'inhouse';
    if (form.editingProcessId) {
      return rows.map((row) => (
        row.localId === form.editingProcessId
          ? {
            ...row,
            name: trimmed,
            outputStageCode: form.outputStageCode || null,
            outputStageLabel: form.outputStageCode ? (stage?.label ?? form.outputStageCode) : null,
            active: form.processActive,
            doneInhouse,
            doneExternal,
            dirty: true,
          }
          : row
      ));
    }
    const sortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
    return [
      ...rows,
      {
        localId: nextKey(),
        id: null,
        name: trimmed,
        outputStageCode: form.outputStageCode || null,
        outputStageLabel: form.outputStageCode ? (stage?.label ?? form.outputStageCode) : null,
        active: form.processActive,
        sortOrder,
        vendorCount: 0,
        doneInhouse,
        doneExternal,
        challanFields: [],
        dirty: true,
      },
    ];
  };

  const submitProcessForm = () => {
    const next = applyProcessForm(processes);
    if (!next) return;
    setProcesses(next);
    resetProcessForm();
  };

  const removeProcess = (row: ProcessDraft) => {
    if (!row.id) setProcesses((rows) => rows.filter((item) => item.localId !== row.localId));
    else setProcesses((rows) => rows.map((item) => (item.localId === row.localId ? { ...item, active: false, dirty: true } : item)));
    if (editingProcessId === row.localId) resetProcessForm();
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      const pendingProcesses = applyProcessForm(snapshot.current.processes);
      if (!pendingProcesses) return false;
      setProcesses(pendingProcesses);
      resetProcessForm();

      for (const row of pendingProcesses) {
        if (row.id && !row.dirty) continue;
        const res = await mmSaveProcess({
          ...(row.id ? { id: row.id } : {}),
          name: row.name.trim(),
          output_stage_code: row.outputStageCode,
          active: row.active,
          sort_order: row.sortOrder,
          done_inhouse: row.doneInhouse,
          done_external: row.doneExternal,
          challan_fields: row.challanFields,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          await processesQ.refetch();
          return false;
        }
      }

      showNotification('Processes saved', 'success');
      await Promise.all([processesQ.refetch(), refreshV4()]);
      return true;
    },
  }), [dirty, showNotification, processesQ, refreshV4]);

  if (processesQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (processesQ.error) {
    return (
      <p className="text-[12px] text-red-600 p-2">
        {processesQ.error instanceof Error ? processesQ.error.message : 'Could not load processes'}
      </p>
    );
  }

  const visibleProcesses = processes.filter((row) => showInactive || row.active);

  const stageOptions = [
    { value: '', label: 'No change' },
    ...stages.map((stage) => ({ value: stage.code, label: stage.label || stage.code })),
  ];

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col gap-3">
      <p className="text-[11px] text-slate-500 shrink-0">
        Add a process and where it is done. How it comes back is entered when it is received.
      </p>
      <EditorSplitLayout
        fillHeight
        leftScrollable
        rightScrollable
        left={(
          <DesktopWriteGate>
            <div className="space-y-5">
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
              <SelectDropdown size="compact" label="Output stage" value={outputStageCode} onChange={setOutputStageCode} options={stageOptions} />
              <p className="text-[11px] text-slate-400 -mt-3">QC resets automatically when an output stage is set.</p>
              <SelectDropdown size="compact"
                label="Done at"
                value={doneAt}
                onChange={(value) => setDoneAt(value === 'external' || value === 'both' ? value : 'inhouse')}
                options={[
                  { value: 'inhouse', label: 'In-house' },
                  { value: 'external', label: 'External' },
                  { value: 'both', label: 'Both' },
                ]}
              />
              <EditorToggle label="Active" on={processActive} onChange={setProcessActive} />
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
              isEmpty={visibleProcesses.length === 0}
              emptyMessage="No processes yet."
              headerAction={(
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                    Show inactive
                  </label>
                  <MmTableSaveButton />
                </div>
              )}
            >
              <CatalogTable headers={['S.No', 'Process', 'Done at', 'Output stage', 'Vendors', 'Active', '']}>
                {visibleProcesses.map((row, idx) => (
                  <CatalogTableRow key={row.localId} onClick={() => loadProcess(row)} selected={editingProcessId === row.localId}>
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 truncate">
                      {row.name || '—'}
                      {!row.id ? <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span> : null}
                    </CatalogTableCell>
                    <CatalogTableCell className="text-slate-600">{doneAtLabel(row)}</CatalogTableCell>
                    <CatalogTableCell className="text-slate-600 truncate">
                      {row.outputStageLabel || stageLabel(row.outputStageCode)}
                    </CatalogTableCell>
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
    </div>
  );
});

export default MmProcessesPage;
