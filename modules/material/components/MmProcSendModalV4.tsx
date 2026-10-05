import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Modal, SelectDropdown } from '../../../components/ui';
import { LabeledDatePicker } from '../../../components/SingleDatePicker';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import {
  mmListRollsV4,
  mmProcSend,
  type MmV4ProcPurpose,
  type MmV4ProcSide,
  type MmV4RollRow,
} from '../lib/mmV4Rpc';
import { useMmV4Config } from '../lib/useMmV4Config';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function MmProcSendModalV4({
  open,
  side,
  preselectedRollIds,
  parentChallanId,
  purpose: purposeProp,
  onClose,
  onSent,
}: {
  open: boolean;
  side: MmV4ProcSide;
  preselectedRollIds?: string[];
  parentChallanId?: string | null;
  purpose?: MmV4ProcPurpose;
  onClose: () => void;
  onSent: (id: string, challanNo: string) => void;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const { data: v4 } = useMmV4Config(open);

  const [processTypeId, setProcessTypeId] = useState('');
  const [unitFacilityId, setUnitFacilityId] = useState('');
  const [unitRefNo, setUnitRefNo] = useState('');
  const [sentAt, setSentAt] = useState(todayIso());
  const [remarks, setRemarks] = useState('');
  const [reprocess, setReprocess] = useState(Boolean(parentChallanId) || purposeProp === 'reprocess');
  const [reprocessReason, setReprocessReason] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProcessTypeId('');
    setUnitFacilityId('');
    setUnitRefNo('');
    setSentAt(todayIso());
    setRemarks('');
    setReprocess(Boolean(parentChallanId) || purposeProp === 'reprocess');
    setReprocessReason('');
    setPicked(preselectedRollIds ?? []);
    setSearch('');
    setBusy(false);
  }, [open, preselectedRollIds, parentChallanId, purposeProp]);

  const processTypes = useMemo(
    () => (v4?.process_types ?? []).filter((t) => t.active !== false),
    [v4?.process_types],
  );

  const units = useMemo(() => {
    const all = (v4?.facilities ?? []).filter(
      (f) => f.kind === 'process_unit' && f.is_active !== false,
    );
    if (!processTypeId) return all;
    return all.filter((f) => {
      const ids = f.process_type_ids ?? [];
      return ids.length === 0 || ids.includes(processTypeId);
    });
  }, [v4?.facilities, processTypeId]);

  const rollsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'rollsV4Process', side, search] as const,
    queryFn: async (): Promise<MmV4RollRow[]> => {
      const res = await mmListRollsV4({
        side,
        available_for: 'process',
        search: search.trim() || null,
        limit: 200,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: open && Boolean(factoryId) && !(preselectedRollIds && preselectedRollIds.length > 0),
  });

  const rollRows = rollsQ.data ?? [];
  const lockedIds = preselectedRollIds && preselectedRollIds.length > 0;
  const activeIds = lockedIds ? preselectedRollIds : picked;

  const submit = async () => {
    if (!unitFacilityId) {
      showNotification('Select a processing unit', 'error');
      return;
    }
    if (!processTypeId) {
      showNotification('Select a process', 'error');
      return;
    }
    if (activeIds.length === 0) {
      showNotification('Select rolls to send', 'error');
      return;
    }
    if (reprocess && !reprocessReason.trim()) {
      showNotification('Reprocess reason is required', 'error');
      return;
    }
    if (reprocess && !parentChallanId) {
      showNotification('Reprocess needs a parent challan', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmProcSend({
        side,
        unit_facility_id: unitFacilityId,
        process_type_id: processTypeId,
        roll_ids: activeIds,
        unit_ref_no: unitRefNo.trim() || null,
        sent_at: sentAt || null,
        purpose: reprocess ? 'reprocess' : 'fresh',
        parent_challan_id: reprocess ? parentChallanId ?? null : null,
        reprocess_reason: reprocess ? reprocessReason.trim() : null,
        remarks: remarks.trim() || null,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Challan ${res.data.challan_no} sent`, 'success');
      onSent(res.data.id, res.data.challan_no);
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={busy ? () => undefined : onClose} className="max-w-2xl">
      <div className="p-5 flex flex-col gap-3 max-h-[90vh] overflow-y-auto">
        <h4 className="text-[14px] font-semibold text-slate-900">Send to processing</h4>
        <p className="text-[11px] text-slate-500">
          From {side === 'mill' ? 'mill' : 'warehouse'} · {activeIds.length} rolls
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectDropdown
            label="Process"
            value={processTypeId}
            onChange={(v) => {
              setProcessTypeId(v);
              setUnitFacilityId('');
            }}
            options={processTypes.map((t) => ({ value: t.id, label: t.name }))}
          />
          <SelectDropdown
            label="Processing unit"
            value={unitFacilityId}
            onChange={setUnitFacilityId}
            options={units.map((u) => ({
              value: u.id,
              label: `${u.name || u.code}${u.ownership === 'external' ? ' (External)' : ''}`,
            }))}
          />
          <Input label="Unit ref no" value={unitRefNo} onChange={(e) => setUnitRefNo(e.target.value)} />
          <LabeledDatePicker label="Sent date" value={sentAt} onChange={setSentAt} />
        </div>

        <label className="inline-flex items-center gap-2 text-[12px] text-slate-700">
          <input
            type="checkbox"
            checked={reprocess}
            onChange={(e) => setReprocess(e.target.checked)}
            disabled={Boolean(parentChallanId)}
          />
          Reprocess
        </label>
        {reprocess ? (
          <Input
            label="Reprocess reason"
            value={reprocessReason}
            onChange={(e) => setReprocessReason(e.target.value)}
          />
        ) : null}

        <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />

        {!lockedIds ? (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
              <input
                className="h-8 flex-1 border border-slate-200 rounded px-2 text-[11px]"
                placeholder="Search rolls…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span className="text-[10px] text-slate-500">{picked.length} selected</span>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {rollsQ.isLoading ? (
                <p className="px-3 py-6 text-center text-[11px] text-slate-400">Loading rolls…</p>
              ) : rollRows.length === 0 ? (
                <p className="px-3 py-6 text-center text-[11px] text-slate-400">No rolls available</p>
              ) : (
                <table className="w-full text-[11px]">
                  <tbody>
                    {rollRows.map((roll) => {
                      const on = picked.includes(roll.roll_id);
                      return (
                        <tr key={roll.roll_id} className="border-t border-slate-50 hover:bg-slate-50">
                          <td className="px-2 py-1.5 w-8">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                setPicked((cur) =>
                                  on ? cur.filter((id) => id !== roll.roll_id) : [...cur, roll.roll_id],
                                )
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 font-medium">{roll.roll_code}</td>
                          <td className="px-2 py-1.5 text-slate-500">{roll.fabric_type_name || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {roll.length_m != null ? Number(roll.length_m).toFixed(1) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <DesktopWriteGate>
            <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </DesktopWriteGate>
        </div>
      </div>
    </Modal>
  );
}
