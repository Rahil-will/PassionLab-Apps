import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button, Card, Input, Modal } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { MmRollPassportModalV4 } from '../../components/MmRollPassportModalV4';
import { allocationNotePrintDoc } from '../../lib/mmChallanPrint';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import { dateLabel } from '../../lib/mmRollDraft';
import { allocKindLabel, allocLineStatusChip, noteStatusChip } from '../../lib/inspAlloc';
import { mmCreateStoreChallan } from '../../lib/mmRpc';
import {
  mmCancelAllocationNote,
  mmGetAllocationNote,
  type MmAllocNoteLine,
  type MmAllocNoteRow,
} from '../../lib/mmV4Rpc';
import { whTd, whTh } from './whTable';

const CHIP: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  default: 'bg-slate-100 text-slate-600 border-slate-200',
};

function Chip({ label, tone }: { label: string; tone: string }) {
  return <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${CHIP[tone] ?? CHIP.default}`}>{label}</span>;
}

export default function MmWarehouseAllocationDetailPage() {
  const id = useNavigationStore((s) => s.routeParams.id ?? '');
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const { factory } = useFactoryProfileCatalog(factoryId);
  const [passportId, setPassportId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  usePageHeader({ title: 'Allocation note', subtitle: 'Rolls on this allocate / book note.' });

  const noteQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'allocNote', id] as const,
    queryFn: async () => {
      const res = await mmGetAllocationNote(id);
      if (res.ok === false) throw new Error(res.message);
      const data = res.data as typeof res.data & { note?: MmAllocNoteRow };
      const note: MmAllocNoteRow = data.note ?? data;
      const lines: MmAllocNoteLine[] = data.lines ?? [];
      return { note, lines };
    },
    enabled: Boolean(factoryId && id),
  });

  const note = noteQ.data?.note ?? null;
  const lines = noteQ.data?.lines ?? [];
  const statusChip = noteStatusChip(note?.status);
  const activeAllocate = lines.filter((line) => line.status === 'active' && String(line.kind).toLowerCase() !== 'book');
  const styleMaterialId = String(
    note?.style?.style_material_id
    ?? lines.find((line) => line.roll?.style?.style_material_id)?.roll?.style?.style_material_id
    ?? '',
  );

  const printDoc = useMemo(() => {
    if (!note) return null;
    return allocationNotePrintDoc({
      factory,
      challanNo: note.note_no,
      sentAt: note.created_at,
      remarks: note.remarks,
      styleName: note.style?.style_name,
      styleRef: note.style?.style_ref,
      poNumber: note.style?.order_no,
      colorName: note.style?.colorway_name,
      fabricName: [note.style?.fabric_code, note.style?.fabric_name].filter(Boolean).join(' – '),
      rolls: lines.map((line) => ({
        id: line.roll.roll_id,
        unit_code: line.roll.roll_code,
        length_m: line.roll.length_m ?? null,
        weight_kg: line.roll.weight_kg ?? null,
        shade: line.roll.shade ?? null,
        lot_no: line.roll.lot_no ?? null,
        batch_no: line.roll.batch_no ?? null,
        attributes: line.roll.attributes ?? null,
      })),
    });
  }, [factory, lines, note]);
  const { requestPrint } = useMmChallanPrint(printDoc);

  const cancelNote = async () => {
    if (!cancelReason.trim()) { showNotification('Enter a reason', 'error'); return; }
    setBusy(true);
    try {
      const res = await mmCancelAllocationNote(id, cancelReason.trim());
      if (res.ok === false) throw new Error(res.message);
      showNotification('Allocation note cancelled — rolls are free', 'success');
      setCancelOpen(false); setCancelReason('');
      await noteQ.refetch();
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Cancel failed', 'error');
    } finally { setBusy(false); }
  };

  const dispatch = async () => {
    if (!styleMaterialId) { showNotification('This note has no style line to dispatch against', 'error'); return; }
    const unitIds = activeAllocate.map((line) => line.roll.stock_unit_id || line.roll.roll_id);
    if (unitIds.length === 0) { showNotification('No active allocated rolls to dispatch', 'error'); return; }
    setBusy(true);
    try {
      const res = await mmCreateStoreChallan(styleMaterialId, unitIds, {});
      if (res.ok === false) throw new Error(res.message);
      showNotification(`${res.data.challan_no} · ${unitIds.length} rolls dispatched to cutting`, 'success');
      setDispatchOpen(false);
      await noteQ.refetch();
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL, { id: res.data.id });
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Dispatch failed', 'error');
    } finally { setBusy(false); }
  };

  return (
    <PageShell loading={noteQ.isLoading} error={noteQ.error} onRetry={() => { void noteQ.refetch(); }} skeleton="card">
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl mb-3">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Allocation note</p>
            <h2 className="text-[14px] font-semibold text-slate-900">{note?.note_no || '—'}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {dateLabel(note?.created_at)}{note?.created_by_name ? ` · ${note.created_by_name}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip label={statusChip.label} tone={statusChip.tone} />
            <Button type="button" size="sm" variant="secondary" icon={Printer} onClick={requestPrint}>Print</Button>
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={activeAllocate.length === 0} onClick={() => setDispatchOpen(true)}>Dispatch to cutting</Button>
              <Button type="button" size="sm" variant="danger-light" disabled={!note || note.status === 'closed'} onClick={() => setCancelOpen(true)}>Cancel note</Button>
            </DesktopWriteGate>
          </div>
        </div>
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
          <Fact label="Style" value={note?.style?.style_name || '—'} />
          <Fact label="Colourway" value={note?.style?.colorway_name || '—'} />
          <Fact label="Order" value={note?.style?.order_no || '—'} />
          <Fact label="Fabric" value={[note?.style?.fabric_code, note?.style?.fabric_name].filter(Boolean).join(' – ') || '—'} />
          <Fact
            label="Counts"
            value={note?.counts ? `${note.counts.allocated ?? 0} allocated · ${note.counts.booked ?? 0} booked · ${note.counts.dispatched ?? 0} dispatched` : '—'}
          />
        </div>
        {note?.remarks ? <p className="px-4 pb-3 text-[11px] text-slate-500">{note.remarks}</p> : null}
      </Card>

      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <p className="text-[11px] font-semibold text-slate-700">Lines</p>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className={whTh}>Roll</th>
                <th className={whTh}>Kind</th>
                <th className={whTh}>Qty</th>
                <th className={whTh}>Status</th>
                <th className={whTh}>Store challan no</th>
                <th className={whTh}>Closed reason</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[11px] text-slate-400">No lines on this note.</td></tr>
              ) : lines.map((line) => {
                const chip = allocLineStatusChip(line.status);
                return (
                  <tr key={line.id}>
                    <td className={whTd}>
                      <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => setPassportId(line.roll.roll_id)}>
                        {line.roll.roll_code}
                      </button>
                    </td>
                    <td className={whTd}><Chip label={allocKindLabel(line.kind)} tone={String(line.kind).toLowerCase() === 'book' ? 'warning' : 'success'} /></td>
                    <td className={whTd}>{line.qty ?? '—'}{line.uom ? ` ${line.uom}` : ''}</td>
                    <td className={whTd}><Chip label={chip.label} tone={chip.tone} /></td>
                    <td className={whTd}>
                      {line.store_challan_no ? (
                        line.store_challan_id ? (
                          <button type="button" className="text-blue-700 hover:underline" onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL, { id: String(line.store_challan_id) })}>
                            {line.store_challan_no}
                          </button>
                        ) : line.store_challan_no
                      ) : '—'}
                    </td>
                    <td className={whTd}>{line.close_reason || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={cancelOpen} onClose={() => setCancelOpen(false)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Cancel note {note?.note_no}</h4>
          <p className="text-[11px] text-slate-500">Every active line is released through unallocate / unbook. Rolls become free.</p>
          <Input label="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Required" />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setCancelOpen(false)}>Keep note</Button>
            <DesktopWriteGate>
              <Button type="button" size="sm" variant="danger-light" disabled={busy || !cancelReason.trim()} onClick={() => void cancelNote()}>{busy ? 'Cancelling…' : 'Cancel note'}</Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>

      <Modal isOpen={dispatchOpen} onClose={() => setDispatchOpen(false)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Dispatch to cutting</h4>
          <p className="text-[11px] text-slate-500">
            Creates a store challan prefilled with this note&apos;s {activeAllocate.length} active allocated {activeAllocate.length === 1 ? 'roll' : 'rolls'} for this style line.
          </p>
          <ul className="text-[11px] text-slate-700 space-y-0.5 max-h-40 overflow-auto">
            {activeAllocate.map((line) => <li key={line.id} className="font-mono">{line.roll.roll_code}</li>)}
          </ul>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setDispatchOpen(false)}>Cancel</Button>
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={busy || activeAllocate.length === 0} onClick={() => void dispatch()}>{busy ? 'Creating…' : 'Create challan'}</Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>

      <MmRollPassportModalV4 open={Boolean(passportId)} rollId={passportId} onClose={() => setPassportId(null)} />
      <MmChallanPrintDocument doc={printDoc} />
    </PageShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-[11px] font-semibold text-slate-900 truncate">{value}</p>
    </div>
  );
}
