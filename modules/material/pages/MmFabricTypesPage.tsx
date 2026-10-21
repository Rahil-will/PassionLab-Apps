import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Plus, Loader2, Pencil, X, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, SelectDropdown } from '../../../components/ui';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../stores';
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
import { mmAddUnit, mmDeleteFabricType, mmSaveFabricType } from '../lib/mmRpc';
import { listFabricConstructions, saveFabricConstruction, type MmFabricConstruction } from '../lib/mmFabricRpc';
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import { CommaSeparatedInput, joinCommaList } from '../components/OptionValuesEditor';
import {
  parseUnitCodeList,
  qtyLabel,
  sameUnitList,
  useMmUnits,
  widthLabel,
  type MmUnit,
} from '../lib/units';

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
  qtyUnits: string[];
  widthUnits: string[];
  constructions: DraftConstruction[];
}

const ADD_MORE = '__add_more__';

type UnitOption = { value: string; label: string; base: string };

function UnitMulti({
  label,
  value,
  options,
  onChange,
  onAddMore,
}: {
  label: string;
  value: string[];
  options: UnitOption[];
  onChange: (next: string[]) => void;
  onAddMore: () => void;
}) {
  const [menuKey, setMenuKey] = useState(0);
  const menu = [
    ...options.map((opt) => ({ value: opt.value, label: opt.label })),
    { value: ADD_MORE, label: '+ Add unit…' },
  ];
  return (
    <div>
      <SelectDropdown
        key={menuKey}
        label={label}
        multiple
        closeOnSelect={false}
        collapseWhenAll={false}
        value={value}
        placeholder="Select units"
        options={menu}
        onChange={(next) => {
          if (next.includes(ADD_MORE)) {
            setMenuKey((key) => key + 1);
            onAddMore();
            return;
          }
          const picked = next.filter((item) => options.some((opt) => opt.value === item));
          if (picked.length === 0) return;
          if (picked.length === value.length && picked.every((code, index) => code === value[index])) return;
          onChange(picked);
        }}
      />
      <p className="text-[10px] text-slate-400 mt-1">Comma-separated. The first unit is the default.</p>
    </div>
  );
}

function UnitListCell({ units, kind }: { units: string[]; kind: 'qty' | 'width' }) {
  const labelOf = kind === 'qty' ? qtyLabel : widthLabel;
  return (
    <span className="whitespace-nowrap">
      {units.map((unit, index) => (
        <span key={unit} className={index === 0 ? 'font-semibold text-slate-800' : undefined}>
          {index > 0 ? ' · ' : ''}{labelOf(unit)}
        </span>
      ))}
      {units.length === 0 ? '—' : null}
    </span>
  );
}

function unitMatchesText(unit: MmUnit, text: string): boolean {
  const value = text.trim().toLowerCase();
  return unit.code.toLowerCase() === value
    || unit.label.toLowerCase() === value
    || unit.aliases.some((alias) => alias.toLowerCase() === value);
}

/** Add unit modal — creates a unit via mm_add_unit, or adds a known one to the factory list. */
function AddUnitModal({
  kind,
  factoryId,
  catalog,
  onClose,
  onAdded,
}: {
  kind: 'qty' | 'width';
  factoryId: string | null;
  catalog: MmUnit[];
  onClose: () => void;
  onAdded: (code: string) => void;
}) {
  const { showNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [factor, setFactor] = useState('');
  const [base, setBase] = useState<'kg' | 'm'>('kg');
  const [saving, setSaving] = useState(false);
  const known = name.trim()
    ? catalog.find((unit) => unit.kind === kind && unitMatchesText(unit, name))
    : undefined;
  const save = async () => {
    const label = name.trim();
    if (!label) return;
    const unitFactor = known ? known.factor : Number(factor);
    if (!known && (!Number.isFinite(unitFactor) || unitFactor <= 0)) {
      showNotification('Enter how much one unit is', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await mmAddUnit({
        kind,
        label,
        factor: unitFactor,
        base: kind === 'width' ? 'in' : (known ? known.base : base),
      });
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['mm-units'] });
      if (factoryId) await queryClient.invalidateQueries({ queryKey: queryKeys.supportDropdowns(factoryId) });
      onAdded(res.data.code);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} className="max-w-lg">
      <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Add {kind === 'qty' ? 'qty' : 'width'} unit</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">The new unit is added to your list and picked here.</p>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="px-5 py-4 space-y-4">
        <Input label="Unit name" placeholder="e.g. PCS" value={name} onChange={(e) => setName(e.target.value)} />
        {known ? (
          <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">Already known — it will be added to your list</p>
        ) : kind === 'qty' ? (
          <div className="flex items-end gap-2">
            <span className="text-[11px] text-slate-600 pb-2 whitespace-nowrap">1 {name.trim() || 'unit'} =</span>
            <Input type="number" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="0.00" />
            <SelectDropdown value={base} onChange={(value) => setBase(value === 'm' ? 'm' : 'kg')} options={[{ value: 'kg', label: 'KG' }, { value: 'm', label: 'MTR' }]} className="w-28" />
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <span className="text-[11px] text-slate-600 pb-2 whitespace-nowrap">1 {name.trim() || 'unit'} =</span>
            <Input type="number" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="0.00" />
            <span className="text-[11px] text-slate-600 pb-2">inches</span>
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50/60">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!name.trim() || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

/** Fabric types (Knit / Woven / …). Edits stay local until the page Save. */
const MmFabricTypesPage = forwardRef<
  MmFabricTypesHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function MmFabricTypesPage({ onDirtyChange }, ref) {
  const { data, isLoading } = useMmConfigBundle();
  const refresh = useRefreshMmConfig();
  const { showNotification } = useNotificationStore();
  const unitsQ = useMmUnits();
  const qtyOffer = unitsQ.data?.qty ?? [];
  const widthOffer = unitsQ.data?.width ?? [];
  const qtyOptions: UnitOption[] = qtyOffer.map((unit) => ({ value: unit.code, label: unit.label, base: unit.base }));
  const widthOptions: UnitOption[] = widthOffer.map((unit) => ({ value: unit.code, label: unit.label, base: unit.base }));
  const catalog = unitsQ.data?.all ?? [];
  const factoryId = useNavigationStore((s) => s.factoryId);
  const [addKind, setAddKind] = useState<'qty' | 'width' | null>(null);

  const [draft, setDraft] = useState<DraftType[] | null>(null);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [qtyUnits, setQtyUnits] = useState<string[]>([]);
  const [widthUnits, setWidthUnits] = useState<string[]>([]);
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
        qtyUnits: parseUnitCodeList(t.qty_units),
        widthUnits: parseUnitCodeList(t.width_units),
        constructions: (byType.get(String(t.id)) ?? []).sort((a, b) => a.seq - b.seq),
      }));
  }, [data?.types, constructionRows]);

  const rows = draft ?? savedTypes;
  const editingRow = editingLocalId ? rows.find((row) => row.localId === editingLocalId) ?? null : null;
  const defaultQty = qtyOffer[0] ? [qtyOffer[0].code] : [];
  const defaultWidth = widthOffer[0] ? [widthOffer[0].code] : [];
  const unitsDirty = editingRow
    ? !sameUnitList(editingRow.qtyUnits, qtyUnits) || !sameUnitList(editingRow.widthUnits, widthUnits)
    : !sameUnitList(qtyUnits, defaultQty) || !sameUnitList(widthUnits, defaultWidth);
  const formDirty = Boolean(name.trim() || constructionText.trim() || unitsDirty);

  useEffect(() => {
    if (editingLocalId) return;
    if (qtyOffer.length === 0 && widthOffer.length === 0) return;
    setQtyUnits((current) => {
      const codes = new Set(qtyOffer.map((unit) => unit.code));
      if (current.length > 0 && current.every((code) => codes.has(code))) return current;
      return qtyOffer[0] ? [qtyOffer[0].code] : [];
    });
    setWidthUnits((current) => {
      const codes = new Set(widthOffer.map((unit) => unit.code));
      if (current.length > 0 && current.every((code) => codes.has(code))) return current;
      return widthOffer[0] ? [widthOffer[0].code] : [];
    });
  }, [editingLocalId, qtyOffer, widthOffer]);

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
    setQtyUnits(qtyOffer[0] ? [qtyOffer[0].code] : []);
    setWidthUnits(widthOffer[0] ? [widthOffer[0].code] : []);
    setConstructionText('');
    setEditingLocalId(null);
  };

  const draftFromForm = (existing: DraftType | undefined, trimmed: string): Pick<DraftType, 'name' | 'qtyUnits' | 'widthUnits' | 'constructions'> => ({
    name: trimmed,
    qtyUnits,
    widthUnits,
    constructions: constructionsFromText(constructionText, existing?.constructions ?? []),
  });

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
          ? { ...r, ...draftFromForm(r, trimmed) }
          : r
      )));
    } else {
      applyRows([
        ...rows,
        {
          localId: `tmp_${crypto.randomUUID()}`,
          id: null,
          rowVersion: 1,
          ...draftFromForm(undefined, trimmed),
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
      if (!pendingName && (constructionText.trim() || unitsDirty)) {
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
              ? { ...r, ...draftFromForm(r, pendingName) }
              : r
          ));
        } else {
          pending = [
            ...pending,
            {
              localId: `tmp_${crypto.randomUUID()}`,
              id: null,
              rowVersion: 1,
              ...draftFromForm(undefined, pendingName),
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
            && sameUnitList(original.qtyUnits, row.qtyUnits)
            && sameUnitList(original.widthUnits, row.widthUnits),
          );
          if (typeId && !typeUnchanged) {
            const res = await mmSaveFabricType({
              id: typeId,
              name: row.name,
              qty_units: row.qtyUnits,
              width_units: row.widthUnits,
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
              qty_units: row.qtyUnits,
              width_units: row.widthUnits,
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
  }), [draft, savedTypes, removedIds, formDirty, name, qtyUnits, widthUnits, constructionText, editingLocalId, data, refresh, showNotification, onDirtyChange]);

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
            <UnitMulti
              label="Qty UOM"
              value={qtyUnits}
              options={qtyOptions}
              onChange={setQtyUnits}
              onAddMore={() => setAddKind('qty')}
            />
            <UnitMulti
              label="Width UOM"
              value={widthUnits}
              options={widthOptions}
              onChange={setWidthUnits}
              onAddMore={() => setAddKind('width')}
            />
            <CommaSeparatedInput
              label="Constructions"
              value={constructionText}
              onChange={setConstructionText}
              placeholder="Single jersey, Rib, Interlock"
              hint="Separate constructions with commas."
              rows={4}
            />
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
            <CatalogTable
              headers={['S.No', 'Type', 'Qty UOM', 'Width UOM', 'Constructions', '']}
              widths={[undefined, '10rem', '9rem', '9rem', undefined, '2rem']}
            >
              {rows.map((row, idx) => (
                <CatalogTableRow
                  key={row.localId}
                  onClick={() => {
                    setEditingLocalId(row.localId);
                    setName(row.name);
                    setQtyUnits(row.qtyUnits);
                    setWidthUnits(row.widthUnits);
                    setConstructionText(
                      joinCommaList(row.constructions.filter((item) => item.is_active).map((item) => item.name)),
                    );
                  }}
                  selected={editingLocalId === row.localId}
                >
                  <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 truncate w-[7.5rem] max-w-[7.5rem]">
                    {row.name}
                    {!row.id ? (
                      <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                    ) : null}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">
                    <UnitListCell units={row.qtyUnits} kind="qty" />
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">
                    <UnitListCell units={row.widthUnits} kind="width" />
                  </CatalogTableCell>
                  <CatalogTableCell className="text-[10px] leading-tight text-slate-500 whitespace-normal">
                    {row.constructions.filter((item) => item.is_active).map((item) => item.name).join(', ') || '—'}
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
    {addKind ? (
      <AddUnitModal
        kind={addKind}
        factoryId={factoryId}
        catalog={catalog}
        onClose={() => setAddKind(null)}
        onAdded={(code) => {
          if (addKind === 'qty') setQtyUnits((cur) => (cur.includes(code) ? cur : [...cur, code]));
          else setWidthUnits((cur) => (cur.includes(code) ? cur : [...cur, code]));
          setAddKind(null);
        }}
      />
    ) : null}
    </>
  );
});

export default MmFabricTypesPage;
