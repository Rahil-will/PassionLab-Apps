import { useQuery } from '@tanstack/react-query';
import {
  fetchColorwayLabels,
  fetchDayResourceHourReportRange,
  fetchReportMetaLite,
  fetchReportOrdersPage,
  fetchStyleDailyKpis,
  fetchStyleJourneyReport,
  type ColorwayLabel,
  type ColorwayLabelScope,
  type DayResourceHourReport,
  type ReportMeta,
  type ReportMetaLite,
  type ReportOrdersPageParams,
  type ReportOrdersPageResult,
} from '../reports';
import { queryKeys } from '../queryKeys';

/** Cached report metadata (departments, buyers, resources) — no full order list. */
export function useReportMeta(factoryId: string | null | undefined) {
  return useQuery<ReportMeta>({
    queryKey: queryKeys.reportMeta(factoryId ?? ''),
    queryFn: async () => {
      const lite = await fetchReportMetaLite(factoryId!);
      return { ...lite, orders: [] };
    },
    enabled: Boolean(factoryId),
    staleTime: 5 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });
}

export type { ReportMetaLite };

/** Paginated style_orders for report search and landing recent lists. */
export function useReportOrdersPage(
  factoryId: string | null | undefined,
  params: ReportOrdersPageParams,
  enabled = true,
) {
  return useQuery<ReportOrdersPageResult>({
    queryKey: queryKeys.reportOrdersPage(factoryId ?? '', {
      search: params.search,
      limit: params.limit,
      offset: params.offset,
    }),
    queryFn: () => fetchReportOrdersPage(factoryId!, params),
    enabled: Boolean(factoryId && enabled),
    staleTime: 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
  });
}

/** Style journey report — persisted for offline re-read when previously loaded. */
export function useStyleJourneyReport(
  factoryId: string | null | undefined,
  orderId: string | null | undefined,
  colorwayId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.reportStyle(factoryId ?? '', orderId ?? '', colorwayId),
    queryFn: () => fetchStyleJourneyReport(factoryId!, orderId!, colorwayId),
    enabled: Boolean(factoryId && orderId && enabled),
    staleTime: 2 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });
}

/** Style daily KPI rows — shares cache with journey key family under reports/*. */
export function useStyleDailyKpis(
  factoryId: string | null | undefined,
  orderId: string | null | undefined,
  colorwayId: string | null,
  meta: ReportMeta | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.reportStyle(factoryId ?? '', orderId ?? '', colorwayId),
      'daily',
    ] as const,
    queryFn: () => fetchStyleDailyKpis(factoryId!, orderId!, meta, colorwayId),
    enabled: Boolean(factoryId && orderId && enabled),
    staleTime: 2 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });
}

export type { ColorwayLabelScope };

function colorwayLabelsScopeEnabled(
  factoryId: string | null | undefined,
  scope: ColorwayLabelScope | undefined,
): boolean {
  if (!factoryId || !scope) return false;
  if (scope.orderIds?.length) return true;
  return Boolean(scope.departmentId && scope.dateFrom && scope.dateTo);
}

/** Colorway display labels scoped to report context (orders or dept + date range). */
export function useColorwayLabels(
  factoryId: string | null | undefined,
  scope?: ColorwayLabelScope,
) {
  return useQuery<ColorwayLabel[]>({
    queryKey: [
      ...queryKeys.reportMeta(factoryId ?? ''),
      'colorwayLabels',
      scope?.orderIds?.slice().sort().join(',') ?? '',
      scope?.departmentId ?? '',
      scope?.dateFrom ?? '',
      scope?.dateTo ?? '',
    ] as const,
    queryFn: () => fetchColorwayLabels(factoryId!, scope),
    enabled: colorwayLabelsScopeEnabled(factoryId, scope),
    staleTime: 10 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });
}

/** Day dept resource-hour report for one department and date range. */
export function useDayDeptReport(
  factoryId: string | null | undefined,
  deptId: string | null | undefined,
  dateFrom: string,
  dateTo: string,
  meta: ReportMeta | undefined,
  colorwayLabels: ColorwayLabel[],
  enabled = true,
) {
  return useQuery<DayResourceHourReport>({
    queryKey: queryKeys.reportDay(factoryId ?? '', dateFrom, dateTo, deptId ?? undefined),
    queryFn: () =>
      fetchDayResourceHourReportRange(
        factoryId!,
        dateFrom,
        dateTo,
        deptId!,
        meta!,
        colorwayLabels,
      ),
    enabled: Boolean(factoryId && deptId && meta && enabled),
    staleTime: 2 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnMount: false,
  });
}
