import React, { useMemo } from 'react';
import { BarChart3, Shirt, Package, Users, TrendingUp, Clock } from 'lucide-react';
import { useNavigationStore } from '../../stores';
import { RoutePath } from '../../types';
import { PageShell } from '../../components/layout/PageShell';
import { useReportMeta, useReportOrdersPage } from '../../lib/queries/reports';
import { useActiveOrderCount } from '../../lib/queries/factoryOrders';

const CARDS = [
  {
    route: RoutePath.REPORTS_DAY,
    title: 'Day Report',
    subtitle: 'Department hourly output, handovers, and KPIs by date range',
    icon: BarChart3,
  },
  {
    route: RoutePath.REPORTS_STYLE,
    title: 'Style Report',
    subtitle: 'Full lifecycle and daily charts per colorway',
    icon: Shirt,
  },
] as const;

export const ReportsLanding: React.FC = () => {
  const navigate = useNavigationStore((s) => s.navigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const metaQuery = useReportMeta(factoryId);
  const meta = metaQuery.data;
  const activeCountQuery = useActiveOrderCount(factoryId, Boolean(factoryId));
  const recentOrdersQuery = useReportOrdersPage(
    factoryId,
    { limit: 5, offset: 0 },
    Boolean(factoryId),
  );

  const stats = useMemo(() => {
    const orders = recentOrdersQuery.data?.orders ?? [];
    const totalOrders = activeCountQuery.data ?? recentOrdersQuery.data?.total ?? 0;
    const activeBuyers = meta?.buyers.length ?? 0;
    const recent = orders;
    return { totalOrders, activeBuyers, recent, catalogTotal: recentOrdersQuery.data?.total ?? 0 };
  }, [meta, activeCountQuery.data, recentOrdersQuery.data]);

  return (
    <PageShell className="pb-20 space-y-6">
      <div>
        <h1 className="text-base font-bold text-slate-900">Reports</h1>
        <p className="text-xs text-slate-500 mt-0.5">Overview of production performance and style lifecycle</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Package size={16} strokeWidth={1.75} />
            </div>
            <span className="text-xs font-medium text-slate-500">Total orders</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.totalOrders.toLocaleString()}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp size={16} strokeWidth={1.75} />
            </div>
            <span className="text-xs font-medium text-slate-500">Styles in catalog</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.catalogTotal.toLocaleString()}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
              <Users size={16} strokeWidth={1.75} />
            </div>
            <span className="text-xs font-medium text-slate-500">Active buyers</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.activeBuyers.toLocaleString()}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock size={16} strokeWidth={1.75} />
            </div>
            <span className="text-xs font-medium text-slate-500">Report catalog</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats.recent.length > 0 ? 'Ready' : '—'}</div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(({ route, title, subtitle, icon: Icon }) => (
          <button
            key={route}
            type="button"
            onClick={() => navigate(route)}
            className="text-left bg-white border border-slate-200 rounded-2xl shadow-sm p-6 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center mb-4">
              <Icon size={20} strokeWidth={1.75} />
            </div>
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
          </button>
        ))}
      </div>

      {stats.recent.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Recent styles</h3>
          <ul className="divide-y divide-slate-100">
            {stats.recent.map((o) => (
              <li key={o.id} className="py-2 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">
                  {o.styleName} <span className="text-slate-400">({o.poNumber})</span>
                </span>
                <span className="text-slate-500">{o.buyerName}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageShell>
  );
};
