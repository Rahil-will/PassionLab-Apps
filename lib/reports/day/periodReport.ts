import { supabase } from '../../supabase';
import { fetchDepartmentKpis } from '../kpiAndProgress';
import type { ReportMeta } from '../reportMeta';
import { flattenDeptResourceStyleRows } from './deptMetrics.pure';
import type {
  DeptDailyTrendRow,
  DeptPeriodReport,
  DeptStyleSummaryRow,
} from './types';

export { flattenDeptResourceStyleRows };

export async function fetchDeptPeriodReport(
  factoryId: string,
  departmentId: string,
  dateFrom: string,
  dateTo: string,
  meta: ReportMeta,
): Promise<DeptPeriodReport> {
  const kpiRows = await fetchDepartmentKpis(factoryId, departmentId, dateFrom, dateTo);
  const orderMap = new Map(meta.orders.map((o) => [o.id, o]));
  const resourceMap = new Map(meta.resources.map((r) => [r.id, r]));

  const byDate = new Map<string, {
    output: number;
    target: number;
    effSum: number;
    effCount: number;
    dhuSum: number;
    dhuWeight: number;
  }>();

  const byOrder = new Map<string, {
    orderId: string;
    output: number;
    target: number;
    effSum: number;
    effCount: number;
    dhuSum: number;
    dhuWeight: number;
    dates: Set<string>;
    wipByDate: Map<string, number>;
  }>();

  for (const row of kpiRows) {
    const dateAgg = byDate.get(row.log_date) ?? {
      output: 0, target: 0, effSum: 0, effCount: 0, dhuSum: 0, dhuWeight: 0,
    };
    dateAgg.output += row.daily_output || 0;
    dateAgg.target += row.daily_target || 0;
    if (row.daily_efficiency_pct != null) {
      dateAgg.effSum += Number(row.daily_efficiency_pct);
      dateAgg.effCount += 1;
    }
    if (row.dhu != null) {
      const weight = row.daily_output > 0 ? row.daily_output : 1;
      dateAgg.dhuSum += Number(row.dhu) * weight;
      dateAgg.dhuWeight += weight;
    }
    byDate.set(row.log_date, dateAgg);

    const orderAgg = byOrder.get(row.order_id) ?? {
      orderId: row.order_id,
      output: 0,
      target: 0,
      effSum: 0,
      effCount: 0,
      dhuSum: 0,
      dhuWeight: 0,
      dates: new Set<string>(),
      wipByDate: new Map<string, number>(),
    };
    orderAgg.output += row.daily_output || 0;
    orderAgg.target += row.daily_target || 0;
    orderAgg.dates.add(row.log_date);
    orderAgg.wipByDate.set(row.log_date, (orderAgg.wipByDate.get(row.log_date) || 0) + (row.wip_qty || 0));
    if (row.daily_efficiency_pct != null) {
      orderAgg.effSum += Number(row.daily_efficiency_pct);
      orderAgg.effCount += 1;
    }
    if (row.dhu != null) {
      const weight = row.daily_output > 0 ? row.daily_output : 1;
      orderAgg.dhuSum += Number(row.dhu) * weight;
      orderAgg.dhuWeight += weight;
    }
    byOrder.set(row.order_id, orderAgg);
  }

  const dailyTrend: DeptDailyTrendRow[] = [...byDate.entries()]
    .map(([date, agg]) => ({
      date,
      output: agg.output,
      target: agg.target,
      efficiency: agg.effCount
        ? agg.effSum / agg.effCount
        : agg.target > 0
          ? (agg.output / agg.target) * 100
          : null,
      dhu: agg.dhuWeight > 0 ? Math.round(agg.dhuSum / agg.dhuWeight) : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const { data: hourlyData, error: hourlyError } = await supabase
    .from('hourly_counts')
    .select('order_id, resource_id, count')
    .eq('factory_id', factoryId)
    .eq('department_id', departmentId)
    .gte('log_date', dateFrom)
    .lte('log_date', dateTo);

  if (hourlyError) throw hourlyError;

  const resourceByOrder = new Map<string, Map<string, number>>();
  for (const raw of hourlyData || []) {
    const orderId = raw.order_id as string;
    const resourceId = (raw.resource_id as string) || '';
    const count = Number(raw.count) || 0;
    const orderResources = resourceByOrder.get(orderId) ?? new Map<string, number>();
    orderResources.set(resourceId, (orderResources.get(resourceId) || 0) + count);
    resourceByOrder.set(orderId, orderResources);
  }

  const latestDate = dailyTrend.length > 0 ? dailyTrend[dailyTrend.length - 1].date : null;
  let currentWipTotal = 0;
  if (latestDate) {
    for (const row of kpiRows) {
      if (row.log_date === latestDate) currentWipTotal += row.wip_qty || 0;
    }
  }

  const styleRows: DeptStyleSummaryRow[] = [...byOrder.values()]
    .map((agg) => {
      const order = orderMap.get(agg.orderId);
      const latestWipDate = [...agg.wipByDate.keys()].sort().pop();
      const resources = resourceByOrder.get(agg.orderId);
      const resourceBreakdown = resources
        ? [...resources.entries()]
            .map(([resourceId, output]) => ({
              resourceId,
              resourceName: resourceMap.get(resourceId)?.name || '—',
              output,
              efficiency: null,
            }))
            .sort((a, b) => b.output - a.output)
        : [];

      return {
        orderId: agg.orderId,
        styleName: order?.styleName || agg.orderId.slice(0, 8),
        poNumber: order?.poNumber || '',
        totalOutput: agg.output,
        totalTarget: agg.target,
        avgEfficiency: agg.effCount
          ? agg.effSum / agg.effCount
          : agg.target > 0
            ? (agg.output / agg.target) * 100
            : null,
        avgDhu: agg.dhuWeight > 0 ? Math.round(agg.dhuSum / agg.dhuWeight) : null,
        currentWip: latestWipDate ? agg.wipByDate.get(latestWipDate) || 0 : 0,
        daysActive: agg.dates.size,
        resourceBreakdown,
      };
    })
    .sort((a, b) => b.totalOutput - a.totalOutput);

  const totalOutput = dailyTrend.reduce((s, d) => s + d.output, 0);
  const dayCount = dailyTrend.length || 1;
  let effSum = 0;
  let effCount = 0;
  let dhuSum = 0;
  let dhuWeight = 0;
  for (const d of dailyTrend) {
    if (d.efficiency != null) {
      effSum += d.efficiency;
      effCount += 1;
    }
    if (d.dhu != null) {
      const weight = d.output > 0 ? d.output : 1;
      dhuSum += d.dhu * weight;
      dhuWeight += weight;
    }
  }

  return {
    dailyTrend,
    styleRows,
    kpiSummary: {
      totalOutput,
      avgDailyOutput: totalOutput / dayCount,
      avgEfficiency: effCount ? effSum / effCount : null,
      avgDhu: dhuWeight > 0 ? Math.round(dhuSum / dhuWeight) : null,
      currentWip: currentWipTotal,
    },
  };
}