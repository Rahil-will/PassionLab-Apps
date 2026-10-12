import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, ExternalLink, Printer } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import { MmFabricSummaryCard } from '../../components/MmFabricSummaryCard';
import { MmLockedRollsTable } from '../../components/MmLockedRollsTable';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { storeChallanPrintDoc } from '../../lib/mmChallanPrint';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import { millLineDispatchedStatus, millWordDot, millWordText } from '../mill/millStatus';
import { inboundStatusDot, inboundStatusText, storeDispatchStatusLabel } from '../../lib/inboundDisplay';
import { useMmStyleWarehouse } from '../../lib/useMmOps';
import { fieldsForType, formatQtyM, millDateTimeParts } from '../../lib/mmRollDraft';

function WhenCell({ iso }: { iso: string | null | undefined }) {
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
const thDispQtyCls =
  'px-2.5 py-2.5 text-[10px] font-semibold text-green-800 uppercase tracking-wide border-b border-slate-200 bg-green-100 whitespace-nowrap text-center';
const tdFirstCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';
const tdDispQtyCls = 'px-2.5 py-2.5 text-center border-b border-slate-100 bg-green-50';

export default function MmWarehouseDispatchLinePage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { factory } = useFactoryProfileCatalog(factoryId);
  const orderId = params.orderId ?? '';
  const colorwayId = params.colorwayId ?? '';
  const fabricLineId = params.fabricLineId ?? '';
  const lineParams = { orderId, colorwayId, fabricLineId };
  const { data, isLoading, error, refetch } = useMmStyleWarehouse(orderId || null);
  const [openChallanId, setOpenChallanId] = useState<string | null>(params.challanId ?? null);

  const fabric = useMemo(
    () =>
      (data?.fabrics ?? []).find(
        (row) => row.colorway_id === colorwayId && row.fabric_line_id === fabricLineId,
      ) ?? null,
    [data?.fabrics, colorwayId, fabricLineId],
  );

  const challans = useMemo(() => {
    if (!fabric) return [];
    return (data?.challans ?? []).filter((row) => {
      if (row.kind !== 'store') return false;
      if (row.color_name !== fabric.color_name) return false;
      const name = (row.fabric_name ?? '').trim();
      return name === fabric.fabric_name || name === fabric.fabric_type;
    });
  }, [data?.challans, fabric]);

  const openChallan = challans.find((row) => row.id === openChallanId) ?? null;
  const openRolls = useMemo(
    () => (data?.rolls ?? []).filter((row) => row.store_challan_id === openChallan?.id),
    [data?.rolls, openChallan?.id],
  );
  const openFields = useMemo(() => {
    const typeId = openRolls.find((row) => row.fabric_type_id)?.fabric_type_id ?? null;
    return fieldsForType(data?.test_fields, typeId);
  }, [openRolls, data?.test_fields]);

  const uom = fabric?.uom ?? openChallan?.uom ?? null;
  const qtyRacked = Number(fabric?.qty_racked ?? 0);
  const rollsRacked = Number(fabric?.rolls_racked ?? 0);
  const qtyIssued = Number(fabric?.qty_issued ?? 0);
  const rollsIssued = Number(fabric?.rolls_issued ?? 0);
  const dispatchedStatus = millLineDispatchedStatus(qtyIssued, fabric?.required_m);

  const printDoc = useMemo(() => {
    if (!openChallan || !data?.order) return null;
    return storeChallanPrintDoc({
      factory,
      challanNo: openChallan.challan_no,
      sentAt: openChallan.sent_at,
      styleName: data.order.style_name,
      styleRef: data.order.style_ref,
      buyerName: data.order.buyer_name,
      poNumber: data.order.po_number,
      colorName: openChallan.color_name,
      fabricName: openChallan.fabric_name,
      fabricCategory: openChallan.fabric_category,
      uom: openChallan.uom,
      rolls: openRolls,
    });
  }, [openChallan, openRolls, data?.order, factory]);
  const { requestPrint } = useMmChallanPrint(printDoc);

  useEffect(() => {
    if (params.challanId) setOpenChallanId(params.challanId);
  }, [params.challanId]);

  usePageHeader({
    subtitle: 'All warehouse to cutting challans for this style, color, and fabric',
  });

  return (
    <PageShell loading={isLoading} error={error} onRetry={() => void refetch()} skeleton="card">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 mb-4 items-stretch">
        <MmFabricSummaryCard
          data={
            data?.order && fabric
              ? {
                  style_name: data.order.style_name,
                  style_ref: data.order.style_ref,
                  buyer_name: data.order.buyer_name,
                  po_number: data.order.po_number,
                  image_url: data.order.image_url,
                  color_name: fabric.color_name,
                  fabric_name: fabric.fabric_name,
                  fabric_type: fabric.fabric_type,
                  fabric_category: fabric.fabric_category,
                }
              : data?.order
          }
          onStyleClick={
            orderId ? () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId }) : undefined
          }
        />
        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                <ClipboardList size={16} className="text-primary-600" />
                Dispatch progress
              </h4>
              <DesktopWriteGate>
                <Button
                  type="button"
                  size="sm"
                  disabled={rollsRacked === 0}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_DISPATCH_SEND, lineParams)}
                >
                  Dispatch
                </Button>
              </DesktopWriteGate>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Required</p>
                <p className="text-[13px] font-bold text-blue-900 mt-0.5 tabular-nums">
                  {formatQtyM(fabric?.required_m, uom)}
                </p>
              </div>
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-yellow-700">Racked</p>
                <p className="text-[13px] font-bold text-yellow-900 mt-0.5 tabular-nums">{formatQtyM(qtyRacked, uom)}</p>
                <p className="text-[10px] text-yellow-800/80 mt-0.5">
                  {rollsRacked} {rollsRacked === 1 ? 'roll' : 'rolls'} waiting
                </p>
              </div>
              <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700">Dispatched</p>
                <p className="text-[13px] font-bold text-green-900 mt-0.5 tabular-nums">{formatQtyM(qtyIssued, uom)}</p>
                <p className="text-[10px] text-green-800/80 mt-0.5">
                  {rollsIssued} {rollsIssued === 1 ? 'roll' : 'rolls'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-900">Status</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-slate-900">Cutting</span>
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${millWordText(dispatchedStatus.key)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(dispatchedStatus.key)}`} />
                    {dispatchedStatus.label}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-[11px] font-semibold text-slate-800">Dispatched</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Challans already sent to cutting for this fabric. Open a row to see the rolls.
          </p>
        </div>
        <div className="overflow-x-auto" style={{ minHeight: `${2.6 + (challans.length + 1) * 2.5}rem` }}>
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '4.5%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '21.5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thFirstCls}>S.No</th>
                <th className={thCls}>Dispatched</th>
                <th className={thCls}>Challan</th>
                <th className={thCls}>To</th>
                <th className={thDispQtyCls}>Rolls</th>
                <th className={thDispQtyCls}>Qty</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Received</th>
              </tr>
            </thead>
            <tbody>
              {challans.map((challan, idx) => {
                const open = challan.id === openChallanId;
                return (
                  <tr
                    key={challan.id}
                    className={`hover:bg-slate-50/80 cursor-pointer ${open ? 'bg-blue-50/70' : ''}`}
                    onClick={() => setOpenChallanId(open ? null : challan.id)}
                  >
                    <td className={`${tdFirstCls} text-slate-400 font-semibold tabular-nums`}>{idx + 1}</td>
                    <td className={`${tdCls} whitespace-nowrap`}><WhenCell iso={challan.sent_at} /></td>
                    <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{challan.challan_no}</td>
                    <td className={`${tdCls} truncate`}>Cutting store</td>
                    <td className={tdDispQtyCls}>
                      <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                        {challan.roll_count}
                      </span>
                    </td>
                    <td className={tdDispQtyCls}>
                      <span className="block text-[11px] font-semibold text-green-800 tabular-nums">
                        {formatQtyM(challan.qty, challan.uom ?? uom)}
                      </span>
                    </td>
                    <td className={`${tdCls} text-center`}>
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(challan.status)}`} />
                        <span className={`text-[10px] font-bold ${inboundStatusText(challan.status)}`}>
                          {storeDispatchStatusLabel(challan.status)}
                        </span>
                      </span>
                    </td>
                    <td className={`${tdCls} whitespace-nowrap`}><WhenCell iso={challan.received_at} /></td>
                  </tr>
                );
              })}
              {challans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="border-b border-slate-100">
                    <span className="block text-center text-[11px] text-slate-400 italic py-3">
                      No dispatches for this fabric yet.
                    </span>
                  </td>
                </tr>
              ) : (
                <tr aria-hidden>
                  <td colSpan={8} className="h-14 border-0 p-0" />
                </tr>
              )}
              {challans.length === 0 ? (
                <tr aria-hidden>
                  <td colSpan={8} className="h-14 border-0 p-0" />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {openChallan ? (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm mt-4">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="text-[11px] font-semibold text-slate-800">Rolls sent · {openChallan.challan_no}</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {openChallan.roll_count} {openChallan.roll_count === 1 ? 'roll' : 'rolls'} ·{' '}
                {formatQtyM(openChallan.qty, openChallan.uom ?? uom)} · {storeDispatchStatusLabel(openChallan.status)}. Read-only.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={ExternalLink}
                onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL, { id: openChallan.id })}
              >
                Details
              </Button>
              <Button type="button" size="sm" variant="secondary" icon={Printer} onClick={requestPrint}>
                Print
              </Button>
            </div>
          </div>
          <MmLockedRollsTable
            rolls={openRolls}
            fields={openFields}
            uom={openChallan.uom ?? uom}
            emptyText="No rolls on this challan."
          />
        </div>
      ) : null}
      <MmChallanPrintDocument doc={printDoc} />
    </PageShell>
  );
}
