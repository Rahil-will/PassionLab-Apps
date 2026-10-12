/**
 * FabricMergeModal — merge a duplicate fabric into a target fabric.
 * Filtered to same type + same UOM, excluding the source fabric itself.
 */
import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Modal } from '../../../components/ui';
import { Button } from '../../../components/ui';
import { FabricPicker } from './FabricPicker';
import { mergeFabric, type MmFabric } from '../lib/mmFabricRpc';
import { useNotificationStore } from '../../../stores';

export interface FabricMergeModalProps {
  open: boolean;
  from: MmFabric;
  onClose: () => void;
  onMerged: () => void;
}

export function FabricMergeModal({ open, from, onClose, onMerged }: FabricMergeModalProps) {
  const { showNotification } = useNotificationStore();
  const [target, setTarget] = useState<MmFabric | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleMerge() {
    if (!target) {
      showNotification('Select a target fabric', 'error');
      return;
    }
    if (!reason.trim()) {
      showNotification('Reason is required', 'error');
      return;
    }
    setSaving(true);
    const res = await mergeFabric(from.id, target.id, reason.trim());
    setSaving(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    const d = res.data;
    showNotification(
      `Merged ${from.code} into ${d.into.code} — moved ${d.moved_order_lines} order line(s)`,
      'success',
    );
    onMerged();
    onClose();
  }

  // Reset state when dialog closes
  function handleClose() {
    setTarget(null);
    setReason('');
    onClose();
  }

  return (
    <Modal isOpen={open} onClose={handleClose} className="max-w-lg">
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 rounded-t-2xl">
        <h3 className="text-sm font-bold text-slate-800">Merge fabric</h3>
        <p className="text-[10px] text-slate-500 mt-0.5">
          All order lines and style materials on <span className="font-semibold">{from.code}</span> will be
          moved to the target. The source becomes inactive.
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* Source */}
        <div>
          <p className="text-[10px] font-semibold text-slate-600 mb-1">Merging from</p>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[11px] font-semibold text-slate-800">
              {from.code} — {from.name}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">{from.composition_text} · {from.gsm} GSM</p>
            {from.used_on_lines > 0 && (
              <div className="flex items-center gap-1 mt-1.5 text-[10px] text-amber-700 font-semibold">
                <AlertTriangle size={12} />
                Used on {from.used_on_lines} order line(s) — these will move to the target
              </div>
            )}
          </div>
        </div>

        {/* Target picker */}
        <div>
          <FabricPicker
            label="Merge into"
            value={target?.id ?? null}
            onChange={(f) => setTarget(f)}
            filter={{
              fabric_type_id: from.fabric_type_id,
              uom: from.uom,
            }}
            excludeIds={[from.id]}
            placeholder="Search target fabric…"
          />
          {target && (
            <p className="text-[10px] text-slate-500 mt-1 pl-1">
              {target.code} · {target.name} · {target.composition_text}
            </p>
          )}
        </div>

        {/* Reason */}
        <div>
          <label className="block text-[10px] font-semibold text-slate-600 mb-1">
            Reason<span className="text-red-500 ml-0.5">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are these fabrics being merged?"
            className="w-full bg-white border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 rounded-lg px-3 py-2 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none resize-y min-h-[5rem]"
          />
        </div>
      </div>

      <div className="px-5 pb-5 flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!target || !reason.trim() || saving}
          onClick={() => { void handleMerge(); }}
        >
          {saving ? (
            <><Loader2 size={13} className="animate-spin mr-1.5" /> Merging…</>
          ) : (
            'Merge'
          )}
        </Button>
      </div>
    </Modal>
  );
}
