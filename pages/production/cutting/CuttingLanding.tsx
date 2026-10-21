import React, { useCallback, useEffect, useMemo, useState } from 'react';
import format from 'date-fns/format';
import { ChevronRight, ClipboardList, Package, Scissors } from 'lucide-react';
import { Button, Card } from '../../../components/ui';
import { PageShell } from '../../../components/layout/PageShell';
import { usePageHeader } from '../../../components/Breadcrumb';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import { useDepartmentsCatalog } from '../../../lib/queries/settingsSlices';
import {
  fetchDayCuttingSessionsRpc,
  type DayCuttingSessionRpcRow,
} from '../../../lib/reports/day/cuttingSessionsRpc';
import { useMmStoreChallans, useMmWarehouseStock } from '../../../modules/material/lib/useMmOps';
import { formatQtyM, formatWhen, dateTimeParts } from '../../../modules/material/lib/mmRollDraft';
import { storeDispatchStatusLabel } from '../../../modules/material/lib/inboundDisplay';
import { useFactoryModules } from '../../../core/modules/useModuleEnabled';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const tdCls = 'px-2.5 py-2 text-[11px] text-slate-700 border-b border-slate-100';

function SummaryTile({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">{value}</p>
      {hint ? <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p> : null}
    </>
  );
  if (!onClick) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 min-w-0">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 min-w-0 text-left hover:border-slate-300 hover:bg-slate-50/80 transition-colors w-full"
    >
      {body}
    </button>
  );
}

export const CuttingLanding: React.FC = () => {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const modulesQuery = useFactoryModules();
  const materialOn = Boolean(modulesQuery.data?.find((m) => m.module_key === 'material')?.enabled);
  const { departments } = useDepartmentsCatalog(factoryId, 'core');

  const today = format(new Date(), 'yyyy-MM-dd');
  const storeQuery = useMmStoreChallans('');
  const stockQuery = useMmWarehouseStock('', 'cutting', '', 1, materialOn);

  const [sessions, setSessions] = useState<DayCuttingSessionRpcRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const cuttingDeptId = useMemo(() => {
    const origin = departments.find(
      (d) => d.role === 'origin' || d.planning_mode === 'native_cutting' || d.productionPath === 'native_cutting',
    );
    return origin?.id ?? null;
  }, [departments]);

  const loadSessions = useCallback(async () => {
    if (!factoryId || !cuttingDeptId) {
      setSessions([]);
      return;
    }
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const rows = await fetchDayCuttingSessionsRpc(factoryId, cuttingDeptId, today, today);
      setSessions(rows ?? []);
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : 'Failed to load cutting sessions');
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [factoryId, cuttingDeptId, today]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const pendingInbound = useMemo(
    () => (storeQuery.data ?? []).filter((row) => row.status === 'pending' || row.status === 'partial'),
    [storeQuery.data],
  );
  const pendingPreview = pendingInbound.slice(0, 6);
  const cutQtyToday = sessions.reduce((sum, row) => sum + (Number(row.output_qty) || 0), 0);
  const stockTotal = Number(stockQuery.data?.total) || 0;

  usePageHeader({
    subtitle: 'Cutting manager view — inbound fabric, stock at cutting, and today’s sessions.',
  });

  return (
    <PageShell className="w-full pb-20 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile
          label="Pending receive"
          value={materialOn ? String(pendingInbound.length) : '—'}
          hint={materialOn ? 'Store challans not fully received' : 'Material module off'}
          onClick={materialOn ? () => requestNavigate(RoutePath.PRODUCTION_CUTTING_INBOUND) : undefined}
        />
        <SummaryTile
          label="Rolls at cutting"
          value={materialOn ? String(stockTotal) : '—'}
          hint="Issued at cutting store"
          onClick={materialOn ? () => requestNavigate(RoutePath.PRODUCTION_CUTTING_STOCK) : undefined}
        />
        <SummaryTile
          label="Sessions today"
          value={String(sessions.length)}
          hint={cuttingDeptId ? today : 'No cutting department configured'}
        />
        <SummaryTile label="Cut qty today" value={String(cutQtyToday)} hint="From floor lay sessions" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => requestNavigate(RoutePath.PRODUCTION_CUTTING_INBOUND)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50/80"
        >
          <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
            <ClipboardList size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-slate-900">Inbound challans</span>
            <span className="block text-[10px] text-slate-500">Receive warehouse store challans</span>
          </span>
          <ChevronRight size={16} className="text-slate-300 shrink-0" />
        </button>
        <button
          type="button"
          onClick={() => requestNavigate(RoutePath.PRODUCTION_CUTTING_STOCK)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50/80"
        >
          <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <Package size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-slate-900">Fabric at cutting</span>
            <span className="block text-[10px] text-slate-500">Rolls available for lays</span>
          </span>
          <ChevronRight size={16} className="text-slate-300 shrink-0" />
        </button>
        <button
          type="button"
          onClick={() => requestNavigate(RoutePath.REPORTS_DAY)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50/80"
        >
          <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
            <Scissors size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold text-slate-900">Day Report</span>
            <span className="block text-[10px] text-slate-500">Full cutting metrics and hours</span>
          </span>
          <ChevronRight size={16} className="text-slate-300 shrink-0" />
        </button>
      </div>

      {materialOn ? (
        <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-semibold text-slate-900">Pending inbound</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Store challans waiting for cutting receive</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => requestNavigate(RoutePath.PRODUCTION_CUTTING_INBOUND)}
            >
              View all
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse">
              <thead>
                <tr>
                  <th className={thCls}>When</th>
                  <th className={thCls}>Challan</th>
                  <th className={thCls}>Style</th>
                  <th className={thCls}>Fabric</th>
                  <th className={thCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {storeQuery.isLoading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[11px] text-slate-400">
                      Loading…
                    </td>
                  </tr>
                )}
                {!storeQuery.isLoading && pendingPreview.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[11px] text-slate-400">
                      Nothing pending receive.
                    </td>
                  </tr>
                )}
                {pendingPreview.map((row) => {
                  const parts = dateTimeParts(row.sent_at);
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-slate-50/80 cursor-pointer"
                      onClick={() => requestNavigate(RoutePath.PRODUCTION_CUTTING_INBOUND_DETAIL, { id: row.id })}
                    >
                      <td className={`${tdCls} tabular-nums text-slate-500`}>
                        {parts.date}
                        {parts.time ? `, ${parts.time}` : ''}
                      </td>
                      <td className={`${tdCls} font-semibold`}>{row.challan_no}</td>
                      <td className={`${tdCls} truncate`}>{row.style_name || '—'}</td>
                      <td className={`${tdCls} truncate`}>
                        {row.fabric_name || row.fabric_type || '—'}
                        <span className="block text-[10px] text-slate-400">
                          {row.roll_count} rolls · {formatQtyM(Number(row.qty ?? 0), row.uom)}
                        </span>
                      </td>
                      <td className={`${tdCls} text-[10px] font-semibold text-amber-700`}>
                        {storeDispatchStatusLabel(row.status)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[12px] font-semibold text-slate-900">Today’s cutting sessions</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Logged on the floor Lay Report. Capture stays on the floor app.
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => void loadSessions()}>
            Refresh
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] table-fixed border-collapse">
            <thead>
              <tr>
                <th className={thCls}>When</th>
                <th className={thCls}>Style</th>
                <th className={thCls}>Color</th>
                <th className={thCls}>Session / Lay</th>
                <th className={thCls}>Resource</th>
                <th className={thCls}>Fabric</th>
                <th className={`${thCls} text-right`}>Output</th>
              </tr>
            </thead>
            <tbody>
              {sessionsLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[11px] text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!sessionsLoading && sessionsError && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[11px] text-red-600">
                    {sessionsError}
                  </td>
                </tr>
              )}
              {!sessionsLoading && !sessionsError && sessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[11px] text-slate-400">
                    {cuttingDeptId
                      ? 'No cutting sessions logged today.'
                      : 'Configure an origin / cutting department to see today’s sessions.'}
                  </td>
                </tr>
              )}
              {!sessionsLoading &&
                !sessionsError &&
                sessions.map((row) => (
                  <tr key={row.id}>
                    <td className={`${tdCls} tabular-nums text-slate-500`}>
                      {formatWhen(row.started_at ?? row.log_date)}
                    </td>
                    <td className={`${tdCls} truncate`}>
                      <span className="font-medium">{row.style_name || '—'}</span>
                      {row.style_ref ? (
                        <span className="block text-[10px] text-slate-400 truncate">{row.style_ref}</span>
                      ) : null}
                    </td>
                    <td className={`${tdCls} truncate`}>{row.color_name || '—'}</td>
                    <td className={`${tdCls} truncate`}>
                      {row.session_no || row.ref_no || '—'}
                      {row.lay_no ? (
                        <span className="block text-[10px] text-slate-400">Lay {row.lay_no}</span>
                      ) : null}
                    </td>
                    <td className={`${tdCls} truncate`}>{row.resource_name || '—'}</td>
                    <td className={`${tdCls} truncate`}>{row.fabric_type || row.fabric_code || '—'}</td>
                    <td className={`${tdCls} text-right tabular-nums font-semibold`}>
                      {Number(row.output_qty) || 0}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
};
