import React, { useMemo, useState } from 'react';
import { ClipboardList, ExternalLink, Link2, Printer } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import { MmFabricSummaryCard } from '../../components/MmFabricSummaryCard';
import { MmMillRollsTable } from '../../components/MmMillRollsTable';
import { MmAllocateRollsModal } from '../../components/MmAllocateRollsModal';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { millChallanPrintDoc } from '../../lib/mmChallanPrint';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import {
  formatQtyM,
  groupMillDispatchedChallans,
  millChallanStatusLabel,
  millDateLabel,
  millDateTimeParts,
  millDeclaredQty,
} from '../../lib/mmRollDraft';
import { inboundStatusDot, inboundStatusText } from '../../lib/inboundDisplay';
import { millBatchRowStatus, millWordDot, millWordText } from './millStatus';
import {
  millDistinctLabel,
  millSingleValue,
  unallocatedToLineRoll,
  unallocatedToStockRow,
} from './millUnallocated';
import { useInvalidateMmOps, useMmUnallocatedMill } from '../../lib/useMmOps';

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
  'px-2.5 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap text-center';
const thCls =
  'px-2.5 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap text-center';
const thQtyCls =
  'px-2.5 py-2.5 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 whitespace-nowrap text-center';
const thAtQtyCls =
  'px-2.5 py-2.5 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 whitespace-nowrap text-center';
const thDispQtyCls =
  'px-2.5 py-2.5 text-[10px] font-semibold text-green-800 uppercase tracking-wide border-b border-slate-200 bg-green-100 whitespace-nowrap text-center';
const tdFirstCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';
const tdQtyCls = 'px-2.5 py-2.5 text-center border-b border-slate-100 bg-blue-50/40';
const tdAtQtyCls = 'px-2.5 py-2.5 text-center border-b border-slate-100 bg-yellow-50';
const tdDispQtyCls = 'px-2.5 py-2.5 text-center border-b border-slate-100 bg-green-50';

export default function MmMillUnallocatedLinePage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { factory } = useFactoryProfileCatalog(factoryId);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const batchId = params.batchId ?? '';
  const millQuery = useMmUnallocatedMill();
  const [openChallanId, setOpenChallanId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const batch = (millQuery.data?.batches ?? []).find((row) => row.id === batchId);
  const rolls = useMemo(
    () => (millQuery.data?.rolls ?? []).filter((row) => row.mill_batch_id === batchId),
    [millQuery.data?.rolls, batchId],
  );
  const lineRolls = useMemo(() => rolls.map(unallocatedToLineRoll), [rolls]);
  const atMillRolls = rolls.filter((row) => row.at_mill);
  const dispatchedRolls = rolls.filter((row) => !row.at_mill);
  const qtyAtMill = atMillRolls.reduce((sum, row) => sum + millDeclaredQty(unallocatedToLineRoll(row)), 0);
  const qtyDispatched = dispatchedRolls.reduce((sum, row) => sum + millDeclaredQty(unallocatedToLineRoll(row)), 0);
  const colorRef = millDistinctLabel(rolls.map((row) => row.color_ref));
  const lotNo = millDistinctLabel(rolls.map((row) => row.lot_no));
  const batchStatus = millBatchRowStatus(atMillRolls.length, dispatchedRolls.length, rolls.length);
  const dispatchedChallans = groupMillDispatchedChallans(lineRolls);
  const openChallan = dispatchedChallans.find((row) => row.id === openChallanId) ?? null;

  usePageHeader({
    title: 'General PO fabric details',
    subtitle: 'Rolls on this General PO batch. Allocate more, assign to a style, or dispatch.',
  }, 'General PO fabric details');

  const printDoc = useMemo(() => {
    if (!openChallan || !batch) return null;
    return millChallanPrintDoc({
      factory,
      challanNo: openChallan.challan_no,
      referenceNo: openChallan.reference_no,
      sentAt: openChallan.sent_at,
      toLocation: openChallan.to_location,
      styleName: 'General PO',
      colorName: colorRef === '—' ? '' : colorRef,
      fabricName: batch.fabric_type,
      uom: 'm',
      fields: [],
      rolls: openChallan.rolls,
    });
  }, [openChallan, batch, factory, colorRef]);
  const { requestPrint } = useMmChallanPrint(printDoc);

  if (!millQuery.isLoading && millQuery.data && !batch) {
    return (
      <PageShell>
        <Card className="p-6">
          <p className="text-[13px] text-slate-600">This General PO batch was not found. It may already be assigned to a style.</p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED)}
          >
            Back to General PO
          </Button>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell
      loading={millQuery.isLoading}
      error={millQuery.error}
      onRetry={() => void millQuery.refetch()}
      skeleton="card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 mb-4 items-stretch">
        <MmFabricSummaryCard
          hideImage
          data={{
            fabric_name: batch?.fabric_ref_name || batch?.fabric_type,
            fabric_type: batch?.fabric_type,
            fabric_ref_name: batch?.fabric_ref_name,
            color_ref: millSingleValue(rolls.map((row) => row.color_ref)) || batch?.color_ref || '',
            color_name: colorRef === '—' ? '' : colorRef,
            mill_ref: batch?.mill_ref,
            batch_no: batch?.batch_no,
            lot_no: lotNo === '—' ? '' : lotNo,
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
                    onClick={() =>
                      requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE, { batchId })
                    }
                  >
                    Allocate rolls
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={atMillRolls.length === 0}
                    onClick={() =>
                      requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE, {
                        batchId,
                        mode: 'testing',
                      })
                    }
                  >
                    Test
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={atMillRolls.length === 0}
                    onClick={() =>
                      requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE, {
                        batchId,
                        mode: 'inspection',
                      })
                    }
                  >
                    4-point
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={atMillRolls.length === 0}
                    onClick={() =>
                      requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_DISPATCH, { batchId })
                    }
                  >
                    Dispatch to warehouse
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={atMillRolls.length === 0}
                    onClick={() => setAssignOpen(true)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Link2 size={14} />
                      Assign to style
                    </span>
                  </Button>
                </div>
              </DesktopWriteGate>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">Mill produced</p>
                <p className="text-[13px] font-bold text-yellow-900 mt-0.5 tabular-nums">
                  {formatQtyM(qtyAtMill + qtyDispatched, 'm')}
                </p>
                <p className="text-[10px] text-yellow-800/80 mt-0.5">
                  {rolls.length} {rolls.length === 1 ? 'roll' : 'rolls'}
                </p>
              </div>
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">At mill</p>
                <p className="text-[13px] font-bold text-yellow-900 mt-0.5 tabular-nums">{formatQtyM(qtyAtMill, 'm')}</p>
                <p className="text-[10px] text-yellow-800/80 mt-0.5">
                  {atMillRolls.length} {atMillRolls.length === 1 ? 'roll' : 'rolls'}
                </p>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700">Mill dispatched</p>
                <p className="text-[13px] font-bold text-green-900 mt-0.5 tabular-nums">{formatQtyM(qtyDispatched, 'm')}</p>
                <p className="text-[10px] text-green-800/80 mt-0.5">
                  {dispatchedRolls.length} {dispatchedRolls.length === 1 ? 'roll' : 'rolls'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-900">Status</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-slate-900">Batch</span>
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${millWordText(batchStatus.key)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(batchStatus.key)}`} />
                    {batchStatus.label}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1 truncate">Lot {lotNo}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-[11px] font-semibold text-slate-800">Mill batches</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">Open the batch to add rolls.</p>
        </div>
        <div className="overflow-x-auto" style={{ minHeight: `${2.6 + 2 * 2.5}rem` }}>
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '4.5%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '7.944%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thFirstCls}>S.No</th>
                <th className={thCls}>Batch</th>
                <th className={thCls}>Ref</th>
                <th className={thCls}>Date</th>
                <th className={thQtyCls}>Qty</th>
                <th className={thQtyCls}>Rolls</th>
                <th className={thAtQtyCls}>At mill qty</th>
                <th className={thAtQtyCls}>At mill</th>
                <th className={thDispQtyCls}>Disp. qty</th>
                <th className={thDispQtyCls}>Disp. rolls</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {batch ? (
                <tr
                  className="hover:bg-slate-50/80 cursor-pointer"
                  onClick={() =>
                    requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE, { batchId })
                  }
                >
                  <td className={`${tdFirstCls} text-slate-400 font-semibold tabular-nums`}>1</td>
                  <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{batch.batch_no}</td>
                  <td className={`${tdCls} truncate`}>{batch.mill_ref || '—'}</td>
                  <td className={`${tdCls} truncate`}>{millDateLabel(batch.production_date)}</td>
                  <td className={tdQtyCls}>
                    <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">
                      {formatQtyM(batch.qty_m, 'm')}
                    </span>
                  </td>
                  <td className={tdQtyCls}>
                    <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">{batch.roll_count}</span>
                  </td>
                  <td className={tdAtQtyCls}>
                    <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">
                      {formatQtyM(qtyAtMill, 'm')}
                    </span>
                  </td>
                  <td className={tdAtQtyCls}>
                    <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">{atMillRolls.length}</span>
                  </td>
                  <td className={tdDispQtyCls}>
                    <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                      {formatQtyM(qtyDispatched, 'm')}
                    </span>
                  </td>
                  <td className={tdDispQtyCls}>
                    <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                      {dispatchedRolls.length}
                    </span>
                  </td>
                  <td className={`${tdCls} text-center`}>
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(batchStatus.key)}`} />
                      <span className={`text-[10px] font-bold ${millWordText(batchStatus.key)}`}>{batchStatus.label}</span>
                    </span>
                  </td>
                  <td className={`${tdCls} truncate text-slate-500`}>{batch.remarks || '—'}</td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={12} className="border-b border-slate-100">
                    <span className="block text-center text-[11px] text-slate-400 italic py-3">No mill batch.</span>
                  </td>
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
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className={thFirstCls}>S.No</th>
                <th className={thCls}>Dispatched</th>
                <th className={thCls}>Challan</th>
                <th className={thCls}>Ref</th>
                <th className={thCls}>To</th>
                <th className={thDispQtyCls}>Rolls</th>
                <th className={thDispQtyCls}>Qty</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Received</th>
              </tr>
            </thead>
            <tbody>
              {dispatchedChallans.map((challan, idx) => {
                const open = challan.id === openChallanId;
                return (
                  <tr
                    key={challan.id}
                    className={`hover:bg-slate-50/80 cursor-pointer ${open ? 'bg-blue-50/70' : ''}`}
                    onClick={() => setOpenChallanId(open ? null : challan.id)}
                  >
                    <td className={`${tdFirstCls} text-slate-400 font-semibold tabular-nums`}>{idx + 1}</td>
                    <td className={`${tdCls} whitespace-nowrap`}><MillWhenCell iso={challan.sent_at} /></td>
                    <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{challan.challan_no}</td>
                    <td className={`${tdCls} truncate`}>{challan.reference_no || '—'}</td>
                    <td className={`${tdCls} truncate`}>{challan.to_location || 'Warehouse'}</td>
                    <td className={tdDispQtyCls}>
                      <span className="block text-[11px] font-semibold text-green-800 tabular-nums">{challan.roll_count}</span>
                    </td>
                    <td className={tdDispQtyCls}>
                      <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                        {formatQtyM(challan.qty_m, 'm')}
                      </span>
                    </td>
                    <td className={`${tdCls} text-center`}>
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
                  <td colSpan={9} className="border-b border-slate-100">
                    <span className="block text-center text-[11px] text-slate-400 italic py-3">No mill challans yet.</span>
                  </td>
                </tr>
              ) : null}
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
                {openChallan.roll_count} {openChallan.roll_count === 1 ? 'roll' : 'rolls'} · {formatQtyM(openChallan.qty_m, 'm')} · {millChallanStatusLabel(openChallan.status)}. Read-only.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={ExternalLink}
                onClick={() =>
                  requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ROLL, { kind: 'mill', id: openChallan.id })
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
            fields={[]}
            uom="m"
            emptyText="No rolls on this challan."
            statusMode="work"
            showBatch
            showSerialNumber
            evenColumns
          />
        </div>
      )}
      <MmChallanPrintDocument doc={printDoc} />
      <MmAllocateRollsModal
        open={assignOpen}
        source="mill"
        rolls={atMillRolls.map(unallocatedToStockRow)}
        onClose={() => setAssignOpen(false)}
        onDone={(overAllocated, assigned) => {
          setAssignOpen(false);
          showNotification(
            overAllocated
              ? 'Assigned to style. That fabric is now over required qty.'
              : 'Assigned to style. Dispatch those rolls from fabric details.',
            'success',
          );
          void invalidate();
          if (assigned) {
            requestNavigate(RoutePath.MATERIAL_MILL_LINE, assigned);
          }
        }}
      />
    </PageShell>
  );
}
