import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BarChart3, Columns3, Package, type LucideIcon } from 'lucide-react';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { CatalogTablePanel } from '../../../../components/settings/CatalogTablePanel';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { presentMeasures } from '../../lib/fabricStock';
import { formatWhen } from '../../lib/mmRollDraft';
import {
  inboundFabricCategory,
  inboundStatusDot,
  inboundStatusText,
  storeDispatchStatusLabel,
} from '../../lib/inboundDisplay';
import { mmWhListReceipts } from '../../lib/mmV4Rpc';
import { useMmStoreChallans, useMmWarehouseDashboard, useMmFptSummary } from '../../lib/useMmOps';

const thCls =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-6 pr-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thRollsCls =
  'px-2 py-1.5 text-[9px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap';
const thQtyCls =
  'px-2 py-1.5 text-[9px] font-semibold text-green-800 uppercase tracking-wide border-b border-slate-200 bg-green-100 text-center whitespace-nowrap';
const tdCls = 'px-2 py-1.5 text-[9px] text-slate-700 border-b border-slate-100';
const tdFirstCls = 'pl-6 pr-2 py-1.5 text-[9px] text-slate-700 border-b border-slate-100';
const tdRollsCls = 'px-2 py-1.5 text-center border-b border-slate-100 bg-yellow-50';
const tdQtyCls = 'px-2 py-1.5 text-center border-b border-slate-100 bg-green-50';

function warehouseQty(data: { qty_kg?: number | null; qty_m?: number | null } | null | undefined): string {
  return presentMeasures(data?.qty_kg, data?.qty_m);
}

function RollsArt() {
  return (
    <svg viewBox="0 0 88 56" className="w-[5.25rem] h-14" aria-hidden>
      <ellipse cx="58" cy="16" rx="15" ry="10" fill="#bfdbfe" />
      <rect x="43" y="16" width="30" height="16" fill="#dbeafe" />
      <ellipse cx="58" cy="32" rx="15" ry="10" fill="#93c5fd" />
      <ellipse cx="32" cy="28" rx="17" ry="11" fill="#e0e7ff" />
      <rect x="15" y="28" width="34" height="16" fill="#eef2ff" />
      <ellipse cx="32" cy="44" rx="17" ry="11" fill="#c7d2fe" />
    </svg>
  );
}

function QtyWaveArt() {
  return (
    <svg viewBox="0 0 180 72" className="absolute inset-y-0 right-0 h-full w-[68%] pointer-events-none" preserveAspectRatio="none" aria-hidden>
      <path d="M40 72C70 52 90 58 118 38C140 22 156 18 180 8V72H40Z" fill="#bbf7d0" opacity="0.55" />
      <path d="M62 72C92 48 112 56 140 32C158 16 170 14 180 6V72H62Z" fill="#86efac" opacity="0.35" />
    </svg>
  );
}

function RacksArt() {
  return (
    <svg viewBox="0 0 64 52" className="w-14 h-12" aria-hidden>
      <rect x="8" y="6" width="6" height="40" rx="2" fill="#c4b5fd" />
      <rect x="50" y="6" width="6" height="40" rx="2" fill="#c4b5fd" />
      <rect x="8" y="10" width="48" height="5" rx="1.5" fill="#ddd6fe" />
      <rect x="8" y="24" width="48" height="5" rx="1.5" fill="#ddd6fe" />
      <rect x="8" y="38" width="48" height="5" rx="1.5" fill="#ddd6fe" />
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
  green: {
    shell: 'bg-emerald-50 border-emerald-100',
    iconWrap: 'bg-emerald-100 text-emerald-600',
    label: 'text-emerald-600',
    value: 'text-emerald-900',
    sub: 'text-emerald-700/80',
  },
  violet: {
    shell: 'bg-violet-50 border-violet-100',
    iconWrap: 'bg-violet-100 text-violet-600',
    label: 'text-violet-500',
    value: 'text-slate-800',
    sub: 'text-violet-600/80',
  },
} as const;

function WarehouseHeroCard({
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
  art: React.ReactNode;
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
  inward: { shell: 'bg-blue-50 border-blue-100', label: 'text-blue-700' },
  inventory: { shell: 'bg-emerald-50 border-emerald-100', label: 'text-emerald-700' },
  planning: { shell: 'bg-amber-50 border-amber-100', label: 'text-amber-800' },
  processing: { shell: 'bg-violet-50 border-violet-100', label: 'text-violet-700' },
  issue: { shell: 'bg-orange-50 border-orange-100', label: 'text-orange-800' },
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
  const grid = count >= 2;
  const rows = grid ? Math.ceil(count / 2) : 1;
  return (
    <div
      className={`min-w-0 min-h-0 flex flex-col rounded-lg border px-2.5 py-2 ${colors.shell}`}
      style={{ flexGrow: rows, flexShrink: 1, flexBasis: 0 }}
    >
      <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1 shrink-0 ${colors.label}`}>{label}</p>
      <div className={grid ? 'min-h-0 flex-1 grid grid-cols-2 gap-1.5 auto-rows-fr' : 'min-h-0 flex-1 flex flex-col'}>
        {nodes.map((child, index) => {
          const wide = grid && count % 2 === 1 && index === count - 1;
          if (!wide) return child;
          const el = child as React.ReactElement<{ className?: string }>;
          return React.cloneElement(el, { className: 'col-span-2 h-full' });
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
      className={`w-full h-full flex-1 flex items-center justify-between gap-1.5 rounded-md bg-transparent px-2 py-1.5 text-left hover:bg-black/[0.04] ${className ?? ''}`}
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-slate-800 leading-tight">{title}</span>
        {subtitle ? <span className="block text-[10px] text-slate-500 leading-tight truncate">{subtitle}</span> : null}
      </span>
      <ArrowRight size={12} className="text-slate-400 shrink-0" />
    </button>
  );
}

const RECENT = 7;

export default function MmWarehouseLanding() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const dashboard = useMmWarehouseDashboard();
  const receiptsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'whReceipts', 'landing'] as const,
    queryFn: async () => {
      const res = await mmWhListReceipts({ limit: RECENT });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });
  const storeOut = useMmStoreChallans('');
  const fpt = useMmFptSummary();

  usePageHeader({
    subtitle: 'Recent warehouse movement. Stock is view-only. Rack is putaway, move, and allocate.',
  });

  const data = dashboard.data;

  const received = receiptsQ.data ?? [];

  const sent = useMemo(() => {
    return [...(storeOut.data ?? [])]
      .sort((a, b) => String(b.sent_at ?? '').localeCompare(String(a.sent_at ?? '')))
      .slice(0, RECENT);
  }, [storeOut.data]);

  const pageError = dashboard.error ?? receiptsQ.error ?? storeOut.error;
  const pageLoading = dashboard.isLoading && !dashboard.data;

  return (
    <PageShell
      loading={pageLoading}
      error={pageError}
      onRetry={() => {
        void dashboard.refetch();
        void receiptsQ.refetch();
        void storeOut.refetch();
      }}
      skeleton="card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,28rem)] gap-4 items-stretch lg:h-[calc(100dvh-7.25rem)] lg:overflow-hidden">
        <div className="flex flex-col gap-4 min-w-0 lg:min-h-0 lg:overflow-y-auto minimal-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <WarehouseHeroCard
              label="Rolls in warehouse"
              value={String(data?.rolls_in_stock ?? 0)}
              tone="blue"
              icon={Package}
              art={(
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <RollsArt />
                </div>
              )}
            />
            <WarehouseHeroCard
              label="Qty"
              value={warehouseQty(data)}
              tone="green"
              icon={BarChart3}
              art={<QtyWaveArt />}
            />
            <WarehouseHeroCard
              label="On racks"
              value={String(data?.rolls_pickable ?? 0)}
              sub={`${data?.pending_putaway ?? 0} waiting putaway`}
              tone="violet"
              icon={Columns3}
              art={(
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                  <RacksArt />
                </div>
              )}
            />
          </div>
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[220px]">
            <CatalogTablePanel
              title="Recent receipts"
              subtitle="Fabric received at the warehouse gate."
              emptyMessage="No receipts yet."
              isEmpty={received.length === 0}
              headerAction={
                <button
                  type="button"
                  className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL)}
                >
                  All receipts
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '11%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={thFirstCls}>Date</th>
                      <th className={thCls}>GRN / receipt</th>
                      <th className={thCls}>Ref no</th>
                      <th className={thCls}>Source</th>
                      <th className={thCls}>Vendor</th>
                      <th className={thCls}>Fabric</th>
                      <th className={thCls}>Stage</th>
                      <th className={thRollsCls}>Rolls</th>
                      <th className={thQtyCls}>Qty</th>
                      <th className={thCenterCls}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {received.map((row) => {
                      const pending = Number(row.qc_pending ?? 0);
                      const tested = pending <= 0 && Number(row.rolls ?? 0) > 0;
                      const status = pending > 0 ? 'pending_test' : tested ? 'passed' : 'received';
                      const statusLabel = pending > 0 ? 'Not tested' : tested ? 'Tested' : 'Received';
                      const refNo = row.invoice_ref || row.party_challan_no || row.po_ref || '—';
                      return (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50/80 cursor-pointer"
                          onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIPT, { id: row.id })}
                        >
                          <td className={`${tdFirstCls} whitespace-nowrap text-slate-600`}>{formatWhen(row.received_at)}</td>
                          <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{row.grn_no || '—'}</td>
                          <td className={`${tdCls} truncate text-slate-500`}>{refNo}</td>
                          <td className={`${tdCls} truncate ${row.source === 'external' ? 'text-slate-500' : 'text-blue-700'}`}>
                            {row.source === 'process_return' ? 'Process return' : row.source === 'external' ? 'External' : 'Internal'}
                          </td>
                          <td className={`${tdCls} truncate`}>{row.from?.name || '—'}</td>
                          <td className={`${tdCls} truncate`}>{row.fabric?.name || row.fabric?.code || '—'}</td>
                          <td className={`${tdCls} truncate`}>{row.stage_code || '—'}</td>
                          <td className={tdRollsCls}>
                            <span className="block text-[9px] font-semibold text-yellow-900 tabular-nums">{row.rolls ?? 0}</span>
                          </td>
                          <td className={tdQtyCls}>
                            <span className="block text-[9px] font-semibold text-green-900 tabular-nums">
                              {row.qty ?? '—'}{row.uom ? ` ${row.uom}` : ''}
                            </span>
                          </td>
                          <td className={`${tdCls} text-center`}>
                            <span className="inline-flex items-center justify-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(status)}`} />
                              <span className={`text-[9px] font-bold ${inboundStatusText(status)}`}>{statusLabel}</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    <tr aria-hidden>
                      <td colSpan={10} className="h-10 border-0 p-0" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CatalogTablePanel>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[220px]">
            <CatalogTablePanel
              title="Dispatched to cutting store"
              subtitle="Recent warehouse to cutting challans. Open a row for the full challan."
              emptyMessage="Nothing dispatched to cutting yet."
              isEmpty={sent.length === 0}
              headerAction={
                <button
                  type="button"
                  className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE)}
                >
                  Open history
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '9%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={thFirstCls}>Date</th>
                      <th className={thCls}>Challan</th>
                      <th className={thCls}>Challan ref</th>
                      <th className={thCls}>Style</th>
                      <th className={thCls}>Style ref</th>
                      <th className={thCls}>Fabric</th>
                      <th className={thCls}>Category</th>
                      <th className={thRollsCls}>Rolls</th>
                      <th className={thCenterCls}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sent.map((row) => (
                      <tr
                        key={row.id}
                        className="hover:bg-slate-50/80 cursor-pointer"
                        onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL, { id: row.id })}
                      >
                        <td className={`${tdFirstCls} whitespace-nowrap text-slate-600`}>{formatWhen(row.sent_at)}</td>
                        <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{row.challan_no}</td>
                        <td className={`${tdCls} truncate text-slate-500`}>{row.reference_no || '—'}</td>
                        <td className={`${tdCls} font-medium text-slate-800 truncate`}>{row.style_name}</td>
                        <td className={`${tdCls} truncate text-slate-500`}>{row.style_ref || '—'}</td>
                        <td className={`${tdCls} truncate`}>{row.fabric_name || row.fabric_type || '—'}</td>
                        <td className={`${tdCls} truncate`}>{inboundFabricCategory(row)}</td>
                        <td className={tdRollsCls}>
                          <span className="block text-[9px] font-semibold text-yellow-900 tabular-nums">
                            {row.roll_count}
                          </span>
                        </td>
                        <td className={`${tdCls} text-center`}>
                          <span className="inline-flex items-center justify-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${inboundStatusDot(row.status)}`} />
                            <span className={`text-[9px] font-bold ${inboundStatusText(row.status)}`}>
                              {storeDispatchStatusLabel(row.status)}
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                    <tr aria-hidden>
                      <td colSpan={9} className="h-10 border-0 p-0" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </CatalogTablePanel>
          </div>
        </div>

        <aside className="w-full min-h-[26rem] lg:min-h-0 lg:h-full lg:sticky lg:top-0">
          <div className="h-full rounded-2xl border border-slate-200 bg-slate-100/80 p-3 shadow-sm flex flex-col min-h-[26rem] lg:min-h-0">
            <p className="text-xs font-semibold text-slate-800 shrink-0 px-0.5">Quick access</p>
            <div className="mt-2 flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
              <HubGroup label="Receive" tone="inward">
                <HubLink
                  title="GRNs"
                  subtitle="Vendor receipts"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL)}
                />
                <HubLink
                  title="Internal receipts"
                  subtitle="From In-house"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_INTERNAL)}
                />
                <HubLink
                  title="Process returns"
                  subtitle="Rolls back from processing"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS_RETURNS)}
                />
                <HubLink
                  title="Receive fabric"
                  subtitle="Backup — normally done on mobile"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIVE)}
                />
                <HubLink
                  title="Expected receipts"
                  subtitle="Still due on each line"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_EXPECTED)}
                />
              </HubGroup>
              <HubGroup label="Quality" tone="planning">
                <HubLink
                  title="Testing"
                  subtitle={
                    fpt.data && fpt.data.rolls > 0 && fpt.data.failPct != null
                      ? `${data?.testing_pending ?? 0} awaiting · ${Math.round(fpt.data.failPct)}% fail / 30d`
                      : `${data?.testing_pending ?? 0} awaiting test`
                  }
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING)}
                />
                <HubLink
                  title="QC queue"
                  subtitle="Receipts and returned challans"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_QC)}
                />
              </HubGroup>
              <HubGroup label="Stock" tone="inventory">
                <HubLink
                  title="Stock view"
                  subtitle={`${data?.rolls_in_stock ?? 0} rolls`}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_FABRICS)}
                />
                <HubLink
                  title="Racks"
                  subtitle={`${data?.rack_count ?? 0} racks · ${data?.pending_putaway ?? 0} putaway`}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RACKS)}
                />
                <HubLink
                  title="Movements"
                  subtitle="Ledger by time"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS)}
                />
              </HubGroup>
              <HubGroup label="Styles" tone="planning">
                <HubLink
                  title="Style-wise fabric"
                  subtitle="Status before dispatch"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLES)}
                />
                <HubLink
                  title="Allocations"
                  subtitle="Numbered allocation notes"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ALLOCATIONS)}
                />
              </HubGroup>
              <HubGroup label="Processing" tone="processing">
                <HubLink
                  title="Send to processing"
                  subtitle="Create process challan"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND)}
                />
                <HubLink
                  title="Process history"
                  subtitle="Warehouse challans"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS)}
                />
              </HubGroup>
              <HubGroup label="Dispatch to cutting" tone="issue">
                <HubLink
                  title="Dispatch"
                  subtitle="To cutting"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_DISPATCH)}
                />
                <HubLink
                  title="Dispatch history"
                  subtitle="Cutting challans"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE)}
                />
              </HubGroup>
              <HubGroup label="Returns" tone="inward">
                <HubLink
                  title="Supplier returns"
                  subtitle={`${data?.red_label_count ?? 0} red label`}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RETURNS)}
                />
                <HubLink
                  title="End-bits"
                  subtitle="Remnants from cutting"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_END_BITS)}
                />
              </HubGroup>
            </div>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
