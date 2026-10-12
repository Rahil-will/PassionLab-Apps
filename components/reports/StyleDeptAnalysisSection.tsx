import React, { useEffect, useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import {
  BarChart3,
  Calendar,
  CalendarRange,
  Factory,
  Gauge,
  Hash,
  Layers,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartSizedContainer,
  DAILY_TREND_CHART_HEIGHT,
  VisitOperationOutputChart,
  buildVisitOperationBarPoints,
  operationOutputBarColor,
} from './ReportCharts';
import { ChartPrintTable } from './ChartPrintTable';
import { SelectDropdown } from '../ui';
import { isDeptPerformanceEligible } from '../../lib/reportDeptUtils';
import {
  fetchStyleDeptAuditMetrics,
  fetchStyleDeptQualitySummary,
  fetchStyleDeptResourceDailyRows,
  fetchStyleOutsourceDailyMovements,
  formatDhu,
  formatEffPct,
  formatPct2,
  type StyleDeptAuditMetrics,
  type StyleDeptAuditSessionRow,
  type StyleDeptDailyRow,
  type StyleDeptQualitySummary,
  type StyleJourneyDept,
  type StyleOutsourceDailyPoint,
} from '../../lib/mesReportsApi';
import { dailyRowsForVisit, deptChartDailyRows } from '../../lib/reportVisitDailyRows';

const QC_CHART_ROW_PX = 28;
const QC_CHART_PAD_PX = 36;
const QC_CHART_MIN = 220;
const QC_CHART_MAX = 360;

function qcChartHeight(rowCount: number): number {
  const rows = Math.max(rowCount, 1);
  return Math.min(QC_CHART_MAX, Math.max(QC_CHART_MIN, rows * QC_CHART_ROW_PX + QC_CHART_PAD_PX));
}

function wrapLabelLines(label: string, maxChars = 12, maxLines = 2): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of label.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function DefectYAxisTick({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
}) {
  if (x == null || y == null || !payload?.value) return null;
  const lines = wrapLabelLines(payload.value);
  return (
    <g transform={`translate(${x},${y})`}>
      {lines.map((line, i) => (
        <text
          key={i}
          x={0}
          y={i * 9 - (lines.length - 1) * 4}
          textAnchor="end"
          fill="#94a3b8"
          fontSize={8}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

const axisStyle = { fontSize: 10, fill: '#94a3b8' };
const tooltipStyle = {
  fontSize: 11,
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  backgroundColor: '#fff',
  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
};

function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso.split('T')[0]), 'dd MMM');
  } catch {
    return iso;
  }
}

function efficiencyAccent(efficiency: number | null): string {
  if (efficiency == null) return 'text-slate-700';
  if (efficiency >= 100) return 'text-emerald-600';
  if (efficiency >= 75) return 'text-amber-600';
  return 'text-red-600';
}

function DeptKpiChip({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 min-w-[10rem] flex-1 xl:flex-none xl:min-w-[11rem]">
      <span className="text-blue-500 shrink-0">{icon}</span>
      <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">
        {label}
      </span>
      <span className={`ml-auto text-sm font-bold tabular-nums ${accent ?? 'text-slate-900'}`}>
        {value}
      </span>
    </div>
  );
}

type YMetric = 'output' | 'productivity' | 'efficiency';

function MetricToggle({
  value,
  onChange,
}: {
  value: YMetric;
  onChange: (m: YMetric) => void;
}) {
  return (
    <div className="flex gap-1 shrink-0">
      {(['output', 'productivity', 'efficiency'] as YMetric[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-2.5 py-1 rounded-full text-[8px] font-semibold border transition-colors ${
            value === m
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-slate-600 border-slate-200 hover:border-blue-200'
          }`}
        >
          {m === 'output' ? 'Output' : m === 'productivity' ? 'Prod' : 'Eff %'}
        </button>
      ))}
    </div>
  );
}

interface DeptAnalysisBlockProps {
  factoryId: string;
  orderId: string;
  colorwayId: string | null;
  dept: StyleJourneyDept;
  rows: StyleDeptDailyRow[];
  auditSessions: StyleDeptAuditSessionRow[];
  dateFrom: string;
  dateTo: string;
}

interface AuditDeptMetrics extends StyleDeptAuditMetrics {}

function computeAuditDeptMetrics(
  sessions: StyleDeptAuditSessionRow[],
  dateFrom: string,
  dateTo: string,
): AuditDeptMetrics | null {
  const filtered = sessions.filter((s) => s.date >= dateFrom && s.date <= dateTo);
  if (filtered.length === 0) return null;

  let totalSample = 0;
  let totalPassed = 0;
  let totalMajor = 0;
  let totalMinor = 0;
  let passedAudits = 0;
  let failedAudits = 0;
  const byDay = new Map<string, StyleDeptAuditSessionRow[]>();

  for (const s of filtered) {
    totalSample += s.sampleSize;
    totalPassed += s.passed;
    totalMajor += s.majorFailed;
    totalMinor += s.minorFailed;
    const isPass = s.result === 'pass' || (s.failed <= 0 && s.sampleSize > 0);
    if (isPass) passedAudits += 1;
    else failedAudits += 1;
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }

  const defects = totalMajor + totalMinor;
  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySessions]) => {
      let sample = 0;
      let passed = 0;
      let major = 0;
      let minor = 0;
      let dayPassed = 0;
      let dayFailed = 0;
      for (const s of daySessions) {
        sample += s.sampleSize;
        passed += s.passed;
        major += s.majorFailed;
        minor += s.minorFailed;
        if (s.result === 'pass' || (s.failed <= 0 && s.sampleSize > 0)) dayPassed += 1;
        else dayFailed += 1;
      }
      const dayDefects = major + minor;
      return {
        label: formatShortDate(date),
        passPct: sample > 0 ? (passed / sample) * 100 : null,
        defectivePct: sample > 0 ? (dayDefects / sample) * 100 : null,
        majorDefectivePct: sample > 0 ? (major / sample) * 100 : null,
        auditCount: daySessions.length,
        passedCount: dayPassed,
        failedCount: dayFailed,
      };
    });

  return {
    totalAudits: filtered.length,
    passedAudits,
    failedAudits,
    passPct: totalSample > 0 ? (totalPassed / totalSample) * 100 : null,
    defectivePct: totalSample > 0 ? (defects / totalSample) * 100 : null,
    majorDefectivePct: totalSample > 0 ? (totalMajor / totalSample) * 100 : null,
    dhu: totalSample > 0 ? (defects / totalSample) * 100 : null,
    daily,
  };
}

function dayEfficiencyPct(
  output: number,
  availableMins: number,
  sam: number | null,
): number | null {
  if (!sam || sam <= 0 || availableMins <= 0 || output <= 0) return null;
  const producedMins = output * sam;
  return (producedMins / availableMins) * 100;
}

function OutsourceMovementBarChart({
  title,
  data,
  color,
  height = DAILY_TREND_CHART_HEIGHT,
}: {
  title: string;
  data: Array<{ label: string; qty: number }>;
  color: string;
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase text-slate-500 mb-1.5">{title}</p>
        <div
          className="flex items-center justify-center text-[10px] text-slate-400 border border-dashed border-slate-200 rounded-xl"
          style={{ height }}
        >
          No data
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase text-slate-500 mb-1.5">{title}</p>
      <ChartSizedContainer height={height}>
        <BarChart data={data} margin={{ top: 14, right: 8, left: 0, bottom: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisStyle}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={56}
          />
          <YAxis tick={axisStyle} width={36} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="qty" name={title} fill={color} radius={[4, 4, 0, 0]} maxBarSize={52}>
            <LabelList dataKey="qty" position="top" fontSize={9} fill="#64748b" />
          </Bar>
        </BarChart>
      </ChartSizedContainer>
    </div>
  );
}

const DeptAnalysisBlock: React.FC<DeptAnalysisBlockProps> = ({
  factoryId,
  orderId,
  colorwayId,
  dept,
  rows,
  auditSessions,
  dateFrom,
  dateTo,
}) => {
  const [yMetric, setYMetric] = useState<YMetric>('output');
  const [qualitySummary, setQualitySummary] = useState<StyleDeptQualitySummary | null>(null);
  const [auditMetricsFromView, setAuditMetricsFromView] = useState<StyleDeptAuditMetrics | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [resourceRows, setResourceRows] = useState<StyleDeptDailyRow[] | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [outsourcePoints, setOutsourcePoints] = useState<StyleOutsourceDailyPoint[]>([]);
  const qcDept = dept.isQcDept || dept.primaryCaptureApp === 'qc_log';
  const auditDept = dept.isAuditDept;

  const stepType = dept.stepType ?? 'produce';
  const primaryCaptureApp = dept.primaryCaptureApp ?? 'hourly';
  const variant =
    stepType === 'loading'
      ? 'loading'
      : primaryCaptureApp === 'qc_log' || stepType === 'qc'
      ? 'qc'
      : primaryCaptureApp === 'batch' || stepType === 'batch'
      ? 'batch'
      : stepType === 'outsource'
      ? 'outsource'
      : 'produce';
  const showEfficiency = variant === 'produce' || variant === 'qc';
  const showProductivity = showEfficiency;
  const chartTitle = variant === 'loading' ? 'Daily Loaded Qty' : 'Daily Output';
  const chartSubtitle = variant === 'loading' ? 'quantity loaded per day' : 'pieces per day';
  const showMetricToggle = showEfficiency;

  const resourceOptions = useMemo(() => {
    const lines = dept.lineBreakdown.filter((l) => l.resourceId);
    if (lines.length === 0) return [];
    const lineOpts = lines.map((l) => ({
      value: l.resourceId,
      label: l.resourceName?.trim() || l.resourceId.slice(0, 8),
    }));
    if (lines.length === 1) {
      return [{ value: '', label: 'All resources' }, lineOpts[0]];
    }
    return [{ value: '', label: 'All resources' }, ...lineOpts];
  }, [dept.lineBreakdown]);

  useEffect(() => {
    setResourceRows(null);
    setSelectedResourceId('');
  }, [dept.deptId, dept.visitId, colorwayId, orderId]);

  const activeRows = useMemo(() => {
    if (!selectedResourceId) return rows;
    if (resourceRows === null) return rows;
    const resourceOutput = resourceRows.reduce((s, r) => s + r.output, 0);
    if (resourceOutput > 0) return resourceRows;
    return rows;
  }, [rows, selectedResourceId, resourceRows]);

  const activeRowsFiltered = useMemo(
    () => activeRows.filter((r) => r.date >= dateFrom && r.date <= dateTo),
    [activeRows, dateFrom, dateTo],
  );

  const operationChartRows = useMemo(
    () =>
      activeRowsFiltered.filter(
        (r) => r.output > 0 || (r.operationId && r.output >= 0) || r.dailyAvailableMins > 0,
      ),
    [activeRowsFiltered],
  );

  const kpiRows = useMemo(() => deptChartDailyRows(activeRowsFiltered), [activeRowsFiltered]);

  const filtered = useMemo(() => kpiRows, [kpiRows]);

  const visitOpBars = useMemo(
    () => buildVisitOperationBarPoints(operationChartRows),
    [operationChartRows],
  );

  const hasLoadingCapture = useMemo(
    () =>
      visitOpBars.some((p) => p.color === '#10b981' && p.output > 0),
    [visitOpBars],
  );

  const hasProduceCapture = useMemo(
    () =>
      visitOpBars.some((p) => p.color === '#3b82f6' && p.output > 0),
    [visitOpBars],
  );

  const quantityLabel = useMemo(
    () =>
      hasLoadingCapture && !hasProduceCapture
        ? 'Loaded qty'
        : variant === 'loading'
          ? 'Loaded qty'
          : 'Output',
    [hasLoadingCapture, hasProduceCapture, variant],
  );

  useEffect(() => {
    if (!selectedResourceId) {
      setResourceRows(null);
      setResourceLoading(false);
      return;
    }
    let cancelled = false;
    setResourceLoading(true);
    fetchStyleDeptResourceDailyRows(
      factoryId,
      orderId,
      dept.deptId,
      selectedResourceId,
      colorwayId,
      rows,
      dept.plannedSam,
    )
      .then((next) => {
        if (!cancelled) setResourceRows(next);
      })
      .catch(() => {
        if (!cancelled) setResourceRows([]);
      })
      .finally(() => {
        if (!cancelled) setResourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [factoryId, orderId, dept.deptId, selectedResourceId, colorwayId, rows, dept.plannedSam]);

  useEffect(() => {
    if (variant !== 'outsource') {
      setOutsourcePoints([]);
      return;
    }
    let cancelled = false;
    fetchStyleOutsourceDailyMovements(
      factoryId,
      orderId,
      dept.deptId,
      dateFrom,
      dateTo,
      colorwayId,
      dept.routeIds,
    )
      .then((pts) => {
        if (!cancelled) setOutsourcePoints(pts);
      })
      .catch(() => {
        if (!cancelled) setOutsourcePoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [
    variant,
    factoryId,
    orderId,
    dept.deptId,
    dept.routeIds,
    dateFrom,
    dateTo,
    colorwayId,
  ]);

  useEffect(() => {
    if (!qcDept) {
      setQualitySummary(null);
      return;
    }
    let cancelled = false;
    fetchStyleDeptQualitySummary(
      factoryId,
      orderId,
      dept.deptId,
      dateFrom,
      dateTo,
      colorwayId,
      selectedResourceId || null,
    )
      .then((summary) => {
        if (!cancelled) setQualitySummary(summary);
      })
      .catch(() => {
        if (!cancelled) setQualitySummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [factoryId, orderId, dept.deptId, dateFrom, dateTo, colorwayId, qcDept, selectedResourceId]);

  useEffect(() => {
    if (!auditDept) {
      setAuditMetricsFromView(null);
      return;
    }
    let cancelled = false;
    fetchStyleDeptAuditMetrics(factoryId, orderId, dept.deptId, dateFrom, dateTo, colorwayId)
      .then((metrics) => {
        if (!cancelled) setAuditMetricsFromView(metrics);
      })
      .catch(() => {
        if (!cancelled) setAuditMetricsFromView(null);
      });
    return () => {
      cancelled = true;
    };
  }, [factoryId, orderId, dept.deptId, dateFrom, dateTo, colorwayId, auditDept]);

  const kpis = useMemo(() => {
    const dates = [...new Set(operationChartRows.map((r) => r.date))].sort();
    const outputDates = operationChartRows.filter((r) => r.output > 0).map((r) => r.date).sort();
    const produceRows = operationChartRows.filter(
      (r) => operationOutputBarColor(r.operationName || '') === '#3b82f6',
    );
    const totalOutput =
      hasLoadingCapture && hasProduceCapture
        ? produceRows.reduce((s, r) => s + r.output, 0)
        : operationChartRows.reduce((s, r) => s + r.output, 0);
    let producedMins = 0;
    let availableMins = 0;
    let prodSum = 0;
    let prodCount = 0;
    let dhuSum = 0;
    let dhuWeight = 0;
    let defSum = 0;
    let defCount = 0;
    const sam = dept.plannedSam ?? 0;

    for (const r of filtered) {
      producedMins += r.output * sam;
      availableMins += r.dailyAvailableMins;
      if (r.productivity != null) {
        prodSum += r.productivity;
        prodCount += 1;
      }
      if (r.dhu != null) {
        const w = r.output > 0 ? r.output : 1;
        dhuSum += r.dhu * w;
        dhuWeight += w;
      }
      if (r.defectivePct != null) {
        defSum += r.defectivePct;
        defCount += 1;
      }
    }

    const avgEfficiency =
      producedMins > 0 && availableMins > 0 ? (producedMins / availableMins) * 100 : null;

    return {
      totalDays: dates.length,
      startDate: outputDates[0] ?? dept.startDate,
      endDate: dates[dates.length - 1] ?? dept.endDate,
      totalOutput,
      avgEfficiency,
      avgProductivity: prodCount ? prodSum / prodCount : null,
      avgDhu: dhuWeight > 0 ? dhuSum / dhuWeight : null,
      avgDefectivePct: defCount ? defSum / defCount : null,
    };
  }, [operationChartRows, filtered, dept.startDate, dept.endDate, dept.plannedSam, hasLoadingCapture, hasProduceCapture]);

  const chartDataKey = visitOpBars.map((p) => `${p.key}:${p.output}:${p.target}`).join('|');

  const outsourceSentChart = useMemo(
    () => outsourcePoints.filter((p) => p.sent > 0).map((p) => ({ label: p.label, qty: p.sent })),
    [outsourcePoints],
  );

  const outsourceReceivedChart = useMemo(
    () =>
      outsourcePoints.filter((p) => p.received > 0).map((p) => ({ label: p.label, qty: p.received })),
    [outsourcePoints],
  );

  const defectiveTrendData = useMemo(() => {
    if (qualitySummary?.dailyDefective.length) {
      return qualitySummary.dailyDefective
        .filter((d) => d.pct != null)
        .map((d) => ({ label: d.label, pct: d.pct as number }));
    }
    return filtered
      .filter((r) => r.defectivePct != null)
      .map((r) => ({
        label: formatShortDate(r.date),
        pct: r.defectivePct as number,
      }));
  }, [qualitySummary, filtered]);

  const topDefectChartData = useMemo(
    () => (qualitySummary?.topDefects ?? []).slice(0, 7).map((d) => ({ name: d.name, count: d.count })),
    [qualitySummary],
  );

  const metricLineData = useMemo(
    () =>
      filtered.map((r) => ({
        label: r.date.slice(5),
        value:
          yMetric === 'productivity'
            ? r.productivity
            : dayEfficiencyPct(r.output, r.dailyAvailableMins, dept.plannedSam),
      })),
    [filtered, yMetric, dept.plannedSam],
  );

  const metricLabel =
    yMetric === 'output' ? 'Output' : yMetric === 'productivity' ? 'Productivity' : 'Efficiency %';

  const metricLineName = yMetric === 'productivity' ? 'Productivity' : 'Efficiency';
  const metricLineEmpty = metricLineData.every((d) => d.value == null);

  const qcChartRows = Math.max(topDefectChartData.length, defectiveTrendData.length, 1);
  const qcChartsHeight = qcChartHeight(qcChartRows);

  const auditMetrics = useMemo(() => {
    if (!auditDept) return null;
    if (auditMetricsFromView) return auditMetricsFromView;
    return computeAuditDeptMetrics(auditSessions, dateFrom, dateTo);
  }, [auditDept, auditMetricsFromView, auditSessions, dateFrom, dateTo]);

  const auditPassTrendData = useMemo(
    () =>
      (auditMetrics?.daily ?? [])
        .filter((d) => d.passPct != null)
        .map((d) => ({ label: d.label, pct: d.passPct as number })),
    [auditMetrics],
  );

  const auditDefectiveTrendData = useMemo(
    () =>
      (auditMetrics?.daily ?? [])
        .filter((d) => d.defectivePct != null)
        .map((d) => ({ label: d.label, pct: d.defectivePct as number })),
    [auditMetrics],
  );

  const auditChartRows = Math.max(auditPassTrendData.length, auditDefectiveTrendData.length, 1);
  const auditChartsHeight = qcChartHeight(auditChartRows);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Factory size={14} className="text-blue-500 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide truncate">
              {dept.activitiesLabel || dept.deptName}
            </h3>
            {dept.activitiesLabel && dept.activitiesLabel !== dept.deptName && (
              <p className="text-[9px] text-slate-500 truncate mt-0.5">{dept.deptName}</p>
            )}
          </div>
          {qcDept && (
            <span className="text-[8px] font-bold uppercase tracking-wide text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded shrink-0">
              QC
            </span>
          )}
          {auditDept && (
            <span className="text-[8px] font-bold uppercase tracking-wide text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded shrink-0">
              Audit
            </span>
          )}
        </div>
        {resourceOptions.length > 0 && (
          <div className="no-print shrink-0 w-[11rem]">
            <SelectDropdown
              value={selectedResourceId}
              onChange={setSelectedResourceId}
              options={resourceOptions}
              icon={Layers}
              placeholder="All resources"
              disabled={resourceLoading}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-wide">Production summary</p>
            {showMetricToggle && <MetricToggle value={yMetric} onChange={setYMetric} />}
          </div>

          <div className="no-print">
          {variant === 'outsource' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <OutsourceMovementBarChart
                title="Sent to vendor"
                data={outsourceSentChart}
                color="#3b82f6"
              />
              <OutsourceMovementBarChart
                title="Received from vendor"
                data={outsourceReceivedChart}
                color="#10b981"
              />
            </div>
          ) : yMetric === 'output' ? (
            <VisitOperationOutputChart
              key={chartDataKey}
              rows={operationChartRows}
              height={DAILY_TREND_CHART_HEIGHT}
            />
          ) : metricLineEmpty ? (
            <div
              className="flex items-center justify-center text-[10px] text-slate-400"
              style={{ height: DAILY_TREND_CHART_HEIGHT }}
            >
              No data for {metricLabel.toLowerCase()}
            </div>
          ) : (
            <ChartSizedContainer height={DAILY_TREND_CHART_HEIGHT}>
              <LineChart data={metricLineData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={axisStyle} />
                <YAxis tick={axisStyle} width={40} unit={yMetric === 'efficiency' ? '%' : undefined} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 10, color: '#64748b' }} />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={metricLineName}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                >
                  <LabelList
                    dataKey="value"
                    position="top"
                    fontSize={9}
                    fill="#64748b"
                    formatter={(v) => {
                      const n = typeof v === 'number' ? v : Number(v);
                      return n != null && !Number.isNaN(n)
                        ? yMetric === 'efficiency'
                          ? `${n.toFixed(2)}%`
                          : String(Math.round(n * 10) / 10)
                        : '';
                    }}
                  />
                </Line>
              </LineChart>
            </ChartSizedContainer>
          )}
          </div>
          <ChartPrintTable
            title="Daily trend"
            columns={['Date', 'Operation', 'Output', 'Target']}
            rows={visitOpBars.map((p) => [
              p.dateLabel,
              p.operationName,
              p.output,
              p.target > 0 ? p.target : '—',
            ])}
          />
          {yMetric !== 'output' && !metricLineEmpty && (
            <ChartPrintTable
              title={metricLabel}
              columns={['Period', metricLineName]}
              rows={metricLineData.map((r) => [r.label, r.value ?? '—'])}
            />
          )}
        </div>

        <div className="flex flex-wrap xl:flex-col gap-2 xl:min-w-[12rem]">
          <DeptKpiChip icon={<Hash size={14} />} label="Days" value={String(kpis.totalDays)} />
          <DeptKpiChip
            icon={<Calendar size={14} />}
            label="Start"
            value={formatShortDate(kpis.startDate)}
          />
          <DeptKpiChip
            icon={<CalendarRange size={14} />}
            label="Plan end"
            value={formatShortDate(dept.endDate)}
          />
          <DeptKpiChip
            icon={<BarChart3 size={14} />}
            label={quantityLabel}
            value={kpis.totalOutput.toLocaleString()}
          />
          {showEfficiency && (
            <DeptKpiChip
              icon={<Gauge size={14} />}
              label="Efficiency"
              value={formatEffPct(kpis.avgEfficiency)}
              accent={efficiencyAccent(kpis.avgEfficiency)}
            />
          )}
          {showProductivity && (
            <DeptKpiChip
              icon={<TrendingUp size={14} />}
              label="Productivity"
              value={kpis.avgProductivity != null ? kpis.avgProductivity.toFixed(1) : '—'}
            />
          )}
        </div>
      </div>

      {qcDept && (
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
          <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-wide xl:col-span-2 mb-1">
            Quality summary
          </p>
          <div className="no-print grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0 items-start xl:col-span-1">
            <div className="min-w-0 flex flex-col">
              <p className="text-[9px] font-semibold uppercase text-slate-500 mb-1.5 shrink-0">
                Top 7 defects
              </p>
              {topDefectChartData.length === 0 ? (
                <div
                  className="flex items-center justify-center text-[10px] text-slate-400 border border-dashed border-slate-200 rounded-xl"
                  style={{ height: qcChartsHeight }}
                >
                  No defect data
                </div>
              ) : (
                <ChartSizedContainer height={qcChartsHeight}>
                  <BarChart
                    data={topDefectChartData}
                    layout="vertical"
                    margin={{ top: 2, right: 20, left: 2, bottom: 2 }}
                    barCategoryGap="12%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={axisStyle} hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={84}
                      tick={DefectYAxisTick}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" fill="#ef4444" radius={[0, 3, 3, 0]} barSize={28}>
                      <LabelList
                        dataKey="count"
                        position="right"
                        fontSize={9}
                        fill="#64748b"
                      />
                    </Bar>
                  </BarChart>
                </ChartSizedContainer>
              )}
            </div>

            <div className="min-w-0 flex flex-col">
              <p className="text-[9px] font-semibold uppercase text-slate-500 mb-1.5 shrink-0">
                Defective % by day
              </p>
              {defectiveTrendData.length === 0 ? (
                <div
                  className="flex items-center justify-center text-[10px] text-slate-400 border border-dashed border-slate-200 rounded-xl"
                  style={{ height: qcChartsHeight }}
                >
                  No defective % data
                </div>
              ) : (
                <ChartSizedContainer height={qcChartsHeight}>
                  <BarChart
                    data={defectiveTrendData}
                    margin={{ top: 14, right: 8, left: 0, bottom: 2 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="label" tick={axisStyle} />
                    <YAxis tick={axisStyle} width={32} unit="%" domain={[0, 'auto']} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v) =>
                        v != null
                          ? [formatPct2(typeof v === 'number' ? v : Number(v)), 'Defective']
                          : ['', 'Defective']
                      }
                    />
                    <Bar dataKey="pct" fill="#ef4444" radius={[3, 3, 0, 0]} barSize={32}>
                      <LabelList
                        dataKey="pct"
                        position="top"
                        fontSize={9}
                        fill="#64748b"
                        formatter={(v) => {
                          const n = typeof v === 'number' ? v : Number(v);
                          return n != null && !Number.isNaN(n) ? formatPct2(n) : '';
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ChartSizedContainer>
              )}
            </div>
          </div>
          <ChartPrintTable
            title="Top 7 defects"
            columns={['Defect', 'Count']}
            rows={topDefectChartData.map((d) => [d.name, d.count])}
          />
          <ChartPrintTable
            title="Defective % by day"
            columns={['Day', 'Defective %']}
            rows={defectiveTrendData.map((d) => [d.label, formatPct2(d.pct)])}
          />

          <div className="flex flex-wrap xl:flex-col gap-2 xl:min-w-[12rem] shrink-0">
            <DeptKpiChip
              icon={<Hash size={14} />}
              label="Total inspected"
              value={qualitySummary ? qualitySummary.inspected.toLocaleString() : '—'}
            />
            <DeptKpiChip
              icon={<TrendingUp size={14} />}
              label="First-time pass"
              value={qualitySummary ? qualitySummary.firstTimePass.toLocaleString() : '—'}
            />
            <DeptKpiChip
              icon={<TrendingUp size={14} />}
              label="Rework passed"
              value={qualitySummary ? qualitySummary.reworkPass.toLocaleString() : '—'}
            />
            <DeptKpiChip
              icon={<Gauge size={14} />}
              label="FTR %"
              value={qualitySummary?.ftrPct != null ? formatPct2(qualitySummary.ftrPct) : '—'}
            />
            <DeptKpiChip
              icon={<Gauge size={14} />}
              label="Defective %"
              value={
                qualitySummary?.avgDefectivePct != null
                  ? formatPct2(qualitySummary.avgDefectivePct)
                  : '—'
              }
            />
            <DeptKpiChip
              icon={<Gauge size={14} />}
              label="DHU"
              value={formatDhu(qualitySummary?.avgDhu ?? null)}
            />
          </div>
        </div>
      )}

      {auditDept && (
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-wide mb-3">
              Audit summary
            </p>
            {!auditMetrics ? (
              <p className="text-[10px] text-slate-400 py-4">No audit sessions in this period</p>
            ) : (
              <div className="no-print grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0 items-start">
                <div className="min-w-0 flex flex-col">
                  <p className="text-[9px] font-semibold uppercase text-slate-500 mb-1.5 shrink-0">
                    Audit pass % by day
                  </p>
                  {auditPassTrendData.length === 0 ? (
                    <div
                      className="flex items-center justify-center text-[10px] text-slate-400 border border-dashed border-slate-200 rounded-xl"
                      style={{ height: auditChartsHeight }}
                    >
                      No pass rate data
                    </div>
                  ) : (
                    <ChartSizedContainer height={auditChartsHeight}>
                      <BarChart
                        data={auditPassTrendData}
                        margin={{ top: 14, right: 8, left: 0, bottom: 2 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={axisStyle} />
                        <YAxis tick={axisStyle} width={32} unit="%" domain={[0, 100]} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v) =>
                            v != null
                              ? [formatPct2(typeof v === 'number' ? v : Number(v)), 'Pass %']
                              : ['', 'Pass %']
                          }
                        />
                        <Bar dataKey="pct" fill="#8b5cf6" radius={[3, 3, 0, 0]} barSize={32}>
                          <LabelList
                            dataKey="pct"
                            position="top"
                            fontSize={9}
                            fill="#64748b"
                            formatter={(v) => {
                              const n = typeof v === 'number' ? v : Number(v);
                              return n != null && !Number.isNaN(n) ? formatPct2(n) : '';
                            }}
                          />
                        </Bar>
                      </BarChart>
                    </ChartSizedContainer>
                  )}
                </div>

                <div className="min-w-0 flex flex-col">
                  <p className="text-[9px] font-semibold uppercase text-slate-500 mb-1.5 shrink-0">
                    Defective % by day
                  </p>
                  {auditDefectiveTrendData.length === 0 ? (
                    <div
                      className="flex items-center justify-center text-[10px] text-slate-400 border border-dashed border-slate-200 rounded-xl"
                      style={{ height: auditChartsHeight }}
                    >
                      No defective % data
                    </div>
                  ) : (
                    <ChartSizedContainer height={auditChartsHeight}>
                      <BarChart
                        data={auditDefectiveTrendData}
                        margin={{ top: 14, right: 8, left: 0, bottom: 2 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="label" tick={axisStyle} />
                        <YAxis tick={axisStyle} width={32} unit="%" domain={[0, 'auto']} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v) =>
                          v != null
                            ? [formatPct2(typeof v === 'number' ? v : Number(v)), 'Defective']
                            : ['', 'Defective']
                        }
                        />
                        <Bar dataKey="pct" fill="#ef4444" radius={[3, 3, 0, 0]} barSize={32}>
                          <LabelList
                            dataKey="pct"
                            position="top"
                            fontSize={9}
                            fill="#64748b"
                            formatter={(v) => {
                              const n = typeof v === 'number' ? v : Number(v);
                              return n != null && !Number.isNaN(n) ? formatPct2(n) : '';
                            }}
                          />
                        </Bar>
                      </BarChart>
                    </ChartSizedContainer>
                  )}
                </div>
              </div>
            )}
          </div>

          {auditMetrics && (
            <div className="flex flex-wrap xl:flex-col gap-2 xl:min-w-[12rem] shrink-0">
              <DeptKpiChip
                icon={<Hash size={14} />}
                label="Total audits"
                value={String(auditMetrics.totalAudits)}
              />
              <DeptKpiChip
                icon={<Gauge size={14} />}
                label="Passed audits"
                value={String(auditMetrics.passedAudits)}
                accent="text-emerald-600"
              />
              <DeptKpiChip
                icon={<Gauge size={14} />}
                label="Failed audits"
                value={String(auditMetrics.failedAudits)}
                accent={auditMetrics.failedAudits > 0 ? 'text-red-600' : 'text-slate-900'}
              />
              <DeptKpiChip
                icon={<Gauge size={14} />}
                label="Lot pass %"
                value={auditMetrics.passPct != null ? formatPct2(auditMetrics.passPct) : '—'}
              />
              <DeptKpiChip
                icon={<Gauge size={14} />}
                label="Defective %"
                value={
                  auditMetrics.defectivePct != null
                    ? formatPct2(auditMetrics.defectivePct)
                    : '—'
                }
              />
              <DeptKpiChip icon={<Gauge size={14} />} label="DHU" value={formatDhu(auditMetrics.dhu)} />
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export interface StyleDeptAnalysisSectionProps {
  factoryId: string;
  orderId: string;
  colorwayId: string | null;
  flowDepts: StyleJourneyDept[];
  dailyRows: StyleDeptDailyRow[];
  deptAuditsById: Map<string, StyleDeptAuditSessionRow[]>;
  dateFrom: string;
  dateTo: string;
  selectedDeptId: string;
}

export const StyleDeptAnalysisSection: React.FC<StyleDeptAnalysisSectionProps> = ({
  factoryId,
  orderId,
  colorwayId,
  flowDepts,
  dailyRows,
  deptAuditsById,
  dateFrom,
  dateTo,
  selectedDeptId,
}) => {
  const deptsToShow = useMemo(() => {
    const eligible = flowDepts.filter(isDeptPerformanceEligible);
    if (selectedDeptId) {
      const one = eligible.find((d) => d.visitId === selectedDeptId);
      return one ? [one] : [];
    }
    return [...eligible].sort((a, b) => a.flowStep - b.flowStep);
  }, [flowDepts, selectedDeptId]);

  const rowsByDept = useMemo(() => {
    const map = new Map<string, StyleDeptDailyRow[]>();
    for (const row of dailyRows) {
      const list = map.get(row.deptId) ?? [];
      list.push(row);
      map.set(row.deptId, list);
    }
    return map;
  }, [dailyRows]);

  if (deptsToShow.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600 px-1">
        Department performance
      </p>
      {deptsToShow.map((dept) => (
        <DeptAnalysisBlock
          key={dept.visitId}
          factoryId={factoryId}
          orderId={orderId}
          colorwayId={colorwayId}
          dept={dept}
          rows={dailyRowsForVisit(dept, flowDepts, rowsByDept)}
          auditSessions={deptAuditsById.get(dept.deptId) ?? []}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      ))}
    </div>
  );
};
