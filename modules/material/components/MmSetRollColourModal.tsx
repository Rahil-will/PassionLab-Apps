import React, { useEffect, useState } from 'react';
import { Button, Modal } from '../../../components/ui';
import { useNotificationStore } from '../../../stores';
import { mmSetRollColour } from '../lib/mmV4Rpc';

export function MmSetRollColourModal({
  open,
  rollIds,
  onClose,
  onSaved,
}: {
  open: boolean;
  rollIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showNotification } = useNotificationStore();
  const [color, setColor] = useState('');
  const [dyeLot, setDyeLot] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setColor('');
    setDyeLot('');
  }, [open]);

  const save = async () => {
    const name = color.trim();
    if (!name) {
      showNotification('Enter a colour', 'error');
      return;
    }
    if (rollIds.length === 0) {
      showNotification('Select rolls', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmSetRollColour({
        roll_ids: rollIds,
        color: name,
        dye_lot: dyeLot.trim() || null,
      });
      if (res.ok === false) throw new Error(res.message);
      const count = res.data.updated ?? rollIds.length;
      showNotification(`Colour set on ${count} rolls`, 'success');
      onSaved();
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Could not set colour', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} className="max-w-md">
      <div className="p-4 flex flex-col gap-3">
        <div>
          <h4 className="text-[14px] font-semibold text-slate-900">Set colour</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {rollIds.length} {rollIds.length === 1 ? 'roll' : 'rolls'}
          </p>
        </div>
        <label className="block">
          <span className="block text-[10px] font-semibold text-slate-600 mb-1">Colour</span>
          <input
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="w-full h-8 rounded-lg border border-slate-200 px-2 text-[12px] text-slate-800"
            aria-label="Colour"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold text-slate-600 mb-1">Dye lot</span>
          <input
            value={dyeLot}
            onChange={(event) => setDyeLot(event.target.value)}
            className="w-full h-8 rounded-lg border border-slate-200 px-2 text-[12px] text-slate-800"
            aria-label="Dye lot"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
