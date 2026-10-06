import React, { useEffect, useMemo, useState } from 'react';
import { Filter, ClipboardList, Printer, Search } from 'lucide-react';
import { Button, Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { MmFabricSummaryCard } from '../../components/MmFabricSummaryCard';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { inboundChallanPrintDoc } from '../../lib/mmChallanPrint';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import { inboundInvoiceInspection, inboundStatusDot, inboundStatusText } from '../../lib/inboundDisplay';
import { useNotificationStore } from '../../../../stores';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import { useInvalidateMmOps, useMmInChallanDetail } from '../../lib/useMmOps';
import {
  mmReceiveInChallanLines,
  mmReceiveMillInChallan,
  mmShortCloseInChallan,
  type MmStockRoll,
  type MmTestField,
} from '../../lib/mmRpc';
import {
  fieldRole,
  formatQtyM,
  lockedRollValues,
  millChallanStatusClass,
  millChallanStatusLabel,
  millLineRollToDraft,
  millDateTimeParts,
  millRollFieldText,
  withLengthField,
  type MmDraftRoll,
} from '../../lib/mmRollDraft';

interface VendorRow {
  id: string;
  unit_code: string;
  length_m: number | null;
  status: string;
  values: ReturnType<typeof lockedRollValues>;
}

type InboundMillRow = MmDraftRoll & { batch_no: string | null; unitStatus: string };

const thCls =
  'px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap text-center';
const thQtyCls =
  'px-3 py-2.5 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 whitespace-nowrap text-center';
const tdCls = 'px-3 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';
const tdQtyCls = 'px-3 py-2.5 text-center border-b border-slate-100 bg-blue-50/40 text-[10px]';

function toVendorRow(roll: MmStockRoll): VendorRow {
  return {
    id: roll.id,
    unit_code: roll.unit_code,
    length_m: roll.length_m,
    status: roll.status,
    values: lockedRollValues(roll),
  };
}

function draftFieldValue(row: MmDraftRoll, field: MmTestField): string {
  const role = fieldRole(field);
  if (role === 'length') return row.attributes[field.key] || row.length_m;
  if (role === 'weight') return row.attributes[field.key] || row.weight_kg;
  if (role === 'shade') return row.attributes[field.key] || row.shade;
  if (role === 'lot') return row.attributes[field.key] || row.lot_no;
  return row.attributes[field.key] ?? '';
}

function WhenPill({ label, iso }: { label: string; iso: string | null | undefined }) {
  const parts = millDateTimeParts(iso);
  return (
    <span className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-[10px] font-medium text-slate-600">
      <span className="text-slate-400">{label}</span>
      {' '}
      <span className="tabular-nums">
        {parts.date}
        {parts.time ? `, ${parts.time}` : ''}
      </span>
    </span>
  );
}

function MetricTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'blue' | 'green' | 'yellow';
}) {
  const shell =
    tone === 'blue'
      ? 'border-blue-100 bg-blue-50/70'
      : tone === 'green'
        ? 'border-green-200 bg-green-50'
        : 'border-yellow-200 bg-yellow-50';
  const labelCls =
    tone === 'blue' ? 'text-blue-600' : tone === 'green' ? 'text-green-700' : 'text-yellow-700';
  const valueCls =
    tone === 'blue' ? 'text-blue-900' : tone === 'green' ? 'text-green-900' : 'text-yellow-900';
  return (
    <div className={`rounded-xl border ${shell} px-3 py-2.5 min-w-0 h-full`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wide ${labelCls}`}>{label}</p>
      <p className={`text-[13px] font-bold mt-1 tabular-nums ${valueCls}`}>{value}</p>
      {sub ? <p className={`text-[10px] mt-0.5 ${labelCls}`}>{sub}</p> : null}
    </div>
  );
}

export default function MmWarehouseRollDetail() {
  const id = useNavigationStore((s) => s.routeParams.id);
  const millOrderId = useNavigationStore((s) => s.routeParams.orderId ?? '');
  const millColorwayId = useNavigationStore((s) => s.routeParams.colorwayId ?? '');
  const millFabricLineId = useNavigationStore((s) => s.routeParams.fabricLineId ?? '');
  const millView = useNavigationStore((s) => s.currentRoute === RoutePath.MATERIAL_MILL_CHALLAN);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { factory } = useFactoryProfileCatalog(factoryId);
  const { showNotification } = useNotificationStore();
  const { data, isLoading, error, refetch } = useMmInChallanDetail(id ?? null);
  const invalidate = useInvalidateMmOps();
  const [millRows, setMillRows] = useState<InboundMillRow[]>([]);
  const [vendorRows, setVendorRows] = useState<VendorRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [rollQuery, setRollQuery] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [arrived, setArrived] = useState<Record<string, boolean>>({});
  const [closeReason, setCloseReason] = useState('');

  const challan = data?.challan;
  const fields = data?.test_fields ?? [];
  const cols = useMemo(() => withLengthField(fields, challan?.uom), [fields, challan?.uom]);
  const uom = challan?.uom ?? null;
  const isMill = challan?.source === 'mill';
  const millPending = isMill && challan?.status === 'pending';
  const millPartial = isMill && challan?.status === 'partial';
  const millOpen = millPending || millPartial;
  const millReceived = isMill && (challan?.status === 'received' || challan?.status === 'short_closed' || challan?.status === 'partial');

  useEffect(() => {
    if (!data) return;
    if (data.challan.source === 'mill') {
      setMillRows(
        (data.rolls ?? []).map((roll) => ({
          ...millLineRollToDraft(
            { ...roll, at_mill: false },
            data.test_fields ?? [],
            data.challan.uom,
          ),
          batch_no: roll.batch_no ?? null,
          unitStatus: roll.status,
        })),
      );
      const nextArrived: Record<string, boolean> = {};
      for (const roll of data.rolls ?? []) {
        if (roll.status === 'in_transit') nextArrived[roll.id] = true;
      }
      setArrived(nextArrived);
    } else {
      setVendorRows((data.rolls ?? []).map(toVendorRow));
    }
    setRollQuery('');
    setFilterBatch('');
    setCloseReason('');
  }, [data]);

  const transitRows = millRows.filter((row) => row.unitStatus === 'in_transit' && row.id);
  const tickedTransit = transitRows.filter((row) => row.id && arrived[row.id] !== false);

  const receiveMill = async () => {
    if (!id || challan == null) return;
    if (tickedTransit.length === 0) {
      showNotification('Tick the rolls that arrived', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = millPartial
        ? await mmReceiveInChallanLines(id, tickedTransit.map((row) => row.id as string))
        : await mmReceiveMillInChallan(
          id,
          [],
          challan.row_version,
          transitRows.filter((row) => row.id && arrived[row.id] === false).map((row) => row.id as string),
        );
      if (res.ok === false) throw new Error(res.message);
      showNotification(millPartial ? 'Late rolls received' : 'Received into warehouse', 'success');
      await invalidate();
      await refetch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Receive failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const shortClose = async () => {
    if (!id) return;
    const reason = closeReason.trim();
    if (!reason) {
      showNotification('A short close needs a reason', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmShortCloseInChallan(id, reason);
      if (res.ok === false) throw new Error(res.message);
      showNotification('Challan short closed', 'success');
      await invalidate();
      await refetch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Short close failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openTesting = () => {
    if (!id) return;
    requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id });
  };

  const millQty = millRows.reduce((sum, row) => sum + Number(row.length_m || 0), 0);
  const onChallanQty = isMill ? millQty || Number(challan?.qty || 0) : Number(challan?.qty || 0);
  const receivedQty = !isMill
    ? onChallanQty
    : millRows
      .filter((row) => row.unitStatus !== 'in_transit' && row.unitStatus !== 'missing')
      .reduce((sum, row) => sum + Number(row.length_m || 0), 0);
  const q = rollQuery.trim().toLowerCase();
  const batchOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of millRows) {
      const name = (row.batch_no ?? '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [millRows]);
  const visibleMill = millRows.filter((row) => {
    if (filterBatch && (row.batch_no ?? '') !== filterBatch) return false;
    if (q && !(row.roll_no.toLowerCase().includes(q) || (row.batch_no ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
  const visibleVendor = vendorRows.filter((row) => !q || row.unit_code.toLowerCase().includes(q));
  const millColSpan = (millOpen ? 4 : 3) + cols.length;
  const printDoc = useMemo(() => {
    if (!challan) return null;
    return inboundChallanPrintDoc({
      factory,
      source: challan.source,
      challanNo: challan.challan_no,
      referenceNo: challan.reference_no,
      sentAt: challan.sent_at,
      toLocation: challan.to_location,
      remarks: challan.remarks,
      supplierName: challan.supplier_name,
      styleName: challan.style_name,
      styleRef: challan.style_ref,
      buyerName: challan.buyer_name,
      poNumber: challan.po_number,
      colorName: challan.color_name,
      fabricName: challan.fabric_name,
      fabricCategory: challan.fabric_category,
      uom: challan.uom,
      factoryName: challan.factory_name,
      factoryCode: challan.factory_code,
      fields: data?.test_fields,
      rolls: (data?.rolls ?? []).map((roll) => ({
        id: roll.id,
        unit_code: roll.unit_code,
        length_m: roll.length_m,
        weight_kg: roll.weight_kg,
        shade: roll.shade,
        lot_no: roll.lot_no,
        batch_no: roll.batch_no ?? null,
        attributes: roll.attributes,
        mill_snapshot: roll.mill_snapshot,
      })),
    });
  }, [challan, data?.rolls, data?.test_fields, factory]);
  const { requestPrint } = useMmChallanPrint(printDoc);

  usePageHeader({
    title: millView
      ? (challan?.challan_no ? `Mill challan ${challan.challan_no}` : 'Mill challan')
      : undefined,
    subtitle: millView
      ? 'Sent to the warehouse. Receive happens on Fabric Warehouse.'
      : !challan
        ? 'Open a challan from inbound to receive rolls or view invoice inspection.'
        : isMill
          ? millPending
            ? 'Receive mill rolls as sent. Testing is entered on Testing. Invoice inspection is view-only here.'
            : 'Rolls received from the mill. Testing is on Testing. Invoice inspection below is view-only.'
          : 'Vendor GRN as received from the floor. Testing is on Testing. Invoice inspection below is view-only.',
  }, [challan, isMill, millPending, millView]);

  const invoiceInsp = challan ? inboundInvoiceInspection(challan) : null;

  return (
    <PageShell loading={isLoading} error={error} onRetry={() => void refetch()} skeleton="card">
      {challan ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-stretch">
          <MmFabricSummaryCard
            data={challan}
            imageSize="large"
            onStyleClick={
              millView && millOrderId
                ? () =>
                    requestNavigate(RoutePath.MATERIAL_MILL_LINE, {
                      orderId: millOrderId,
                      colorwayId: millColorwayId,
                      fabricLineId: millFabricLineId,
                    })
                : challan.order_id
                  ? () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId: challan.order_id as string })
                  : undefined
            }
          />
          <Card className="shadow-sm border-slate-200 h-full" noPadding>
            <div className="px-5 py-4 h-full flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-3">
                    <ClipboardList size={16} className="text-primary-600 shrink-0" />
                    Challan details
                  </h4>
                  <p className="text-[15px] font-bold text-slate-900 leading-tight truncate">
                    {isMill ? 'Challan No' : 'GRN No'} {challan.challan_no}
                    <span className="text-slate-300 font-semibold"> | </span>
                    Ref No {challan.reference_no || '—'}
                  </p>
                  <p className="text-[12px] text-slate-500 mt-1.5 truncate">
                    {isMill ? 'Mill inbound' : challan.supplier_name ? `Vendor · ${challan.supplier_name}` : 'Vendor inbound'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button type="button" size="sm" variant="secondary" icon={Printer} onClick={requestPrint}>
                    Print
                  </Button>
                  {millView ? null : millOpen ? (
                    <DesktopWriteGate>
                      <Button type="button" size="sm" disabled={busy} onClick={() => void receiveMill()}>
                        {busy ? 'Receiving…' : millPartial ? 'Receive ticked' : 'Receive'}
                      </Button>
                    </DesktopWriteGate>
                  ) : (
                    <Button type="button" size="sm" variant="secondary" onClick={openTesting}>
                      Test this challan
                    </Button>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${millChallanStatusClass(challan.status)}`}
                  >
                    {millChallanStatusLabel(challan.status)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <WhenPill label="Sent" iso={challan.sent_at} />
                <WhenPill label="Received" iso={challan.received_at} />
              </div>
              <div className="grid grid-cols-3 gap-3 mt-auto pt-3">
                <MetricTile label="Required" value={formatQtyM(challan.required_m, uom)} tone="blue" />
                <MetricTile
                  label="Received"
                  value={formatQtyM(receivedQty, uom)}
                  sub={
                    !isMill || millReceived
                      ? `${millRows.filter((row) => row.unitStatus !== 'in_transit' && row.unitStatus !== 'missing').length} received`
                      : 'Waiting receive'
                  }
                  tone="green"
                />
                <MetricTile
                  label="On challan"
                  value={formatQtyM(onChallanQty, uom)}
                  sub={`${challan.roll_count} ${challan.roll_count === 1 ? 'roll' : 'rolls'}`}
                  tone="yellow"
                />
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {challan && !millView && invoiceInsp ? (
        <Card className="shadow-sm border-slate-200 mb-4" noPadding>
          <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Invoice inspection
              </p>
              <p className="text-[12px] text-slate-600 mt-1">
                View only. Sample and pass/fail apply to this{' '}
                {isMill ? 'challan' : 'GRN'}. Decide keep, putaway, or red label from Stock and Rack.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 min-w-[5.5rem]">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Sample</p>
                <p className="text-[13px] font-bold tabular-nums text-slate-800 mt-0.5">
                  {invoiceInsp.samplePct != null ? `${invoiceInsp.samplePct}%` : '—'}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                  {invoiceInsp.checked}/{invoiceInsp.rolls} rolls
                </p>
              </div>
              <div
                className={`rounded-xl border px-3 py-2 min-w-[5.5rem] ${
                  invoiceInsp.verdict === 'pass'
                    ? 'border-emerald-200 bg-emerald-50'
                    : invoiceInsp.verdict === 'fail'
                      ? 'border-red-200 bg-red-50'
                      : invoiceInsp.verdict === 'pending'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-slate-50'
                }`}
              >
                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Result</p>
                <p
                  className={`text-[13px] font-bold mt-0.5 ${
                    invoiceInsp.verdict === 'pass'
                      ? 'text-emerald-800'
                      : invoiceInsp.verdict === 'fail'
                        ? 'text-red-800'
                        : invoiceInsp.verdict === 'pending'
                          ? 'text-amber-800'
                          : 'text-slate-600'
                  }`}
                >
                  {invoiceInsp.label}
                </p>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {challan && isMill ? (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                placeholder="Search roll, batch..."
                value={rollQuery}
                onChange={(e) => setRollQuery(e.target.value)}
              />
            </div>
            <SelectDropdown
              value={filterBatch}
              onChange={setFilterBatch}
              options={[
                { value: '', label: 'All batches' },
                ...batchOptions.map((name) => ({ value: name, label: name })),
              ]}
              icon={Filter}
              className="w-36"
            />
          </div>
          {millPartial ? (
            <div className="px-4 py-2 border-b border-amber-100 bg-amber-50 flex flex-col sm:flex-row sm:items-center gap-2">
              <p className="text-[11px] text-amber-800 flex-1">
                Unticked rolls are still in transit. Receive the ones that arrived, or short-close the rest.
              </p>
              <DesktopWriteGate>
                <div className="flex items-center gap-2">
                  <input
                    className="text-xs border border-amber-200 rounded-md px-2 py-1 bg-white min-w-0 w-56"
                    placeholder="Reason for short close"
                    value={closeReason}
                    onChange={(e) => setCloseReason(e.target.value)}
                  />
                  <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void shortClose()}>
                    Short close
                  </Button>
                </div>
              </DesktopWriteGate>
            </div>
          ) : null}
          {millPending ? (
            <p className="px-4 py-2 border-b border-slate-100 text-[11px] text-slate-500">
              Untick a roll that did not arrive. It stays in transit until you receive it later or short-close the challan.
            </p>
          ) : null}
          <div className="overflow-x-auto" style={{ minHeight: `${2.6 + (visibleMill.length + 1) * 2.5}rem` }}>
            <table className="w-full min-w-[980px] table-fixed border-collapse">
              <colgroup>
                {millOpen ? <col style={{ width: '2.75rem' }} /> : null}
                <col style={{ width: '3.25rem' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '14%' }} />
                {cols.map((field) => (
                  <col key={field.id} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {millOpen ? <th className={thCls}>In</th> : null}
                  <th className={thCls}>S.No</th>
                  <th className={thCls}>Batch</th>
                  <th className={thCls}>Roll no.</th>
                  {cols.map((field) => (
                    <th key={field.id} className={fieldRole(field) === 'length' ? thQtyCls : thCls}>
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleMill.length === 0 ? (
                  <tr>
                    <td colSpan={millColSpan} className="px-3 py-8 text-center text-[11px] text-slate-400 italic">
                      No mill rolls match this filter.
                    </td>
                  </tr>
                ) : (
                  visibleMill.map((row) => {
                    const serial = millRows.findIndex((r) => r.localId === row.localId) + 1;
                    return (
                      <tr key={row.localId}>
                        {millOpen ? (
                          <td className={tdCls}>
                            {row.unitStatus === 'in_transit' && row.id ? (
                              <input
                                type="checkbox"
                                checked={arrived[row.id] !== false}
                                onChange={(e) => {
                                  const rollId = row.id as string;
                                  setArrived((current) => ({ ...current, [rollId]: e.target.checked }));
                                }}
                                aria-label={`Roll ${row.roll_no} arrived`}
                              />
                            ) : (
                              <span className="text-[10px] text-slate-400">
                                {row.unitStatus === 'missing' ? 'Missing' : 'In'}
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td className={`${tdCls} text-slate-400 font-semibold`}>{serial}</td>
                        <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{row.batch_no || '—'}</td>
                        <td className={`${tdCls} font-semibold text-slate-800`}>
                          {row.roll_no}
                        </td>
                        {cols.map((field) => {
                          const qty = fieldRole(field) === 'length';
                          const value = draftFieldValue(row, field);
                          return (
                            <td key={field.id} className={qty ? tdQtyCls : tdCls}>
                              <span className={`tabular-nums ${qty ? 'text-[10px] font-medium text-blue-800' : ''}`}>
                                {value || '—'}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
                <tr aria-hidden>
                  <td colSpan={millColSpan} className="h-14 border-0 p-0" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {challan && !isMill ? (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center bg-slate-50/50 gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                placeholder="Search roll no..."
                value={rollQuery}
                onChange={(e) => setRollQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-fixed border-collapse">
              <thead>
                <tr>
                  <th className={thCls} style={{ width: '3.25rem' }}>S.No</th>
                  <th className={thCls}>Roll no.</th>
                  <th className={thQtyCls}>Qty</th>
                  {fields.map((field) => (
                    <th key={field.id} className={thCls}>{field.label}</th>
                  ))}
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleVendor.length === 0 ? (
                  <tr>
                    <td colSpan={4 + fields.length} className="px-3 py-8 text-center text-[11px] text-slate-400 italic">
                      No rolls on this challan.
                    </td>
                  </tr>
                ) : (
                  visibleVendor.map((row) => {
                    const serial = vendorRows.findIndex((r) => r.id === row.id) + 1;
                    return (
                      <tr key={row.id}>
                        <td className={`${tdCls} text-slate-400 font-semibold`}>{serial}</td>
                        <td className={`${tdCls} font-semibold text-slate-800`}>{row.unit_code}</td>
                        <td className={tdQtyCls}>
                          <span className="tabular-nums text-[10px] font-medium text-blue-800">
                            {formatQtyM(row.length_m, uom)}
                          </span>
                        </td>
                        {fields.map((field) => (
                          <td key={field.id} className={tdCls}>
                            <span className="tabular-nums">{millRollFieldText(row.values, field)}</span>
                          </td>
                        ))}
                        <td className={tdCls}>
                          <span className="inline-flex items-center justify-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(row.status)}`} />
                            <span className={`text-[10px] font-semibold ${inboundStatusText(row.status)}`}>
                              {millChallanStatusLabel(row.status)}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
                <tr aria-hidden>
                  <td colSpan={4 + fields.length} className="h-14 border-0 p-0" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <MmChallanPrintDocument doc={printDoc} />
    </PageShell>
  );
}
