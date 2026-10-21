import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmFabricSummaryCard } from '../../components/MmFabricSummaryCard';
import { fmtUomQty } from '../../lib/fabricStock';
import { lineDispatchedStatus, wordDot, wordText } from '../../lib/fabricLineStatus';
import { inboundStatusDot, inboundStatusText, storeDispatchStatusLabel } from '../../lib/inboundDisplay';
import { dateTimeParts, formatQtyM } from '../../lib/mmRollDraft';
import type { MmStyleWarehouseChallan } from '../../lib/mmRpc';
import { useMmStyleWarehouse } from '../../lib/useMmOps';
import { finishedText, rollColour, rollStageLabel } from '../../lib/rollColour';
import { whTdQty, whTdRolls, whThQty, whThRolls } from './whTable';
import {
  mmListAllocationNotes,
  mmListRollsV4,
  mmStyleFabricPosition,
  mmUnallocateRollsV4,
  mmUnbookRolls,
  type MmStyleFabricPositionRow,
  type MmV4RollRow,
} from '../../lib/mmV4Rpc';

const th = 'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

async function loadLine(lineId: string): Promise<MmStyleFabricPositionRow | null> {
  const byColourway = await mmStyleFabricPosition({
    colorway_material_id: lineId,
    include_closed: true,
  });
  if (byColourway.ok === false) throw new Error(byColourway.message);
  const first = (byColourway.data.rows ?? []).find((row) => row.colorway_material_id === lineId) ?? byColourway.data.rows?.[0];
  if (first) return first;
  const byStyle = await mmStyleFabricPosition({
    style_material_id: lineId,
    include_closed: true,
  });
  if (byStyle.ok === false) throw new Error(byStyle.message);
  return (byStyle.data.rows ?? []).find((row) => row.style_material_id === lineId) ?? byStyle.data.rows?.[0] ?? null;
}

export default function MmWarehouseStyleFabricPage() {
  const lineId = useNavigationStore((s) => s.routeParams.lineId ?? '');
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const [bookedPick, setBookedPick] = useState<Record<string, boolean>>({});
  const [allocPick, setAllocPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const lineQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'whStyleFabric', lineId] as const,
    queryFn: () => loadLine(lineId),
    enabled: Boolean(factoryId && lineId),
  });
  const line = lineQ.data ?? null;
  const styleMaterialId = line?.style_material_id ?? '';
  const uom = line?.uom === 'kg' ? 'kg' : 'm';
  const fabricName = line?.fabric?.name || line?.line_name || '—';

  // Same source the Dispatch line page uses — it carries the style image
  // (mm_style_fabric_position has no image_url, which is why the image
  // never showed here) plus racked / dispatched totals and store challans.
  const styleWhQ = useMmStyleWarehouse(line?.order_id ?? null);
  const styleWh = styleWhQ.data ?? null;
  const warehouseFabric = useMemo(() => {
    const fabrics = styleWh?.fabrics ?? [];
    return (
      fabrics.find((row) => styleMaterialId && row.style_material_id === styleMaterialId)
      ?? fabrics.find((row) => row.colorway_id === line?.colorway_id && row.fabric_name === fabricName)
      ?? fabrics.find((row) => row.colorway_id === line?.colorway_id)
      ?? null
    );
  }, [styleWh?.fabrics, styleMaterialId, line?.colorway_id, fabricName]);
  const dispatchedChallans = useMemo(() => {
    const store = (styleWh?.challans ?? []).filter((row) => row.kind === 'store');
    const colorName = warehouseFabric?.color_name || line?.colorway_name || '';
    const name = warehouseFabric?.fabric_name || fabricName;
    const strict = store.filter((row) => row.color_name === colorName && (row.fabric_name === name || row.fabric_name === warehouseFabric?.fabric_type));
    if (strict.length > 0) return strict;
    return colorName ? store.filter((row) => row.color_name === colorName) : store;
  }, [styleWh?.challans, warehouseFabric, line?.colorway_name, fabricName]);
  const qtyRacked = warehouseFabric ? Number(warehouseFabric.qty_racked ?? 0) : Number(line?.in_warehouse?.qty ?? 0);
  const rollsRacked = warehouseFabric ? Number(warehouseFabric.rolls_racked ?? 0) : Number(line?.in_warehouse?.rolls ?? 0);
  const qtyIssued = warehouseFabric ? Number(warehouseFabric.qty_issued ?? 0) : Number(line?.issued?.qty ?? 0);
  const rollsIssued = warehouseFabric ? Number(warehouseFabric.rolls_issued ?? 0) : Number(line?.issued?.units ?? 0);
  const dispatchedStatus = lineDispatchedStatus(qtyIssued, line?.required);

  const rollsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'whStyleFabricRolls', styleMaterialId] as const,
    queryFn: async () => {
      const [booked, allocated] = await Promise.all([
        mmListRollsV4({ booked_style_material_id: styleMaterialId, limit: 500 }),
        mmListRollsV4({ style_material_id: styleMaterialId, limit: 500 }),
      ]);
      if (booked.ok === false) throw new Error(booked.message);
      if (allocated.ok === false) throw new Error(allocated.message);
      return {
        booked: (booked.data.rows ?? []).filter((row) => row.booked_style_material_id === styleMaterialId),
        allocated: (allocated.data.rows ?? []).filter((row) => {
          const id = row.style && typeof row.style.style_material_id === 'string' ? row.style.style_material_id : '';
          return id === styleMaterialId || Boolean(row.style);
        }),
      };
    },
    enabled: Boolean(factoryId && styleMaterialId),
  });

  const notesQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'styleAllocNotes', styleMaterialId] as const,
    queryFn: async () => {
      const res = await mmListAllocationNotes({ style_material_id: styleMaterialId });
      if (res.ok === false) return [];
      return Array.isArray(res.data) ? res.data : (res.data.rows ?? []);
    },
    enabled: Boolean(factoryId && styleMaterialId),
  });

  usePageHeader({
    title: 'Style fabric',
    subtitle: [line?.style_name, line?.colorway_name, line?.fabric?.name].filter(Boolean).join(' · ') || 'Required, allocated, booked, issued, and uncovered.',
  }, 'Style fabric');

  const refresh = async () => {
    await lineQ.refetch();
    await rollsQ.refetch();
    await styleWhQ.refetch();
  };

  const unbook = async () => {
    const ids = (rollsQ.data?.booked ?? []).filter((row) => bookedPick[row.roll_id]).map((row) => row.roll_id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await mmUnbookRolls(ids);
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Unbooked ${res.data.count} rolls`, 'success');
      setBookedPick({});
      await refresh();
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Unbook failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const unallocate = async () => {
    const ids = (rollsQ.data?.allocated ?? []).filter((row) => allocPick[row.roll_id]).map((row) => row.roll_id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await mmUnallocateRollsV4(ids);
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Unallocated ${res.data.count} rolls`, 'success');
      setAllocPick({});
      await refresh();
    } catch (error) {
      showNotification(error instanceof Error ? error.message : 'Unallocate failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openAllocate = () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC_ALLOCATE, { lineId });
  const newReceipt = () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIVE, {
    purpose: 'style',
    orderId: line?.order_id ?? '',
    colorwayId: line?.colorway_id ?? '',
    colorwayMaterialId: line?.colorway_material_id ?? '',
    styleMaterialId: line?.style_material_id ?? '',
  });

  return (
    <PageShell loading={lineQ.isLoading} error={lineQ.error} onRetry={() => { void lineQ.refetch(); }} skeleton="card">
      {line?.order_cancelled || line?.release_suggested ? (
        <p className="mb-3 text-[12px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Order cancelled — release rolls
        </p>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 mb-4 items-stretch">
        <MmFabricSummaryCard
          data={{
            style_name: line?.style_name,
            style_ref: line?.style_ref,
            buyer_name: line?.buyer_name,
            po_number: line?.po_number,
            image_url: styleWh?.order?.image_url,
            color_name: line?.colorway_name,
            fabric_color: line?.colour,
            fabric_name: fabricName,
            fabric_type: line?.fabric_type ?? line?.fabric?.fabric_type,
            fabric_category: line?.fabric_category,
          }}
          onStyleClick={
            line?.order_id
              ? () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId: line.order_id })
              : undefined
          }
        />
        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                <ClipboardList size={16} className="text-primary-600" />
                Fabric progress
              </h4>
              <DesktopWriteGate>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" size="sm" onClick={openAllocate}>Allocate rolls</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={newReceipt}>New receipt</Button>
                </div>
              </DesktopWriteGate>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <Metric label="Required" value={fmtUomQty(line?.required, uom)} tone="blue" />
              <Metric label="Racked" value={fmtUomQty(qtyRacked, uom)} sub={`${rollsRacked} ${rollsRacked === 1 ? 'roll' : 'rolls'} waiting`} tone="yellow" />
              <Metric label="Booked" value={fmtUomQty(line?.booked?.qty, uom)} sub={`${line?.booked?.rolls ?? 0} rolls`} tone="violet" />
              <Metric label="Allocated" value={fmtUomQty(line?.allocated, uom)} sub={`${rollsQ.data?.allocated.length ?? 0} rolls`} tone="green" />
              <Metric label="Dispatched" value={fmtUomQty(qtyIssued, uom)} sub={`${rollsIssued} ${rollsIssued === 1 ? 'roll' : 'rolls'}`} tone="green" />
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-slate-900">
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">Status</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-slate-900">Cutting</span>
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${wordText(dispatchedStatus.key)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${wordDot(dispatchedStatus.key)}`} />
                    {dispatchedStatus.label}
                  </span>
                </div>
                {Number(line?.uncovered) > 0 ? (
                  <p className="text-[10px] mt-0.5 text-red-600 font-semibold">Uncovered {fmtUomQty(line?.uncovered, uom)}</p>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {(notesQ.data ?? []).length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-700">Allocation notes</span>
          {(notesQ.data ?? []).map((note) => (
            <button
              key={note.id}
              type="button"
              className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-800 hover:bg-blue-100"
              onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ALLOCATION, { id: note.id })}
            >
              {note.note_no} · {note.status}
            </button>
          ))}
        </div>
      ) : null}

      <RollTable
        title="Booked greige"
        subtitle="Reserved for this style. The roll stays free until it is allocated."
        uom={uom}
        rows={rollsQ.data?.booked ?? []}
        picked={bookedPick}
        onPick={setBookedPick}
        actionLabel={busy ? 'Unbooking…' : 'Unbook'}
        onAction={() => void unbook()}
        busy={busy}
      />
      <div className="mt-4">
        <RollTable
          title="Allocated"
          subtitle="Finished rolls on this style line."
          uom={uom}
          rows={rollsQ.data?.allocated ?? []}
          picked={allocPick}
          onPick={setAllocPick}
          actionLabel={busy ? 'Unallocating…' : 'Unallocate'}
          onAction={() => void unallocate()}
          busy={busy}
        />
      </div>
      <div className="mt-4">
        <DispatchedTable
          challans={dispatchedChallans}
          uom={uom}
          onOpen={
            line?.order_id && warehouseFabric?.fabric_line_id
              ? () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE, {
                  orderId: line.order_id,
                  colorwayId: warehouseFabric.colorway_id,
                  fabricLineId: warehouseFabric.fabric_line_id ?? '',
                })
              : undefined
          }
        />
      </div>
    </PageShell>
  );
}

function WhenCell({ iso }: { iso: string | null | undefined }) {
  const parts = dateTimeParts(iso);
  if (parts.date === '—') return <span className="text-slate-400">—</span>;
  return (
    <span className="whitespace-nowrap">
      {parts.date}
      {parts.time ? <span className="text-slate-400">, {parts.time}</span> : null}
    </span>
  );
}

function DispatchedTable({
  challans,
  uom,
  onOpen,
}: {
  challans: MmStyleWarehouseChallan[];
  uom: string;
  onOpen?: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
        <h4 className="text-[11px] font-semibold text-slate-800">Dispatched</h4>
        <p className="text-[10px] text-slate-400 mt-0.5">
          Challans already sent to cutting for this fabric.{onOpen ? ' Open to see the dispatch.' : ''}
        </p>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>S.No</th>
              <th className={th}>Dispatched</th>
              <th className={th}>Challan</th>
              <th className={th}>To</th>
              <th className={whThRolls}>Rolls</th>
              <th className={whThQty}>Qty</th>
              <th className={th}>Status</th>
              <th className={th}>Received</th>
            </tr>
          </thead>
          <tbody>
            {challans.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[11px] text-slate-400">No dispatches for this fabric yet.</td>
              </tr>
            ) : challans.map((challan, idx) => (
              <tr
                key={challan.id}
                className={onOpen ? 'hover:bg-slate-50/80 cursor-pointer' : undefined}
                onClick={onOpen}
              >
                <td className={`${td} text-slate-400 font-semibold tabular-nums`}>{idx + 1}</td>
                <td className={td}><WhenCell iso={challan.sent_at} /></td>
                <td className={`${td} font-semibold text-slate-800`}>{challan.challan_no}</td>
                <td className={td}>Cutting store</td>
                <td className={whTdRolls}>{challan.roll_count}</td>
                <td className={whTdQty}>{formatQtyM(challan.qty, challan.uom ?? uom)}</td>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(challan.status)}`} />
                    <span className={`text-[10px] font-bold ${inboundStatusText(challan.status)}`}>
                      {storeDispatchStatusLabel(challan.status)}
                    </span>
                  </span>
                </td>
                <td className={td}><WhenCell iso={challan.received_at} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'blue' | 'green' | 'violet' | 'slate' | 'red' | 'yellow' }) {
  const shell = tone === 'blue'
    ? 'border-blue-100 bg-blue-50/70 text-blue-900'
    : tone === 'green'
      ? 'border-green-200 bg-green-50 text-green-900'
      : tone === 'yellow'
        ? 'border-yellow-200 bg-yellow-50 text-yellow-900'
        : tone === 'violet'
          ? 'border-violet-200 bg-violet-50 text-violet-900'
          : tone === 'red'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-slate-200 bg-slate-50 text-slate-900';
  return (
    <div className={`rounded-xl border px-3 py-2 ${shell}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-[13px] font-bold mt-0.5 tabular-nums">{value}</p>
      {sub ? <p className="text-[10px] mt-0.5 opacity-80">{sub}</p> : null}
    </div>
  );
}

function RollTable({
  title,
  subtitle,
  uom,
  rows,
  picked,
  onPick,
  actionLabel,
  onAction,
  busy,
}: {
  title: string;
  subtitle: string;
  uom: 'kg' | 'm';
  rows: MmV4RollRow[];
  picked: Record<string, boolean>;
  onPick: (next: Record<string, boolean>) => void;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-[11px] font-semibold text-slate-800">{title}</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <DesktopWriteGate>
          <Button type="button" size="sm" variant="secondary" disabled={busy || !Object.values(picked).some(Boolean)} onClick={onAction}>
            {actionLabel}
          </Button>
        </DesktopWriteGate>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th} />
              <th className={th}>Roll</th>
              <th className={whThQty}>Qty</th>
              <th className={th}>Stage</th>
              <th className={th}>Colour</th>
              <th className={th}>Finished</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[11px] text-slate-400">None.</td>
              </tr>
            ) : rows.map((row) => {
              const mark = finishedText(row.finished);
              const qty = uom === 'kg' ? row.weight_kg : row.length_m;
              return (
                <tr key={row.roll_id}>
                  <td className={td}>
                    <input
                      type="checkbox"
                      checked={Boolean(picked[row.roll_id])}
                      onChange={(event) => onPick({ ...picked, [row.roll_id]: event.target.checked })}
                    />
                  </td>
                  <td className={`${td} font-semibold`}>{row.roll_code}</td>
                  <td className={whTdQty}>{qty == null ? '—' : fmtUomQty(Number(qty), uom)}</td>
                  <td className={td}>{rollStageLabel(row)}</td>
                  <td className={td}>{rollColour(row)}</td>
                  <td className={td}><span className={mark.className}>{mark.text}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
