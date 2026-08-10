import React, { useCallback, useEffect, useMemo, useState } from 'react';
import format from 'date-fns/format';
import { Download, Factory, RefreshCw } from 'lucide-react';
import { useNavigationStore } from '../../stores';
import { Button, Card, SelectDropdown } from '../../components/ui';
import { PageShell } from '../../components/layout/PageShell';
import { ReportToolbar } from '../../components/reports/ReportToolbar';
import { DayDeptCard } from '../../components/reports/DayDeptCard';
import { DateRangePicker, type DateRangeValue } from '../../components/DateRangePicker';
import { filterDayReportDepartments } from '../../lib/departmentFilters';
import { downloadExcelWorkbook, type ExcelSheet } from '../../lib/csvExport';
import {
  isUuid,
  resolveRouteColorwayId,
  resolveRouteOrderId,
} from '../../lib/reportPageUtils';
import {
  computeDayDeptMetricsFromRows,
  dayHandoverStatusLabel,
  fetchColorwayLabels,
  fetchDayResourceHourReportRange,
  type DayHandoverSummary,
  type DayResourceHourReport,
  type DayResourceHourRow,
  type DayShiftHourSection,
} from '../../lib/reports';
import { useColorwayLabels, useDayDeptReport, useReportMeta } from '../../lib/queries/reports';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

function todayRange(): DateRangeValue {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const iso = today.toISOString();
  return { startDate: iso, endDate: iso };
}

function toYmd(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd');
}

function matchesSearch(
  query: string,
  styleName: string,
  poNumber: string,
  styleRef = '',
  buyerName = '',
): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    styleName.toLowerCase().includes(q) ||
    poNumber.toLowerCase().includes(q) ||
    styleRef.toLowerCase().includes(q) ||
    buyerName.toLowerCase().includes(q)
  );
}

function sortDayRows(rows: DayResourceHourRow[]): DayResourceHourRow[] {
  return [...rows].sort((a, b) => {
    const da = a.logDate ?? '';
    const db = b.logDate ?? '';
    if (da !== db) return da.localeCompare(db);
    return (
      a.resourceName.localeCompare(b.resourceName) ||
      a.styleName.localeCompare(b.styleName) ||
      a.colorName.localeCompare(b.colorName)
    );
  });
}

function filterRows(
  rows: DayResourceHourRow[],
  searchQuery: string,
  linkOrderId: string,
  linkColorwayId: string,
): DayResourceHourRow[] {
  return rows.filter((row) => {
    if (linkOrderId && row.orderId !== linkOrderId) return false;
    if (linkColorwayId && row.colorwayId !== linkColorwayId) return false;
    return matchesSearch(searchQuery, row.styleName, row.poNumber, row.styleRef, row.buyerName);
  });
}

function handoverSheetRows(
  handoverByDay: Array<{ date: string; handover: DayHandoverSummary }>,
): Array<Array<string | number | null | undefined>> {
  const rows: Array<Array<string | number | null | undefined>> = [];
  for (const { date, handover } of handoverByDay) {
    if (handover.received.length === 0 && handover.sent.length === 0) continue;
    rows.push([`— ${date} —`, '', '', '', '', '', '', '', '', '']);
    for (const row of handover.received) {
      rows.push([
        'Received',
        row.fromDepartmentName,
        row.styleName,
        row.buyerName,
        row.poNumber,
        row.operationName,
        row.colorName,
        dayHandoverStatusLabel(row.status),
        row.sentQty,
        row.receivedQty,
        row.missingInTransit ?? '',
      ]);
    }
    for (const row of handover.sent) {
      rows.push([
        'Sent',
        row.toDepartmentName,
        row.styleName,
        row.buyerName,
        row.poNumber,
        row.operationName,
        row.colorName,
        dayHandoverStatusLabel(row.status),
        row.sentQty,
        row.receivedQty,
        row.missingInTransit ?? '',
      ]);
    }
  }
  return rows;
}

function exportDeptWorkbook(
  deptName: string,
  dateFrom: string,
  dateTo: string,
  report: DayResourceHourReport,
  visibleRows: DayResourceHourRow[],
): void {
  const handoverByDay =
    report.handoverByDay ??
    (report.handover ? [{ date: dateFrom, handover: report.handover }] : []);

  const hours = report.hourColumns;
  const multiDay =
    visibleRows.some((r) => r.logDate) && new Set(visibleRows.map((r) => r.logDate)).size > 1;

  const hourlyHeaders = [
    ...(multiDay ? ['Date'] : []),
    'Resource',
    'Style',
    'Style Ref',
    'Buyer',
    'PO',
    'Color',
    'WF',
    'Planned End',
    'Hr Target',
    ...hours.flatMap((h) => [`${h} Actual`, `${h} Target`]),
    'Total',
    'Eff %',
    'Productivity',
  ];

  const hourlyRows: Array<Array<string | number | null | undefined>> = [];
  let lastDate: string | undefined;
  for (const row of visibleRows) {
    if (multiDay && row.logDate && row.logDate !== lastDate) {
      hourlyRows.push([`— ${row.logDate} —`]);
      lastDate = row.logDate;
    }
    hourlyRows.push([
      ...(multiDay ? [row.logDate ?? ''] : []),
      row.resourceName,
      row.styleName,
      row.styleRef,
      row.buyerName,
      row.poNumber,
      row.colorName,
      row.workforce ?? '',
      row.plannedEndDate ?? '',
      row.hourlyTarget || '',
      ...hours.flatMap((h) => [row.hours[h] || 0, row.hourTargets[h] || 0]),
      row.total,
      row.efficiencyPct != null ? row.efficiencyPct.toFixed(1) : '',
      row.productivity != null ? row.productivity.toFixed(1) : '',
    ]);
  }

  if (visibleRows.length > 0) {
    const metrics = computeDayDeptMetricsFromRows(visibleRows);
    hourlyRows.push([
      ...(multiDay ? [''] : []),
      'Totals',
      '',
      '',
      '',
      '',
      '',
      metrics.workforce > 0 ? metrics.workforce : '',
      '',
      '',
      ...hours.flatMap((h) => {
        let actual = 0;
        for (const row of visibleRows) actual += row.hours[h] || 0;
        return [actual, ''];
      }),
      visibleRows.reduce((s, r) => s + r.total, 0),
      metrics.efficiency != null ? metrics.efficiency.toFixed(1) : '',
      metrics.productivity != null ? metrics.productivity.toFixed(1) : '',
    ]);
  }

  const sheets: ExcelSheet[] = [
    {
      name: 'Handovers',
      headers: ['Direction', 'Department', 'Style', 'Buyer', 'PO', 'Operation', 'Color', 'Status', 'Sent', 'Received', 'Missing'],
      rows: handoverSheetRows(handoverByDay),
    },
    {
      name: 'Hourly Output',
      headers: hourlyHeaders,
      rows: hourlyRows,
    },
  ];

  const slug = deptName.replace(/\s+/g, '-').toLowerCase();
  const rangeSlug = dateFrom === dateTo ? dateFrom : `${dateFrom}_to_${dateTo}`;
  downloadExcelWorkbook(`day-report-${slug}-${rangeSlug}`, sheets);
}

export const DayReport: React.FC = () => {
  const { factoryId, routeParams } = useNavigationStore();
  const isOnline = useOnlineStatus();
  const metaQuery = useReportMeta(factoryId);
  const meta = metaQuery.data ?? null;
  const metaLoading = metaQuery.isLoading && !metaQuery.data;
  const [dateRange, setDateRange] = useState<DateRangeValue>(todayRange);
  const dateFrom = toYmd(dateRange.startDate);
  const dateTo = toYmd(dateRange.endDate);
  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [linkOrderId, setLinkOrderId] = useState('');
  const [linkColorwayId, setLinkColorwayId] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [exportAllLoading, setExportAllLoading] = useState(false);

  const departments = useMemo(
    () => (meta ? filterDayReportDepartments(meta.departments) : []),
    [meta],
  );

  const activeDeptId = useMemo(() => {
    if (selectedDeptId && departments.some((d) => d.id === selectedDeptId)) {
      return selectedDeptId;
    }
    return departments[0]?.id ?? '';
  }, [selectedDeptId, departments]);

  const colorwayLabelsQuery = useColorwayLabels(factoryId, {
    departmentId: activeDeptId || undefined,
    dateFrom,
    dateTo,
  });
  const colorwayLabels = colorwayLabelsQuery.data ?? [];

  const selectedDept = useMemo(
    () => departments.find((d) => d.id === activeDeptId) ?? null,
    [departments, activeDeptId],
  );

  const deptOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments],
  );

  const deptReportQuery = useDayDeptReport(
    factoryId,
    activeDeptId || null,
    dateFrom,
    dateTo,
    meta ?? undefined,
    colorwayLabels,
    Boolean(meta && activeDeptId),
  );

  const reportRefreshing = deptReportQuery.isFetching;
  const report = deptReportQuery.data ?? null;
  const reportLoading =
    metaLoading ||
    colorwayLabelsQuery.isLoading ||
    (Boolean(activeDeptId) && (deptReportQuery.isLoading || deptReportQuery.isFetching));
  const deptError = deptReportQuery.error
    ? deptReportQuery.error instanceof Error
      ? deptReportQuery.error.message
      : 'Failed to load department'
    : null;
  const error = deptError ?? loadError;
  const reportCacheUpdatedAt = deptReportQuery.dataUpdatedAt
    ? new Date(deptReportQuery.dataUpdatedAt)
    : null;

  useEffect(() => {
    setSelectedDeptId('');
    setSearchQuery('');
    setLinkOrderId('');
    setLinkColorwayId('');
    setLoadError(null);
    setLastUpdated(null);
    setDateRange(todayRange());
  }, [factoryId]);

  useEffect(() => {
    if (metaQuery.error) {
      setLoadError(
        metaQuery.error instanceof Error
          ? metaQuery.error.message
          : 'Failed to load report metadata',
      );
    }
  }, [metaQuery.error]);

  useEffect(() => {
    if (colorwayLabelsQuery.error) {
      setLoadError(
        colorwayLabelsQuery.error instanceof Error
          ? colorwayLabelsQuery.error.message
          : 'Failed to load colorway labels',
      );
    }
  }, [colorwayLabelsQuery.error]);

  useEffect(() => {
    if (departments.length > 0 && !selectedDeptId) {
      setSelectedDeptId(departments[0].id);
    }
    if (selectedDeptId && !departments.some((d) => d.id === selectedDeptId)) {
      setSelectedDeptId(departments[0]?.id ?? '');
    }
  }, [departments, selectedDeptId]);

  useEffect(() => {
    if (!meta) return;
    const orderId = resolveRouteOrderId(routeParams);
    const colorwayId = resolveRouteColorwayId(routeParams);
    if (!orderId) {
      setLinkOrderId('');
      setLinkColorwayId('');
      return;
    }
    if (isUuid(orderId)) {
      setLinkOrderId(orderId);
      setLinkColorwayId(colorwayId);
    } else {
      setLinkOrderId('');
      setLinkColorwayId('');
    }
  }, [routeParams, meta]);

  const metaCacheUpdatedAt = metaQuery.dataUpdatedAt
    ? new Date(metaQuery.dataUpdatedAt)
    : null;
  const isCachedMetaView =
    Boolean(meta) && (!isOnline || (metaQuery.isFetching && metaQuery.isStale));

  const refreshReport = useCallback(async () => {
    setLoadError(null);
    await Promise.all([metaQuery.refetch(), colorwayLabelsQuery.refetch(), deptReportQuery.refetch()]);
    setLastUpdated(new Date());
  }, [metaQuery, colorwayLabelsQuery, deptReportQuery]);

  const exportAll = useCallback(() => {
    if (!selectedDept || !report) return;
    const visible = filterRows(report.rows, searchQuery, linkOrderId, linkColorwayId);
    exportDeptWorkbook(selectedDept.name, dateFrom, dateTo, report, visible);
  }, [selectedDept, report, searchQuery, linkOrderId, linkColorwayId, dateFrom, dateTo]);

  const exportAllDepartments = useCallback(async () => {
    if (!factoryId || !meta || departments.length === 0) return;
    setExportAllLoading(true);
    setLoadError(null);
    try {
      const reports = await Promise.all(
        departments.map(async (dept) => {
          const labels = await fetchColorwayLabels(factoryId, {
            departmentId: dept.id,
            dateFrom,
            dateTo,
          });
          return fetchDayResourceHourReportRange(
            factoryId,
            dateFrom,
            dateTo,
            dept.id,
            meta,
            labels,
          );
        }),
      );
      const summaryRows = reports.map((report, i) => {
        const dept = departments[i];
        const metrics = computeDayDeptMetricsFromRows(report.rows);
        return [
          dept.name,
          report.kpi.output ?? 0,
          metrics.workforce > 0 ? metrics.workforce : 0,
          metrics.efficiency != null ? Number(metrics.efficiency.toFixed(1)) : '',
          metrics.productivity != null ? Number(metrics.productivity.toFixed(1)) : '',
          report.kpi.wip ?? 0,
          report.kpi.dhu != null ? report.kpi.dhu : 0,
        ];
      });
      const sheets: ExcelSheet[] = [
        {
          name: 'All Departments',
          headers: ['Department', 'Output', 'Workforce', 'Eff %', 'Productivity', 'WIP', 'DHU'],
          rows: summaryRows,
        },
      ];
      const rangeSlug = dateFrom === dateTo ? dateFrom : `${dateFrom}_to_${dateTo}`;
      downloadExcelWorkbook(`day-report-all-departments-${rangeSlug}`, sheets);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to export all departments');
    } finally {
      setExportAllLoading(false);
    }
  }, [factoryId, meta, departments, dateFrom, dateTo]);

  const visibleRows = useMemo(() => {
    if (report == null) return [];
    const filtered = filterRows(report.rows, searchQuery, linkOrderId, linkColorwayId);
    return sortDayRows(filtered);
  }, [report, searchQuery, linkOrderId, linkColorwayId]);

  const visibleShiftSections = useMemo((): DayShiftHourSection[] | undefined => {
    if (!report?.shiftSections?.length) return undefined;
    return report.shiftSections
      .map((sec) => ({
        ...sec,
        rows: sortDayRows(filterRows(sec.rows, searchQuery, linkOrderId, linkColorwayId)),
      }))
      .filter((sec) => sec.rows.length > 0);
  }, [report, searchQuery, linkOrderId, linkColorwayId]);

  const deptDropdownOptions = metaLoading
    ? [{ value: '', label: 'Loading departments…' }]
    : deptOptions.length > 0
      ? deptOptions
      : [{ value: '', label: 'No departments' }];

  if (!factoryId) {
    return (
      <PageShell className="pb-20">
        <Card className="p-8 text-center text-sm text-slate-500">
          Select a factory to view reports.
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="pb-4 flex flex-col gap-3 min-h-[calc(100vh-10rem)]">
      <Card noPadding className="shrink-0 overflow-visible">
        <ReportToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Filter style, ref, PO, buyer…"
          showDate={false}
          onRefresh={() => void refreshReport()}
          refreshing={reportRefreshing || metaLoading}
          lastUpdated={lastUpdated ?? reportCacheUpdatedAt ?? metaCacheUpdatedAt}
          isOffline={!isOnline}
          isCachedView={isCachedMetaView}
        >
          <DateRangePicker
            value={dateRange}
            onChange={setDateRange}
            variant="pill"
            className="w-[15.5rem]"
          />
          <SelectDropdown
            value={activeDeptId}
            onChange={setSelectedDeptId}
            options={deptDropdownOptions}
            icon={Factory}
            className="w-44"
            disabled={metaLoading || deptOptions.length === 0}
          />
          <button
            type="button"
            onClick={exportAll}
            disabled={visibleRows.length === 0 || reportLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Download size={13} />
            Export
          </button>
          <button
            type="button"
            onClick={() => void exportAllDepartments()}
            disabled={exportAllLoading || departments.length === 0 || metaLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Download size={13} />
            {exportAllLoading ? 'Exporting…' : 'Export all'}
          </button>
        </ReportToolbar>

        {error && (
          <div className="mx-4 mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              onClick={() => void refreshReport()}
            >
              Retry
            </Button>
          </div>
        )}
      </Card>

      {meta && departments.length === 0 && !metaLoading && (
        <Card className="p-8 text-center text-sm text-slate-400">
          No production departments configured.
        </Card>
      )}

      {(metaLoading || selectedDept || departments.length > 0) && (
        <div className="flex-1 min-h-0 flex flex-col w-full">
          <DayDeptCard
            key={`${activeDeptId}:${dateFrom}:${dateTo}`}
            deptName={selectedDept?.name ?? 'Department'}
            loading={reportLoading}
            error={error}
            report={report}
            visibleRows={visibleRows}
            visibleShiftSections={visibleShiftSections}
            multiDay={dateFrom !== dateTo}
            fullHeight
            searchQuery={searchQuery}
          />
        </div>
      )}
    </PageShell>
  );
};
