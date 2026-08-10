import React, { useCallback, useEffect, useMemo, useState } from "react";
import format from "date-fns/format";
import startOfMonth from "date-fns/startOfMonth";
import endOfMonth from "date-fns/endOfMonth";
import { Search, Download } from "lucide-react";
import { useNavigationStore } from "../stores";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useActiveOrderCount, useOrdersEnrichedPage } from "../lib/queries/factoryOrders";
import { useBuyersCatalog } from "../lib/queries/settingsSlices";
import { PageShell, PageToolbarCard } from "../components/layout/PageShell";
import { RoutePath } from "../types";
import {
  Activity,
  Calendar,
  Gauge,
  PackageCheck,
  Ship,
  Target,
  TrendingUp,
} from "lucide-react";
import { SelectDropdown, CardSkeleton, ListSkeleton, Skeleton } from "../components/ui";
import { DateRangePicker, DateRangeValue } from "../components/DateRangePicker";
import { fetchCutToShipReport, fetchFactoryKpis } from "../lib/reports";
import { downloadCsv } from "../lib/csvExport";
import { buildColorwayCutShipItems, matchesColorwaySearch } from "../lib/cutToShipList";
import {
  aggregateFulfillmentKpis,
  buildFulfillmentSnapshot,
  formatFulfillmentPct,
} from "../lib/fulfillmentMetrics";
import { activeShipmentDeliveryDates, primaryShipmentDate } from "../lib/orderShipmentPlan";
import {
  aggregateByDay,
  isOrderInProduction,
  wipForLatestDay,
} from "../lib/dashboardData";
import { DailyTrendChart, EfficiencyLineChart } from "../components/reports/ReportCharts";

const KPICard: React.FC<{
  title: string;
  value: string;
  subtext: string;
  icon: React.ElementType;
  accent: string;
  iconAccent: string;
  onClick?: () => void;
}> = ({ title, value, subtext, icon: Icon, accent, iconAccent, onClick }) => {
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={`relative bg-white border border-slate-200 rounded-xl shadow-sm min-h-[92px] overflow-hidden flex flex-col justify-center px-4 py-3 transition-shadow ${
        clickable
          ? 'cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500'
          : ''
      }`}
    >
      <Icon
        className={`absolute -right-2 -bottom-2 w-16 h-16 opacity-[0.1] pointer-events-none ${iconAccent}`}
        strokeWidth={1.25}
      />
      <div className="relative z-10">
        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{title}</div>
        <div className={`text-xl font-bold tracking-tight ${accent}`}>{value}</div>
        <div className="text-[10px] text-slate-500 mt-0.5">{subtext}</div>
      </div>
    </div>
  );
};

function toYmd(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const DashboardSkeleton: React.FC = () => (
  <div className="space-y-4">
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
      <CardSkeleton count={6} />
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Skeleton variant="rectangular" className="h-[280px]" />
      <Skeleton variant="rectangular" className="h-[280px]" />
    </div>
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <Skeleton className="h-4 w-48 mb-3" />
      <ListSkeleton rows={4} />
    </div>
  </div>
);

export const Dashboard: React.FC = () => {
  const { navigate, factoryId } = useNavigationStore();
  const { buyers, loading: settingsLoading } = useBuyersCatalog(factoryId, 'core');
  const activeOrderCountQuery = useActiveOrderCount(factoryId, Boolean(factoryId));

  const today = new Date();
  const [dateRange, setDateRange] = useState<DateRangeValue>({
    startDate: startOfMonth(today).toISOString(),
    endDate: endOfMonth(today).toISOString(),
  });
  const [buyerFilter, setBuyerFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [cutRows, setCutRows] = useState<Awaited<ReturnType<typeof fetchCutToShipReport>>>([]);
  const [kpiRows, setKpiRows] = useState<Awaited<ReturnType<typeof fetchFactoryKpis>>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const handleToday = useCallback(() => {
    const iso = new Date().toISOString();
    setDateRange({ startDate: iso, endDate: iso });
  }, []);

  const dateFrom = toYmd(dateRange.startDate);
  const dateTo = toYmd(dateRange.endDate);

  const loadDashboard = useCallback(async () => {
    if (!factoryId) {
      setCutRows([]);
      setKpiRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [cut, kpis] = await Promise.all([
        fetchCutToShipReport(factoryId, { buyerId: buyerFilter || null }),
        fetchFactoryKpis(factoryId, dateFrom, dateTo),
      ]);
      setCutRows(cut);
      setKpiRows(kpis);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load dashboard");
      setCutRows([]);
      setKpiRows([]);
    } finally {
      setLoading(false);
    }
  }, [factoryId, buyerFilter, dateFrom, dateTo]);

  const cutOrderIds = useMemo(
    () => [...new Set(cutRows.map((r) => r.order_id).filter(Boolean))],
    [cutRows],
  );
  const enrichedOrdersQuery = useOrdersEnrichedPage(
    factoryId,
    cutOrderIds,
    cutOrderIds.length > 0,
  );
  const orders = enrichedOrdersQuery.data ?? [];

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const buyerOptions = useMemo(() => {
    const opts = buyers
      .map((b) => ({ value: b.name, label: b.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: "", label: "All buyers" }, ...opts];
  }, [buyers]);

  const colorwayItems = useMemo(
    () => buildColorwayCutShipItems(cutRows, orders, new Map()),
    [cutRows, orders],
  );

  const orderHasShipmentInRange = (order: typeof orders[0]) => {
    const dates = activeShipmentDeliveryDates(order.shipmentPlan);
    if (dates.length === 0) return true;
    return dates.some((d) => d >= dateFrom && d <= dateTo);
  };

  const scopedItems = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return colorwayItems.filter((item) => {
      const order = orders.find((o) => o.id === item.orderId);
      if (!order) return false;
      if (buyerFilter && order.buyer !== buyerFilter) return false;
      if (q && !matchesColorwaySearch(item, q)) return false;
      return orderHasShipmentInRange(order);
    });
  }, [colorwayItems, orders, buyerFilter, debouncedSearch, dateFrom, dateTo]);

  const snapshots = useMemo(() => {
    return scopedItems.map((item) => {
      const order = orders.find((o) => o.id === item.orderId);
      return buildFulfillmentSnapshot(item.row, primaryShipmentDate(order?.shipmentPlan), item.completionStatus);
    });
  }, [scopedItems, orders]);

  const fulfillmentKpis = useMemo(() => aggregateFulfillmentKpis(snapshots), [snapshots]);

  const dailyOutput = useMemo(() => aggregateByDay(kpiRows), [kpiRows]);

  const efficiencyByDay = useMemo(() => {
    const byDay = new Map<string, number[]>();
    for (const row of kpiRows) {
      if (row.daily_efficiency_pct == null) continue;
      const list = byDay.get(row.log_date) ?? [];
      list.push(row.daily_efficiency_pct);
      byDay.set(row.log_date, list);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, effs]) => ({
        date,
        efficiency: avg(effs) != null ? Math.round(avg(effs)!) : null,
      }));
  }, [kpiRows]);

  const productionKpis = useMemo(() => {
    const periodOutput = kpiRows.reduce((s, r) => s + (r.daily_output || 0), 0);
    const periodTarget = kpiRows.reduce((s, r) => s + (r.daily_target || 0), 0);
    const totalAvailableMins = kpiRows.reduce((s, r) => s + (r.daily_available_mins || 0), 0);
    const totalProducedMins = kpiRows.reduce((s, r) => s + (r.daily_produced_mins || 0), 0);
    const effValues = kpiRows
      .map((r) => r.daily_efficiency_pct)
      .filter((v): v is number => v != null);
    const avgEff = avg(effValues);
    const activeOrders = activeOrderCountQuery.data ?? 0;
    const wip = wipForLatestDay(kpiRows);
    const efficiencyPct =
      totalAvailableMins > 0
        ? Math.round((100 * totalProducedMins) / totalAvailableMins)
        : avgEff != null
        ? Math.round(avgEff)
        : null;
    const todayKey = format(new Date(), "yyyy-MM-dd");
    const todayOutput = kpiRows
      .filter((r) => r.log_date === todayKey)
      .reduce((s, r) => s + (r.daily_output || 0), 0);
    return { periodOutput, periodTarget, efficiencyPct, activeOrders, wip, todayOutput };
  }, [kpiRows, activeOrderCountQuery.data, orders]);

  const attentionBaseItems = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return colorwayItems.filter((item) => {
      const order = orders.find((o) => o.id === item.orderId);
      if (!order) return false;
      if (buyerFilter && order.buyer !== buyerFilter) return false;
      if (q && !matchesColorwaySearch(item, q)) return false;
      return true;
    });
  }, [colorwayItems, orders, buyerFilter, debouncedSearch]);

  const attentionSnapshots = useMemo(() => {
    return attentionBaseItems.map((item) => {
      const order = orders.find((o) => o.id === item.orderId);
      return buildFulfillmentSnapshot(item.row, primaryShipmentDate(order?.shipmentPlan), item.completionStatus);
    });
  }, [attentionBaseItems, orders]);

  const attentionOrders = useMemo(() => {
    const byOrder = new Map<
      string,
      { orderId: string; styleName: string; poNumber: string; o2s: number | null; gap: number }
    >();
    for (let i = 0; i < attentionBaseItems.length; i++) {
      const item = attentionBaseItems[i];
      const snap = attentionSnapshots[i];
      const existing = byOrder.get(item.orderId);
      const o2s = snap.orderToShipPct;
      const gap = Math.max(0, snap.orderQty - snap.shippedQty);
      if (!existing) {
        byOrder.set(item.orderId, {
          orderId: item.orderId,
          styleName: item.styleName,
          poNumber: item.poNumber,
          o2s,
          gap,
        });
      } else {
        existing.gap += gap;
        if (o2s != null) {
          existing.o2s = existing.o2s == null ? o2s : Math.min(existing.o2s, o2s);
        }
      }
    }
    return [...byOrder.values()]
      .filter((o) => o.gap > 0)
      .sort((a, b) => (a.o2s ?? 0) - (b.o2s ?? 0));
  }, [attentionBaseItems, attentionSnapshots]);

  const handleExportAttentionOrders = useCallback(() => {
    if (attentionOrders.length === 0) return;
    const headers = ['Style', 'PO Number', 'Order to Ship %', 'Short pcs'];
    const rows = attentionOrders.map((o) => [
      o.styleName,
      o.poNumber,
      o.o2s != null ? formatFulfillmentPct(o.o2s) : '—',
      o.gap,
    ]);
    downloadCsv('attention-orders.csv', headers, rows);
  }, [attentionOrders]);

  const pageLoading = settingsLoading || loading || (cutOrderIds.length > 0 && enrichedOrdersQuery.isLoading);

  return (
    <PageShell error={loadError} onRetry={() => void loadDashboard()} className="space-y-4 pb-20">
      <PageToolbarCard className="mes-page-chrome !overflow-visible relative z-20">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 w-full min-w-0">
          <div className="flex items-center gap-2 flex-1 min-w-0 w-full lg:max-w-md">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 w-full min-w-0"
              placeholder="Search style, PO…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full lg:w-auto lg:ml-auto lg:justify-end">
            <DateRangePicker
              variant="pill"
              dropdownAlign="right"
              value={dateRange}
              onChange={setDateRange}
              className="w-full sm:w-auto"
            />
            <button
              type="button"
              onClick={handleToday}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <Calendar size={13} />
              Today
            </button>
            <SelectDropdown
              value={buyerFilter}
              onChange={setBuyerFilter}
              options={buyerOptions}
              className="w-full sm:w-44"
            />
          </div>
        </div>
      </PageToolbarCard>

      {pageLoading ? (
        <DashboardSkeleton />
      ) : (
        <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3">
        <KPICard
          title="Today output"
          value={productionKpis.todayOutput.toLocaleString()}
          subtext="All departments · today"
          icon={TrendingUp}
          accent="text-blue-700"
          iconAccent="text-blue-600"
          onClick={() => navigate(RoutePath.REPORTS_DAY, { dateFrom: toYmd(new Date().toISOString()), dateTo: toYmd(new Date().toISOString()) })}
        />
        <KPICard
          title="Period output"
          value={productionKpis.periodOutput.toLocaleString()}
          subtext={`Target ${productionKpis.periodTarget.toLocaleString()} pcs`}
          icon={TrendingUp}
          accent="text-slate-800"
          iconAccent="text-slate-500"
          onClick={() => navigate(RoutePath.REPORTS_DAY, { dateFrom, dateTo })}
        />
        <KPICard
          title="Efficiency"
          value={productionKpis.efficiencyPct != null ? `${productionKpis.efficiencyPct}%` : "—"}
          subtext="Output vs plan"
          icon={Gauge}
          accent="text-violet-700"
          iconAccent="text-violet-600"
          onClick={() => navigate(RoutePath.REPORTS_DAY, { dateFrom, dateTo })}
        />
        <KPICard
          title="Floor WIP"
          value={productionKpis.wip.toLocaleString()}
          subtext="Pieces on floor now"
          icon={Activity}
          accent="text-amber-700"
          iconAccent="text-amber-600"
          onClick={() => navigate(RoutePath.FLOOR_DAY, { dateFrom, dateTo })}
        />
        <KPICard
          title="Active orders"
          value={String(productionKpis.activeOrders)}
          subtext="In production"
          icon={Target}
          accent="text-slate-800"
          iconAccent="text-slate-500"
          onClick={() => navigate(RoutePath.STATUS_TRACKER)}
        />
        <KPICard
          title="Order → Ship"
          value={formatFulfillmentPct(fulfillmentKpis.orderToShipPct)}
          subtext={`${fulfillmentKpis.shippedQty.toLocaleString()} / ${fulfillmentKpis.orderQty.toLocaleString()} pcs`}
          icon={Ship}
          accent="text-emerald-700"
          iconAccent="text-emerald-600"
          onClick={() => navigate(RoutePath.REPORTS_STYLE, { dateFrom, dateTo })}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DailyTrendChart
          data={dailyOutput.map((d) => ({ date: d.logDate, output: d.output, target: d.target }))}
          title="Factory output trend"
          subtitle="All departments combined · pieces out vs daily plan"
          height={280}
        />
        <EfficiencyLineChart
          data={efficiencyByDay}
          title="Efficiency trend"
          subtitle="All departments · daily average %"
          height={280}
        />
      </div>

      {attentionOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Orders with balance to ship
            </p>
            <button
              type="button"
              onClick={handleExportAttentionOrders}
              className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 hover:text-blue-600 transition-colors"
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {attentionOrders.map((o) => (
              <button
                key={o.orderId}
                type="button"
                onClick={() => navigate(RoutePath.ORDER_COMPLETION, { orderId: o.orderId })}
                className="text-left rounded-lg border border-slate-100 px-3 py-2.5 hover:bg-slate-50 transition-colors"
              >
                <div className="text-xs font-semibold text-slate-800 truncate">{o.styleName}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">PO {o.poNumber}</div>
                <div className="mt-1.5 flex items-center justify-between text-[10px]">
                  <span className="text-emerald-700 font-semibold tabular-nums">
                    O→S {formatFulfillmentPct(o.o2s)}
                  </span>
                  <span className="text-amber-700 font-semibold tabular-nums">
                    {o.gap.toLocaleString()} short
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </PageShell>
  );
};
