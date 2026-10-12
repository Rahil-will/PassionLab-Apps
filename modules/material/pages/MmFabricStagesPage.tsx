import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { GripVertical, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
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
import { mmSaveFabricStage } from '../lib/mmV4Rpc';
import { useMmV4Config, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmFabricStagesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type StageDraft = {
  localId: string;
  code: string;
  label: string;
  seq: number;
  can_cut: boolean;
  is_initial: boolean;
  is_active: boolean;
  dirty: boolean;
  isNew: boolean;
};

function renumber(rows: StageDraft[]): StageDraft[] {
  return rows.map((row, index) => ({
    ...row,
    seq: index + 1,
    dirty: row.dirty || row.seq !== index + 1,
  }));
}

function insertAfter(
  rows: StageDraft[],
  row: StageDraft,
  afterLocalId: string | '',
): StageDraft[] {
  const inactive = rows.filter((r) => !r.is_active && r.localId !== row.localId);
  const active = rows.filter((r) => r.is_active && r.localId !== row.localId);
  const placed = { ...row, is_active: true };
  if (!afterLocalId) {
    return [...renumber([placed, ...active]), ...inactive];
  }
  const idx = active.findIndex((r) => r.localId === afterLocalId);
  if (idx < 0) return [...renumber([...active, placed]), ...inactive];
  const next = [...active];
  next.splice(idx + 1, 0, placed);
  return [...renumber(next), ...inactive];
}

const MmFabricStagesPage = forwardRef<
  MmFabricStagesHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFabricStagesPage({ onDirtyChange }, ref) {
  const { data, isLoading, error } = useMmV4Config();
  const refresh = useRefreshMmV4Config();
  const { showNotification } = useNotificationStore();
  const [rows, setRows] = useState<StageDraft[]>([]);
  const [baseline, setBaseline] = useState<StageDraft[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const dragLocalId = useRef<string | null>(null);
  const [dragOverLocalId, setDragOverLocalId] = useState<string | null>(null);

  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [placeAfter, setPlaceAfter] = useState('');
  const [canCut, setCanCut] = useState(false);
  const [isInitial, setIsInitial] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!data) return;
    const next = [...(data.stages ?? [])]
      .filter((s) => s.code !== 'PFGD')
      .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
      .map((s, i) => ({
        localId: s.code,
        code: s.code,
        label: s.label ?? s.code,
        seq: Number(s.seq ?? i + 1),
        can_cut: s.can_cut === true,
        is_initial: s.is_initial === true,
        is_active: s.is_active !== false,
        dirty: false,
        isNew: false,
      }));
    setRows(next);
    setBaseline(next);
    setHydrated(true);
    onDirtyChange?.(false);
  }, [data, onDirtyChange]);

  const formDirty = Boolean(code.trim() || label.trim());

  const dirty = useMemo(() => {
    if (!hydrated) return false;
    return (
      rows.some((r) => r.dirty)
      || JSON.stringify(rows.map(({ dirty: _d, ...rest }) => rest))
        !== JSON.stringify(baseline.map(({ dirty: _d, ...rest }) => rest))
      || formDirty
    );
  }, [rows, baseline, formDirty, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    onDirtyChange?.(dirty);
  }, [dirty, hydrated, onDirtyChange]);

  const ordered = useMemo(
    () => [...rows].filter((r) => r.is_active).sort((a, b) => a.seq - b.seq),
    [rows],
  );

  const placeAfterOptions = useMemo(() => {
    const others = ordered.filter((r) => r.localId !== editingLocalId);
    return [
      { value: '', label: 'At start' },
      ...others.map((r) => ({
        value: r.localId,
        label: `After ${r.label || r.code || 'stage'}`,
      })),
    ];
  }, [ordered, editingLocalId]);

  const resetForm = () => {
    setEditingLocalId(null);
    setCode('');
    setLabel('');
    setPlaceAfter(ordered.length ? ordered[ordered.length - 1]!.localId : '');
    setCanCut(false);
    setIsInitial(false);
    setIsActive(true);
  };

  useEffect(() => {
    if (editingLocalId) return;
    setPlaceAfter(ordered.length ? ordered[ordered.length - 1]!.localId : '');
  }, [ordered, editingLocalId]);

  const loadRow = (row: StageDraft) => {
    setEditingLocalId(row.localId);
    setCode(row.code);
    setLabel(row.label);
    setCanCut(row.can_cut);
    setIsInitial(row.is_initial);
    setIsActive(row.is_active);
    const idx = ordered.findIndex((r) => r.localId === row.localId);
    setPlaceAfter(idx > 0 ? ordered[idx - 1]!.localId : '');
  };

  const submitForm = () => {
    const trimmedCode = code.trim().toUpperCase();
    const trimmedLabel = label.trim();
    if (!trimmedCode || !trimmedLabel) {
      showNotification('Stage code and label are required', 'error');
      return;
    }
    if (rows.some((r) => r.localId !== editingLocalId && r.code.toUpperCase() === trimmedCode)) {
      showNotification('That stage code already exists', 'error');
      return;
    }

    if (editingLocalId) {
      const current = rows.find((r) => r.localId === editingLocalId);
      if (!current) return;
      const updated: StageDraft = {
        ...current,
        code: current.isNew ? trimmedCode : current.code,
        label: trimmedLabel,
        can_cut: canCut,
        is_initial: isInitial,
        is_active: isActive,
        dirty: true,
      };
      setRows(insertAfter(rows, updated, placeAfter));
    } else {
      const created: StageDraft = {
        localId: `tmp_${crypto.randomUUID()}`,
        code: trimmedCode,
        label: trimmedLabel,
        seq: rows.length + 1,
        can_cut: canCut,
        is_initial: isInitial,
        is_active: isActive,
        dirty: true,
        isNew: true,
      };
      setRows(insertAfter(rows, created, placeAfter));
    }
    resetForm();
  };

  const removeRow = (row: StageDraft) => {
    if (row.isNew) {
      setRows((prev) => renumber(prev.filter((r) => r.localId !== row.localId)));
    } else {
      setRows((prev) => {
        const remaining = prev.filter((r) => r.localId !== row.localId && r.is_active);
        const deactivated: StageDraft = { ...row, is_active: false, dirty: true };
        return [
          ...renumber(remaining.map((r) => ({ ...r, dirty: true }))),
          deactivated,
        ];
      });
    }
    if (editingLocalId === row.localId) resetForm();
  };

  const moveRow = (fromLocalId: string, toLocalId: string) => {
    if (fromLocalId === toLocalId) return;
    const active = [...rows].filter((r) => r.is_active).sort((a, b) => a.seq - b.seq);
    const inactive = rows.filter((r) => !r.is_active);
    const fromIdx = active.findIndex((r) => r.localId === fromLocalId);
    const toIdx = active.findIndex((r) => r.localId === toLocalId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...active];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    setRows([
      ...renumber(next.map((r) => ({ ...r, dirty: true }))),
      ...inactive,
    ]);
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      let pending = rows;

      const trimmedCode = code.trim().toUpperCase();
      const trimmedLabel = label.trim();
      if (trimmedCode || trimmedLabel) {
        if (!trimmedCode || !trimmedLabel) {
          showNotification('Stage code and label are required', 'error');
          return false;
        }
        if (pending.some((r) => r.localId !== editingLocalId && r.code.toUpperCase() === trimmedCode)) {
          showNotification('That stage code already exists', 'error');
          return false;
        }
        if (editingLocalId) {
          const current = pending.find((r) => r.localId === editingLocalId);
          if (current) {
            const updated: StageDraft = {
              ...current,
              code: current.isNew ? trimmedCode : current.code,
              label: trimmedLabel,
              can_cut: canCut,
              is_initial: isInitial,
              is_active: isActive,
              dirty: true,
            };
            pending = insertAfter(pending, updated, placeAfter);
          }
        } else {
          const created: StageDraft = {
            localId: `tmp_${crypto.randomUUID()}`,
            code: trimmedCode,
            label: trimmedLabel,
            seq: pending.length + 1,
            can_cut: canCut,
            is_initial: isInitial,
            is_active: isActive,
            dirty: true,
            isNew: true,
          };
          pending = insertAfter(pending, created, placeAfter);
        }
        setRows(pending);
        resetForm();
      }

      for (const row of pending.filter((r) => r.dirty)) {
        if (!row.code.trim() || !row.label.trim()) {
          showNotification('Stage code and label are required', 'error');
          return false;
        }
        const res = await mmSaveFabricStage({
          code: row.code.trim().toUpperCase(),
          label: row.label.trim(),
          seq: row.seq,
          can_cut: row.can_cut,
          is_initial: row.is_initial,
          is_active: row.is_active,
        });
        if (res.ok === false) {
          showNotification(res.message, 'error');
          return false;
        }
      }
      showNotification('Fabric stages saved', 'success');
      await refresh();
      return true;
    },
  }), [
    dirty,
    rows,
    code,
    label,
    canCut,
    isInitial,
    isActive,
    placeAfter,
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
        {error instanceof Error ? error.message : 'Could not load fabric stages'}
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
                {editingLocalId ? 'Edit fabric stage' : 'Add fabric stage'}
              </h4>
            </div>
            <Input
              label="Code"
              value={code}
              disabled={Boolean(editingLocalId && !rows.find((r) => r.localId === editingLocalId)?.isNew)}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <Input
              label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitForm()}
            />
            <SelectDropdown
              label="Place in sequence"
              value={placeAfter}
              onChange={setPlaceAfter}
              options={placeAfterOptions}
            />
            <label className="flex items-center gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={canCut}
                onChange={(e) => setCanCut(e.target.checked)}
              />
              Can be cut
            </label>
            <label className="flex items-center gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={isInitial}
                onChange={(e) => setIsInitial(e.target.checked)}
              />
              Initial
            </label>
            <label className="flex items-center gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>
            <div className="flex flex-col gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                icon={editingLocalId ? Pencil : Plus}
                disabled={!code.trim() || !label.trim()}
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
                      const row = rows.find((r) => r.localId === editingLocalId);
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
            title="Fabric stages"
            subtitle="Drag rows to reorder, or set place-in-sequence on the left"
            isEmpty={ordered.length === 0}
            emptyMessage="No stages yet."
            headerAction={<MmTableSaveButton />}
          >
            <CatalogTable headers={['', 'S.No', 'Code', 'Label', 'Cut', 'Initial', 'Active', '']}>
              {ordered.map((row, idx) => (
                <CatalogTableRow
                  key={row.localId}
                  onClick={() => loadRow(row)}
                  selected={editingLocalId === row.localId}
                >
                  <CatalogTableCell className="!w-8 !max-w-[2rem] !px-1 text-center">
                    <DesktopWriteGate>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          dragLocalId.current = row.localId;
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', row.localId);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverLocalId(row.localId);
                        }}
                        onDragLeave={() => {
                          setDragOverLocalId((cur) => (cur === row.localId ? null : cur));
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const from = dragLocalId.current ?? e.dataTransfer.getData('text/plain');
                          if (from) moveRow(from, row.localId);
                          dragLocalId.current = null;
                          setDragOverLocalId(null);
                        }}
                        onDragEnd={() => {
                          dragLocalId.current = null;
                          setDragOverLocalId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={`p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-grab active:cursor-grabbing ${
                          dragOverLocalId === row.localId ? 'bg-blue-100 text-blue-600' : ''
                        }`}
                        aria-label={`Reorder ${row.label || row.code}`}
                      >
                        <GripVertical size={14} />
                      </button>
                    </DesktopWriteGate>
                  </CatalogTableCell>
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 truncate">
                    {row.code || '—'}
                    {row.isNew ? (
                      <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                    ) : null}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-800 truncate">{row.label || '—'}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">{row.can_cut ? 'Yes' : '—'}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">{row.is_initial ? 'Yes' : '—'}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">{row.is_active ? 'Yes' : 'No'}</CatalogTableCell>
                  <CatalogTableCell>
                    <DesktopWriteGate>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRow(row);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                        aria-label={`Remove ${row.label || row.code}`}
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

export default MmFabricStagesPage;
