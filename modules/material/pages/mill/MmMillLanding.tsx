import React, { useMemo } from 'react';
import { ArrowRight, ClipboardList, Package, Send, type LucideIcon } from 'lucide-react';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { CatalogTablePanel } from '../../../../components/settings/CatalogTablePanel';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { formatQtyM, formatWhen } from '../../lib/mmRollDraft';
import {
  inboundFabricCategory,
  inboundStatusDot,
  inboundStatusText,
  inboundStyleDisplayName,
  inboundWhen,
  isInboundAwaitingReceive,
  inboundOpsStatusLabel,
  inboundOpsStatus,
} from '../../lib/inboundDisplay';
import { useMmInChallans, useMmMillStock, useMmStockMovements, useMmUnallocatedMill } from '../../lib/useMmOps';
import type { MmInChallanHeader, MmStockMovementRow } from '../../lib/mmRpc';
import { useFabricV4Enabled } from '../../lib/useMmV4Config';

const thCls =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-6 pr-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thRollsCls =
  'px-2 py-1.5 text-[9px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap';
const tdCls = 'px-2 py-1.5 text-[9px] text-slate-700 border-b border-slate-100';
const tdFirstCls = 'pl-6 pr-2 py-1.5 text-[9px] text-slate-700 border-b border-slate-100';
const tdRollsCls = 'px-2 py-1.5 text-center border-b border-slate-100 bg-yellow-50';

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
  blue: {
    shell: 'bg-blue-50 border-blue-100',
    iconWrap: 'bg-blue-100 text-blue-600',
    label: 'text-blue-500',
    value: 'text-slate-800',
    sub: 'text-blue-600/80',
  },
  amber: {
    shell: 'bg-amber-50 border-amber-100',
    iconWrap: 'bg-amber-100 text-amber-600',
    label: 'text-amber-600',
    value: 'text-amber-900',
    sub: 'text-amber-700/80',
  },
  green: {
    shell: 'bg-emerald-50 border-emerald-100',
    iconWrap: 'bg-emerald-100 text-emerald-600',
    label: 'text-emerald-600',
    value: 'text-emerald-900',
    sub: 'text-emerald-700/80',
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
          <p className={`text-[22px] font-bold leading-tight tabular-nums mt-0.5 ${colors.value}`}>{value}</p>
          {sub ? <p className={`text-[11px] mt-0.5 ${colors.sub}`}>{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}

const HUB_GROUPS = {
  stock: { shell: 'bg-emerald-50 border-emerald-100', label: 'text-emerald-700' },
  quality: { shell: 'bg-rose-50 border-rose-100', label: 'text-rose-700' },
  issue: { shell: 'bg-orange-50 border-orange-100', label: 'text-orange-800' },
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

const RECENT = 7;

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
  if (!row.style_material_id) return 'General PO';
  return inboundStyleDisplayName(row);
}

function allocationGroupKey(row: MmStockMovementRow): string {
  const minute = (row.txn_at ?? '').slice(0, 16);
  if (row.order_id) return `ord:${row.order_id}:${row.action}:${minute}`;
  return `free:${minute}:${row.action}:${row.unit_code}`;
}

interface AllocationGroup {
  key: string;
  when: string | null;
  rollCount: number;
  qty: number;
  uom: string | null;
  style: string;
  color: string;
  fabric: string;
  orderId: string | null;
}

function groupAllocations(rows: MmStockMovementRow[]): AllocationGroup[] {
  const map = new Map<string, AllocationGroup>();
  for (const row of rows) {
    const key = allocationGroupKey(row);
    const existing = map.get(key);
    if (existing) {
      existing.rollCount += 1;
      existing.qty += Number(row.qty) || 0;
      continue;
    }
    map.set(key, {
      key,
      when: row.txn_at,
      rollCount: 1,
      qty: Number(row.qty) || 0,
      uom: row.uom,
      style: (row.style_name || '').trim() || 'General PO',
      color: row.color_name || '—',
      fabric: row.fabric_name || '—',
      orderId: row.order_id,
    });
  }
  return [...map.values()].sort((a, b) => String(b.when ?? '').localeCompare(String(a.when ?? '')));
}

export default function MmMillLanding() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const fabricV4 = useFabricV4Enabled();
  const millIn = useMmInChallans('mill', '');
  const unallocated = useMmUnallocatedMill();
  const millStock = useMmMillStock('', '', 'at_mill', 1);
  const allocations = useMmStockMovements('', 'allocation', 1, true);

  usePageHeader({
    subtitle: 'Make mill batches, attach them to a style, or send them to the warehouse.',
  });

  const waitingFree = useMemo(
    () => (unallocated.data?.rolls ?? []).filter((row) => row.at_mill),
    [unallocated.data?.rolls],
  );
  const waitingQty = waitingFree.reduce((sum, row) => sum + (Number(row.length_m) || 0), 0);

  const inTransit = useMemo(
    () => (millIn.data ?? []).filter(isInboundAwaitingReceive),
    [millIn.data],
  );
  const inspectPending = millStock.data?.inspect_pending ?? 0;

  const sent = useMemo(
    () =>
      [...(millIn.data ?? [])]
        .sort((a, b) => String(inboundWhen(b) ?? '').localeCompare(String(inboundWhen(a) ?? '')))
        .slice(0, RECENT),
    [millIn.data],
  );

  const recentAlloc = useMemo(
    () => groupAllocations(allocations.data?.rows ?? []).slice(0, RECENT),
    [allocations.data?.rows],
  );

  const pageError = millIn.error ?? unallocated.error ?? allocations.error ?? millStock.error;
  const pageLoading = millIn.isLoading && !millIn.data && unallocated.isLoading;

  return (
    <PageShell
      loading={pageLoading}
      error={pageError}
      onRetry={() => {
        void millIn.refetch();
        void unallocated.refetch();
        void millStock.refetch();
        void allocations.refetch();
      }}
      skeleton="card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,22rem)] gap-4 items-stretch min-h-[calc(100dvh-7.25rem)]">
        <div className="flex flex-col gap-4 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MillHeroCard
              label="General PO at mill"
              value={String(waitingFree.length)}
              sub={waitingQty > 0 ? formatQtyM(waitingQty, 'm') : 'No free rolls'}
              tone="amber"
              icon={Package}
              art={(
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <RollsArt />
                </div>
              )}
            />
            <MillHeroCard
              label="In transit"
              value={String(inTransit.length)}
              sub="Challans waiting warehouse receive"
              tone="blue"
              icon={Send}
            />
            <MillHeroCard
              label="Awaiting 4-point"
              value={String(inspectPending)}
              sub="Mill rolls still at mill with no 4-point"
              tone="green"
              icon={ClipboardList}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[220px]">
            <CatalogTablePanel
              title="Recent allocations"
              subtitle="Rolls attached to a style. Open a row for fabric details."
              emptyMessage="No allocations yet. Add mill rolls on an allocated fabric, or assign from General PO."
              isEmpty={recentAlloc.length === 0}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '14%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={thFirstCls}>When</th>
                      <th className={thCls}>Style</th>
                      <th className={thCls}>Color</th>
                      <th className={thCls}>Fabric</th>
                      <th className={thRollsCls}>Rolls</th>
                      <th className={thCenterCls}>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAlloc.map((row) => (
                      <tr
                        key={row.key}
                        className="hover:bg-slate-50/80 cursor-pointer"
                        onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STYLES)}
                      >
                        <td className={`${tdFirstCls} whitespace-nowrap text-slate-600`}>{formatWhen(row.when)}</td>
                        <td className={`${tdCls} font-semibold truncate`}>{row.style}</td>
                        <td className={`${tdCls} truncate`}>{row.color}</td>
                        <td className={`${tdCls} truncate`}>{row.fabric}</td>
                        <td className={tdRollsCls}>
                          <span className="block text-[9px] font-semibold text-yellow-900 tabular-nums">{row.rollCount}</span>
                        </td>
                        <td className={`${tdCls} text-center tabular-nums font-semibold`}>{formatQtyM(row.qty, row.uom)}</td>
                      </tr>
                    ))}
                    <tr aria-hidden>
                      <td colSpan={6} className="h-10 border-0 p-0" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CatalogTablePanel>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[220px]">
            <CatalogTablePanel
              title="Dispatched to warehouse"
              subtitle="A style name means the challan belongs to that style. General PO means it does not."
              emptyMessage="Nothing dispatched to the warehouse yet."
              isEmpty={sent.length === 0}
              headerAction={
                <button
                  type="button"
                  className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_HISTORY)}
                >
                  Sent mill challans
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '10%' }} />
                  </colgroup>
                  <thead>
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
                            <span className="block text-[9px] font-semibold text-yellow-900 tabular-nums">{row.roll_count}</span>
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

        <aside className="self-stretch min-h-[26rem] lg:min-h-0">
          <div className="h-full rounded-2xl border border-slate-200 bg-slate-100/80 p-3 shadow-sm flex flex-col min-h-0 overflow-y-auto">
            <p className="text-[11px] font-semibold text-slate-800 shrink-0 px-0.5">Quick access</p>
            <div className="mt-2.5 flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto">
              <HubGroup label="Stock" tone="stock">
                {fabricV4 ? (
                  <HubLink
                    title="Mill batches"
                    subtitle="Style and general batches with custody and stages"
                    onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCHES)}
                  />
                ) : null}
                <HubLink
                  title="Allocate rolls"
                  subtitle="New batch or from mill stock, on a style fabric"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STYLES)}
                />
                <HubLink
                  title="General PO"
                  subtitle={`${waitingFree.length} waiting at mill`}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED)}
                />
                <HubLink
                  title="Mill stock"
                  subtitle="Rolls still at the mill"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STOCK)}
                />
              </HubGroup>
              <HubGroup label="Quality" tone="quality">
                {fabricV4 ? (
                  <HubLink
                    title="QC queue"
                    subtitle="Rolls at mill that still need test or inspection"
                    onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_QC)}
                  />
                ) : null}
                <HubLink
                  title="Mill testing"
                  subtitle="Test parameters and shade on a mill batch"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STOCK, { mode: 'testing' })}
                />
                <HubLink
                  title="4-point inspection"
                  subtitle="Actual length, width, cuttable width, and 4-point on a mill batch"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STOCK, { mode: 'inspection' })}
                />
              </HubGroup>
              <HubGroup label="Issue" tone="issue">
                <HubLink
                  title="Dispatch"
                  subtitle="Open fabric details to send rolls"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STYLES)}
                />
                <HubLink
                  title="Sent mill challans"
                  subtitle="Already sent to the warehouse"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_HISTORY)}
                />
              </HubGroup>
              <HubGroup label="Planning" tone="planning">
                <HubLink
                  title="Style fabrics"
                  subtitle="Required, produced, dispatched"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_STYLES)}
                />
                <HubLink
                  title="Send to process"
                  subtitle="Pick mill rolls and send them for processing"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_PROCESS)}
                />
              </HubGroup>
            </div>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
