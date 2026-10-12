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
import { listFabricConstructions, saveFabricConstruction, type MmFabricConstruction } from '../lib/mmFabricRpc';
import { MmTableSaveButton } from '../components/MmTableSaveButton';

export interface MmFabricTypesHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

interface DraftConstruction {
  localId: string;
  id: string | null;
  name: string;
  seq: number;
  is_active: boolean;
  used: number;
}

interface DraftType {
  localId: string;
  id: string | null;
  rowVersion: number;
  name: string;
  remarks: string;
  constructions: DraftConstruction[];
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
  const [constructionText, setConstructionText] = useState('');
  const [constructionRows, setConstructionRows] = useState<MmFabricConstruction[] | null>(null);
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const savedTypes = useMemo<DraftType[]>(() => {
    const byType = new Map<string, DraftConstruction[]>();
    for (const row of constructionRows ?? []) {
      const list = byType.get(row.fabric_type_id) ?? [];
      list.push({
        localId: row.id,
        id: row.id,
        name: row.name,
        seq: row.seq,
        is_active: row.is_active,
        used: row.used_on_fabrics ?? 0,
      });
      byType.set(row.fabric_type_id, list);
    }
    return (data?.types ?? [])
      .filter((t) => t.is_active !== false)
      .map((t) => ({
        localId: String(t.id),
        id: String(t.id),
        rowVersion: Number(t.row_version ?? 1),
        name: String(t.name),
        remarks: t.remarks != null ? String(t.remarks) : '',
        constructions: (byType.get(String(t.id)) ?? []).sort((a, b) => a.seq - b.seq),
      }));
  }, [data?.types, constructionRows]);

  const rows = draft ?? savedTypes;
  const formDirty = Boolean(name.trim() || remarks.trim() || constructionText.trim());

  useEffect(() => {
    let cancel = false;
    void listFabricConstructions(null, true).then((res) => {
      if (cancel) return;
      setConstructionRows(res.ok === false ? [] : (res.data.rows ?? []));
    });
    return () => { cancel = true; };
  }, [data]);

  function constructionsFromText(text: string, existing: DraftConstruction[]): DraftConstruction[] {
    const names = text.split(/[\n,]/).map((part) => part.trim()).filter(Boolean);
    const used = new Set<string>();
    return names.map((itemName, index) => {
      const prev = existing.find((row) => (
        Boolean(row.id)
        && !used.has(row.id as string)
        && row.name.trim().toLowerCase() === itemName.toLowerCase()
      ));
      if (prev?.id) used.add(prev.id);
      return {
        localId: prev?.localId ?? `tmp_${crypto.randomUUID()}`,
        id: prev?.id ?? null,
        name: itemName,
        seq: index + 1,
        is_active: true,
        used: prev?.used ?? 0,
      };
    });
  }

  const resetForm = () => {
    setName('');
    setRemarks('');
    setConstructionText('');
    setEditingLocalId(null);
  };

  useEffect(() => {
    onDirtyChange?.(
      (draft !== null && JSON.stringify(draft) !== JSON.stringify(savedTypes))
      || removedIds.length > 0
      || formDirty
    );
  }, [draft, savedTypes, removedIds, formDirty, onDirtyChange]);

  const applyRows = (next: DraftType[]) => {
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
          ? { ...r, name: trimmed, remarks: remarks.trim(), constructions: constructionsFromText(constructionText, r.constructions) }
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
          constructions: constructionsFromText(constructionText, []),
        },
      ]);
    }
    resetForm();
  };

  const removeRow = (row: DraftType) => {
    const nextRemoved = row.id ? [...removedIds, row.id] : removedIds;
    setRemovedIds(nextRemoved);
    applyRows(rows.filter((r) => r.localId !== row.localId));
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
      if (!pendingName && (remarks.trim() || constructionText.trim())) {
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
              ? { ...r, name: pendingName, remarks: remarks.trim(), constructions: constructionsFromText(constructionText, r.constructions) }
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
              constructions: constructionsFromText(constructionText, []),
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
          let typeId = row.id;
          const typeUnchanged = Boolean(
            typeId
            && original
            && original.name === row.name
            && original.remarks === row.remarks,
          );
          if (typeId && !typeUnchanged) {
            const res = await mmSaveFabricType({
              id: typeId,
              name: row.name,
              remarks: row.remarks,
              row_version: row.rowVersion,
            });
            if (res.ok === false) throw new Error(res.message);
            const savedRow = res.data as { row_version?: unknown } | null;
            if (savedRow?.row_version != null) {
              pending = pending.map((r) =>
                r.localId === row.localId ? { ...r, rowVersion: Number(savedRow.row_version) } : r,
              );
              setDraft(pending);
            }
          } else if (!typeId) {
            const res = await mmSaveFabricType({
              name: row.name,
              remarks: row.remarks,
            });
            if (res.ok === false) throw new Error(res.message);
            const savedRow = res.data as { id?: unknown; row_version?: unknown } | null;
            if (savedRow?.id != null) {
              typeId = String(savedRow.id);
              pending = pending.map((r) =>
                r.localId === row.localId
                  ? { ...r, id: typeId, rowVersion: Number(savedRow.row_version ?? 1) }
                  : r,
              );
              setDraft(pending);
            }
          }
          if (!typeId) continue;
          const named = row.constructions
            .map((item, index) => ({ ...item, name: item.name.trim(), seq: index + 1 }))
            .filter((item) => item.name);
          const previous = original?.constructions ?? [];
          for (const item of named) {
            const prev = previous.find((c) => c.id && c.id === item.id);
            if (prev && prev.name === item.name && prev.seq === item.seq && prev.is_active) continue;
            const res = await saveFabricConstruction({
              ...(item.id ? { id: item.id } : { fabric_type_id: typeId }),
              name: item.name,
              seq: item.seq,
              is_active: true,
            });
            if (res.ok === false) throw new Error(res.message);
          }
          for (const prev of previous) {
            if (!prev.id || !prev.is_active) continue;
            if (named.some((item) => item.id === prev.id)) continue;
            if (prev.used > 0 && !window.confirm(`${prev.name} is used on fabrics. It will be hidden from pickers.`)) continue;
            const res = await saveFabricConstruction({
              id: prev.id,
              fabric_type_id: typeId,
              name: prev.name,
              seq: prev.seq,
              is_active: false,
            });
            if (res.ok === false) throw new Error(res.message);
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
  }), [draft, savedTypes, removedIds, formDirty, name, remarks, constructionText, editingLocalId, data, refresh, showNotification, onDirtyChange]);

  if (isLoading || constructionRows === null) {
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
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 mb-1">Constructions</label>
              <textarea
                rows={Math.max(3, constructionText.split('\n').filter((line) => line.trim()).length || 3)}
                value={constructionText}
                onChange={(e) => setConstructionText(e.target.value)}
                placeholder={'Single jersey\nRib\nInterlock'}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y text-[11px] leading-5"
              />
              <p className="mt-1 text-[9px] text-slate-400">One construction per line.</p>
            </div>
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
            <CatalogTable headers={['S.No', 'Type', 'Constructions', 'Remarks', '']}>
              {rows.map((row, idx) => (
                <CatalogTableRow
                  key={row.localId}
                  onClick={() => {
                    setEditingLocalId(row.localId);
                    setName(row.name);
                    setRemarks(row.remarks);
                    setConstructionText(
                      row.constructions.filter((item) => item.is_active).map((item) => item.name).join('\n'),
                    );
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
                  <CatalogTableCell className="text-[10px] leading-tight text-slate-500 whitespace-normal">
                    {row.constructions.filter((item) => item.is_active).map((item) => item.name).join(', ') || '—'}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-500 truncate max-w-[10rem]">
                    {row.remarks.trim() || '—'}
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
