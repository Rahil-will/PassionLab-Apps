import React, { useState } from 'react';
import { Button } from '../../../components/ui';
import { useNotificationStore } from '../../../stores';
import { FabricPicker } from './FabricPicker';
import { setBatchFabric, type MmFabric } from '../lib/mmFabricRpc';
import { useMmConfigRights, useMmQuickCreateRights } from '../lib/useMmConfigRights';
import { fabricMismatchMessage } from '../lib/fabricStock';

export function SetBatchFabricButton({
  batchId,
  fabricId,
  fabricTypeId,
  onDone,
  compact = false,
}: {
  batchId: string;
  fabricId?: string | null;
  fabricTypeId?: string | null;
  onDone: (fabric: MmFabric) => void;
  compact?: boolean;
}) {
  const canSet = useMmQuickCreateRights();
  const isConfig = useMmConfigRights();
  const { showNotification } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = Boolean(fabricId);
  if (!canSet || (has && !isConfig)) return null;

  const apply = async (fabric: MmFabric) => {
    setBusy(true);
    setError(null);
    const res = await setBatchFabric(batchId, fabric.id);
    setBusy(false);
    if (res.ok === false) {
      setError(fabricMismatchMessage(res) ?? res.message);
      return;
    }
    showNotification(`Batch linked to ${fabric.code}`, 'success');
    setOpen(false);
    onDone(fabric);
  };

  return (
    <div className="inline-flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
      {compact ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] font-semibold text-blue-700 hover:text-blue-800 disabled:opacity-40"
        >
          {has ? 'Change' : 'Set fabric'}
        </button>
      ) : (
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setOpen((v) => !v)}>
          {has ? 'Change' : 'Set fabric'}
        </Button>
      )}
      {error ? <p className="text-[10px] text-red-600 max-w-[16rem]">{error}</p> : null}
      {open ? (
        <div className="w-64">
          <FabricPicker
            value={fabricId ?? null}
            label={has ? 'Change fabric' : 'Set fabric'}
            disabled={busy}
            filter={fabricTypeId ? { fabric_type_id: fabricTypeId } : undefined}
            onChange={(fabric) => { void apply(fabric); }}
          />
        </div>
      ) : null}
    </div>
  );
}
