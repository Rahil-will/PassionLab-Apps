import React, { useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { BarChart3, ChevronDown, ChevronRight, Gauge, Package, TrendingUp, Users } from 'lucide-react';
import { TableSkeleton, Skeleton } from '../ui';
import { DayHandoverTables } from './DayHandoverTables';
import { DayNativeEntries } from './DayNativeEntries';
import { WorkforceBreakdownPopover } from './WorkforceBreakdownPopover';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import {
  computeDayDeptMetricsFromRows,
  formatDhu,
  type DayResourceHourReport,
  type DayResourceHourRow,
  type DayShiftHourSection,
} from '../../lib/mesReportsApi';

function efficiencyAccent(efficiency: number | null): string {
  if (efficiency == null) return 'text-slate-500';
  if (efficiency >= 100) return 'text-emerald-600';
  if (efficiency >= 75) return 'text-amber-600';
  return 'text-red-600';
}

function formatEffPct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(1)}%`;
}

function formatPassPct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(1)}%`;
}

function formatProductivity(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toFixed(1);
}

function formatPlanEndWithDaysLeft(
  iso: string | null,
  logDate: string | undefined,
): { date: string; daysLeft: string | null } {
  if (!iso) return { date: '—', daysLeft: null };
  let date = iso;
  try {
    date = format(parseISO(iso.split('T')[0]), 'dd MMM');
  } catch {
    /* keep raw */
  }
  if (!logDate) return { date, daysLeft: null };
  try {
    const end = iso.split('T')[0];
    const diff = Math.ceil(
      (parseISO(end).getTime() - parseISO(logDate).getTime()) / 86_400_000,
    );
    if (diff === 0) return { date, daysLeft: 'Today' };
    if (diff === 1) return { date, daysLeft: '1 day left' };
    if (diff > 1) return { date, daysLeft: `${diff} days left` };
    if (diff === -1) return { date, daysLeft: '1 day over' };
    return { date, daysLeft: `${Math.abs(diff)} days over` };
  } catch {
    return { date, daysLeft: null };
  }
}

const HOUR_COL_CLASS = 'px-1 py-3 text-center min-w-[2.5rem] max-w-[2.75rem] border-b-2 border-slate-200 border-r border-slate-100 text-slate-400';
const HOUR_CELL_CLASS = 'px-1 py-2 text-center font-bold text-[10px] text-slate-700 border-r border-slate-100';
const HOUR_FOOT_CLASS = 'py-2 px-1 text-center border-r border-slate-100 text-[10px]';

function formatHrTarget(value: number): string {
  if (value <= 0) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function computeTotals(
  rows: DayResourceHourRow[],
  hourColumns: string[],
): {
  totalsByHour: Record<string, number>;
  grandTotal: number;
} {
  const totalsByHour: Record<string, number> = {};
  for (const h of hourColumns) totalsByHour[h] = 0;
  let grandTotal = 0;
  for (const row of rows) {
    grandTotal += row.total;
    for (const h of hourColumns) {
      totalsByHour[h] += row.hours[h] || 0;
    }
  }
  return { totalsByHour, grandTotal };
}

interface KpiStatProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}

function KpiStat({ icon, label, value, accent = 'text-slate-900' }: KpiStatProps) {
  return (
    <div className="flex flex-1 min-w-0 items-center gap-2.5 px-5 py-3">
      <span className="text-blue-500 shrink-0">{icon}</span>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[8px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">
          {label}
        </span>
        <span className={`text-base font-bold tabular-nums leading-none ${accent}`}>{value}</span>
      </div>
    </div>
  );
}

function fabricAspectLabel(aspect: 'shell' | 'lining' | null | undefined): string {
  if (aspect === 'lining') return 'Lining';
  if (aspect === 'shell') return 'Shell';
  return '—';
}

function rowVisibilityKey(row: DayResourceHourRow): string {
  return `${row.logDate ?? ''}|${row.operationGroupId ?? row.operationId ?? ''}|${row.resourceId}|${row.orderId}|${row.colorwayId ?? ''}|${row.layNo ?? ''}`;
}

export interface DayDeptCardProps {
  deptName: string;
  loading: boolean;
  error?: string | null;
  report?: DayResourceHourReport | null;
  visibleRows: DayResourceHourRow[];
  visibleShiftSections?: DayShiftHourSection[];
  fullHeight?: boolean;
  multiDay?: boolean;
  searchQuery?: string;
}

export const DayDeptCard: React.FC<DayDeptCardProps> = ({
  deptName,
  loading,
  error,
  report,
  visibleRows,
  visibleShiftSections,
  fullHeight = true,
  multiDay = false,
  searchQuery = '',
}) => {
  const isNativeCutting = report?.isNativeCutting ?? false;
  const isNativeShipment = report?.isNativeShipment ?? false;
  const isOutsource = report?.isOutsource ?? false;
  const isBatch = report?.isBatch ?? false;
  const entryKind = isNativeCutting
    ? 'cutting_session'
    : isNativeShipment
      ? 'shipment'
      : isOutsource
        ? 'outsource'
        : isBatch
          ? 'batch'
          : null;

  const hourlySections = useMemo((): DayShiftHourSection[] => {
    if (report?.operationSections?.length) {
      const visibleKeys = new Set(visibleRows.map((r) => rowVisibilityKey(r)));
      const fallbackHours = report.hourColumns ?? [];
      return report.operationSections.map((op) => ({
        shiftId: op.operationId,
        shiftName: op.fabricAspect
          ? `${op.operationLabel} · ${fabricAspectLabel(op.fabricAspect)}`
          : op.operationLabel,
        hourColumns: op.hourColumns.length > 0 ? op.hourColumns : fallbackHours,
        rows: op.rows.filter((r) => visibleKeys.has(rowVisibilityKey(r))),
      }));
    }
    if (visibleShiftSections && visibleShiftSections.length > 0) {
      return visibleShiftSections;
    }
    if (!report) return [];
    return [
      {
        shiftId: '_default',
        shiftName: 'Shift',
        hourColumns: report.hourColumns,
        rows: visibleRows,
      },
    ];
  }, [report, visibleShiftSections, visibleRows]);

  const hourColumns = hourlySections[0]?.hourColumns ?? report?.hourColumns ?? [];

  const reportMetrics = useMemo(
    () => computeDayDeptMetricsFromRows(report?.rows ?? []),
    [report],
  );
  const displayOutput = report?.kpi.output ?? 0;

  const captureLabel = report?.isQcDept
    ? 'QC'
    : isNativeCutting
      ? 'Cutting sessions'
      : isNativeShipment
        ? 'Shipment logs'
        : isOutsource
          ? 'Vendor movements'
          : isBatch
            ? 'Batch output'
            : 'Hourly';

  const multiDayRange = multiDay;

  const formatDayLabel = (iso: string) => {
    try {
      return format(parseISO(iso), 'dd MMM yyyy');
    } catch {
      return iso;
    }
  };

  const rangeDates = useMemo(() => {
    if (!multiDayRange) return null;
    const dates = [
      ...new Set(
        visibleRows
          .filter((r) => r.logDate && r.total > 0)
          .map((r) => r.logDate as string),
      ),
    ].sort();
    return dates.length > 0 ? dates : null;
  }, [multiDayRange, visibleRows]);

  const [hourlyCollapsed, setHourlyCollapsed] = useState(false);

  const renderHourlyRow = (
    row: DayResourceHourRow,
    sectionHourColumns: string[],
    nativeCutting: boolean,
  ) => {
    const planEnd = formatPlanEndWithDaysLeft(row.plannedEndDate, row.logDate);
    return (
    <tr
      key={`${row.logDate ?? ''}-${row.shiftId ?? ''}-${row.orderId}-${row.colorwayId ?? 'all'}-${row.resourceId}`}
      className="hover:bg-slate-50/80"
    >
      <td
        className={`${t.firstCell} w-[4rem] max-w-[4rem] truncate text-slate-600`}
        title={row.resourceName}
      >
        {row.resourceName}
      </td>
      <td className={`${t.deptCell} text-left`}>
        <span className="block font-semibold text-slate-800 truncate max-w-[7rem]">{row.styleName}</span>
        {row.styleRef && (
          <span className="block text-[9px] text-slate-400 truncate max-w-[7rem]">{row.styleRef}</span>
        )}
      </td>
      <td className={`${t.deptCell} text-left text-slate-600 truncate max-w-[4rem]`}>
        {row.buyerName || '—'}
      </td>
      <td className={`${t.deptCell} text-left text-slate-500`}>{row.poNumber}</td>
      <td className={`${t.deptCell} text-left text-slate-600`}>{row.colorName}</td>
      {nativeCutting ? (
        <>
          <td className={`${t.deptCell} text-left text-slate-600 capitalize`}>
            {fabricAspectLabel(row.fabricAspect)}
          </td>
          <td className={`${t.deptCell} text-left text-slate-500 tabular-nums`}>{row.layNo || '—'}</td>
        </>
      ) : null}
      <td className={t.numCell}>
        <WorkforceBreakdownPopover
          total={row.workforce}
          breakdown={row.workforceBreakdown}
          deptName={deptName}
        />
      </td>
      {!nativeCutting ? (
        <td className={`${t.numCell} text-slate-600 whitespace-nowrap min-w-[5.5rem]`}>
          <span className="block">{planEnd.date}</span>
          {planEnd.daysLeft && (
            <span className="block text-[8px] font-medium text-slate-400 tabular-nums">
              {planEnd.daysLeft}
            </span>
          )}
        </td>
      ) : null}
      {!nativeCutting ? <td className={t.adjCell}>{formatHrTarget(row.hourlyTarget)}</td> : null}
      {sectionHourColumns.map((h) => {
        const val = row.hours[h] ?? 0;
        return (
          <td key={h} className={HOUR_CELL_CLASS}>
            <span className={val > 0 ? 'text-slate-800' : 'text-slate-300'}>{val}</span>
          </td>
        );
      })}
      <td className={`${t.numCell} text-slate-900`}>{row.total}</td>
      <td className={`${t.numCell} ${efficiencyAccent(row.efficiencyPct)}`}>
        {formatEffPct(row.efficiencyPct)}
      </td>
      <td className={`${t.numCell} text-slate-600`}>{formatProductivity(row.productivity)}</td>
    </tr>
    );
  };

  const renderHourlyTable = (section: DayShiftHourSection) => {
    const sectionRows = section.rows;
    const sectionHourColumns = section.hourColumns;
    const nativeCutting = isNativeCutting;
    const { totalsByHour, grandTotal } = computeTotals(sectionRows, sectionHourColumns);
    const sectionMetrics = computeDayDeptMetricsFromRows(sectionRows);
    const colSpan = 8 + sectionHourColumns.length + 3;

    return (
      <div key={section.shiftId} className="border-t border-slate-100 first:border-t-0">
        <div className="px-4 py-1.5 bg-slate-50/60 border-b border-slate-100">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            {section.shiftName}
          </p>
        </div>
        <div className="w-full overflow-x-auto">
          <table className={`${t.table} w-full min-w-full`}>
            <thead className={t.thead}>
              <tr>
                <th className={`${t.firstHead} w-[4rem] max-w-[4rem]`}>Resource</th>
                <th className={`${t.deptHead} text-left min-w-[6.5rem]`}>Style</th>
                <th className={`${t.deptHead} text-left`}>Buyer</th>
                <th className={`${t.deptHead} text-left`}>PO</th>
                <th className={`${t.deptHead} text-left`}>Color</th>
                {nativeCutting ? (
                  <>
                    <th className={`${t.deptHead} text-left`}>Fabric</th>
                    <th className={`${t.deptHead} text-left`}>Lay</th>
                  </>
                ) : null}
                <th className={t.numHead}>WF</th>
                {!nativeCutting ? (
                  <>
                    <th className={`${t.numHead} min-w-[5.5rem]`}>Plan end</th>
                    <th className={t.adjHead}>Hr tgt</th>
                  </>
                ) : null}
                {sectionHourColumns.map((h) => (
                  <th key={h} className={`${HOUR_COL_CLASS} whitespace-nowrap text-[8px]`}>
                    {h}
                  </th>
                ))}
                <th className={t.numHead}>Total</th>
                <th className={t.numHead}>Eff %</th>
                <th className={t.numHead}>Prod</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sectionRows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="py-8 px-4 text-center text-[10px] text-slate-400 italic">
                    No output logged for this department in the selected period.
                  </td>
                </tr>
              ) : rangeDates
                ? rangeDates.map((date) => {
                    const dayRows = sectionRows.filter((r) => r.logDate === date && r.total > 0);
                    if (dayRows.length === 0) return null;
                    return (
                      <React.Fragment key={date}>
                        {renderDateDivider(date, colSpan)}
                        {dayRows.map((row) => renderHourlyRow(row, sectionHourColumns, nativeCutting))}
                      </React.Fragment>
                    );
                  })
                : sectionRows.map((row) => renderHourlyRow(row, sectionHourColumns, nativeCutting))}

              {sectionRows.length > 0 && (
                <tr className="bg-slate-100 font-semibold">
                  <td className={t.footFirst}>Totals</td>
                  <td className={t.footDept} colSpan={nativeCutting ? 6 : 4} />
                  <td className={t.footNum}>
                    {sectionMetrics.workforce > 0 ? sectionMetrics.workforce : '—'}
                  </td>
                  {!nativeCutting ? (
                    <>
                      <td className={t.footNum}>—</td>
                      <td className={t.footAdj}>—</td>
                    </>
                  ) : null}
                  {sectionHourColumns.map((h) => {
                    const val = totalsByHour[h] || 0;
                    return (
                      <td key={h} className={HOUR_FOOT_CLASS}>
                        {val}
                      </td>
                    );
                  })}
                  <td className={t.footNum}>{grandTotal}</td>
                  <td className={`${t.footNum} ${efficiencyAccent(sectionMetrics.efficiency)}`}>
                    {formatEffPct(sectionMetrics.efficiency)}
                  </td>
                  <td className={t.footNum}>{formatProductivity(sectionMetrics.productivity)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  const renderDateDivider = (date: string, colSpan: number) => (
    <tr key={`day-${date}`} className="bg-slate-50">
      <td
        colSpan={colSpan}
        className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-wide text-slate-500 border-y border-slate-200"
      >
        {formatDayLabel(date)}
      </td>
    </tr>
  );

  const totalRowCount = hourlySections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className={`flex flex-col w-full gap-3 ${fullHeight ? 'flex-1 min-h-0' : ''}`}>
      {loading && (
        <>
          <div className="flex items-stretch rounded-2xl border border-slate-200 bg-white overflow-hidden shrink-0">
            <div className="flex flex-col justify-center px-5 py-4 border-r border-slate-100 min-w-[8rem] gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="flex flex-1 divide-x divide-slate-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex-1 px-4 py-4 flex flex-col gap-2">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-5 w-10" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 flex-1 min-h-[280px]">
            <TableSkeleton rows={8} />
          </div>
        </>
      )}

      {!loading && (
        <>
      <div className="flex items-stretch rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
        <div className="flex flex-col justify-center px-5 py-4 border-r border-slate-100 min-w-[8rem]">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wide">{deptName}</h2>
          <span className="text-[9px] text-blue-500 font-semibold mt-0.5">{captureLabel}</span>
        </div>

        {report && !error && (
          <div className="flex flex-1 items-stretch divide-x divide-slate-100">
            <KpiStat icon={<BarChart3 size={18} />} label="Output" value={String(displayOutput)} />
            <KpiStat
              icon={<Gauge size={18} />}
              label="Efficiency"
              value={formatEffPct(report?.kpi.efficiency)}
              accent={efficiencyAccent(report?.kpi.efficiency)}
            />
            <KpiStat
              icon={<TrendingUp size={18} />}
              label="Productivity"
              value={formatProductivity(report?.kpi.productivity)}
            />
            <KpiStat
              icon={<Users size={18} />}
              label="Workforce"
              value={reportMetrics.workforce > 0 ? String(reportMetrics.workforce) : '—'}
            />
            <KpiStat icon={<Package size={18} />} label="WIP" value={String(report.kpi.wip ?? 0)} />
            {report.isQcDept && (
              <>
                <KpiStat icon={<BarChart3 size={18} />} label="Inspected" value={String(report.kpi.inspected ?? 0)} />
                <KpiStat icon={<Gauge size={18} />} label="Pass %" value={formatPassPct(report.kpi.passPct)} />
                <KpiStat icon={<Gauge size={18} />} label="DHU" value={formatDhu(report.kpi.dhu)} />
              </>
            )}
          </div>
        )}
      </div>

      {report?.handover && !error && (
        <DayHandoverTables
          deptName={deptName}
          handover={report.handover}
          handoverByDay={report.handoverByDay}
          multiDay={multiDayRange}
        />
      )}

      {error && (
        <p className="rounded-2xl border border-red-100 bg-red-50 px-6 py-8 text-[10px] text-red-600">
          {error}
        </p>
      )}

      {!error && report && entryKind && (
        <DayNativeEntries
          entries={
            entryKind === 'outsource'
              ? report.outsourceEntries || []
              : entryKind === 'batch'
                ? report.batchEntries || []
                : report.nativeEntries || []
          }
          kind={entryKind}
          multiDay={multiDayRange}
          searchQuery={searchQuery}
        />
      )}

      {!error && report && !entryKind && (
        <div className="flex flex-col w-full rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setHourlyCollapsed((c) => !c)}
            className="w-full px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors shrink-0"
          >
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">Hourly output</h3>
            <span className="text-[9px] text-slate-500 tabular-nums">
              {totalRowCount} rows
            </span>
            <span className="ml-auto text-slate-400 shrink-0">
              {hourlyCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>

          {!hourlyCollapsed && (
            <div className="w-full">
              {hourlySections.map((section) => renderHourlyTable(section))}
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
};
