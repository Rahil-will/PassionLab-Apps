import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Plus, Loader2, Pencil, X, Trash2 } from 'lucide-react';
import { Button, Input } from '../../../components/ui';
import { useNotificationStore, useNavigationStore } from '../../../stores';
import { EditorSplitLayout } from '../../../components/settings/EditorSplitLayout';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from '../../../components/settings/CatalogTablePanel';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../../lib/queryKeys';
import { mmDeleteTrimRequirementParam, mmSaveTrimRequirementParam } from '../lib/mmRpc';
import { MmTableSaveButton } from '../components/MmTableSaveButton';

export interface MmTrimParamsHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

interface DraftTrim {
  localId: string;
  id: string | null;
  rowVersion: number;
  category: string;
  types: string[];
}

function parseTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}

function mergeTypeDraft(current: string[], draft: string): string[] {
  const trimmed = draft.trim();
  if (!trimmed) return current;
  if (current.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return current;
  return [...current, trimmed];
}

/** Trim requirement parameters \u2014 category + type chips. Local until Save. */
const MmTrimParamsPage = forwardRef<
  MmTrimParamsHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmTrimParamsPage({ onDirtyChange }, ref) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: queryKeys.mmTrimParams(factoryId ?? ''),
    queryFn: async (): Promise<DraftTrim[]> => {
      const { data, error } = await supabase
        .from('mm_trim_requirement_params')
        .select('id, category, types, seq, row_version, is_active')
        .eq('factory_id', factoryId!)
        .eq('is_active', true)
        .order('seq', { ascending: true })
        .order('category', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        localId: String(row.id),
        id: String(row.id),
        rowVersion: Number(row.row_version ?? 1),
        category: String(row.category ?? ''),
        types: parseTypes(row.types),
      }));
    },
    enabled: Boolean(factoryId),
    staleTime: 30_000,
  });

  const saved = listQuery.data ?? [];
  const [draft, setDraft] = useState<DraftTrim[] | null>(null);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [typeDraft, setTypeDraft] = useState('');
  const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const typeInputWrapRef = useRef<HTMLDivElement>(null);

  const focusTypeInput = () => {
    requestAnimationFrame(() => {
      typeInputWrapRef.current?.querySelector('input')?.focus();
    });
  };

  const rows = draft ?? saved;
  const formDirty = Boolean(category.trim() || types.length > 0 || typeDraft.trim());

  useEffect(() => {
    onDirtyChange?.(
      (draft !== null && JSON.stringify(draft) !== JSON.stringify(saved))
      || removedIds.length > 0
      || formDirty
    );
  }, [draft, saved, removedIds, formDirty, onDirtyChange]);

  const resetForm = () => {
    setCategory('');
    setTypes([]);
    setTypeDraft('');
    setEditingLocalId(null);
  };

  const addTrimType = () => {
    const next = mergeTypeDraft(types, typeDraft);
    if (next === types && typeDraft.trim()) {
      showNotification('That trim type is already added', 'error');
      focusTypeInput();
      return;
    }
    if (next === types) {
      focusTypeInput();
      return;
    }
    setTypes(next);
    setTypeDraft('');
    focusTypeInput();
  };

  const tableDirty =
    (draft !== null && JSON.stringify(draft) !== JSON.stringify(saved)) || removedIds.length > 0;

  const applyRows = (next: DraftTrim[], nextRemoved = removedIds) => {
    setDraft(next);
  };

  const submitForm = () => {
    const trimmed = category.trim();
    if (!trimmed) return;
    const nextTypes = mergeTypeDraft(types, typeDraft);
    if (rows.some((r) => r.localId !== editingLocalId && r.category.toLowerCase() === trimmed.toLowerCase())) {
      showNotification('That trim category already exists', 'error');
      return;
    }
    if (editingLocalId) {
      applyRows(rows.map((r) => (r.localId === editingLocalId ? { ...r, category: trimmed, types: nextTypes } : r)));
    } else {
      applyRows([
        ...rows,
        { localId: `tmp_${crypto.randomUUID()}`, id: null, rowVersion: 1, category: trimmed, types: nextTypes },
      ]);
    }
    resetForm();
  };

  const removeRow = (row: DraftTrim) => {
    const nextRemoved = row.id ? [...removedIds, row.id] : removedIds;
    setRemovedIds(nextRemoved);
    applyRows(rows.filter((r) => r.localId !== row.localId), nextRemoved);
    if (editingLocalId === row.localId) resetForm();
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => tableDirty || formDirty,
    save: async () => {
      let pending = draft ?? saved;
      const pendingCategory = category.trim();
      if (!pendingCategory && (types.length > 0 || typeDraft.trim())) {
        showNotification('Enter a category before saving', 'error');
        return false;
      }
      if (pendingCategory) {
        const nextTypes = mergeTypeDraft(types, typeDraft);
        if (pending.some((r) => r.localId !== editingLocalId && r.category.toLowerCase() === pendingCategory.toLowerCase())) {
          showNotification('That trim category already exists', 'error');
          return false;
        }
        if (editingLocalId) {
          pending = pending.map((r) => (r.localId === editingLocalId ? { ...r, category: pendingCategory, types: nextTypes } : r));
        } else {
          pending = [
            ...pending,
            { localId: `tmp_${crypto.randomUUID()}`, id: null, rowVersion: 1, category: pendingCategory, types: nextTypes },
          ];
        }
        setDraft(pending);
      }
      setSaving(true);
      try {
        for (const id of removedIds) {
          const res = await mmDeleteTrimRequirementParam(id);
          if (res.ok === false) throw new Error(res.message);
        }
        for (let i = 0; i < pending.length; i++) {
          const row = pending[i]!;
          const original = saved.find((t) => t.id === row.id);
          if (row.id && original && original.category === row.category && JSON.stringify(original.types) === JSON.stringify(row.types)) {
            continue;
          }
          const payload: Record<string, unknown> = {
            category: row.category,
            types: row.types,
            seq: i,
          };
          if (row.id) {
            payload.id = row.id;
            payload.row_version = row.rowVersion;
          }
          const res = await mmSaveTrimRequirementParam(payload);
          if (res.ok === false) throw new Error(res.message);
          const savedRow = res.data as { id?: unknown; row_version?: unknown } | null;
          if (savedRow?.id != null) {
            pending[i] = {
              ...row,
              id: String(savedRow.id),
              rowVersion: Number(savedRow.row_version ?? row.rowVersion),
            };
            setDraft([...pending]);
          }
        }
        setDraft(null);
        setRemovedIds([]);
        resetForm();
        if (factoryId) {
          await Promise.all([
            qc.invalidateQueries({ queryKey: queryKeys.mmTrimParams(factoryId) }),
            qc.invalidateQueries({ queryKey: queryKeys.mmRequirementCatalog(factoryId) }),
          ]);
        }
        onDirtyChange?.(false);
        showNotification('Trim requirement parameters saved', 'success');
        return true;
      } catch (e) {
        showNotification(e instanceof Error ? e.message : 'Save failed', 'error');
        return false;
      } finally {
        setSaving(false);
      }
    },
  }), [draft, saved, removedIds, tableDirty, formDirty, category, types, typeDraft, editingLocalId, factoryId, qc, showNotification, onDirtyChange]);

  if (listQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[280px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
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
            <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
              {editingLocalId ? <Pencil size={14} /> : <Plus size={14} />}
              {editingLocalId ? 'Edit trim category' : 'Add trim category'}
            </h4>
            <Input
              label="Category"
              placeholder="e.g. Sewing trims"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitForm()}
            />
            <div className="space-y-2">
              <div ref={typeInputWrapRef}>
                <Input
                  label="Trim types"
                  placeholder="Type a trim type and press Enter"
                  value={typeDraft}
                  onChange={(e) => setTypeDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTrimType();
                    }
                  }}
                />
              </div>
              {types.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {types.map((val, idx) => (
                    <div
                      key={`${val}-${idx}`}
                      className="flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-blue-50 text-blue-700 border-blue-200"
                    >
                      <span>{val}</span>
                      <button
                        type="button"
                        onClick={() => setTypes(types.filter((_, i) => i !== idx))}
                        className="opacity-60 hover:opacity-100"
                        aria-label={`Remove ${val}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Plus}
                disabled={!typeDraft.trim() || saving}
                onMouseDown={(e) => e.preventDefault()}
                onClick={addTrimType}
                className="w-full !bg-blue-50 !text-blue-700 !border-blue-200 hover:!bg-blue-100 hover:!text-blue-800"
              >
                Add trims
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={editingLocalId ? Pencil : Plus}
                disabled={!category.trim() || saving}
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
            title="Trim categories"
            subtitle="Click a row to edit"
            isEmpty={rows.length === 0}
            emptyMessage="No trim categories yet."
            headerAction={<MmTableSaveButton />}
          >
            <CatalogTable headers={['S.No', 'Category', 'Types', '']} widths={['3.5rem', '12.7rem', undefined, '2.5rem']}>
              {rows.map((row, idx) => (
                <CatalogTableRow
                  key={row.localId}
                  onClick={() => {
                    setEditingLocalId(row.localId);
                    setCategory(row.category);
                    setTypes(row.types);
                    setTypeDraft('');
                  }}
                  selected={editingLocalId === row.localId}
                >
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 truncate">
                    {row.category}
                    {!row.id ? (
                      <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                    ) : null}
                  </CatalogTableCell>
                  <CatalogTableCell>
                    {row.types.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.types.map((t) => (
                          <span
                            key={t}
                            className="px-1.5 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-medium"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
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
                        aria-label={`Remove ${row.category}`}
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

export default MmTrimParamsPage;
