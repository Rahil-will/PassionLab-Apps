import React, { useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { BarChart3, ChevronDown, ChevronRight, Gauge, Package, TrendingUp, Users } from 'lucide-react';
import { TableSkeleton, Skeleton } from '../ui';
import { DayHandoverTables } from './DayHandoverTables';
import { DayNativeEntries } from './DayNativeEntries';
import { DayAuditTables } from './DayAuditTables';
import { WorkforceBreakdownPopover } from './WorkforceBreakdownPopover';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import {
  computeDayDeptMetricsFromRows,
  formatDhu,
  type DayAuditRow,
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

/** Lower is better for defective % / DHU, unlike efficiency where higher is better. */
function defectiveAccent(pct: number | null): string {
  if (pct == null) return 'text-slate-500';
  if (pct <= 2) return 'text-emerald-600';
  if (pct <= 5) return 'text-amber-600';
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

const HOUR_COL_CLASS = 'px-1 py-3 text-center border-b-2 border-slate-200 border-r border-slate-100 text-slate-400';
const HOUR_CELL_CLASS = 'px-1 py-2 text-center font-bold text-[10px] text-slate-700 border-r border-slate-100';
const HOUR_FOOT_CLASS = 'py-2 px-1 text-center border-r border-slate-100 text-[10px]';

/**
 * Fixed per-column widths (used with `table-fixed` + a `<colgroup>`) so columns
 * never grow/shrink with content — the hourly and QC tables share the same
 * widths for the columns they have in common, so they line up visually.
 */
const COL_W = {
  resource: 'w-16',
  style: 'w-32',
  buyer: 'w-16',
  po: 'w-16',
  color: 'w-16',
  sam: 'w-12',
  fabric: 'w-16',
  lay: 'w-14',
  wf: 'w-14',
  planEnd: 'w-20',
  hrTgt: 'w-12',
  hour: 'w-10',
  total: 'w-12',
  eff: 'w-14',
  prod: 'w-12',
  inspected: 'w-14',
  defectivePct: 'w-16',
  dhu: 'w-12',
} as const;

function hourlyColWidths(nativeCutting: boolean, hourCount: number): string[] {
  const hours = Array.from({ length: hourCount }, () => COL_W.hour);
  if (nativeCutting) {
    return [
      COL_W.resource, COL_W.style, COL_W.buyer, COL_W.po, COL_W.color,
      COL_W.fabric, COL_W.lay, COL_W.wf,
      ...hours,
      COL_W.total, COL_W.eff, COL_W.prod,
    ];
  }
  return [
    COL_W.resource, COL_W.style, COL_W.buyer, COL_W.po, COL_W.color,
    COL_W.sam, COL_W.wf, COL_W.planEnd, COL_W.hrTgt,
    ...hours,
    COL_W.total, COL_W.eff, COL_W.prod,
  ];
}

function qcColWidths(hourCount: number): string[] {
  const hours = Array.from({ length: hourCount }, () => COL_W.hour);
  return [
    COL_W.resource, COL_W.style, COL_W.buyer, COL_W.po, COL_W.color,
    COL_W.sam, COL_W.wf, COL_W.planEnd, COL_W.hrTgt,
    ...hours,
    COL_W.total, COL_W.eff, COL_W.prod,
    COL_W.inspected, COL_W.defectivePct, COL_W.dhu,
  ];
}

/**
 * Loading is a receiving/WIP-start acknowledgement, not SAM-measured
 * production — its card drops SAM, Plan end, Hr tgt, Eff % and Productivity
 * entirely (they'd only ever show "—") instead of rendering a full hourly
 * table with dead columns.
 */
function loadingColWidths(hourCount: number): string[] {
  const hours = Array.from({ length: hourCount }, () => COL_W.hour);
  return [COL_W.resource, COL_W.style, COL_W.buyer, COL_W.po, COL_W.color, COL_W.wf, ...hours, COL_W.total];
}

function TableColGroup({ widths }: { widths: string[] }) {
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} className={w} />
      ))}
    </colgroup>
  );
}

function formatHrTarget(value: number): string {
  if (value <= 0) return '—';
  return String(Math.round(value));
}

/** Defective % and DHU (defects per hundred units) share the same formula here — no per-defect
 * count is captured, only pass/fail, so a defective piece counts as exactly one defect. */
function formatDefectivePct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(1)}%`;
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

function formatSam(value: number | null | undefined): string {
  if (value == null || value <= 0) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Workforce KPI is an average daily headcount over the period — may be fractional. */
function formatWorkforce(value: number | null | undefined): string {
  if (value == null || value <= 0) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fabricAspectLabel(aspect: 'shell' | 'lining' | null | undefined): string {
  if (aspect === 'lining') return 'Lining';
  if (aspect === 'shell') return 'Shell';
  return '—';
}

function cuttingOperationOutputs(
  report: DayResourceHourReport,
): Array<{ label: string; output: number }> {
  const byName = new Map<string, number>();
  const sections = report.operationSections ?? [];
  if (sections.length > 0) {
    for (const sec of sections) {
      const label = sec.operationLabel || 'Cutting';
      const total = sec.rows.reduce((sum, row) => sum + row.total, 0);
      byName.set(label, (byName.get(label) || 0) + total);
    }
  } else {
    for (const entry of report.nativeEntries ?? []) {
      const label = entry.operationName || 'Cutting';
      byName.set(label, (byName.get(label) || 0) + entry.outputQty);
    }
  }
  return [...byName.entries()]
    .map(([label, output]) => ({ label, output }))
    .sort((a, b) => a.label.localeCompare(b.label));
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
  visibleQcShiftSections?: DayShiftHourSection[];
  fullHeight?: boolean;
  multiDay?: boolean;
  searchQuery?: string;
  auditRows?: DayAuditRow[];
  auditsLoading?: boolean;
  shipmentDesk?: boolean;
  showAudits?: boolean;
}

export const DayDeptCard: React.FC<DayDeptCardProps> = ({
  deptName,
  loading,
  error,
  report,
  visibleRows,
  visibleShiftSections,
  visibleQcShiftSections,
  fullHeight = true,
  multiDay = false,
  searchQuery = '',
  auditRows = [],
  auditsLoading = false,
  shipmentDesk = false,
  showAudits = true,
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

  // Three-way split, on two independent axes:
  //  - stepType: 'loading' (receiving/WIP-start, no SAM) vs everything else (real production)
  //  - captureKind: 'hourly' vs 'qc' — only meaningful within production rows
  // Kept as separate row sets so each renders as its own table/card instead of
  // merging into one with columns that don't apply to every row.
  const nonQcVisibleRows = useMemo(
    () => visibleRows.filter((r) => r.captureKind !== 'qc'),
    [visibleRows],
  );
  const loadingVisibleRows = useMemo(
    () => nonQcVisibleRows.filter((r) => r.stepType === 'loading'),
    [nonQcVisibleRows],
  );
  const mainVisibleRows = useMemo(
    () => nonQcVisibleRows.filter((r) => r.stepType !== 'loading'),
    [nonQcVisibleRows],
  );
  const qcVisibleRows = useMemo(
    () => visibleRows.filter((r) => r.captureKind === 'qc' && r.stepType !== 'loading'),
    [visibleRows],
  );

  // A department with only one routed operation (no per-operation split) can
  // still be a loading-only department (rare, but possible) — detect that so
  // its single shift section renders as the Loading card, not "Hourly output".
  const fallbackRows = visibleShiftSections?.length
    ? visibleShiftSections.flatMap((s) => s.rows)
    : nonQcVisibleRows;
  const fallbackIsLoadingOnly =
    !report?.operationSections?.length
    && fallbackRows.length > 0
    && fallbackRows.every((r) => r.stepType === 'loading');

  const hourlySections = useMemo((): DayShiftHourSection[] => {
    if (report?.operationSections?.length) {
      const visibleKeys = new Set(mainVisibleRows.map((r) => rowVisibilityKey(r)));
      const fallbackHours = report.hourColumns ?? [];
      return report.operationSections
        .filter((op) => op.captureKind !== 'qc' && op.stepType !== 'loading')
        .map((op) => ({
          shiftId: op.operationId,
          shiftName: op.fabricAspect
            ? `${op.operationLabel} · ${fabricAspectLabel(op.fabricAspect)}`
            : op.operationLabel,
          hourColumns: op.hourColumns.length > 0 ? op.hourColumns : fallbackHours,
          rows: op.rows.filter((r) => visibleKeys.has(rowVisibilityKey(r))),
        }));
    }
    if (fallbackIsLoadingOnly) return [];
    if (visibleShiftSections && visibleShiftSections.length > 0) {
      return visibleShiftSections;
    }
    if (!report) return [];
    return [
      {
        shiftId: '_default',
        shiftName: 'Shift',
        hourColumns: report.hourColumns,
        rows: mainVisibleRows,
      },
    ];
  }, [report, visibleShiftSections, mainVisibleRows, fallbackIsLoadingOnly]);

  const loadingSections = useMemo((): DayShiftHourSection[] => {
    if (report?.operationSections?.length) {
      const visibleKeys = new Set(loadingVisibleRows.map((r) => rowVisibilityKey(r)));
      const fallbackHours = report.hourColumns ?? [];
      return report.operationSections
        .filter((op) => op.stepType === 'loading')
        .map((op) => ({
          shiftId: op.operationId,
          shiftName: op.operationLabel,
          hourColumns: op.hourColumns.length > 0 ? op.hourColumns : fallbackHours,
          rows: op.rows.filter((r) => visibleKeys.has(rowVisibilityKey(r))),
        }));
    }
    if (fallbackIsLoadingOnly) {
      return [
        {
          shiftId: '_loading',
          shiftName: 'Loading',
          hourColumns: report?.hourColumns ?? [],
          rows: fallbackRows,
        },
      ];
    }
    return [];
  }, [report, loadingVisibleRows, fallbackIsLoadingOnly, fallbackRows]);

  const qcHourlySections = useMemo((): DayShiftHourSection[] => {
    if (report?.operationSections?.length) {
      const visibleKeys = new Set(qcVisibleRows.map((r) => rowVisibilityKey(r)));
      const fallbackHours = report.hourColumns ?? [];
      return report.operationSections
        .filter((op) => op.captureKind === 'qc')
        .map((op) => ({
          shiftId: op.operationId,
          shiftName: op.operationLabel,
          hourColumns: op.hourColumns.length > 0 ? op.hourColumns : fallbackHours,
          rows: op.rows.filter((r) => visibleKeys.has(rowVisibilityKey(r))),
        }));
    }
    if (visibleQcShiftSections && visibleQcShiftSections.length > 0) {
      return visibleQcShiftSections;
    }
    return [];
  }, [report, visibleQcShiftSections, qcVisibleRows]);

  const hourColumns = hourlySections[0]?.hourColumns ?? report?.hourColumns ?? [];

  // Fallback only — excludes loading rows (no SAM/produced-mins, not measured
  // production) so it can't dilute efficiency/productivity if a report ever
  // arrives without server-computed kpi.efficiency/productivity/workforce.
  const reportMetrics = useMemo(
    () =>
      computeDayDeptMetricsFromRows(
        (report?.rows ?? []).filter((r) => r.stepType !== 'loading'),
      ),
    [report],
  );
  const displayOutput = report?.kpi.output ?? 0;
  // Always prefer the server-computed KPIs: they sum produced minutes and
  // available minutes across every row/day FIRST, then divide once — the
  // correct way to combine multi-day, multi-shift, multi-resource data.
  // (A client-side per-row recompute here previously double-counted/omitted
  // rows and could go stale relative to what the tables below show.)
  const displayEfficiency = report?.kpi.efficiency ?? reportMetrics.efficiency;
  const displayProductivity = report?.kpi.productivity ?? reportMetrics.productivity;
  // Prefer the server-computed workforce KPI (origin/cutting sources it directly
  // from workforce_logs since cutting sessions don't reliably carry a resource_id
  // to match against); fall back to the row-based client computation otherwise.
  const displayWorkforce = report?.kpi.workforce ?? reportMetrics.workforce;
  const cuttingOps = useMemo(
    () => (report && isNativeCutting ? cuttingOperationOutputs(report) : []),
    [report, isNativeCutting],
  );

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
        className={`${t.firstCell} truncate text-slate-600`}
        title={row.resourceName}
      >
        {row.resourceName}
      </td>
      <td className={`${t.deptCell} text-left truncate`}>
        <span className="block font-semibold text-slate-800 truncate">{row.styleName}</span>
        {row.styleRef && (
          <span className="block text-[9px] text-slate-400 truncate">{row.styleRef}</span>
        )}
      </td>
      <td className={`${t.deptCell} text-left text-slate-600 truncate`}>
        {row.buyerName || '—'}
      </td>
      <td className={`${t.deptCell} text-left text-slate-500 truncate`}>{row.poNumber}</td>
      <td className={`${t.deptCell} text-left text-slate-600 truncate`}>{row.colorName}</td>
      {!nativeCutting ? (
        <td className={`${t.numCell} text-slate-600`}>{formatSam(row.sam)}</td>
      ) : null}
      {nativeCutting ? (
        <>
          <td className={`${t.deptCell} text-left text-slate-600 capitalize truncate`}>
            {fabricAspectLabel(row.fabricAspect)}
          </td>
          <td className={`${t.deptCell} text-left text-slate-500 tabular-nums truncate`}>{row.layNo || '—'}</td>
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
        <td className={`${t.numCell} text-slate-600 whitespace-nowrap`}>
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
    const colSpan = (nativeCutting ? 8 : 9) + sectionHourColumns.length + 3;

    return (
      <div key={section.shiftId} className="border-t border-slate-100 first:border-t-0">
        <div className="px-4 py-1.5 bg-slate-50/60 border-b border-slate-100">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            {section.shiftName}
          </p>
        </div>
        <div className="w-full overflow-x-auto">
          <table className={`${t.table} min-w-full table-fixed`}>
            <TableColGroup widths={hourlyColWidths(nativeCutting, sectionHourColumns.length)} />
            <thead className={t.thead}>
              <tr>
                <th className={t.firstHead}>Resource</th>
                <th className={`${t.deptHead} text-left`}>Style</th>
                <th className={`${t.deptHead} text-left`}>Buyer</th>
                <th className={`${t.deptHead} text-left`}>PO</th>
                <th className={`${t.deptHead} text-left`}>Color</th>
                {!nativeCutting ? <th className={t.numHead}>SAM</th> : null}
                {nativeCutting ? (
                  <>
                    <th className={`${t.deptHead} text-left`}>Fabric</th>
                    <th className={`${t.deptHead} text-left`}>Lay</th>
                  </>
                ) : null}
                <th className={t.numHead}>WF</th>
                {!nativeCutting ? (
                  <>
                    <th className={t.numHead}>Plan end</th>
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
                  <td className={t.footDept} colSpan={nativeCutting ? 6 : 5} />
                  <td className={t.footNum}>
                    {formatWorkforce(sectionMetrics.workforce)}
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

  const [loadingCollapsed, setLoadingCollapsed] = useState(false);

  const renderLoadingRow = (row: DayResourceHourRow, sectionHourColumns: string[]) => (
    <tr
      key={`${row.logDate ?? ''}-${row.shiftId ?? ''}-${row.orderId}-${row.colorwayId ?? 'all'}-${row.resourceId}`}
      className="hover:bg-slate-50/80"
    >
      <td className={`${t.firstCell} truncate text-slate-600`} title={row.resourceName}>
        {row.resourceName}
      </td>
      <td className={`${t.deptCell} text-left truncate`}>
        <span className="block font-semibold text-slate-800 truncate">{row.styleName}</span>
        {row.styleRef && (
          <span className="block text-[9px] text-slate-400 truncate">{row.styleRef}</span>
        )}
      </td>
      <td className={`${t.deptCell} text-left text-slate-600 truncate`}>
        {row.buyerName || '—'}
      </td>
      <td className={`${t.deptCell} text-left text-slate-500 truncate`}>{row.poNumber}</td>
      <td className={`${t.deptCell} text-left text-slate-600 truncate`}>{row.colorName}</td>
      <td className={t.numCell}>
        <WorkforceBreakdownPopover
          total={row.workforce}
          breakdown={row.workforceBreakdown}
          deptName={deptName}
        />
      </td>
      {sectionHourColumns.map((h) => {
        const val = row.hours[h] ?? 0;
        return (
          <td key={h} className={HOUR_CELL_CLASS}>
            <span className={val > 0 ? 'text-slate-800' : 'text-slate-300'}>{val}</span>
          </td>
        );
      })}
      <td className={`${t.numCell} text-slate-900`}>{row.total}</td>
    </tr>
  );

  const renderLoadingTable = (section: DayShiftHourSection) => {
    const sectionRows = section.rows;
    const sectionHourColumns = section.hourColumns;
    const { totalsByHour, grandTotal } = computeTotals(sectionRows, sectionHourColumns);
    const sectionWorkforce = computeDayDeptMetricsFromRows(sectionRows).workforce;
    const colSpan = 6 + sectionHourColumns.length + 1;

    return (
      <div key={section.shiftId} className="border-t border-slate-100 first:border-t-0">
        <div className="px-4 py-1.5 bg-slate-50/60 border-b border-slate-100">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            {section.shiftName}
          </p>
        </div>
        <div className="w-full overflow-x-auto">
          <table className={`${t.table} min-w-full table-fixed`}>
            <TableColGroup widths={loadingColWidths(sectionHourColumns.length)} />
            <thead className={t.thead}>
              <tr>
                <th className={t.firstHead}>Resource</th>
                <th className={`${t.deptHead} text-left`}>Style</th>
                <th className={`${t.deptHead} text-left`}>Buyer</th>
                <th className={`${t.deptHead} text-left`}>PO</th>
                <th className={`${t.deptHead} text-left`}>Color</th>
                <th className={t.numHead}>WF</th>
                {sectionHourColumns.map((h) => (
                  <th key={h} className={`${HOUR_COL_CLASS} whitespace-nowrap text-[8px]`}>
                    {h}
                  </th>
                ))}
                <th className={t.numHead}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sectionRows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="py-8 px-4 text-center text-[10px] text-slate-400 italic">
                    No loading logged for this department in the selected period.
                  </td>
                </tr>
              ) : rangeDates
                ? rangeDates.map((date) => {
                    const dayRows = sectionRows.filter((r) => r.logDate === date && r.total > 0);
                    if (dayRows.length === 0) return null;
                    return (
                      <React.Fragment key={date}>
                        {renderDateDivider(date, colSpan)}
                        {dayRows.map((row) => renderLoadingRow(row, sectionHourColumns))}
                      </React.Fragment>
                    );
                  })
                : sectionRows.map((row) => renderLoadingRow(row, sectionHourColumns))}

              {sectionRows.length > 0 && (
                <tr className="bg-slate-100 font-semibold">
                  <td className={t.footFirst}>Totals</td>
                  <td className={t.footDept} colSpan={4} />
                  <td className={t.footNum}>{formatWorkforce(sectionWorkforce)}</td>
                  {sectionHourColumns.map((h) => {
                    const val = totalsByHour[h] || 0;
                    return (
                      <td key={h} className={HOUR_FOOT_CLASS}>
                        {val}
                      </td>
                    );
                  })}
                  <td className={t.footNum}>{grandTotal}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const [qcCollapsed, setQcCollapsed] = useState(false);

  const renderQcHourlyRow = (row: DayResourceHourRow, sectionHourColumns: string[]) => {
    const planEnd = formatPlanEndWithDaysLeft(row.plannedEndDate, row.logDate);
    return (
    <tr
      key={`${row.logDate ?? ''}-${row.shiftId ?? ''}-${row.orderId}-${row.colorwayId ?? 'all'}-${row.resourceId}`}
      className="hover:bg-slate-50/80"
    >
      <td
        className={`${t.firstCell} truncate text-slate-600`}
        title={row.resourceName}
      >
        {row.resourceName}
      </td>
      <td className={`${t.deptCell} text-left truncate`}>
        <span className="block font-semibold text-slate-800 truncate">{row.styleName}</span>
        {row.styleRef && (
          <span className="block text-[9px] text-slate-400 truncate">{row.styleRef}</span>
        )}
      </td>
      <td className={`${t.deptCell} text-left text-slate-600 truncate`}>
        {row.buyerName || '—'}
      </td>
      <td className={`${t.deptCell} text-left text-slate-500 truncate`}>{row.poNumber}</td>
      <td className={`${t.deptCell} text-left text-slate-600 truncate`}>{row.colorName}</td>
      <td className={`${t.numCell} text-slate-600`}>{formatSam(row.sam)}</td>
      <td className={t.numCell}>
        <WorkforceBreakdownPopover
          total={row.workforce}
          breakdown={row.workforceBreakdown}
          deptName={deptName}
        />
      </td>
      <td className={`${t.numCell} text-slate-600 whitespace-nowrap`}>
        <span className="block">{planEnd.date}</span>
        {planEnd.daysLeft && (
          <span className="block text-[8px] font-medium text-slate-400 tabular-nums">
            {planEnd.daysLeft}
          </span>
        )}
      </td>
      <td className={t.adjCell}>{formatHrTarget(row.hourlyTarget)}</td>
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
      <td className={`${t.numCell} text-slate-600`}>{row.inspectedQty ?? 0}</td>
      <td className={`${t.numCell} ${defectiveAccent(row.defectivePct)}`}>
        {formatDefectivePct(row.defectivePct)}
      </td>
      <td className={`${t.numCell} text-slate-600`}>{formatDhu(row.dhu)}</td>
    </tr>
    );
  };

  const renderQcHourlyTable = (section: DayShiftHourSection) => {
    const sectionRows = section.rows;
    const sectionHourColumns = section.hourColumns;
    const { totalsByHour, grandTotal } = computeTotals(sectionRows, sectionHourColumns);
    let inspected = 0;
    let defective = 0;
    for (const row of sectionRows) {
      inspected += row.inspectedQty ?? 0;
      defective += row.defectiveQty ?? 0;
    }
    const defectivePct = inspected > 0 ? (defective / inspected) * 100 : null;
    const sectionMetrics = computeDayDeptMetricsFromRows(sectionRows);
    const colSpan = 9 + sectionHourColumns.length + 6;

    return (
      <div key={section.shiftId} className="border-t border-slate-100 first:border-t-0">
        <div className="px-4 py-1.5 bg-slate-50/60 border-b border-slate-100">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
            {section.shiftName}
          </p>
        </div>
        <div className="w-full overflow-x-auto">
          <table className={`${t.table} min-w-full table-fixed`}>
            <TableColGroup widths={qcColWidths(sectionHourColumns.length)} />
            <thead className={t.thead}>
              <tr>
                <th className={t.firstHead}>Resource</th>
                <th className={`${t.deptHead} text-left`}>Style</th>
                <th className={`${t.deptHead} text-left`}>Buyer</th>
                <th className={`${t.deptHead} text-left`}>PO</th>
                <th className={`${t.deptHead} text-left`}>Color</th>
                <th className={t.numHead}>SAM</th>
                <th className={t.numHead}>WF</th>
                <th className={t.numHead}>Plan end</th>
                <th className={t.adjHead}>Hr tgt</th>
                {sectionHourColumns.map((h) => (
                  <th key={h} className={`${HOUR_COL_CLASS} whitespace-nowrap text-[8px]`}>
                    {h}
                  </th>
                ))}
                <th className={t.numHead}>Passed</th>
                <th className={t.numHead}>Eff %</th>
                <th className={t.numHead}>Prod</th>
                <th className={t.numHead}>Inspected</th>
                <th className={t.numHead}>Defective %</th>
                <th className={t.numHead}>DHU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sectionRows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="py-8 px-4 text-center text-[10px] text-slate-400 italic">
                    No QC output logged for this department in the selected period.
                  </td>
                </tr>
              ) : rangeDates
                ? rangeDates.map((date) => {
                    const dayRows = sectionRows.filter((r) => r.logDate === date);
                    if (dayRows.length === 0) return null;
                    return (
                      <React.Fragment key={date}>
                        {renderDateDivider(date, colSpan)}
                        {dayRows.map((row) => renderQcHourlyRow(row, sectionHourColumns))}
                      </React.Fragment>
                    );
                  })
                : sectionRows.map((row) => renderQcHourlyRow(row, sectionHourColumns))}

              {sectionRows.length > 0 && (
                <tr className="bg-slate-100 font-semibold">
                  <td className={t.footFirst}>Totals</td>
                  <td className={t.footDept} colSpan={4} />
                  <td className={t.footNum}>—</td>
                  <td className={t.footNum}>{formatWorkforce(sectionMetrics.workforce)}</td>
                  <td className={t.footNum}>—</td>
                  <td className={t.footAdj}>—</td>
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
                  <td className={t.footNum}>{inspected}</td>
                  <td className={`${t.footNum} ${defectiveAccent(defectivePct)}`}>
                    {formatDefectivePct(defectivePct)}
                  </td>
                  <td className={t.footNum}>{formatDhu(defectivePct)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const totalRowCount = hourlySections.reduce((n, s) => n + s.rows.length, 0);
  const loadingTotalRowCount = loadingSections.reduce((n, s) => n + s.rows.length, 0);
  const qcTotalRowCount = qcHourlySections.reduce((n, s) => n + s.rows.length, 0);

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
          <div className="flex flex-1 items-stretch divide-x divide-slate-100 overflow-x-auto">
            {isNativeCutting ? (
              <>
                {(cuttingOps.length > 0
                  ? cuttingOps
                  : [{ label: 'Output', output: displayOutput }]
                ).map((op, i) => (
                  <KpiStat
                    key={`${op.label}-${i}`}
                    icon={<BarChart3 size={18} />}
                    label={op.label}
                    value={String(op.output)}
                  />
                ))}
                <KpiStat
                  icon={<Users size={18} />}
                  label="Workforce"
                  value={formatWorkforce(displayWorkforce)}
                />
                <KpiStat icon={<Package size={18} />} label="WIP" value={String(report.kpi.wip ?? 0)} />
              </>
            ) : (
              <>
                <KpiStat icon={<BarChart3 size={18} />} label="Output" value={String(displayOutput)} />
                <KpiStat
                  icon={<Gauge size={18} />}
                  label="Efficiency"
                  value={formatEffPct(displayEfficiency)}
                  accent={efficiencyAccent(displayEfficiency)}
                />
                <KpiStat
                  icon={<TrendingUp size={18} />}
                  label="Productivity"
                  value={formatProductivity(displayProductivity)}
                />
                <KpiStat
                  icon={<Users size={18} />}
                  label="Workforce"
                  value={formatWorkforce(displayWorkforce)}
                />
                <KpiStat icon={<Package size={18} />} label="WIP" value={String(report.kpi.wip ?? 0)} />
                {report.isQcDept && (
                  <>
                    <KpiStat icon={<BarChart3 size={18} />} label="Inspected" value={String(report.kpi.inspected ?? 0)} />
                    <KpiStat icon={<Gauge size={18} />} label="Pass %" value={formatPassPct(report.kpi.passPct)} />
                    <KpiStat
                      icon={<Gauge size={18} />}
                      label="Defective %"
                      value={formatDefectivePct(report.kpi.defectivePct)}
                      accent={defectiveAccent(report.kpi.defectivePct)}
                    />
                    <KpiStat icon={<Gauge size={18} />} label="DHU" value={formatDhu(report.kpi.dhu)} />
                  </>
                )}
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

      {!error && report && !entryKind && loadingTotalRowCount > 0 && (
        <div className="flex flex-col w-full rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setLoadingCollapsed((c) => !c)}
            className="w-full px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors shrink-0"
          >
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">Loading</h3>
            <span className="text-[9px] text-slate-500 tabular-nums">
              {loadingTotalRowCount} rows
            </span>
            <span className="ml-auto text-slate-400 shrink-0">
              {loadingCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>

          {!loadingCollapsed && (
            <div className="w-full">
              {loadingSections.map((section) => renderLoadingTable(section))}
            </div>
          )}
        </div>
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

      {!error && report && !entryKind && qcTotalRowCount > 0 && (
        <div className="flex flex-col w-full rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
          <button
            type="button"
            onClick={() => setQcCollapsed((c) => !c)}
            className="w-full px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors shrink-0"
          >
            <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">QC output</h3>
            <span className="text-[9px] text-slate-500 tabular-nums">
              {qcTotalRowCount} rows
            </span>
            <span className="ml-auto text-slate-400 shrink-0">
              {qcCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>

          {!qcCollapsed && (
            <div className="w-full">
              {qcHourlySections.map((section) => renderQcHourlyTable(section))}
            </div>
          )}
        </div>
      )}

      {!error && showAudits && (auditsLoading || auditRows.length > 0 || Boolean(report)) && (
        <DayAuditTables
          deptName={deptName}
          rows={auditRows}
          loading={auditsLoading}
          multiDay={multiDayRange}
          shipmentDesk={shipmentDesk}
        />
      )}
        </>
      )}
    </div>
  );
};
