import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button, Modal, SelectDropdown } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { formatQtyM } from '../lib/mmRollDraft';

export const MILL_SHORT_CLOSE_REASONS = [
  { value: 'Remaining qty not required', label: 'Remaining qty not required' },
  { value: 'Mill cannot produce remaining', label: 'Mill cannot produce remaining' },
  { value: 'Quality or shade rejected', label: 'Quality or shade rejected' },
  { value: 'Buyer cancelled remaining', label: 'Buyer cancelled remaining' },
  { value: 'Other', label: 'Other' },
] as const;

interface MmMillShortCloseModalProps {
  mode: 'close' | 'reopen';
  isOpen: boolean;
  busy: boolean;
  atMillQty: number;
  atMillRolls: number;
  uom: string;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
}

export function MmMillShortCloseModal({
  mode,
  isOpen,
  busy,
  atMillQty,
  atMillRolls,
  uom,
  onClose,
  onConfirm,
}: MmMillShortCloseModalProps) {
  const leftover = atMillRolls > 0 || atMillQty > 0;
  const closing = mode === 'close';
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setReason('');
      setNotes('');
    }
  }, [isOpen]);

  const other = reason === 'Other';
  const composed = other
    ? notes.trim()
    : [reason, notes.trim()].filter(Boolean).join('. ');
  const canConfirm = !closing || composed.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => undefined : onClose}>
      <div className="relative">
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full"
        >
          <X size={20} />
        </button>
        <div className="flex flex-col items-center p-8 pb-4 text-center">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ${
              closing
                ? 'bg-amber-100 text-amber-600 ring-amber-50'
                : 'bg-slate-100 text-slate-600 ring-slate-50'
            }`}
          >
            <AlertTriangle size={32} />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-2">
            {closing ? 'Short close this fabric?' : 'Cancel short close?'}
          </h3>
          <p className="text-slate-500 text-xs max-w-[300px] leading-relaxed">
            {closing
              ? 'Required qty will be marked Closed. No more mill dispatch until this is cancelled.'
              : 'Required status will go back to Pending or Met from dispatched qty. Dispatch can continue.'}
          </p>
        </div>
        {closing && leftover && (
          <div className="mx-6 mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left">
            <p className="text-[11px] font-semibold text-amber-900">Produced and not dispatched</p>
            <p className="text-[12px] font-bold text-slate-900 mt-1 tabular-nums">
              {formatQtyM(atMillQty, uom)} · {atMillRolls} {atMillRolls === 1 ? 'roll' : 'rolls'}
            </p>
            <p className="text-[11px] text-amber-800 mt-1 leading-snug">
              These rolls stay at mill. They cannot be dispatched while this fabric is short closed.
            </p>
          </div>
        )}
        {closing ? (
          <div className="mx-6 mb-2 text-left space-y-3">
            <div>
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">Reason *</span>
              <SelectDropdown
                value={reason}
                onChange={setReason}
                options={[
                  { value: '', label: 'Select a reason' },
                  ...MILL_SHORT_CLOSE_REASONS.map((item) => ({ value: item.value, label: item.label })),
                ]}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1" htmlFor="mm-short-close-notes">
                {other ? 'Details *' : 'Notes'}
              </label>
              <textarea
                id="mm-short-close-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 280))}
                rows={3}
                maxLength={280}
                placeholder={other ? 'Why this fabric is short closed' : 'Optional'}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 resize-y"
              />
            </div>
          </div>
        ) : null}
        <div className="p-6 pt-2 flex flex-col gap-3">
          <DesktopWriteGate>
            <Button
              type="button"
              variant={closing ? 'danger' : 'primary'}
              disabled={busy || !canConfirm}
              onClick={() => onConfirm(closing ? composed : undefined)}
              className="w-full text-xs"
            >
              {busy ? 'Saving…' : closing ? 'Short close' : 'Cancel short close'}
            </Button>
          </DesktopWriteGate>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose} className="w-full text-xs">
            {closing ? 'Keep open' : 'Keep closed'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
