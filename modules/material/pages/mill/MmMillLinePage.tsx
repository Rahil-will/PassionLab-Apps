import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, ExternalLink, Printer } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import { MmFabricSummaryCard } from '../../components/MmFabricSummaryCard';
import { MmMillRollsTable } from '../../components/MmMillRollsTable';
import { MmMillShortCloseModal } from '../../components/MmMillShortCloseModal';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { millChallanPrintDoc } from '../../lib/mmChallanPrint';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import { mmSetMillShortClose } from '../../lib/mmRpc';
import { useInvalidateMmOps, useMmMillLine } from '../../lib/useMmOps';
import {
  millBatchRowStatus,
  millLineDispatchedStatus,
  millLineProducedStatus,
  millWordDot,
  millWordText,
} from './millStatus';
import {
  formatQtyM,
  groupMillDispatchedChallans,
  millChallanStatusLabel,
  millDateLabel,
  millDateTimeParts,
  millDeclaredQty,
} from '../../lib/mmRollDraft';
import { inboundStatusDot, inboundStatusText } from '../../lib/inboundDisplay';
import { millDistinctLabel } from './millUnallocated';

function MillWhenCell({ iso }: { iso: string | null | undefined }) {
  const parts = millDateTimeParts(iso);
  if (parts.date === '—') return <span className="text-slate-400">—</span>;
  return (
    <span className="whitespace-nowrap">
      {parts.date}
      {parts.time ? <span className="text-slate-400">, {parts.time}</span> : null}
    </span>
  );
}

const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thQtyCls = thCenterCls;
const thAtQtyCls = thCenterCls;
const thDispQtyCls = thCenterCls;
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-left max-w-0 overflow-hidden';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-left max-w-0 overflow-hidden';
const tdQtyCls = 'px-2.5 py-2.5 text-center border-b border-slate-100 max-w-0 overflow-hidden';
const tdAtQtyCls = tdQtyCls;
const tdDispQtyCls = tdQtyCls;

export default function MmMillLinePage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { factory } = useFactoryProfileCatalog(factoryId);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const orderId = params.orderId ?? '';
  const colorwayId = params.colorwayId ?? '';
  const fabricLineId = params.fabricLineId ?? '';
  const { data, isLoading, error, refetch } = useMmMillLine(orderId, colorwayId, fabricLineId);
  const [openChallanId, setOpenChallanId] = useState<string | null>(params.challanId ?? null);
  const [closeMode, setCloseMode] = useState<'close' | 'reopen' | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);

  const atMill = (data?.rolls ?? []).filter((row) => row.at_mill).length;
  const dispatched = (data?.rolls ?? []).filter((row) => !row.at_mill).length;
  const qtyAtMill = (data?.rolls ?? [])
    .filter((row) => row.at_mill)
    .reduce((sum, row) => sum + millDeclaredQty(row), 0);
  const qtyDispatched = (data?.rolls ?? [])
    .filter((row) => !row.at_mill)
    .reduce((sum, row) => sum + millDeclaredQty(row), 0);
  const shortClosed = Boolean(data?.mill_short_closed);
  const producedStatus = millLineProducedStatus(qtyAtMill + qtyDispatched, data?.required_m);
  const dispatchedStatus = millLineDispatchedStatus(qtyDispatched, data?.required_m, shortClosed);
  const lineParams = { orderId, colorwayId, fabricLineId };
  const fabricRefName = millDistinctLabel([
    ...(data?.batches ?? []).map((row) => row.fabric_ref_name),
    ...(data?.rolls ?? []).map((row) => row.fabric_ref_name),
  ]);
  const colorRef = millDistinctLabel((data?.rolls ?? []).map((row) => row.color_ref));

  usePageHeader({
    title: 'Style fabric details',
    subtitle: 'Batches and rolls for this allocated fabric. Allocate more rolls, or dispatch to the warehouse.',
  }, 'Style fabric details');

  const uom = data?.uom ?? '';
  const producedRolls = atMill + dispatched;
  const batches = data?.batches ?? [];
  const rolls = data?.rolls ?? [];
  const dispatchedChallans = groupMillDispatchedChallans(rolls);
  const openChallan = dispatchedChallans.find((row) => row.id === openChallanId) ?? null;
  const printDoc = useMemo(() => {
    if (!openChallan || !data) return null;
    return millChallanPrintDoc({
      factory,
      challanNo: openChallan.challan_no,
      referenceNo: openChallan.reference_no,
      sentAt: openChallan.sent_at,
      toLocation: openChallan.to_location,
      styleName: data.style_name,
      styleRef: data.style_ref,
      buyerName: data.buyer_name,
      poNumber: data.po_number,
      colorName: data.color_name,
      fabricName: data.fabric_name,
      fabricCategory: data.fabric_category,
      uom: data.uom,
      fields: data.test_fields,
      rolls: openChallan.rolls,
    });
  }, [openChallan, data, factory]);
  const { requestPrint } = useMmChallanPrint(printDoc);

  useEffect(() => {
    if (params.challanId) setOpenChallanId(params.challanId);
  }, [params.challanId]);

  const batchQtySplit = (batchId: string) => {
    let atMillQty = 0;
    let dispatchedQty = 0;
    for (const roll of rolls) {
      if (roll.mill_batch_id !== batchId) continue;
      const qty = millDeclaredQty(roll);
      if (roll.at_mill) atMillQty += qty;
      else dispatchedQty += qty;
    }
    return { atMillQty, dispatchedQty };
  };

  const openBatch = (id: string) => {
    requestNavigate(RoutePath.MATERIAL_MILL_ASSIGN, {
      ...lineParams,
      batchId: id,
    });
  };

  const confirmShortClose = async (reason?: string) => {
    if (!closeMode) return;
    setCloseBusy(true);
    try {
      const closed = closeMode === 'close';
      const res = await mmSetMillShortClose(orderId, colorwayId, fabricLineId, closed, reason);
      if (res.ok === false) throw new Error(res.message);
      showNotification(closed ? 'Fabric short closed' : 'Short close cancelled', 'success');
      setCloseMode(null);
      await invalidate();
      await refetch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Could not update short close', 'error');
    } finally {
      setCloseBusy(false);
    }
  };

  return (
    <PageShell loading={isLoading} error={error} onRetry={() => void refetch()} skeleton="card">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 mb-4 items-stretch">
        <MmFabricSummaryCard
          data={{
            ...data,
            fabric_ref_name: fabricRefName === '—' ? '' : fabricRefName,
            color_ref: colorRef === '—' ? '' : colorRef,
          }}
        />
        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                <ClipboardList size={16} className="text-primary-600" />
                Mill progress
              </h4>
              <DesktopWriteGate>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={shortClosed}
                    onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_ASSIGN, lineParams)}
                  >
                    Allocate rolls
                  </Button>
                  {shortClosed ? null : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={atMill === 0}
                      onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_DISPATCH, lineParams)}
                    >
                      Dispatch to warehouse
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="danger-light"
                    onClick={() => setCloseMode(shortClosed ? 'reopen' : 'close')}
                  >
                    {shortClosed ? 'Cancel short close' : 'Short close'}
                  </Button>
                </div>
              </DesktopWriteGate>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Required</p>
                <p className="text-[13px] font-bold text-blue-900 mt-0.5 tabular-nums">{formatQtyM(data?.required_m, uom)}</p>
              </div>
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">Mill produced</p>
                <p className="text-[13px] font-bold text-yellow-900 mt-0.5 tabular-nums">{formatQtyM(qtyAtMill + qtyDispatched, uom)}</p>
                <p className="text-[10px] text-yellow-800/80 mt-0.5">{producedRolls} {producedRolls === 1 ? 'roll' : 'rolls'}</p>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700">Mill dispatched</p>
                <p className="text-[13px] font-bold text-green-900 mt-0.5 tabular-nums">{formatQtyM(qtyDispatched, uom)}</p>
                <p className="text-[10px] text-green-800/80 mt-0.5">{dispatched} {dispatched === 1 ? 'roll' : 'rolls'}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-900">Status</p>
                <div className="mt-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-slate-900">Produced</span>
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${millWordText(producedStatus.key)}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(producedStatus.key)}`} />
                      {producedStatus.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-slate-900">Dispatched</span>
                    <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${millWordText(dispatchedStatus.key)}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(dispatchedStatus.key)}`} />
                      {dispatchedStatus.label}
                    </span>
                  </div>
                  {shortClosed && data?.mill_short_closed_reason ? (
                    <p className="text-[10px] text-slate-500 leading-snug">{data.mill_short_closed_reason}</p>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-[11px] font-semibold text-slate-800">Mill batches</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {shortClosed ? 'Short closed. Cancel short close to add more rolls.' : 'Open a batch to add rolls. Test and inspect on the challan.'}
          </p>
        </div>
        <div className="overflow-auto">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '12%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thFirstCls}>Batch</th>
                <th className={thCls}>Ref</th>
                <th className={thCls}>Date</th>
                <th className={thQtyCls}>Qty</th>
                <th className={thQtyCls}>Rolls</th>
                <th className={thAtQtyCls}>At mill qty</th>
                <th className={thAtQtyCls}>At mill</th>
                <th className={thDispQtyCls}>Disp. qty</th>
                <th className={thDispQtyCls}>Disp. rolls</th>
                <th className={thCenterCls}>Status</th>
                <th className={thCls}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => {
                const split = batchQtySplit(batch.id);
                const batchStatus = millBatchRowStatus(batch.at_mill_count, batch.dispatched_count, batch.roll_count);
                return (
                <tr
                  key={batch.id}
                  className={shortClosed ? '' : 'hover:bg-slate-50/80 cursor-pointer'}
                  onClick={shortClosed ? undefined : () => openBatch(batch.id)}
                >
                  <td className={`${tdFirstCls} font-semibold text-slate-800 truncate`}>{batch.batch_no}</td>
                  <td className={`${tdCls} truncate`}>{batch.mill_ref || '—'}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>{millDateLabel(batch.production_date)}</td>
                  <td className={tdQtyCls}>
                    <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">
                      {formatQtyM(batch.qty_m, uom)}
                    </span>
                  </td>
                  <td className={tdQtyCls}>
                    <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">
                      {batch.roll_count}
                    </span>
                  </td>
                  <td className={tdAtQtyCls}>
                    <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">
                      {formatQtyM(split.atMillQty, uom)}
                    </span>
                  </td>
                  <td className={tdAtQtyCls}>
                    <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">
                      {batch.at_mill_count}
                    </span>
                  </td>
                  <td className={tdDispQtyCls}>
                    <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                      {formatQtyM(split.dispatchedQty, uom)}
                    </span>
                  </td>
                  <td className={tdDispQtyCls}>
                    <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                      {batch.dispatched_count}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 text-center border-b border-slate-100">
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(batchStatus.key)}`} />
                      <span className={`text-[10px] font-bold ${millWordText(batchStatus.key)}`}>
                        {batchStatus.label}
                      </span>
                    </span>
                  </td>
                  <td className={`${tdCls} truncate text-slate-500`}>{batch.remarks || '—'}</td>
                </tr>
                );
              })}
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No mill batches yet.
                  </td>
                </tr>
              ) : (
                <tr aria-hidden>
                  <td colSpan={11} className="h-10 border-0 p-0" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm mt-4">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-[11px] font-semibold text-slate-800">Dispatched</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">Open a challan to see the rolls sent. This list is read-only.</p>
        </div>
        <div className="overflow-auto">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thFirstCls}>Dispatched</th>
                <th className={thCls}>Challan</th>
                <th className={thCls}>Ref</th>
                <th className={thCls}>To</th>
                <th className={thDispQtyCls}>Rolls</th>
                <th className={thDispQtyCls}>Qty</th>
                <th className={thCenterCls}>Status</th>
                <th className={thCls}>Received</th>
              </tr>
            </thead>
            <tbody>
              {dispatchedChallans.map((challan) => {
                const open = challan.id === openChallanId;
                return (
                  <tr
                    key={challan.id}
                    className={`hover:bg-slate-50/80 cursor-pointer ${open ? 'bg-blue-50/70' : ''}`}
                    onClick={() => setOpenChallanId(open ? null : challan.id)}
                  >
                    <td className={`${tdFirstCls} whitespace-nowrap`}><MillWhenCell iso={challan.sent_at} /></td>
                    <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{challan.challan_no}</td>
                    <td className={`${tdCls} truncate`}>{challan.reference_no || '—'}</td>
                    <td className={`${tdCls} truncate`}>{challan.to_location || 'Warehouse'}</td>
                    <td className={tdDispQtyCls}>
                      <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                        {challan.roll_count}
                      </span>
                    </td>
                    <td className={tdDispQtyCls}>
                      <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                        {formatQtyM(challan.qty_m, uom)}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-center border-b border-slate-100">
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(challan.status)}`} />
                        <span className={`text-[10px] font-bold ${inboundStatusText(challan.status)}`}>
                          {millChallanStatusLabel(challan.status)}
                        </span>
                      </span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}><MillWhenCell iso={challan.received_at} /></td>
                  </tr>
                );
              })}
              {dispatchedChallans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No mill challans yet.
                  </td>
                </tr>
              ) : (
                <tr aria-hidden>
                  <td colSpan={8} className="h-10 border-0 p-0" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openChallan && (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm mt-4">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-[11px] font-semibold text-slate-800">Rolls sent · {openChallan.challan_no}</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {openChallan.roll_count} {openChallan.roll_count === 1 ? 'roll' : 'rolls'} · {formatQtyM(openChallan.qty_m, uom)} · {millChallanStatusLabel(openChallan.status)}. Read-only.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={ExternalLink}
                onClick={() =>
                  requestNavigate(RoutePath.MATERIAL_MILL_CHALLAN, {
                    ...lineParams,
                    id: openChallan.id,
                  })
                }
              >
                Details
              </Button>
              <Button type="button" size="sm" variant="secondary" icon={Printer} onClick={requestPrint}>
                Print
              </Button>
            </div>
          </div>
          <MmMillRollsTable
            rolls={openChallan.rolls}
            fields={data?.test_fields ?? []}
            uom={uom}
            emptyText="No rolls on this challan."
            statusMode="work"
            showBatch
            showSerialNumber
            evenColumns
          />
        </div>
      )}
      <MmChallanPrintDocument doc={printDoc} />
      <MmMillShortCloseModal
        mode={closeMode === 'reopen' ? 'reopen' : 'close'}
        isOpen={closeMode !== null}
        busy={closeBusy}
        atMillQty={qtyAtMill}
        atMillRolls={atMill}
        uom={uom}
        onClose={() => {
          if (!closeBusy) setCloseMode(null);
        }}
        onConfirm={(reason) => void confirmShortClose(reason)}
      />
    </PageShell>
  );
}
