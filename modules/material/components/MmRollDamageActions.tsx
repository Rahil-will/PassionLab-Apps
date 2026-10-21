import React, { useState } from 'react';
import { Button, Input, Modal, SelectDropdown } from '../../../components/ui';
import { mmDispositionRejected, mmReportDamage } from '../lib/mmRpc';

type RollLike = {
  roll_id: string;
  roll_code?: string | null;
  uom?: string | null;
  stock_unit_id?: string | null;
  qty_available?: number | null;
  custody?: { side?: string | null; status?: string | null; stock_unit_id?: unknown } | null;
  stock?: { bucket?: string | null; stock_unit_id?: string | null; uom?: string | null } | null;
};

export function rollUnitId(roll: RollLike): string | null {
  if (roll.stock_unit_id) return roll.stock_unit_id;
  if (roll.stock?.stock_unit_id) return roll.stock.stock_unit_id;
  const fromCustody = roll.custody?.stock_unit_id;
  return typeof fromCustody === 'string' && fromCustody ? fromCustody : null;
}

export function rollCanReportDamage(roll: RollLike): boolean {
  return roll.custody?.side === 'warehouse'
    && (roll.custody.status === 'in_stock' || roll.custody.status === 'pending_qc');
}

export function rollIsRejected(roll: RollLike): boolean {
  return roll.custody?.status === 'rejected' || roll.stock?.bucket === 'rejected';
}

export function MmReportDamageModal({
  open,
  rolls,
  onClose,
  onDone,
}: {
  open: boolean;
  rolls: RollLike[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [part, setPart] = useState(false);
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const one = rolls.length === 1 ? rolls[0] : null;

  const close = () => {
    setReason('');
    setPart(false);
    setQty('');
    setError(null);
    onClose();
  };

  const save = async () => {
    if (!reason.trim()) {
      setError('Say what is damaged');
      return;
    }
    if (part && !one) {
      setError('A damaged qty is for one roll at a time');
      return;
    }
    const damaged = part ? Number(qty) : undefined;
    if (part && (!Number.isFinite(damaged) || (damaged ?? 0) <= 0)) {
      setError('Damaged qty must be greater than zero');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await mmReportDamage({
      roll_ids: rolls.map((roll) => roll.roll_id),
      reason: reason.trim(),
      ...(part && damaged != null ? { qty: damaged } : {}),
    });
    setBusy(false);
    if (res.ok === false) {
      setError(res.message);
      return;
    }
    const row = res.data.rolls?.[0];
    const code = row?.roll_code || one?.roll_code || 'Roll';
    const uom = one?.uom === 'kg' ? 'kg' : 'm';
    const message = row?.rejected
      ? `${code} rejected`
      : `${row?.written_off ?? damaged ?? ''} ${uom} written off on ${code}`.replace(/\s+/g, ' ').trim();
    close();
    onDone(message);
  };

  return (
    <Modal isOpen={open} onClose={close} className="max-w-md">
      <div className="p-5 flex flex-col gap-3">
        <h4 className="text-[14px] font-semibold text-slate-900">Report damage</h4>
        <p className="text-[11px] text-slate-500">
          {rolls.length === 1 ? (rolls[0]?.roll_code || '1 roll') : `${rolls.length} rolls`}
        </p>
        <Input label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={part ? 'secondary' : 'primary'} onClick={() => setPart(false)}>
            Whole roll
          </Button>
          <Button type="button" size="sm" variant={part ? 'primary' : 'secondary'} disabled={rolls.length !== 1} onClick={() => setPart(true)}>
            Part of the roll
          </Button>
        </div>
        {part ? (
          <Input label="Qty damaged *" value={qty} onChange={(e) => setQty(e.target.value)} />
        ) : null}
        {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Report damage'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function MmRejectedDispositionModal({
  open,
  unitIds,
  onClose,
  onDone,
}: {
  open: boolean;
  unitIds: string[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [action, setAction] = useState<'return_to_supplier' | 'write_off' | 'accept_deviation'>('return_to_supplier');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason('');
    setReference('');
    setError(null);
    onClose();
  };

  const save = async () => {
    if (!reason.trim()) {
      setError('Enter a reason');
      return;
    }
    setBusy(true);
    const res = await mmDispositionRejected(unitIds, action, reason.trim(), reference.trim());
    setBusy(false);
    if (res.ok === false) {
      setError(res.message);
      return;
    }
    const message = action === 'return_to_supplier' && res.data.return_no
      ? `Supplier return ${res.data.return_no}`
      : 'Disposition saved';
    close();
    onDone(message);
  };

  return (
    <Modal isOpen={open} onClose={close} className="max-w-md">
      <div className="p-5 flex flex-col gap-3">
        <h4 className="text-[14px] font-semibold text-slate-900">Red label disposition</h4>
        <SelectDropdown size="compact"
          value={action}
          onChange={(value) => setAction(value as typeof action)}
          options={[
            { value: 'return_to_supplier', label: 'Return to supplier' },
            { value: 'write_off', label: 'Write off' },
            { value: 'accept_deviation', label: 'Accept as is' },
          ]}
        />
        <Input label="Reason *" value={reason} onChange={(e) => setReason(e.target.value)} />
        {action === 'return_to_supplier' ? (
          <Input label="Debit note ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        ) : null}
        {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="button" size="sm" disabled={busy || unitIds.length === 0} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
