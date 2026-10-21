import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { fabricTypeCategoryLine, MmFabricSummaryCard } from '../../components/MmFabricSummaryCard';
import { fmtUomQty } from '../../lib/fabricStock';
import { finishedText, rollColour, rollStageLabel } from '../../lib/rollColour';
import {
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
  const fabricMeta = fabricTypeCategoryLine(line?.fabric_type ?? line?.fabric?.fabric_type, line?.fabric_category);

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

  usePageHeader({
    title: 'Style fabric',
    subtitle: [line?.style_name, line?.colorway_name, line?.fabric?.name].filter(Boolean).join(' · ') || 'Required, allocated, booked, issued, and uncovered.',
  }, 'Style fabric');

  const refresh = async () => {
    await lineQ.refetch();
    await rollsQ.refetch();
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
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 mb-4 items-stretch">
        <MmFabricSummaryCard
          title="Style"
          showFabric={false}
          splitColours
          data={{
            style_name: line?.style_name,
            style_ref: line?.style_ref,
            buyer_name: line?.buyer_name,
            po_number: line?.po_number,
            color_name: line?.colorway_name,
            fabric_color: line?.colour,
            fabric_name: fabricName,
            fabric_type: line?.fabric_type,
            fabric_category: line?.fabric_category,
          }}
          onStyleClick={
            line?.order_id
              ? () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId: line.order_id })
              : undefined
          }
          extraMetrics={(
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
                  <Layers size={12} className="text-slate-400" />
                  Fabric
                </p>
                <p className="text-[15px] font-bold text-slate-900 leading-tight mt-1" title={fabricName}>
                  {fabricName}
                </p>
                {fabricMeta !== '—' ? (
                  <p className="text-[12px] text-slate-500 mt-0.5 truncate" title={fabricMeta}>{fabricMeta}</p>
                ) : null}
              </div>
              <Metric label="Required" value={fmtUomQty(line?.required, uom)} tone="blue" />
            </>
          )}
        />
        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4 h-full flex flex-col">
            <DesktopWriteGate>
              <div className="flex flex-wrap justify-end gap-2 mb-3">
                <Button type="button" size="sm" onClick={openAllocate}>Allocate rolls</Button>
                <Button type="button" size="sm" variant="secondary" onClick={newReceipt}>New receipt for this style</Button>
              </div>
            </DesktopWriteGate>
            <div className="grid grid-cols-2 gap-2.5 flex-1 content-start">
              <Metric label="Allocated" value={fmtUomQty(line?.allocated, uom)} tone="green" />
              <Metric label="Booked" value={fmtUomQty(line?.booked?.qty, uom)} sub={`${line?.booked?.rolls ?? 0} rolls`} tone="violet" />
              <Metric label="Issued" value={fmtUomQty(line?.issued.qty, uom)} tone="slate" />
              <Metric
                label="Uncovered"
                value={Number(line?.uncovered) > 0 ? fmtUomQty(line?.uncovered, uom) : '—'}
                tone={Number(line?.uncovered) > 0 ? 'red' : 'slate'}
              />
            </div>
          </div>
        </Card>
      </div>

      <RollTable
        title="Booked greige"
        subtitle="Reserved for this style. The roll stays free until it is allocated."
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
          rows={rollsQ.data?.allocated ?? []}
          picked={allocPick}
          onPick={setAllocPick}
          actionLabel={busy ? 'Unallocating…' : 'Unallocate'}
          onAction={() => void unallocate()}
          busy={busy}
        />
      </div>
    </PageShell>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'blue' | 'green' | 'violet' | 'slate' | 'red' }) {
  const shell = tone === 'blue'
    ? 'border-blue-100 bg-blue-50/70 text-blue-900'
    : tone === 'green'
      ? 'border-green-200 bg-green-50 text-green-900'
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
  rows,
  picked,
  onPick,
  actionLabel,
  onAction,
  busy,
}: {
  title: string;
  subtitle: string;
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
              <th className={th}>Stage</th>
              <th className={th}>Colour</th>
              <th className={th}>Finished</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[11px] text-slate-400">None.</td>
              </tr>
            ) : rows.map((row) => {
              const mark = finishedText(row.finished);
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
