import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Plus, Loader2, Pencil, X, Trash2 } from 'lucide-react';
import { Button, Input, SelectDropdown } from '../../../components/ui';
import { supabase } from '../../../lib/supabase';
import { saveSupportDropdownRpc } from '../../../lib/settingsRpc';
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
import { mmDeleteFabricType, mmSaveFabricType } from '../lib/mmRpc';
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
  remarks: string;
  fptMax: string;
  qtyUnits: string[];
  widthUnits: string[];
  constructions: DraftConstruction[];
}

const OFFER_ADD = '__offer__:';
let unitOfferChain: Promise<void> = Promise.resolve();

type UnitOption = { value: string; label: string; base: string };

function UnitMulti({
  label,
  value,
  options,
  extras,
  sameBase,
  onChange,
  onOffer,
}: {
  label: string;
  value: string[];
  options: UnitOption[];
  extras: UnitOption[];
  sameBase?: boolean;
  onChange: (next: string[]) => void;
  onOffer: (code: string) => void;
}) {
  const menu = [
    ...options.map((opt) => ({ value: opt.value, label: opt.label })),
    ...extras.map((opt) => ({ value: `${OFFER_ADD}${opt.value}`, label: `Add ${opt.label} to the list` })),
  ];
  return (
    <div>
      <SelectDropdown
        label={label}
        multiple
        closeOnSelect={false}
        collapseWhenAll={false}
        value={value}
        placeholder="Select units"
        options={menu}
        onChange={(next) => {
          const offered = next.filter((item) => item.startsWith(OFFER_ADD));
          for (const token of offered) onOffer(token.slice(OFFER_ADD.length));
          const picked = next.filter((item) => !item.startsWith(OFFER_ADD) && options.some((opt) => opt.value === item));
          if (picked.length === 0) return;
          if (sameBase) {
            const bases = new Set(picked.map((code) => options.find((opt) => opt.value === code)?.base).filter(Boolean));
            if (bases.size > 1) {
              const added = picked.find((code) => !value.includes(code)) ?? picked[picked.length - 1];
              const ok = window.confirm('A type is either weight or length. The other qty units will be cleared.');
              if (!ok) return;
              onChange([added]);
              return;
            }
          }
          if (picked.length === value.length && picked.every((code, index) => code === value[index])) return;
          onChange(picked);
        }}
      />
      <p className="text-[10px] text-slate-400 mt-1">Comma-separated. The first unit is the default. Add a unit to the factory list.</p>
    </div>
  );
}

function UnitsCell({ qty, width }: { qty: string[]; width: string[] }) {
  return (
    <span>
      {qty.map((unit, index) => (
        <span key={unit} className={index === 0 ? 'font-semibold text-slate-800' : undefined}>
          {index > 0 ? ' · ' : ''}{qtyLabel(unit)}
        </span>
      ))}
      <span> / </span>
      {width.map((unit, index) => (
        <span key={unit} className={index === 0 ? 'font-semibold text-slate-800' : undefined}>
          {index > 0 ? ' · ' : ''}{widthLabel(unit)}
        </span>
      ))}
    </span>
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
  const qtyExtras: UnitOption[] = catalog
    .filter((unit) => unit.kind === 'qty' && !qtyOffer.some((offered) => offered.code === unit.code))
    .map((unit) => ({ value: unit.code, label: unit.label, base: unit.base }));
  const widthExtras: UnitOption[] = catalog
    .filter((unit) => unit.kind === 'width' && !widthOffer.some((offered) => offered.code === unit.code))
    .map((unit) => ({ value: unit.code, label: unit.label, base: unit.base }));
  const factoryId = useNavigationStore((s) => s.factoryId);

  async function offerUnit(kind: 'qty' | 'width', code: string) {
    const unit: MmUnit | undefined = catalog.find((item) => item.code === code && item.kind === kind);
    if (!unit || !factoryId) return;
    const category = kind === 'qty' ? 'qty_uom' : 'width_uom';
    const appName = kind === 'qty' ? 'Qty UOM' : 'Width UOM';
    const run = async () => {
      const { data: row, error } = await supabase
        .from('support_dropdowns')
        .select('id, app_name, values')
        .eq('factory_id', factoryId)
        .eq('category', category)
        .maybeSingle();
      if (error) {
        showNotification(error.message, 'error');
        return;
      }
      if (row && !Array.isArray(row.values)) {
        showNotification(`${appName} list could not be read`, 'error');
        return;
      }
      const current = Array.isArray(row?.values) ? row.values.map((item) => String(item)) : [];
      if (current.some((item) => item.trim().toLowerCase() === unit.label.toLowerCase())) {
        await unitsQ.refetch();
        return;
      }
      const values = [...current, unit.label];
      if (row?.id) {
        await saveSupportDropdownRpc('update', factoryId, {
          id: row.id,
          category,
          app_name: row.app_name || appName,
          values,
        });
      } else {
        await saveSupportDropdownRpc('insert', factoryId, { category, app_name: appName, values });
      }
      await unitsQ.refetch();
      showNotification(`${unit.label} added to ${appName}`, 'success');
    };
    const next = unitOfferChain.then(run, run);
    unitOfferChain = next.then(() => undefined, () => undefined);
    try {
      await next;
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Could not add unit', 'error');
    }
  }

  const [draft, setDraft] = useState<DraftType[] | null>(null);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [fptMax, setFptMax] = useState('');
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
        remarks: t.remarks != null ? String(t.remarks) : '',
        fptMax: t.fpt_max_points != null && t.fpt_max_points !== '' ? String(t.fpt_max_points) : '',
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
  const formDirty = Boolean(name.trim() || remarks.trim() || fptMax.trim() || constructionText.trim() || unitsDirty);

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
    setRemarks('');
    setFptMax('');
    setQtyUnits(qtyOffer[0] ? [qtyOffer[0].code] : []);
    setWidthUnits(widthOffer[0] ? [widthOffer[0].code] : []);
    setConstructionText('');
    setEditingLocalId(null);
  };

  const draftFromForm = (existing: DraftType | undefined, trimmed: string): Pick<DraftType, 'name' | 'remarks' | 'fptMax' | 'qtyUnits' | 'widthUnits' | 'constructions'> => ({
    name: trimmed,
    remarks: remarks.trim(),
    fptMax: fptMax.trim(),
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
      if (!pendingName && (remarks.trim() || fptMax.trim() || constructionText.trim() || unitsDirty)) {
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
            && original.remarks === row.remarks
            && original.fptMax === row.fptMax
            && sameUnitList(original.qtyUnits, row.qtyUnits)
            && sameUnitList(original.widthUnits, row.widthUnits),
          );
          if (typeId && !typeUnchanged) {
            const res = await mmSaveFabricType({
              id: typeId,
              name: row.name,
              remarks: row.remarks,
              fpt_max_points: row.fptMax.trim() === '' ? null : Number(row.fptMax),
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
              remarks: row.remarks,
              fpt_max_points: row.fptMax.trim() === '' ? null : Number(row.fptMax),
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
  }), [draft, savedTypes, removedIds, formDirty, name, remarks, fptMax, qtyUnits, widthUnits, constructionText, editingLocalId, data, refresh, showNotification, onDirtyChange]);

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
            <UnitMulti
              label="Qty UOM"
              value={qtyUnits}
              options={qtyOptions}
              extras={qtyExtras}
              sameBase
              onChange={setQtyUnits}
              onOffer={(code) => { void offerUnit('qty', code); }}
            />
            <UnitMulti
              label="Width UOM"
              value={widthUnits}
              options={widthOptions}
              extras={widthExtras}
              onChange={setWidthUnits}
              onOffer={(code) => { void offerUnit('width', code); }}
            />
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
              <textarea
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y min-h-[2.75rem] max-h-[4.75rem] text-[11px] leading-4"
              />
            </div>
            <Input
              label="4 point max (points / 100 sq yd)"
              type="number"
              placeholder="Blank = factory default"
              value={fptMax}
              onChange={(e) => setFptMax(e.target.value)}
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
            <CatalogTable headers={['S.No', 'Type', 'Units', '4pt max', 'Constructions', 'Remarks', '']}>
              {rows.map((row, idx) => (
                <CatalogTableRow
                  key={row.localId}
                  onClick={() => {
                    setEditingLocalId(row.localId);
                    setName(row.name);
                    setRemarks(row.remarks);
                    setFptMax(row.fptMax);
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
                  <CatalogTableCell className="text-slate-600 whitespace-nowrap">
                    <UnitsCell qty={row.qtyUnits} width={row.widthUnits} />
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-600 tabular-nums w-16 max-w-[4rem]">{row.fptMax.trim() || '—'}</CatalogTableCell>
                  <CatalogTableCell className="text-[10px] leading-tight text-slate-500 whitespace-normal w-[46%]">
                    {row.constructions.filter((item) => item.is_active).map((item) => item.name).join(', ') || '—'}
                  </CatalogTableCell>
                  <CatalogTableCell className="text-slate-500 truncate w-32 max-w-[8rem]">
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
