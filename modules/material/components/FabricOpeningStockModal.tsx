/**
 * Opening stock — adds free in-stock rolls for a fabric. Does not replace stock already there.
 * Shown in the fabric editor, not on the list.
 */
import React, { useState } from 'react';
import { Button, Input, Modal, SelectDropdown } from '../../../components/ui';
import { useNotificationStore } from '../../../stores';
import { saveFabricOpeningStock, type MmFabric } from '../lib/mmFabricRpc';
import { fmtNum } from '../lib/fabricStock';
import { FabricPicker } from './FabricPicker';

const UNIT_OPTIONS = [
  { value: 'roll', label: 'Rolls' },
  { value: 'lap', label: 'Laps' },
  { value: 'pieces', label: 'Pieces' },
];

export type OpeningStockDraft = {
  qty: string;
  count: string;
  unitForm: 'roll' | 'lap' | 'pieces';
  lot: string;
};

export function emptyOpeningStockDraft(): OpeningStockDraft {
  return { qty: '', count: '', unitForm: 'roll', lot: '' };
}

export function parseOpeningStockDraft(draft: OpeningStockDraft):
  | { ok: true; empty: true }
  | { ok: true; empty: false; qty: number; count: number; unitForm: 'roll' | 'lap' | 'pieces'; lot?: string }
  | { ok: false; message: string } {
  const qtyRaw = draft.qty.trim();
  const countRaw = draft.count.trim();
  if (!qtyRaw && !countRaw) return { ok: true, empty: true };
  const qtyN = Number(qtyRaw);
  const countN = Number(countRaw);
  if (!Number.isFinite(qtyN) || qtyN <= 0) return { ok: false, message: 'Enter a quantity for opening stock' };
  if (!Number.isInteger(countN) || countN < 1 || countN > 200) {
    return { ok: false, message: 'Opening stock needs between 1 and 200 rolls, laps, or pieces' };
  }
  return {
    ok: true,
    empty: false,
    qty: qtyN,
    count: countN,
    unitForm: draft.unitForm,
  };
}

export function FabricOpeningStockPanel({
  fabric,
  onSaved,
  draft,
  uom: uomProp,
  onDraftChange,
}: {
  fabric?: MmFabric;
  onSaved?: () => void;
  draft?: OpeningStockDraft;
  uom?: 'kg' | 'm';
  onDraftChange?: (next: OpeningStockDraft) => void;
}) {
  const { showNotification } = useNotificationStore();
  const [qty, setQty] = useState('');
  const [count, setCount] = useState('');
  const [unitForm, setUnitForm] = useState<'roll' | 'lap' | 'pieces'>('roll');
  const [saving, setSaving] = useState(false);
  const pending = Boolean(onDraftChange && draft);
  const qtyValue = pending && draft ? draft.qty : qty;
  const countValue = pending && draft ? draft.count : count;
  const unitValue = pending && draft ? draft.unitForm : unitForm;
  const uom = uomProp ?? (fabric?.uom === 'kg' ? 'kg' : 'm');
  const unitLabel = UNIT_OPTIONS.find((option) => option.value === unitValue)?.label ?? 'Rolls';

  function patchDraft(next: Partial<OpeningStockDraft>) {
    if (!draft || !onDraftChange) return;
    onDraftChange({ ...draft, ...next });
  }

  async function save() {
    const qtyN = Number(qty);
    const countN = Number(count);
    if (!Number.isFinite(qtyN) || qtyN <= 0) {
      showNotification('Enter a quantity', 'error');
      return;
    }
    if (!Number.isInteger(countN) || countN < 1 || countN > 200) {
      showNotification('Enter between 1 and 200', 'error');
      return;
    }
    if (!fabric || !onSaved) return;
    setSaving(true);
    const res = await saveFabricOpeningStock(fabric.id, qtyN, countN, unitForm);
    setSaving(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification(
      `Opening stock ${res.data.qty} ${res.data.uom} · ${res.data.roll_count} ${unitLabel.toLowerCase()} on ${fabric.code}`,
      'success',
    );
    setQty('');
    setCount('');
    onSaved();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Opening stock</span>
      </div>
      <div className="p-4 space-y-3">
        <Input
          label={`Quantity (${uom})`}
          value={qtyValue}
          inputMode="decimal"
          onChange={(e) => (pending ? patchDraft({ qty: e.target.value }) : setQty(e.target.value))}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3 items-end">
          <Input
            label={`Number of ${unitLabel.toLowerCase()}`}
            value={countValue}
            inputMode="numeric"
            onChange={(e) => (pending ? patchDraft({ count: e.target.value }) : setCount(e.target.value))}
          />
          <SelectDropdown
            label="Unit"
            options={UNIT_OPTIONS}
            value={unitValue}
            size="compact"
            onChange={(value) => {
              const next = value === 'lap' || value === 'pieces' ? value : 'roll';
              if (pending) patchDraft({ unitForm: next });
              else setUnitForm(next);
            }}
          />
        </div>
        {!pending && (
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Add stock'}
            </Button>
          </div>
        )}
      </div>
      <p className="px-4 py-2.5 border-t border-slate-100 text-[10px] text-slate-400">
        {pending
          ? 'Warehouse only. Optional, and added when you create the fabric.'
          : 'Adds free warehouse stock. It does not replace what is already in, and it is not mill stock.'}
      </p>
    </div>
  );
}

export function FabricOpeningStockModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showNotification } = useNotificationStore();
  const [picked, setPicked] = useState<MmFabric | null>(null);
  const [qty, setQty] = useState('');
  const [count, setCount] = useState('');
  const [unitForm, setUnitForm] = useState<'roll' | 'lap' | 'pieces'>('roll');
  const [saving, setSaving] = useState(false);
  const uom = picked?.uom === 'kg' ? 'kg' : picked ? 'm' : '';
  const unitLabel = UNIT_OPTIONS.find((option) => option.value === unitForm)?.label ?? 'Rolls';

  async function save() {
    if (!picked) {
      showNotification('Pick a fabric', 'error');
      return;
    }
    const qtyN = Number(qty);
    const countN = Number(count);
    if (!Number.isFinite(qtyN) || qtyN <= 0) {
      showNotification('Enter a quantity', 'error');
      return;
    }
    if (!Number.isInteger(countN) || countN < 1 || countN > 200) {
      showNotification('Enter between 1 and 200', 'error');
      return;
    }
    setSaving(true);
    const res = await saveFabricOpeningStock(picked.id, qtyN, countN, unitForm);
    setSaving(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification(
      `${res.data.roll_count} ${res.data.unit_form} added to ${picked.code} · ${res.data.challan_no}`,
      'success',
    );
    onSaved();
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} className="max-w-md">
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 rounded-t-2xl">
        <h3 className="text-sm font-bold text-slate-800">Opening stock</h3>
        <p className="text-[10px] text-slate-500 mt-0.5">
          {picked ? `${picked.code} · ${picked.name}. ` : ''}Adds free warehouse stock. It does not replace what is already in.
        </p>
      </div>
      <div className="p-5 space-y-3">
        <FabricPicker
          label="Fabric *"
          value={picked?.id ?? null}
          onChange={setPicked}
          onClear={() => setPicked(null)}
        />
        <Input
          label={uom ? `Quantity (${uom})` : 'Quantity'}
          value={qty}
          inputMode="decimal"
          onChange={(e) => setQty(e.target.value)}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-3 items-end">
          <Input
            label={`Number of ${unitLabel.toLowerCase()}`}
            value={count}
            inputMode="numeric"
            onChange={(e) => setCount(e.target.value)}
          />
          <SelectDropdown
            label="Unit"
            options={UNIT_OPTIONS}
            value={unitForm}
            size="compact"
            onChange={(value) => setUnitForm(value === 'lap' || value === 'pieces' ? value : 'roll')}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" disabled={saving || !picked} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Add stock'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function FabricWarehouseStockCard({ fabric }: { fabric: MmFabric }) {
  const onHand = fabric.stock?.in_stock ?? 0;
  const available = fabric.stock?.available ?? 0;
  const allocated = Math.max(0, onHand - available);
  const demand = fabric.position?.demand ?? 0;
  const short = fabric.position?.short ?? 0;
  const uom = fabric.uom === 'kg' ? 'kg' : 'm';
  const cells = [
    ['On hand', fmtNum(onHand)],
    ['Available', fmtNum(available)],
    ['Allocated', fmtNum(allocated)],
    ['Demand', fmtNum(demand)],
    ['Short', fmtNum(short)],
  ];
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Warehouse stock</span>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Fabric warehouse only, in {uom}. Mill and processing quantities are not included.
        </p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 p-4">
        {cells.map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className={`mt-0.5 text-[13px] font-semibold tabular-nums ${label === 'Short' && short > 0 ? 'text-red-600' : 'text-slate-800'}`}>
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
