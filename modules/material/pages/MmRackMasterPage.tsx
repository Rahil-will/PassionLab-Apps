import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Input, SelectDropdown } from '../../../components/ui';
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
import { mmDeactivateRackLocation, mmSaveRackLocation, type MmRackLocation } from '../lib/mmRpc';
import { useInvalidateMmOps, useMmRackMaster } from '../lib/useMmOps';
import { MmTableSaveButton } from '../components/MmTableSaveButton';

export interface MmRackMasterHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type LocType = 'zone' | 'rack' | 'bin';

interface DraftLoc {
  localId: string;
  id: string | null;
  parentLocalId: string;
  code: string;
  name: string;
  location_type: LocType;
  capacity_rolls: number | null;
  roll_count: number;
  rowVersion: number;
}

function isWarehouseParent(parentId: string | null | undefined, warehouseId: string): boolean {
  return !parentId || parentId === warehouseId;
}

function autoCode(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).toUpperCase();
}

function uniqueCode(base: string, used: Set<string>): string {
  const seed = base || 'LOC';
  if (!used.has(seed)) return seed;
  let i = 2;
  while (used.has(`${seed}-${i}`)) i += 1;
  return `${seed}-${i}`;
}

function sortKey(loc: DraftLoc, byLocal: Map<string, DraftLoc>): string {
  const parts: string[] = [];
  let current: DraftLoc | undefined = loc;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.localId)) break;
    seen.add(current.localId);
    parts.unshift(`${current.location_type}:${current.code}`);
    current = current.parentLocalId ? byLocal.get(current.parentLocalId) : undefined;
  }
  return parts.join('/');
}

function depthOf(loc: DraftLoc, byLocal: Map<string, DraftLoc>): number {
  return Math.max(0, sortKey(loc, byLocal).split('/').filter(Boolean).length - 1);
}

function descendantLocalIds(root: DraftLoc, rows: DraftLoc[]): string[] {
  const ids = new Set<string>([root.localId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (ids.has(row.localId) || !ids.has(row.parentLocalId)) continue;
      ids.add(row.localId);
      grew = true;
    }
  }
  return [...ids];
}

function toDraft(loc: MmRackLocation, warehouseId: string): DraftLoc {
  const type: LocType = loc.location_type === 'zone' || loc.location_type === 'bin' ? loc.location_type : 'rack';
  return {
    localId: loc.id,
    id: loc.id,
    parentLocalId: isWarehouseParent(loc.parent_id, warehouseId) ? '' : (loc.parent_id ?? ''),
    code: loc.code,
    name: loc.name,
    location_type: type,
    capacity_rolls: loc.capacity_rolls,
    roll_count: loc.roll_count,
    rowVersion: Number(loc.row_version ?? 1),
  };
}

function sameRow(a: DraftLoc, b: DraftLoc | undefined): boolean {
  if (!b) return false;
  return (
    a.id === b.id
    && a.parentLocalId === b.parentLocalId
    && a.code === b.code
    && a.name === b.name
    && a.location_type === b.location_type
    && a.capacity_rolls === b.capacity_rolls
  );
}

const MmRackMasterPage = forwardRef<MmRackMasterHandle, { onDirtyChange?: (dirty: boolean) => void }>(
  function MmRackMasterPage({ onDirtyChange }, ref) {
    const { showNotification } = useNotificationStore();
    const invalidate = useInvalidateMmOps();
    const { data, isLoading, refetch } = useMmRackMaster();

    const [draft, setDraft] = useState<DraftLoc[] | null>(null);
    const [removedIds, setRemovedIds] = useState<string[]>([]);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [kind, setKind] = useState<LocType>('rack');
    const [parentId, setParentId] = useState('');
    const [capacity, setCapacity] = useState('');
    const [editingLocalId, setEditingLocalId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const warehouseId = data?.warehouse_id ?? '';
    const savedRows = useMemo(
      () => (data?.locations ?? []).map((loc) => toDraft(loc, warehouseId)),
      [data?.locations, warehouseId],
    );
    const rows = draft ?? savedRows;
    const byLocal = useMemo(() => new Map(rows.map((loc) => [loc.localId, loc])), [rows]);
    const tree = useMemo(
      () => [...rows].sort((a, b) => sortKey(a, byLocal).localeCompare(sortKey(b, byLocal))),
      [rows, byLocal],
    );

    const parentOptions = useMemo(() => {
      if (kind === 'bin') return rows.filter((loc) => loc.location_type === 'rack' && loc.localId !== editingLocalId);
      return rows.filter((loc) => loc.location_type === 'zone' && loc.localId !== editingLocalId);
    }, [kind, rows, editingLocalId]);

    const resetForm = () => {
      setName('');
      setCode('');
      setCapacity('');
      setKind('rack');
      setParentId('');
      setEditingLocalId(null);
    };

    const editingRow = editingLocalId ? byLocal.get(editingLocalId) ?? null : null;
    const formDirty = editingRow
      ? name.trim() !== editingRow.name
        || code.trim().toUpperCase() !== editingRow.code.toUpperCase()
        || (kind === 'zone' ? '' : parentId) !== editingRow.parentLocalId
        || capacity.trim() !== (editingRow.capacity_rolls != null ? String(editingRow.capacity_rolls) : '')
      : Boolean(name.trim() || code.trim() || capacity.trim());
    const tableDirty =
      removedIds.length > 0
      || (draft !== null && JSON.stringify(draft) !== JSON.stringify(savedRows));
    const dirty = tableDirty || formDirty;

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    const startEdit = (loc: DraftLoc) => {
      setEditingLocalId(loc.localId);
      setKind(loc.location_type);
      setParentId(loc.parentLocalId);
      setName(loc.name);
      setCode(loc.code);
      setCapacity(loc.capacity_rolls != null ? String(loc.capacity_rolls) : '');
    };

    const applyRows = (next: DraftLoc[]) => {
      setDraft(next);
    };

    const submitForm = () => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        showNotification('Name is required', 'error');
        return false;
      }
      if (kind === 'bin' && !parentId) {
        showNotification('Select a rack for this bin', 'error');
        return false;
      }
      const capacityValue = capacity.trim() ? Number(capacity.trim()) : null;
      if (capacityValue != null && (!Number.isFinite(capacityValue) || capacityValue < 0)) {
        showNotification('Max rolls cannot be negative', 'error');
        return false;
      }
      const usedCodes = new Set(
        rows.filter((r) => r.localId !== editingLocalId).map((r) => r.code.toUpperCase()),
      );
      const nextCode = uniqueCode((code.trim() || autoCode(trimmedName)).toUpperCase(), usedCodes);
      if (rows.some((r) => r.localId !== editingLocalId && r.code.toUpperCase() === nextCode)) {
        showNotification('That location code already exists', 'error');
        return false;
      }
      if (editingLocalId) {
        applyRows(rows.map((r) => (
          r.localId === editingLocalId
            ? {
                ...r,
                name: trimmedName,
                code: nextCode,
                parentLocalId: kind === 'zone' ? '' : parentId,
                location_type: kind,
                capacity_rolls: kind === 'zone' ? null : capacityValue,
              }
            : r
        )));
      } else {
        applyRows([
          ...rows,
          {
            localId: `tmp_${crypto.randomUUID()}`,
            id: null,
            parentLocalId: kind === 'zone' ? '' : parentId,
            code: nextCode,
            name: trimmedName,
            location_type: kind,
            capacity_rolls: kind === 'zone' ? null : capacityValue,
            roll_count: 0,
            rowVersion: 1,
          },
        ]);
      }
      resetForm();
      return true;
    };

    const removeRow = (loc: DraftLoc) => {
      if (loc.roll_count > 0) {
        showNotification('Move rolls off this rack before removing it', 'error');
        return;
      }
      const drop = new Set(descendantLocalIds(loc, rows));
      const nextRemoved = [...removedIds];
      for (const row of rows) {
        if (!drop.has(row.localId) || !row.id) continue;
        if (!nextRemoved.includes(row.id)) nextRemoved.push(row.id);
      }
      setRemovedIds(nextRemoved);
      applyRows(rows.filter((r) => !drop.has(r.localId)));
      if (editingLocalId && drop.has(editingLocalId)) resetForm();
    };

    const persistAll = useCallback(async (): Promise<boolean> => {
      if (!data) return false;
      let pending = [...(draft ?? savedRows)];
      const trimmedName = name.trim();
      const formHasInput = Boolean(trimmedName || code.trim() || capacity.trim());
      if (formHasInput) {
        if (!trimmedName) {
          showNotification('Name is required', 'error');
          return false;
        }
        if (kind === 'bin' && !parentId) {
          showNotification('Select a rack for this bin', 'error');
          return false;
        }
        const capacityValue = capacity.trim() ? Number(capacity.trim()) : null;
        if (capacityValue != null && (!Number.isFinite(capacityValue) || capacityValue < 0)) {
          showNotification('Max rolls cannot be negative', 'error');
          return false;
        }
        const usedCodes = new Set(
          pending.filter((r) => r.localId !== editingLocalId).map((r) => r.code.toUpperCase()),
        );
        const nextCode = uniqueCode((code.trim() || autoCode(trimmedName)).toUpperCase(), usedCodes);
        if (editingLocalId) {
          pending = pending.map((r) => (
            r.localId === editingLocalId
              ? {
                  ...r,
                  name: trimmedName,
                  code: nextCode,
                  parentLocalId: kind === 'zone' ? '' : parentId,
                  location_type: kind,
                  capacity_rolls: kind === 'zone' ? null : capacityValue,
                }
              : r
          ));
        } else {
          pending = [
            ...pending,
            {
              localId: `tmp_${crypto.randomUUID()}`,
              id: null,
              parentLocalId: kind === 'zone' ? '' : parentId,
              code: nextCode,
              name: trimmedName,
              location_type: kind,
              capacity_rolls: kind === 'zone' ? null : capacityValue,
              roll_count: 0,
            rowVersion: 1,
            },
          ];
        }
        setDraft(pending);
      }

      if (
        removedIds.length === 0
        && pending.length === savedRows.length
        && pending.every((row, i) => sameRow(row, savedRows[i]))
      ) {
        onDirtyChange?.(false);
        return true;
      }

      setSaving(true);
      try {
        for (const id of removedIds) {
          const res = await mmDeactivateRackLocation(id);
          if (res.ok === false) throw new Error(res.message);
        }
        const idByLocal = new Map<string, string>();
        for (const row of pending) {
          if (row.id) idByLocal.set(row.localId, row.id);
        }
        const originalByLocal = new Map(savedRows.map((row) => [row.localId, row]));
        const order: LocType[] = ['zone', 'rack', 'bin'];
        for (const type of order) {
          for (const row of pending.filter((r) => r.location_type === type)) {
            const original = originalByLocal.get(row.localId);
            if (row.id && sameRow(row, original)) continue;
            const parentServerId = row.parentLocalId ? idByLocal.get(row.parentLocalId) : undefined;
            if (row.parentLocalId && !parentServerId) {
              throw new Error(`Save the parent of ${row.name} first`);
            }
            const res = await mmSaveRackLocation({
              id: row.id ?? undefined,
              name: row.name,
              code: row.code || undefined,
              location_type: row.location_type,
              parent_id: parentServerId,
              capacity_rolls: row.capacity_rolls,
              row_version: row.id ? row.rowVersion : null,
            });
            if (res.ok === false) throw new Error(res.message);
            idByLocal.set(row.localId, res.data.id);
            pending = pending.map((r) => (
              r.localId === row.localId ? { ...r, id: res.data.id, code: res.data.code } : r
            ));
          }
        }
        setDraft(null);
        setRemovedIds([]);
        resetForm();
        await invalidate();
        await refetch();
        onDirtyChange?.(false);
        showNotification('Racks saved', 'success');
        return true;
      } catch (e) {
        showNotification(e instanceof Error ? e.message : 'Save failed', 'error');
        return false;
      } finally {
        setSaving(false);
      }
    }, [
      data,
      draft,
      savedRows,
      name,
      code,
      capacity,
      kind,
      parentId,
      editingLocalId,
      removedIds,
      invalidate,
      refetch,
      onDirtyChange,
      showNotification,
    ]);

    useImperativeHandle(ref, () => ({
      isDirty: () => dirty,
      save: async () => {
        if (!dirty) return true;
        return persistAll();
      },
    }), [dirty, persistAll]);

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-[240px]">
          <Loader2 size={24} className="animate-spin text-slate-400" />
        </div>
      );
    }

    return (
      <EditorSplitLayout
        fillHeight
        leftScrollable
        rightScrollable
        left={
          <DesktopWriteGate>
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingLocalId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingLocalId ? 'Edit location' : 'Add zone, rack, or bin'}
              </h4>
              <SelectDropdown
                label="Type"
                value={kind}
                disabled={saving || Boolean(editingLocalId)}
                className="w-full"
                shape="pill"
                options={[
                  { value: 'zone', label: 'Zone' },
                  { value: 'rack', label: 'Rack' },
                  { value: 'bin', label: 'Bin' },
                ]}
                onChange={(v) => {
                  setKind(v as LocType);
                  setParentId('');
                }}
              />
              {kind !== 'zone' && (
                <SelectDropdown
                  label={kind === 'bin' ? 'Rack' : 'Zone (optional)'}
                  value={parentId}
                  disabled={saving}
                  className="w-full"
                  shape="pill"
                  placeholder={kind === 'bin' ? 'Select rack' : 'Warehouse root'}
                  options={[
                    { value: '', label: kind === 'bin' ? 'Select rack' : 'Warehouse root' },
                    ...parentOptions.map((loc) => ({
                      value: loc.localId,
                      label: `${loc.code} · ${loc.name}`,
                    })),
                  ]}
                  onChange={setParentId}
                />
              )}
              <Input
                label="Name"
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitForm()}
              />
              <Input
                label="Code"
                placeholder="Auto-generated if blank"
                value={code}
                disabled={saving}
                onChange={(e) => setCode(e.target.value)}
              />
              {kind !== 'zone' && (
                <Input
                  label="Max rolls"
                  type="number"
                  min={0}
                  placeholder="No limit"
                  value={capacity}
                  disabled={saving}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              )}
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
                      disabled={saving || (byLocal.get(editingLocalId)?.roll_count ?? 0) > 0}
                      onClick={() => {
                        const row = byLocal.get(editingLocalId);
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
        }
        right={
          <CatalogTablePanel
            title="Racks"
            subtitle="Click a row to edit. Save writes the table to the warehouse."
            isEmpty={tree.length === 0}
            emptyMessage="No zones, racks, or bins yet."
            headerAction={<MmTableSaveButton />}
          >
            <CatalogTable headers={['S.No', 'Name', 'Type', 'Code', 'Capacity', '']}>
              {tree.map((loc, idx) => (
                <CatalogTableRow key={loc.localId} onClick={() => startEdit(loc)} selected={editingLocalId === loc.localId}>
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800">
                    <span style={{ paddingLeft: `${depthOf(loc, byLocal) * 14}px` }}>{loc.name}</span>
                    {!loc.id ? (
                      <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                    ) : null}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-500 capitalize">{loc.location_type}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-500">{loc.code}</CatalogTableCell>
                  <CatalogTableCell className="tabular-nums text-slate-600">
                    {loc.location_type === 'zone'
                      ? '—'
                      : `${loc.roll_count}${loc.capacity_rolls != null ? ` / ${loc.capacity_rolls}` : ''}`}
                  </CatalogTableCell>
                  <CatalogTableCell>
                    <DesktopWriteGate>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRow(loc);
                        }}
                        disabled={saving || loc.roll_count > 0}
                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                        aria-label={`Remove ${loc.name}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </DesktopWriteGate>
                  </CatalogTableCell>
                </CatalogTableRow>
              ))}
            </CatalogTable>
          </CatalogTablePanel>
        }
      />
    );
  },
);

export default MmRackMasterPage;
