import React, { useMemo } from 'react';
import { ArrowRight, BarChart3, Columns3, Package, type LucideIcon } from 'lucide-react';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { CatalogTablePanel } from '../../../../components/settings/CatalogTablePanel';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { formatWhen } from '../../lib/mmRollDraft';
import { MmInboundChallanTable } from '../../components/MmInboundChallanTable';
import {
  inboundFabricCategory,
  inboundStatusDot,
  inboundStatusText,
  inboundWhen,
  isInboundAwaitingReceive,
  storeDispatchStatusLabel,
} from '../../lib/inboundDisplay';
import { useMmInChallans, useMmStoreChallans, useMmWarehouseDashboard, useMmFptSummary } from '../../lib/useMmOps';

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
  quality: { shell: 'bg-rose-50 border-rose-100', label: 'text-rose-700' },
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

export default function MmWarehouseLanding() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const dashboard = useMmWarehouseDashboard();
  const millIn = useMmInChallans('mill', '');
  const vendorIn = useMmInChallans('vendor', '');
  const storeOut = useMmStoreChallans('');
  const fpt = useMmFptSummary();

  usePageHeader({
    subtitle: 'Recent warehouse movement. Stock is view-only. Rack is putaway, move, and allocate.',
  });

  const data = dashboard.data;

  const received = useMemo(() => {
    const rows = [...(millIn.data ?? []), ...(vendorIn.data ?? [])].filter(isInboundAwaitingReceive);
    return rows
      .sort((a, b) => String(inboundWhen(b) ?? '').localeCompare(String(inboundWhen(a) ?? '')))
      .slice(0, RECENT);
  }, [millIn.data, vendorIn.data]);

  const sent = useMemo(() => {
    return [...(storeOut.data ?? [])]
      .sort((a, b) => String(b.sent_at ?? '').localeCompare(String(a.sent_at ?? '')))
      .slice(0, RECENT);
  }, [storeOut.data]);

  const pageError = dashboard.error ?? millIn.error ?? vendorIn.error ?? storeOut.error;
  const pageLoading = dashboard.isLoading && !dashboard.data;

  return (
    <PageShell
      loading={pageLoading}
      error={pageError}
      onRetry={() => {
        void dashboard.refetch();
        void millIn.refetch();
        void vendorIn.refetch();
        void storeOut.refetch();
      }}
      skeleton="card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,22rem)] gap-4 items-stretch min-h-[calc(100dvh-7.25rem)]">
        <div className="flex flex-col gap-4 min-w-0">
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
              value={`${Number(data?.qty_m ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} m`}
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
              title="Received into warehouse"
              subtitle="In transit mill and vendor challans waiting to receive."
              emptyMessage="Nothing waiting to receive."
              isEmpty={received.length === 0}
              headerAction={
                received.length > 0 ? (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    Pending receive
                  </span>
                ) : undefined
              }
            >
              <MmInboundChallanTable rows={received} variant="preview" />
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
                          <span className="inline-flex items-center gap-1.5">
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

        <aside className="w-full min-h-[26rem] lg:min-h-0 lg:sticky lg:top-0 lg:self-start lg:z-10 lg:h-[calc(100dvh-7.25rem)] lg:max-h-[calc(100dvh-7.25rem)]">
          <div className="h-full rounded-2xl border border-slate-200 bg-slate-100/80 p-3 shadow-sm flex flex-col min-h-[26rem] lg:min-h-0 lg:max-h-full overflow-hidden">
            <p className="text-[11px] font-semibold text-slate-800 shrink-0 px-0.5">Quick access</p>
            <div className="mt-2.5 flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto">
              <HubGroup label="Inward" tone="inward">
                <HubLink
                  title="Expected receipts"
                  subtitle="Vs required"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_EXPECTED)}
                />
                <HubLink
                  title="Mill received"
                  subtitle={`${data?.internal_pending ?? 0} waiting`}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_INTERNAL)}
                />
                <HubLink
                  title="Vendor GRNs"
                  subtitle={`${data?.external_pending ?? 0} GRNs`}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL)}
                />
                <HubLink
                  title="Supplier returns"
                  subtitle="Red label sent back"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RETURNS)}
                />
              </HubGroup>
              <HubGroup label="Inventory" tone="inventory">
                <HubLink
                  title="Stock on hand"
                  subtitle={`${data?.rolls_in_stock ?? 0} rolls · view only`}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STOCK)}
                />
                <HubLink
                  title="Rack"
                  subtitle={`${data?.rack_count ?? 0} racks · ${data?.pending_putaway ?? 0} putaway`}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RACKS)}
                />
                <HubLink
                  title="Movements"
                  subtitle="Ledger by time"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS)}
                />
                <HubLink
                  title="End-bit returns"
                  subtitle="Remnants from cutting"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_END_BITS)}
                />
              </HubGroup>
              <HubGroup label="Planning" tone="planning">
                <HubLink
                  title="Style-wise fabrics"
                  subtitle="Per style, then each fabric"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLES)}
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
                  subtitle="Open and returned process challans"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_PROCESS)}
                />
              </HubGroup>
              <HubGroup label="Issue" tone="issue">
                <HubLink
                  title="Dispatch"
                  subtitle="To cutting"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_DISPATCH)}
                />
                <HubLink
                  title="History"
                  subtitle="Cutting challans"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE)}
                />
              </HubGroup>
              <HubGroup label="Quality" tone="quality">
                <HubLink
                  title="Testing"
                  subtitle={
                    fpt.data && fpt.data.rolls > 0 && fpt.data.failPct != null
                      ? `${data?.testing_pending ?? 0} awaiting test · ${Math.round(fpt.data.failPct)}% fail / 30d`
                      : `${data?.testing_pending ?? 0} awaiting test`
                  }
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING)}
                />
              </HubGroup>
            </div>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
