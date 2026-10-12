import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Package, Send, type LucideIcon } from 'lucide-react';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { CatalogTablePanel } from '../../../../components/settings/CatalogTablePanel';
import { Badge } from '../../../../components/ui';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { fmtNum, fmtUomQty } from '../../lib/fabricStock';
import { formatWhen, millDateLabel } from '../../lib/mmRollDraft';
import { unitFormCountText } from '../../lib/mmUnitForm';
import {
  inboundFabricCategory,
  inboundStatusDot,
  inboundStatusText,
  inboundStyleDisplayName,
  inboundWhen,
  inboundOpsStatusLabel,
  inboundOpsStatus,
} from '../../lib/inboundDisplay';
import { useMmInChallans } from '../../lib/useMmOps';
import type { MmInChallanHeader } from '../../lib/mmRpc';
import {
  mmMillListBatchesV4,
  mmProcListChallans,
  type MmV4CustodyBucket,
  type MmV4FabricStage,
  type MmV4MillBatchListRow,
  type MmV4ProcChallanListRow,
} from '../../lib/mmV4Rpc';
import { useMmV4Config } from '../../lib/useMmV4Config';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thRollsCls = thCenterCls;
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdRollsCls = 'px-2.5 py-2.5 text-center border-b border-slate-100 max-w-0 overflow-hidden';

const RECENT_BATCHES = 8;
const RECENT_SENT = 7;

type SideSum = { kg: number; m: number; other: number; roll: number; lap: number; pieces: number };

function emptySum(): SideSum {
  return { kg: 0, m: 0, other: 0, roll: 0, lap: 0, pieces: 0 };
}

function addBucket(sum: SideSum, row: MmV4MillBatchListRow, bucket: MmV4CustodyBucket | undefined) {
  const uom = String(row.fabric_uom ?? '').trim().toLowerCase();
  const qty = Number(bucket?.qty ?? 0);
  if (uom === 'kg') sum.kg += qty;
  else if (uom === 'm') sum.m += qty;
  else sum.other += qty;
  sum.roll += Number(bucket?.rolls ?? 0);
  sum.lap += Number(bucket?.laps ?? 0);
  sum.pieces += Number(bucket?.pieces ?? 0);
}

function qtyLabel(sum: SideSum): string {
  const parts: string[] = [];
  if (sum.kg > 0) parts.push(fmtUomQty(sum.kg, 'kg'));
  if (sum.m > 0) parts.push(fmtUomQty(sum.m, 'm'));
  if (sum.other > 0) parts.push(fmtNum(sum.other));
  return parts.length > 0 ? parts.join(' · ') : '0';
}

function countLabel(sum: SideSum): string {
  const text = unitFormCountText({ roll: sum.roll, lap: sum.lap, pieces: sum.pieces });
  return text === '—' ? '0' : text;
}

function rowTotals(row: MmV4MillBatchListRow): SideSum {
  const sum = emptySum();
  addBucket(sum, row, row.buckets?.at_mill);
  addBucket(sum, row, row.buckets?.at_process);
  addBucket(sum, row, row.buckets?.dispatched);
  return sum;
}

function batchStageLabel(row: MmV4MillBatchListRow, catalog: MmV4FabricStage[]): string {
  const code = String(row.initial_stage_code ?? '').trim();
  if (code) return catalog.find((stage) => stage.code === code)?.label || code;
  const live = Object.entries(row.stages ?? {}).find(([, n]) => Number(n) > 0);
  if (!live) return '—';
  return catalog.find((stage) => stage.code === live[0])?.label || live[0];
}

function batchPlace(row: MmV4MillBatchListRow): { label: string; dot: string; text: string } {
  const mill = Number(row.buckets?.at_mill?.rolls ?? 0) + Number(row.buckets?.at_mill?.laps ?? 0) + Number(row.buckets?.at_mill?.pieces ?? 0);
  const processing = Number(row.buckets?.at_process?.rolls ?? 0) + Number(row.buckets?.at_process?.laps ?? 0) + Number(row.buckets?.at_process?.pieces ?? 0);
  const dispatched = Number(row.buckets?.dispatched?.rolls ?? 0) + Number(row.buckets?.dispatched?.laps ?? 0) + Number(row.buckets?.dispatched?.pieces ?? 0);
  const places = [mill > 0, processing > 0, dispatched > 0].filter(Boolean).length;
  if (mill + processing + dispatched <= 0) return { label: 'Pending', dot: 'bg-slate-300', text: 'text-slate-500' };
  if (places > 1) return { label: 'Partial', dot: 'bg-amber-500', text: 'text-amber-700' };
  if (processing > 0) return { label: 'Processing', dot: 'bg-amber-500', text: 'text-amber-800' };
  if (dispatched > 0) return { label: 'Dispatched', dot: 'bg-emerald-500', text: 'text-emerald-700' };
  return { label: 'At mill', dot: 'bg-yellow-500', text: 'text-yellow-800' };
}

function processName(value: MmV4ProcChallanListRow['process_type']): string {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  return value.name || '—';
}

function outQtyText(row: MmV4ProcChallanListRow): string {
  const qty = Number(row.counts?.qty_out ?? 0);
  const kg = Number(row.counts?.kg_out ?? 0);
  if (qty <= 0 && kg <= 0) return '—';
  if (qty > 0 && kg > 0) return `${fmtNum(qty)} · ${fmtUomQty(kg, 'kg')}`;
  if (kg > 0) return fmtUomQty(kg, 'kg');
  return fmtNum(qty);
}

function RollsArt() {
  return (
    <svg viewBox="0 0 88 56" className="w-[5.25rem] h-14" aria-hidden>
      <ellipse cx="58" cy="16" rx="15" ry="10" fill="#fde68a" />
      <rect x="43" y="16" width="30" height="16" fill="#fef3c7" />
      <ellipse cx="58" cy="32" rx="15" ry="10" fill="#fcd34d" />
      <ellipse cx="32" cy="28" rx="17" ry="11" fill="#ffedd5" />
      <rect x="15" y="28" width="34" height="16" fill="#fff7ed" />
      <ellipse cx="32" cy="44" rx="17" ry="11" fill="#fed7aa" />
    </svg>
  );
}

const HERO_TONES = {
  yellow: {
    shell: 'bg-yellow-50 border-yellow-100',
    iconWrap: 'bg-yellow-100 text-yellow-800',
    label: 'text-yellow-800',
    value: 'text-yellow-900',
    sub: 'text-yellow-800/80',
  },
  blue: {
    shell: 'bg-blue-50 border-blue-100',
    iconWrap: 'bg-blue-100 text-blue-700',
    label: 'text-blue-700',
    value: 'text-blue-900',
    sub: 'text-blue-700/80',
  },
  neutral: {
    shell: 'bg-slate-50 border-slate-200',
    iconWrap: 'bg-slate-200 text-slate-600',
    label: 'text-slate-500',
    value: 'text-slate-800',
    sub: 'text-slate-500',
  },
} as const;

function MillHeroCard({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  art,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: keyof typeof HERO_TONES;
  icon: LucideIcon;
  art?: React.ReactNode;
}) {
  const colors = HERO_TONES[tone];
  return (
    <div className={`relative overflow-hidden rounded-2xl border px-4 py-3.5 min-h-[5.5rem] shadow-sm ${colors.shell}`}>
      {art}
      <div className="relative z-10 flex items-start gap-2.5 min-w-0 pr-16">
        <span className={`mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${colors.iconWrap}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${colors.label}`}>{label}</p>
          <p className={`text-[22px] font-bold leading-tight tabular-nums mt-0.5 ${colors.value}`} title={value}>{value}</p>
          {sub ? <p className={`text-[11px] mt-0.5 ${colors.sub}`}>{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

const HUB_GROUPS = {
  produce: { shell: 'bg-amber-50 border-amber-100', label: 'text-amber-800' },
  process: { shell: 'bg-violet-50 border-violet-100', label: 'text-violet-700' },
  quality: { shell: 'bg-rose-50 border-rose-100', label: 'text-rose-700' },
  stock: { shell: 'bg-emerald-50 border-emerald-100', label: 'text-emerald-700' },
  dispatch: { shell: 'bg-orange-50 border-orange-100', label: 'text-orange-800' },
  planning: { shell: 'bg-amber-50 border-amber-100', label: 'text-amber-800' },
} as const;

function HubGroup({
  label,
  tone,
  children,
}: {
  label: string;
  tone: keyof typeof HUB_GROUPS;
  children: React.ReactNode;
}) {
  const colors = HUB_GROUPS[tone];
  const nodes = React.Children.toArray(children).filter(React.isValidElement);
  const count = nodes.length;
  const grid = count > 2;
  return (
    <div
      className={`min-w-0 rounded-xl border px-2 py-2 flex flex-col min-h-min ${colors.shell}`}
      style={{ flexGrow: Math.max(count, 1), flexShrink: 0, flexBasis: 'auto' }}
    >
      <p className={`text-[10px] font-semibold uppercase tracking-wide px-1 mb-1.5 shrink-0 ${colors.label}`}>{label}</p>
      <div className={grid ? 'grid grid-cols-2 gap-x-1 gap-y-0.5 content-start' : 'flex flex-col space-y-0.5'}>
        {nodes.map((child, index) => {
          const wide = grid && count % 2 === 1 && index === count - 1;
          if (!wide) return child;
          const el = child as React.ReactElement<{ className?: string }>;
          return React.cloneElement(el, { className: 'col-span-2' });
        })}
      </div>
    </div>
  );
}

function HubLink({
  title,
  subtitle,
  onClick,
  className,
}: {
  title: string;
  subtitle?: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`w-full flex items-center justify-between gap-1.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-white/80 ${className ?? ''}`}
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-slate-800 truncate">{title}</span>
        {subtitle ? <span className="block text-[10px] text-slate-600/80 leading-snug">{subtitle}</span> : null}
      </span>
      <ArrowRight size={12} className="text-slate-400 shrink-0" />
    </button>
  );
}

function openMillChallan(
  row: MmInChallanHeader,
  navigate: (route: RoutePath, params?: Record<string, string>) => boolean,
) {
  if (row.order_id && row.colorway_id && row.fabric_line_id) {
    navigate(RoutePath.MATERIAL_MILL_CHALLAN, {
      orderId: row.order_id,
      colorwayId: row.colorway_id,
      fabricLineId: row.fabric_line_id,
      id: row.id,
    });
    return;
  }
  navigate(RoutePath.MATERIAL_WAREHOUSE_ROLL, { kind: 'mill', id: row.id });
}

function millStyleCell(row: Pick<MmInChallanHeader, 'style_name' | 'style_material_id'>): string {
  if (!row.style_material_id) return 'General';
  return inboundStyleDisplayName(row);
}

function queryError(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

export default function MmMillLanding() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { data: config } = useMmV4Config();
  const stages = config?.stages ?? [];

  const batchesQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchesV4', ''] as const,
    queryFn: async () => {
      const res = await mmMillListBatchesV4({});
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });
  const challansQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'procChallans', 'mill', 'pending'] as const,
    queryFn: async () => {
      const res = await mmProcListChallans({ side: 'mill', status: 'pending' });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });
  const millIn = useMmInChallans('mill', '');

  usePageHeader({
    subtitle: 'Produce greige, send it to processing, and dispatch. Test and inspect on the challan.',
  });

  const atMill = useMemo(() => {
    const sum = emptySum();
    for (const row of batchesQ.data ?? []) addBucket(sum, row, row.buckets?.at_mill);
    return sum;
  }, [batchesQ.data]);
  const atProcess = useMemo(() => {
    const sum = emptySum();
    for (const row of batchesQ.data ?? []) addBucket(sum, row, row.buckets?.at_process);
    return sum;
  }, [batchesQ.data]);
  const recentBatches = useMemo(
    () => [...(batchesQ.data ?? [])]
      .sort((a, b) => String(b.production_date ?? '').localeCompare(String(a.production_date ?? '')))
      .slice(0, RECENT_BATCHES),
    [batchesQ.data],
  );
  const openChallans = challansQ.data ?? [];
  const openCount = openChallans.length;

  const sent = useMemo(
    () =>
      [...(millIn.data ?? [])]
        .sort((a, b) => String(inboundWhen(b) ?? '').localeCompare(String(inboundWhen(a) ?? '')))
        .slice(0, RECENT_SENT),
    [millIn.data],
  );

  const pageError = queryError(batchesQ.error) ?? queryError(challansQ.error) ?? millIn.error ?? null;
  const pageLoading =
    (batchesQ.isLoading && batchesQ.data === undefined)
    || (challansQ.isLoading && challansQ.data === undefined)
    || (millIn.isLoading && !millIn.data);

  return (
    <PageShell
      loading={pageLoading}
      error={pageError}
      onRetry={() => {
        void batchesQ.refetch();
        void challansQ.refetch();
        void millIn.refetch();
      }}
      skeleton="card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,22rem)] gap-4 items-stretch min-h-[calc(100dvh-7.25rem)]">
        <div className="flex flex-col gap-4 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MillHeroCard
              label="At mill"
              value={qtyLabel(atMill)}
              sub={countLabel(atMill)}
              tone="yellow"
              icon={Package}
              art={(
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <RollsArt />
                </div>
              )}
            />
            <MillHeroCard
              label="At processing"
              value={qtyLabel(atProcess)}
              sub={`${countLabel(atProcess)} · ${openCount} open`}
              tone="blue"
              icon={Send}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[180px]">
            <CatalogTablePanel
              title="Recent batches"
              subtitle="Latest mill batches. Open a row for the rolls."
              emptyMessage="No batches yet."
              isEmpty={recentBatches.length === 0}
            >
              <div className="overflow-x-auto">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '9%' }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={thFirstCls}>Date</th>
                      <th className={thCls}>Batch no</th>
                      <th className={thCls}>Mill ref</th>
                      <th className={thCls}>Fabric</th>
                      <th className={thCls}>Stage</th>
                      <th className="px-2.5 py-2 text-[10px] font-semibold text-indigo-800 uppercase tracking-wide border-b border-indigo-100 bg-indigo-50 text-left whitespace-nowrap overflow-hidden">Qty</th>
                      <th className={thRollsCls}>Rolls / laps</th>
                      <th className={thCenterCls}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBatches.map((row) => {
                      const totals = rowTotals(row);
                      const place = batchPlace(row);
                      return (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50/80 cursor-pointer"
                          onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCH_DETAIL, { batchId: row.id })}
                        >
                          <td className={`${tdFirstCls} whitespace-nowrap text-slate-600 truncate`}>{millDateLabel(row.production_date)}</td>
                          <td className={`${tdCls} font-semibold truncate`}>{row.batch_no || '—'}</td>
                          <td className={`${tdCls} truncate`}>{row.mill_ref || '—'}</td>
                          <td className={`${tdCls} truncate`}>{row.fabric_name || row.fabric_type_name || '—'}</td>
                          <td className={`${tdCls} truncate`}>{batchStageLabel(row, stages)}</td>
                          <td className="px-2.5 py-2.5 text-[11px] font-semibold text-indigo-900 border-b border-indigo-50 bg-indigo-50/80 max-w-0 overflow-hidden truncate tabular-nums">
                            {qtyLabel(totals)}
                          </td>
                          <td className={tdRollsCls}>
                            <span className="block text-[11px] font-semibold text-yellow-800 tabular-nums truncate">{countLabel(totals)}</span>
                          </td>
                          <td className={tdCls}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${place.dot}`} />
                              <span className={`text-[9px] font-bold truncate ${place.text}`}>{place.label}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    <tr aria-hidden>
                      <td colSpan={8} className="h-10 border-0 p-0" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CatalogTablePanel>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[180px]">
            <CatalogTablePanel
              title="Open process challans"
              subtitle="Sent from the mill and not yet closed."
              emptyMessage="No open process challans."
              isEmpty={openChallans.length === 0}
            >
              <div className="overflow-x-auto">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '22%' }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={thFirstCls}>Challan</th>
                      <th className={thCls}>Process</th>
                      <th className={thCls}>Unit</th>
                      <th className={thCls}>Out qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openChallans.map((row) => (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/80 cursor-pointer"
                        onClick={() => requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: row.id })}
                      >
                        <td className={`${tdFirstCls} font-semibold text-slate-800 truncate`}>{row.challan_no}</td>
                        <td className={`${tdCls} truncate`}>{processName(row.process_type)}</td>
                        <td className={tdCls}>
                          <span className="inline-flex items-center gap-1 min-w-0">
                            <span className="truncate">{row.unit?.name || '—'}</span>
                            {row.unit?.ownership ? (
                              <Badge variant="outline" className="px-1.5 py-0 text-[9px] shrink-0">
                                {row.unit.ownership === 'external' ? 'External' : 'In-house'}
                              </Badge>
                            ) : null}
                          </span>
                        </td>
                        <td className={`${tdCls} tabular-nums font-semibold`}>{outQtyText(row)}</td>
                      </tr>
                    ))}
                    <tr aria-hidden>
                      <td colSpan={4} className="h-10 border-0 p-0" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CatalogTablePanel>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[220px]">
            <CatalogTablePanel
              title="Dispatched to warehouse"
              subtitle="Challans already sent to the warehouse."
              emptyMessage="Nothing dispatched to the warehouse yet."
              isEmpty={sent.length === 0}
              headerAction={
                <button
                  type="button"
                  className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_HISTORY)}
                >
                  View all
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '10%' }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={thFirstCls}>When</th>
                      <th className={thCls}>Challan</th>
                      <th className={thCls}>Style</th>
                      <th className={thCls}>Color</th>
                      <th className={thCls}>Fabric</th>
                      <th className={thRollsCls}>Rolls</th>
                      <th className={thCenterCls}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sent.map((row) => {
                      const ops = inboundOpsStatus(row);
                      return (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50/80 cursor-pointer"
                          onClick={() => openMillChallan(row, requestNavigate)}
                        >
                          <td className={`${tdFirstCls} whitespace-nowrap text-slate-600`}>{formatWhen(inboundWhen(row))}</td>
                          <td className={`${tdCls} font-semibold truncate`}>{row.challan_no}</td>
                          <td className={`${tdCls} truncate`}>{millStyleCell(row)}</td>
                          <td className={`${tdCls} truncate`}>{row.color_name || '—'}</td>
                          <td className={tdCls}>
                            <span className="block truncate">{row.fabric_name || row.fabric_type || '—'}</span>
                            <span className="block text-[8px] text-slate-400 truncate">{inboundFabricCategory(row)}</span>
                          </td>
                          <td className={tdRollsCls}>
                            <span className="block text-[11px] font-semibold text-yellow-800 tabular-nums">{row.roll_count}</span>
                          </td>
                          <td className={tdCls}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(ops)}`} />
                              <span className={`text-[9px] font-bold ${inboundStatusText(ops)}`}>
                                {inboundOpsStatusLabel(ops)}
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    <tr aria-hidden>
                      <td colSpan={7} className="h-10 border-0 p-0" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CatalogTablePanel>
          </div>
        </div>

        <aside className="w-full min-h-[26rem] lg:min-h-0 lg:sticky lg:top-0 lg:self-start lg:z-10 lg:h-[calc(100dvh-7.25rem)] lg:max-h-[calc(100dvh-7.25rem)]">
          <div className="h-full rounded-2xl border border-slate-200 bg-slate-100/80 p-3 shadow-sm flex flex-col min-h-[26rem] lg:min-h-0 lg:max-h-full overflow-hidden">
            <p className="text-[11px] font-semibold text-slate-800 shrink-0 px-0.5">Quick access</p>
            <div className="mt-2.5 flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto">
              <HubGroup label="Produce" tone="produce">
                <HubLink
                  title="Mill batches"
                  subtitle="Date, fabric, stage, and custody"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCHES)}
                />
                <HubLink
                  title="New batch"
                  subtitle="Produce rolls at the mill"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCH_NEW)}
                />
              </HubGroup>
              <HubGroup label="Process" tone="process">
                <HubLink
                  title="Processing"
                  subtitle="Open and returned challans"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_PROCESS, { side: 'mill' })}
                />
                <HubLink
                  title="Send to processing"
                  subtitle="Create a process challan"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_PROCESS_SEND)}
                />
              </HubGroup>
              <HubGroup label="Stock" tone="stock">
                <HubLink
                  title="Mill stock"
                  subtitle="Rolls still at the mill"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STOCK)}
                />
                <HubLink
                  title="Allocate rolls"
                  subtitle="Pick a style fabric, then allocate"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STYLES, { only_short: '1' })}
                />
              </HubGroup>
              <HubGroup label="Dispatch" tone="dispatch">
                <HubLink
                  title="Sent"
                  subtitle="Challans already sent to the warehouse"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_HISTORY)}
                />
              </HubGroup>
              <HubGroup label="Planning" tone="planning">
                <HubLink
                  title="Style fabrics"
                  subtitle="Required, allocated, short per style"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STYLES)}
                />
              </HubGroup>
            </div>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
