import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Modal, SelectDropdown } from '../../../components/ui';
import { MmChallanPrintDocument } from './MmChallanPrintDocument';
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
import { useMmProcesses } from '../lib/useMmV4Config';
import { MmChallanFieldInputs } from './MmChallanFieldInputs';
import {
  challanFieldError,
  fieldValuesPayload,
  sendableProcesses,
  whereChoices,
  whereSendPayload,
} from '../lib/processChallan';
import { unitFormOptionLabel } from '../lib/mmUnitForm';
import { formatQtyM, declaredQty } from '../lib/mmRollDraft';
import { useMmChallanPrint } from '../lib/useMmChallanPrint';
import type { MmChallanPrintDoc } from '../lib/mmChallanPrint';

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

  const [processTypeId, setProcessTypeId] = useState('');
  const [whereId, setWhereId] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [unitRefNo, setUnitRefNo] = useState('');
  const [sentAt, setSentAt] = useState(todayIso());
  const [remarks, setRemarks] = useState('');
  const [reprocess, setReprocess] = useState(Boolean(parentChallanId) || purposeProp === 'reprocess');
  const [reprocessReason, setReprocessReason] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [printDoc, setPrintDoc] = useState<MmChallanPrintDoc | null>(null);
  const [pendingSent, setPendingSent] = useState<{ id: string; challanNo: string } | null>(null);
  const { requestPrint } = useMmChallanPrint(printDoc);

  useEffect(() => {
    if (!open) return;
    setProcessTypeId('');
    setWhereId('');
    setFieldValues({});
    setUnitRefNo('');
    setSentAt(todayIso());
    setRemarks('');
    setReprocess(Boolean(parentChallanId) || purposeProp === 'reprocess');
    setReprocessReason('');
    setPicked(preselectedRollIds ?? []);
    setSearch('');
    setBusy(false);
    setPrintDoc(null);
    setPendingSent(null);
  }, [open, preselectedRollIds, parentChallanId, purposeProp]);

  const processesQ = useMmProcesses(open);
  const processTypes = useMemo(
    () => sendableProcesses(processesQ.data ?? []),
    [processesQ.data],
  );
  const process = processTypes.find((row) => row.id === processTypeId);
  const choices = useMemo(() => whereChoices(process), [process]);
  const choiceKey = choices.map((choice) => choice.id).join('|');

  useEffect(() => {
    if (!open) return;
    const ids = choiceKey.split('|').filter(Boolean);
    if (ids.length === 1) setWhereId(ids[0]);
  }, [open, choiceKey]);

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
    enabled: open && Boolean(factoryId),
  });

  const rollRows = rollsQ.data ?? [];
  const lockedIds = preselectedRollIds && preselectedRollIds.length > 0;
  const activeIds = lockedIds ? preselectedRollIds : picked;

  useEffect(() => {
    if (!open) return;
    const chosen = rollRows.filter((roll) => activeIds.includes(roll.roll_id));
    const colours = [...new Set(chosen.map((roll) => String(roll.style?.colorway_name || '').trim()).filter(Boolean))];
    if (colours.length === 1) {
      const hasColour = (process?.challan_fields ?? []).some((field) => field.key === 'target_color');
      if (hasColour) {
        setFieldValues((current) => (
          current.target_color ? current : { ...current, target_color: colours[0] }
        ));
      }
    }
  }, [open, rollRows, activeIds, process]);

  const submit = async () => {
    if (!processTypeId) {
      showNotification('Select a process', 'error');
      return;
    }
    if (!whereId) {
      showNotification('Select where this process is done', 'error');
      return;
    }
    const fieldError = challanFieldError(process?.challan_fields ?? [], fieldValues);
    if (fieldError) {
      showNotification(fieldError, 'error');
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
        side: 'warehouse',
        process_type_id: processTypeId,
        roll_ids: activeIds,
        ...whereSendPayload(whereId),
        field_values: fieldValuesPayload(process?.challan_fields ?? [], fieldValues),
        unit_ref_no: unitRefNo.trim() || null,
        sent_at: sentAt || null,
        purpose: reprocess ? 'reprocess' : 'fresh',
        parent_challan_id: reprocess ? parentChallanId ?? null : null,
        reprocess_reason: reprocess ? reprocessReason.trim() : null,
        remarks: remarks.trim() || null,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Challan ${res.data.challan_no} sent`, 'success');
      const vendor = choices.find((choice) => choice.id === whereId);
      if (vendor && !vendor.inhouse) {
        const sentRolls = rollRows.filter((roll) => activeIds.includes(roll.roll_id));
        setPrintDoc({
          kind: 'inhouse',
          title: 'Process challan',
          movement: 'Warehouse to processing',
          factoryName: '',
          factoryCode: '',
          challanNo: res.data.challan_no,
          referenceNo: unitRefNo.trim(),
          sentAt: sentAt || null,
          fromLocation: 'Warehouse',
          toLocation: vendor.label,
          styleName: '',
          styleRef: '',
          buyerName: '',
          poNumber: '',
          colorName: '',
          fabricName: sentRolls[0]?.fabric_type_name || '',
          fabricCategory: '',
          uom: sentRolls[0]?.uom ?? null,
          remarks: remarks.trim(),
          fields: [],
          rolls: sentRolls.map((roll) => ({
            id: roll.roll_id,
            unit_code: roll.roll_code,
            length_m: roll.length_m ?? null,
            weight_kg: roll.weight_kg ?? null,
            shade: roll.shade ?? null,
            lot_no: roll.lot_no ?? null,
            batch_no: roll.batch_no ?? null,
            attributes: roll.attributes ?? null,
          })),
        });
        setPendingSent({ id: res.data.id, challanNo: res.data.challan_no });
      } else {
        onSent(res.data.id, res.data.challan_no);
      }
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
          From warehouse · {activeIds.length} rolls
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectDropdown size="compact"
            label="Process"
            value={processTypeId}
            onChange={(v) => {
              setProcessTypeId(v);
              setWhereId('');
              setFieldValues({});
            }}
            options={processTypes.map((t) => ({ value: t.id, label: t.name }))}
          />
          <SelectDropdown size="compact"
            label="Where"
            value={whereId}
            onChange={setWhereId}
            options={[
              { value: '', label: processTypeId ? 'Select where' : 'Pick a process first' },
              ...choices.map((choice) => ({ value: choice.id, label: choice.label })),
            ]}
          />
          <MmChallanFieldInputs
            fields={process?.challan_fields ?? []}
            values={fieldValues}
            onChange={(key, value) => setFieldValues((current) => ({ ...current, [key]: value }))}
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
                  <thead>
                    <tr className="text-left text-[9px] font-semibold uppercase text-slate-500">
                      <th className="px-2 py-1.5" />
                      <th className="px-2 py-1.5">Roll</th>
                      <th className="px-2 py-1.5">Form</th>
                      <th className="px-2 py-1.5">Fabric</th>
                      <th className="px-2 py-1.5 text-right">Qty</th>
                    </tr>
                  </thead>
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
                          <td className="px-2 py-1.5">{unitFormOptionLabel(roll.unit_form || 'roll')}</td>
                          <td className="px-2 py-1.5 text-slate-500">{roll.fabric_type_name || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatQtyM(declaredQty(roll, roll.uom), roll.uom)}
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

        {printDoc ? (
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={requestPrint}>
              Print challan
            </Button>
          </div>
        ) : null}
        <MmChallanPrintDocument doc={printDoc} />

        <div className="flex justify-end gap-2 pt-1">
          {pendingSent ? (
            <Button type="button" size="sm" onClick={() => onSent(pendingSent.id, pendingSent.challanNo)}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <DesktopWriteGate>
                <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
                  {busy ? 'Sending…' : 'Send'}
                </Button>
              </DesktopWriteGate>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
