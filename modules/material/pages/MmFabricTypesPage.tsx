import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Plus, Loader2, Pencil, X, Trash2 } from 'lucide-react';
import { Button, Input } from '../../../components/ui';
import { useNotificationStore } from '../../../stores';
import { EditorSplitLayout } from '../../../components/settings/EditorSplitLayout';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from '../../../components/settings/CatalogTablePanel';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { useMmConfigBundle, useRefreshMmConfig } from '../lib/useMmConfigBundle';
import { mmDeleteFabricType, mmSaveFabricType } from '../lib/mmRpc';
import { MmTableSaveButton } from '../components/MmTableSaveButton';

export interface MmFabricTypesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

interface DraftType {
  localId: string;
  id: string | null;
  rowVersion: number;
  name: string;
  remarks: string;
  requiresShadeBand: boolean;
}

/** Fabric types (Knit / Woven / …). Edits stay local until the page Save. */
const MmFabricTypesPage = forwardRef<
  MmFabricTypesHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFabricTypesPage({ onDirtyChange }, ref) {
  const { data, isLoading } = useMmConfigBundle();
  const refresh = useRefreshMmConfig();
  const { showNotification } = useNotificationStore();

  const [draft, setDraft] = useState<DraftType[] | null>(null);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [shadeRequired, setShadeRequired] = useState(false);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const savedTypes = useMemo<DraftType[]>(
    () =>
      (data?.types ?? [])
        .filter((t) => t.is_active !== false)
        .map((t) => ({
          localId: String(t.id),
          id: String(t.id),
          rowVersion: Number(t.row_version ?? 1),
          name: String(t.name),
          remarks: t.remarks != null ? String(t.remarks) : '',
          requiresShadeBand: t.requires_shade_band === true,
        })),
    [data?.types],
  );

  const rows = draft ?? savedTypes;
  const formDirty = Boolean(name.trim() || remarks.trim());

  useEffect(() => {
    onDirtyChange?.(
      (draft !== null && JSON.stringify(draft) !== JSON.stringify(savedTypes))
      || removedIds.length > 0
      || formDirty
    );
  }, [draft, savedTypes, removedIds, formDirty, onDirtyChange]);

  const resetForm = () => {
    setName('');
    setRemarks('');
    setShadeRequired(false);
    setEditingLocalId(null);
  };

  const applyRows = (next: DraftType[], nextRemoved = removedIds) => {
    setDraft(next);
  };

  const submitForm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (rows.some((r) => r.localId !== editingLocalId && r.name.toLowerCase() === trimmed.toLowerCase())) {
      showNotification('That fabric type already exists', 'error');
      return;
    }
    if (editingLocalId) {
      applyRows(rows.map((r) => (
        r.localId === editingLocalId
          ? { ...r, name: trimmed, remarks: remarks.trim(), requiresShadeBand: shadeRequired }
          : r
      )));
    } else {
      applyRows([
        ...rows,
        {
          localId: `tmp_${crypto.randomUUID()}`,
          id: null,
          rowVersion: 1,
          name: trimmed,
          remarks: remarks.trim(),
          requiresShadeBand: shadeRequired,
        },
      ]);
    }
    resetForm();
  };

  const removeRow = (row: DraftType) => {
    const nextRemoved = row.id ? [...removedIds, row.id] : removedIds;
    setRemovedIds(nextRemoved);
    applyRows(rows.filter((r) => r.localId !== row.localId), nextRemoved);
    if (editingLocalId === row.localId) resetForm();
  };

  useImperativeHandle(ref, () => ({
    isDirty: () =>
      (draft !== null && JSON.stringify(draft) !== JSON.stringify(savedTypes))
      || removedIds.length > 0
      || formDirty,
    save: async () => {
      if (!data) return false;
      let pending = draft ?? savedTypes;
      const pendingName = name.trim();
      if (!pendingName && remarks.trim()) {
        showNotification('Enter a type name before saving', 'error');
        return false;
      }
      if (pendingName) {
        if (pending.some((r) => r.localId !== editingLocalId && r.name.toLowerCase() === pendingName.toLowerCase())) {
          showNotification('That fabric type already exists', 'error');
          return false;
        }
        if (editingLocalId) {
          pending = pending.map((r) => (
            r.localId === editingLocalId
              ? { ...r, name: pendingName, remarks: remarks.trim(), requiresShadeBand: shadeRequired }
              : r
          ));
        } else {
          pending = [
            ...pending,
            {
              localId: `tmp_${crypto.randomUUID()}`,
              id: null,
              rowVersion: 1,
              name: pendingName,
              remarks: remarks.trim(),
              requiresShadeBand: shadeRequired,
            },
          ];
        }
        setDraft(pending);
      }
      setSaving(true);
      try {
        for (const id of removedIds) {
          const res = await mmDeleteFabricType(id);
          if (res.ok === false) throw new Error(res.message);
        }
        for (const row of pending) {
          const original = savedTypes.find((t) => t.id === row.id);
          if (row.id) {
            if (
              original
              && original.name === row.name
              && original.remarks === row.remarks
              && original.requiresShadeBand === row.requiresShadeBand
            ) continue;
            const res = await mmSaveFabricType({
              id: row.id,
              name: row.name,
              remarks: row.remarks,
              row_version: row.rowVersion,
              requires_shade_band: row.requiresShadeBand,
            });
            if (res.ok === false) throw new Error(res.message);
            const savedRow = res.data as { row_version?: unknown } | null;
            if (savedRow?.row_version != null) {
              pending = pending.map((r) =>
                r.localId === row.localId ? { ...r, rowVersion: Number(savedRow.row_version) } : r,
              );
              setDraft(pending);
            }
          } else {
            const res = await mmSaveFabricType({
              name: row.name,
              remarks: row.remarks,
              requires_shade_band: row.requiresShadeBand,
            });
            if (res.ok === false) throw new Error(res.message);
            const savedRow = res.data as { id?: unknown; row_version?: unknown } | null;
            if (savedRow?.id != null) {
              pending = pending.map((r) =>
                r.localId === row.localId
                  ? { ...r, id: String(savedRow.id), rowVersion: Number(savedRow.row_version ?? 1) }
                  : r,
              );
              setDraft(pending);
            }
          }
        }
        setDraft(null);
        setRemovedIds([]);
        resetForm();
        await refresh();
        onDirtyChange?.(false);
        showNotification('Fabric types saved', 'success');
        return true;
      } catch (e) {
        showNotification(e instanceof Error ? e.message : 'Save failed', 'error');
        return false;
      } finally {
        setSaving(false);
      }
    },
  }), [draft, savedTypes, removedIds, formDirty, name, remarks, shadeRequired, editingLocalId, data, refresh, showNotification, onDirtyChange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-xs text-slate-500 p-2">
        Turn Material on under Settings → Factory Settings → Modules.
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
                {editingLocalId ? 'Edit fabric type' : 'Add fabric type'}
              </h4>
            </div>
            <Input
              label="Type name"
              placeholder="e.g. Knit, Woven"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitForm()}
            />
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
              <textarea
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes"
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y min-h-[6.5rem] max-h-40 text-[11px]"
              />
            </div>
            <label className="flex items-start gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={shadeRequired}
                onChange={(e) => setShadeRequired(e.target.checked)}
              />
              <span>Warehouse can assign a shade band on this type. It is a label only. It does not block a store challan or a lay.</span>
            </label>
            <div className="flex flex-col gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                icon={editingLocalId ? Pencil : Plus}
                disabled={!name.trim() || saving}
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
            title="Fabric types"
            subtitle="Click a row to edit"
            isEmpty={rows.length === 0}
            emptyMessage="No fabric types yet."
            headerAction={<MmTableSaveButton />}
          >
            <CatalogTable headers={['S.No', 'Type', 'Remarks', 'Band', '']}>
              {rows.map((row, idx) => (
                <CatalogTableRow
                  key={row.localId}
                  onClick={() => {
                    setEditingLocalId(row.localId);
                    setName(row.name);
                    setRemarks(row.remarks);
                    setShadeRequired(row.requiresShadeBand);
                  }}
                  selected={editingLocalId === row.localId}
                >
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 truncate">
                    {row.name}
                    {!row.id ? (
                      <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                    ) : null}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-500 truncate max-w-[10rem]">
                    {row.remarks.trim() || '—'}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">
                    {row.requiresShadeBand ? 'Required' : '—'}
                  </CatalogTableCell>
                  <CatalogTableCell>
                    <DesktopWriteGate>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRow(row);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                        aria-label={`Remove ${row.name}`}
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

export default MmFabricTypesPage;
