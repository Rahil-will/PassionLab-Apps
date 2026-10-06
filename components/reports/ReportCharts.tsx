import React from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Customized,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const chartMargin = { top: 8, right: 8, left: 0, bottom: 0 };
const axisStyle = { fontSize: 10, fill: '#94a3b8' };
const tooltipStyle = {
  fontSize: 11,
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  backgroundColor: '#fff',
  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
};

function formatChartDate(date: string): string {
  try {
    return format(parseISO(date), 'dd MMM');
  } catch {
    return date;
  }
}

/** Fixed-height Recharts wrapper — avoids width/height -1 when parent uses flex or % sizing. */
export function ChartSizedContainer({
  height,
  children,
}: {
  height: number;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full min-w-0" style={{ height, minHeight: height }}>
      <ResponsiveContainer
        width="100%"
        height={height}
        initialDimension={{ width: 1, height }}
      >
        {children}
      </ResponsiveContainer>
    </div>
  );
}

interface ChartCardProps {
  title: string;
  subtitle?: string;
  height?: number;
  empty?: boolean;
  emptyMessage?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  height = 220,
  empty = false,
  emptyMessage = 'No data for this period',
  footer,
  children,
}) => (
  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
    <p className="text-xs font-semibold text-slate-700 mb-0.5">{title}</p>
    {subtitle && <p className="text-[10px] text-slate-400 mb-3">{subtitle}</p>}
    {!subtitle && <div className="mb-3" />}
    {empty ? (
      <div
        className="flex items-center justify-center text-xs text-slate-400"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    ) : (
      <>
        <ChartSizedContainer height={height}>
            {children}
        </ChartSizedContainer>
        {footer}
      </>
    )}
  </div>
);

interface HourlyBarChartProps {
  data: Array<{ label: string; output: number }>;
  title?: string;
}

export const HourlyBarChart: React.FC<HourlyBarChartProps> = ({ data, title }) => {
  if (data.length === 0) return null;
  return (
    <div className="p-4 border-b border-slate-100">
      {title && <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">{title}</p>}
      <ResponsiveContainer initialDimension={{ width: 1, height: 1 }} width="100%" height={200}>
        <BarChart data={data} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="label" tick={axisStyle} interval={0} angle={-35} textAnchor="end" height={50} />
          <YAxis tick={axisStyle} width={36} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="output" name="Output" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

interface CompareBarChartProps {
  data: Array<{ name: string; output: number; target: number }>;
  title?: string;
}

export const OutputTargetBarChart: React.FC<CompareBarChartProps> = ({ data, title }) => {
  if (data.length === 0) return null;
  return (
    <div className="p-4 border-b border-slate-100">
      {title && <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">{title}</p>}
      <ResponsiveContainer initialDimension={{ width: 1, height: 1 }} width="100%" height={220}>
        <BarChart data={data} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={axisStyle} interval={0} angle={-20} textAnchor="end" height={48} />
          <YAxis tick={axisStyle} width={36} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="output" name="Output" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={32} />
          <Bar dataKey="target" name="Target" fill="#cbd5e1" radius={[6, 6, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

interface ShiftLineChartProps {
  data: Array<{ slot: string; output: number }>;
  title?: string;
}

export const ShiftLineChart: React.FC<ShiftLineChartProps> = ({ data, title }) => {
  if (data.length === 0) return null;
  return (
    <div className="p-4 border-b border-slate-100">
      {title && <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">{title}</p>}
      <ResponsiveContainer initialDimension={{ width: 1, height: 1 }} width="100%" height={180}>
        <LineChart data={data} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="slot" tick={axisStyle} />
          <YAxis tick={axisStyle} width={36} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="output" name="Output" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

interface KpiStripProps {
  items: Array<{ label: string; value: string; accent?: string }>;
  compact?: boolean;
}

export const KpiStrip: React.FC<KpiStripProps> = ({ items, compact = false }) => (
  <div
    className={`grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-slate-100 bg-slate-50/30 ${
      compact ? 'p-2' : 'p-4 gap-3'
    }`}
  >
    {items.map((item) => (
      <div
        key={item.label}
        className={`bg-white rounded-lg border border-slate-200 shadow-sm ${
          compact ? 'px-2 py-1.5' : 'px-3 py-2.5 rounded-xl'
        }`}
      >
        <p
          className={`font-semibold text-slate-400 uppercase tracking-wider ${
            compact ? 'text-[8px]' : 'text-[9px] font-bold'
          }`}
        >
          {item.label}
        </p>
        <p
          className={`font-semibold tabular-nums ${item.accent ?? 'text-slate-800'} ${
            compact ? 'text-xs' : 'text-lg font-bold'
          }`}
        >
          {item.value}
        </p>
      </div>
    ))}
  </div>
);

interface DailyTrendChartProps {
  data: Array<{ date: string; output: number; target: number }>;
  title?: string;
  subtitle?: string;
  height?: number;
  /** Renders chart only — no outer card; for embedding beside KPIs. */
  embedded?: boolean;
}

/** Daily trend chart in department performance cards. */
export const DAILY_TREND_CHART_HEIGHT = 240;

/** @deprecated use DAILY_TREND_CHART_HEIGHT */
export const DEPT_CHART_HEIGHT = DAILY_TREND_CHART_HEIGHT;

const embeddedChartMargin = { top: 8, right: 12, left: 0, bottom: 4 };

function formatAchievementPct(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return '';
  return `${pct.toFixed(0)}%`;
}

function formatOutputBarLabel(output: number, achievementPct: number | null): string {
  if (output <= 0) return '';
  if (achievementPct != null) return `${output} (${formatAchievementPct(achievementPct)})`;
  return String(output);
}

interface ChartLegendItem {
  label: string;
  color: string;
  kind: 'bar' | 'line';
}

const ChartSeriesLegend: React.FC<{ items: ChartLegendItem[] }> = ({ items }) => {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 mt-2 text-[9px] text-slate-500">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.kind === 'line' ? (
            <span className="w-5 h-0 border-t border-dashed border-slate-500" />
          ) : (
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: item.color }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
};

interface TargetLineSpec {
  xKey: string;
  target: number;
}

interface BarTargetLinesProps {
  specs?: TargetLineSpec[];
  xAxisMap?: Record<string, { scale: unknown; x?: number; y?: number }>;
  yAxisMap?: Record<string, { scale: unknown; x?: number; y?: number }>;
}

type BarTargetChartProps = Pick<BarTargetLinesProps, 'xAxisMap' | 'yAxisMap'>;

/** Horizontal target tick centred on each categorical bar band. */
function BarTargetLines(props: BarTargetLinesProps) {
  const specs = props.specs ?? [];
  if (specs.length === 0 || !props.xAxisMap || !props.yAxisMap) return null;

  const xAxis = Object.values(props.xAxisMap)[0];
  const yAxis = Object.values(props.yAxisMap)[0];
  const xScale = xAxis?.scale as ((v: string) => number) & { bandwidth?: () => number };
  const yScale = yAxis?.scale as (v: number) => number;
  if (!xScale || !yScale) return null;

  const bandwidth = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : 32;
  const halfW = bandwidth * 0.44;
  const xOffset = xAxis?.x ?? 0;
  const yOffset = yAxis?.y ?? 0;

  return (
    <g className="bar-target-lines">
      {specs.map(({ xKey, target }) => {
        if (target <= 0) return null;
        const bandX = xScale(xKey);
        if (bandX == null || Number.isNaN(bandX)) return null;
        const cx = xOffset + bandX + bandwidth / 2;
        const cy = yOffset + yScale(target);
        if (Number.isNaN(cy)) return null;
        return (
          <line
            key={`target-${xKey}`}
            x1={cx - halfW}
            x2={cx + halfW}
            y1={cy}
            y2={cy}
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        );
      })}
    </g>
  );
}

function VisitOpAxisTick({
  x,
  y,
  payload,
  points,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  points: VisitOperationBarPoint[];
}) {
  const p = points.find((pt) => pt.key === payload?.value);
  if (p == null || x == null || y == null) return null;
  const shortOp =
    p.operationName.length > 16 ? `${p.operationName.slice(0, 15)}…` : p.operationName;
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" dy={12} fill="#64748b" fontSize={10}>{p.dateLabel}</text>
      <text textAnchor="middle" dy={24} fill="#94a3b8" fontSize={8}>{shortOp}</text>
    </g>
  );
}

export const DailyTrendChart: React.FC<DailyTrendChartProps> = ({
  data,
  title = 'Daily Output Trend',
  subtitle = 'pieces per day',
  height = DEPT_CHART_HEIGHT,
  embedded = false,
}) => {
  const chartData = data.map((d) => {
    const achievementPct = d.target > 0 ? (d.output / d.target) * 100 : null;
    return {
      ...d,
      label: formatChartDate(d.date),
      achievementPct,
      outputLabel: formatOutputBarLabel(d.output, achievementPct),
    };
  });
  const empty = chartData.length === 0;
  const yMax = Math.max(
    ...chartData.map((d) => Math.max(d.output, d.target)),
    1,
  );
  const yDomain: [number, number] = [0, Math.ceil(yMax * 1.12)];

  const chart = (
    <ComposedChart data={chartData} margin={embedded ? embeddedChartMargin : chartMargin}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
      <XAxis dataKey="label" tick={axisStyle} interval="preserveStartEnd" />
      <YAxis tick={axisStyle} width={40} domain={yDomain} allowDecimals={false} />
      <Tooltip
        contentStyle={tooltipStyle}
        formatter={(value, name, item) => {
          const qty = typeof value === 'number' ? value : Number(value ?? 0);
          const pct = item?.payload?.achievementPct;
          if (name === 'Output' && pct != null) {
            return [`${qty.toLocaleString()} (${pct.toFixed(0)}% of target)`, 'Output'];
          }
          return [qty.toLocaleString(), name ?? ''];
        }}
      />
      <Bar dataKey="output" name="Output" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={52} legendType="none">
        {(embedded || chartData.some((d) => d.target > 0)) && (
          <LabelList
            dataKey="outputLabel"
            position="top"
            fontSize={9}
            fill="#64748b"
          />
        )}
      </Bar>
      {chartData.some((d) => d.target > 0) && (
        <Customized
          component={(chartProps: BarTargetChartProps) => (
            <BarTargetLines
              specs={chartData
                .filter((d) => d.target > 0)
                .map((d) => ({ xKey: d.label, target: d.target }))}
              xAxisMap={chartProps.xAxisMap}
              yAxisMap={chartProps.yAxisMap}
            />
          )}
        />
      )}
    </ComposedChart>
  );

  const dailyLegend: ChartLegendItem[] = [
    { label: 'Output', color: '#3b82f6', kind: 'bar' },
    ...(chartData.some((d) => d.target > 0)
      ? [{ label: 'Target', color: '#64748b', kind: 'line' as const }]
      : []),
  ];

  if (embedded) {
    return empty ? (
      <div
        className="flex items-center justify-center text-[10px] text-slate-400"
        style={{ height }}
      >
        No daily capture data
      </div>
    ) : (
      <div className="w-full min-w-0">
        <ChartSizedContainer height={height}>
          {chart}
        </ChartSizedContainer>
        <ChartSeriesLegend items={dailyLegend} />
      </div>
    );
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      height={height}
      empty={empty}
      footer={!empty ? <ChartSeriesLegend items={dailyLegend} /> : undefined}
    >
      {chart}
    </ChartCard>
  );
};

/** Bar color: loading ops green, produce/output ops blue. */
export function operationOutputBarColor(operationName: string, stepType?: string | null): string {
  if (stepType === 'loading') return '#10b981';
  const n = operationName.toLowerCase();
  if (/load/.test(n)) return '#10b981';
  return '#3b82f6';
}

export interface VisitOperationBarPoint {
  key: string;
  date: string;
  dateLabel: string;
  operationName: string;
  output: number;
  target: number;
  color: string;
}

export interface DailyOutputTargetPoint {
  date: string;
  label: string;
  output: number;
  loadingOutput: number;
  produceOutput: number;
  target: number;
  achievementPct: number | null;
  outputLabel: string;
}

/** Daily totals with output vs target for proportional bar charts. */
export function buildDailyOutputTargetPoints(
  rows: Array<{
    date: string;
    output: number;
    target: number;
    operationName?: string;
    dailyAvailableMins?: number;
  }>,
): DailyOutputTargetPoint[] {
  const byDate = new Map<string, { loading: number; produce: number; target: number }>();

  for (const r of rows) {
    if (r.output <= 0 && (r.dailyAvailableMins ?? 0) <= 0 && r.target <= 0) continue;
    const cur = byDate.get(r.date) ?? { loading: 0, produce: 0, target: 0 };
    const operationName = r.operationName?.trim() || 'Output';
    const color = operationOutputBarColor(operationName);
    if (color === '#10b981') cur.loading += r.output;
    else cur.produce += r.output;
    cur.target = Math.max(cur.target, r.target);
    byDate.set(r.date, cur);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const output = v.loading + v.produce;
      const achievementPct = v.target > 0 ? (output / v.target) * 100 : null;
      return {
        date,
        label: formatChartDate(date),
        output,
        loadingOutput: v.loading,
        produceOutput: v.produce,
        target: v.target,
        achievementPct,
        outputLabel: formatOutputBarLabel(output, achievementPct),
      };
    });
}

/** One bar per capture day × operation — separate x-axis slots (loading green, produce blue). */
export function buildVisitOperationBarPoints(
  rows: Array<{
    date: string;
    output: number;
    target: number;
    operationId?: string;
    operationName?: string;
    dailyAvailableMins?: number;
  }>,
): VisitOperationBarPoint[] {
  const points: VisitOperationBarPoint[] = [];
  for (const r of rows) {
    if (r.output <= 0 && (r.dailyAvailableMins ?? 0) <= 0) continue;
    const operationName = r.operationName?.trim() || 'Output';
    const opKey = r.operationId || operationName;
    points.push({
      key: `${r.date}|${opKey}`,
      date: r.date,
      dateLabel: formatChartDate(r.date),
      operationName,
      output: r.output,
      target: r.target,
      color: operationOutputBarColor(operationName),
    });
  }
  return points.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    const aLoad = a.color === '#10b981' ? 0 : 1;
    const bLoad = b.color === '#10b981' ? 0 : 1;
    return aLoad - bLoad || a.operationName.localeCompare(b.operationName);
  });
}

interface VisitOperationOutputChartProps {
  rows: Array<{
    date: string;
    output: number;
    target: number;
    operationId?: string;
    operationName?: string;
    dailyAvailableMins?: number;
  }>;
  height?: number;
  emptyMessage?: string;
}

/** One bar per operation capture day — loading and produce as separate bars. */
export const VisitOperationOutputChart: React.FC<VisitOperationOutputChartProps> = ({
  rows,
  height = DAILY_TREND_CHART_HEIGHT,
  emptyMessage = 'No daily capture data',
}) => {
  const points = buildVisitOperationBarPoints(rows);
  const empty = points.length === 0;
  const chartKey = points.map((p) => `${p.key}:${p.output}:${p.target}`).join('|');
  const yMax = Math.max(...points.map((p) => Math.max(p.output, p.target)), 1);
  const yDomain: [number, number] = [0, Math.ceil(yMax * 1.12)];
  const hasLoading = points.some((p) => p.color === '#10b981' && p.output > 0);
  const hasProduce = points.some((p) => p.color === '#3b82f6' && p.output > 0);
  const hasTarget = points.some((p) => p.target > 0);
  const targetSpecs = points
    .filter((p) => p.target > 0)
    .map((p) => ({ xKey: p.key, target: p.target }));
  const chartHeight = Math.max(height, points.length > 3 ? height + 20 : height);

  const legendItems: ChartLegendItem[] = [
    ...(hasLoading ? [{ label: 'Loading', color: '#10b981', kind: 'bar' as const }] : []),
    ...(hasProduce ? [{ label: 'Output', color: '#3b82f6', kind: 'bar' as const }] : []),
    ...(hasTarget ? [{ label: 'Target', color: '#64748b', kind: 'line' as const }] : []),
  ];

  if (empty) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-slate-400 rounded-xl border border-dashed border-slate-200 bg-slate-50/40"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const margin = { top: 22, right: 12, left: 4, bottom: 48 };

  return (
    <div className="w-full min-w-0">
      <div className="w-full min-w-0">
        <ChartSizedContainer height={chartHeight}>
          <BarChart
            key={chartKey}
            data={points}
            margin={margin}
            barCategoryGap="24%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="key"
              tick={(props) => <VisitOpAxisTick {...props} points={points} />}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
              interval={0}
              height={48}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={42}
              allowDecimals={false}
              domain={yDomain}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
              formatter={(value, _name, item) => {
                const qty = typeof value === 'number' ? value : Number(value ?? 0);
                const p = item?.payload as VisitOperationBarPoint | undefined;
                if (!p) return [qty.toLocaleString(), 'Output'];
                const pct = p.target > 0 ? (p.output / p.target) * 100 : null;
                const label = p.color === '#10b981' ? 'Loading' : 'Output';
                if (pct != null) {
                  return [`${qty.toLocaleString()} (${formatAchievementPct(pct)} of target)`, label];
                }
                return [qty.toLocaleString(), label];
              }}
              labelFormatter={(_label, payload) => {
                const p = payload?.[0]?.payload as VisitOperationBarPoint | undefined;
                return p ? `${p.dateLabel} · ${p.operationName}` : '';
              }}
            />
            <Bar dataKey="output" legendType="none" radius={[4, 4, 0, 0]} maxBarSize={44}>
              {points.map((p) => (
                <Cell key={p.key} fill={p.color} />
              ))}
              <LabelList
                dataKey="output"
                position="top"
                fontSize={9}
                fill="#64748b"
                formatter={(v) => {
                  const n = typeof v === 'number' ? v : Number(v ?? 0);
                  return n > 0 ? String(n) : '';
                }}
              />
            </Bar>
            <Customized
              component={(chartProps: BarTargetChartProps) => (
                <BarTargetLines
                  specs={targetSpecs}
                  xAxisMap={chartProps.xAxisMap}
                  yAxisMap={chartProps.yAxisMap}
                />
              )}
            />
          </BarChart>
        </ChartSizedContainer>
      </div>
      <ChartSeriesLegend items={legendItems} />
    </div>
  );
};

interface EfficiencyLineChartProps {
  data: Array<{ date: string; efficiency: number | null }>;
  title?: string;
  subtitle?: string;
  height?: number;
}

export const EfficiencyLineChart: React.FC<EfficiencyLineChartProps> = ({
  data,
  title = 'Efficiency %',
  subtitle = 'daily average',
  height = 200,
}) => {
  const chartData = data.map((d) => ({
    ...d,
    label: formatChartDate(d.date),
    efficiency: d.efficiency ?? undefined,
  }));
  const empty = chartData.every((d) => d.efficiency == null);
  const showDots = chartData.length <= 14;
  const effValues = chartData.map((d) => d.efficiency).filter((v): v is number => v != null);
  const effMax = effValues.length > 0 ? Math.max(...effValues, 100) : 100;
  const yDomain: [number, number] = [0, Math.ceil(Math.max(effMax * 1.08, 100))];

  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={empty}>
      <LineChart data={chartData} margin={chartMargin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
        <XAxis dataKey="label" tick={axisStyle} interval="preserveStartEnd" />
        <YAxis tick={axisStyle} width={40} unit="%" domain={yDomain} />
        <Tooltip contentStyle={tooltipStyle} />
        <ReferenceLine y={100} stroke="#10b981" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="efficiency"
          name="Efficiency"
          stroke="#3b82f6"
          strokeWidth={2}
          connectNulls={false}
          dot={showDots ? { r: 3, fill: '#fff', stroke: '#3b82f6', strokeWidth: 2 } : false}
        />
      </LineChart>
    </ChartCard>
  );
};

interface DhuLineChartProps {
  data: Array<{ date: string; dhu: number | null }>;
  title?: string;
  subtitle?: string;
  height?: number;
}

export const DhuLineChart: React.FC<DhuLineChartProps> = ({
  data,
  title = 'DHU by Day',
  subtitle = 'DHU (Defects Per Hundred Units)',
  height = 200,
}) => {
  const chartData = data.map((d) => ({
    ...d,
    label: formatChartDate(d.date),
    dhu: d.dhu ?? undefined,
  }));
  const empty = chartData.every((d) => d.dhu == null);
  const showDots = chartData.length <= 14;

  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={empty}>
      <LineChart data={chartData} margin={chartMargin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
        <XAxis dataKey="label" tick={axisStyle} interval="preserveStartEnd" />
        <YAxis tick={axisStyle} width={40} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line
          type="monotone"
          dataKey="dhu"
          name="DHU"
          stroke="#f59e0b"
          strokeWidth={2}
          connectNulls={false}
          dot={showDots ? { r: 3, fill: '#fff', stroke: '#f59e0b', strokeWidth: 2 } : false}
        />
      </LineChart>
    </ChartCard>
  );
};

interface DefectivePctLineChartProps {
  data: Array<{ date: string; defectivePct: number | null }>;
  title?: string;
  subtitle?: string;
  height?: number;
}

export const DefectivePctLineChart: React.FC<DefectivePctLineChartProps> = ({
  data,
  title = 'Defective %',
  subtitle = 'failed + rework vs inspected',
  height = 200,
}) => {
  const chartData = data.map((d) => ({
    ...d,
    label: formatChartDate(d.date),
    defectivePct: d.defectivePct ?? undefined,
  }));
  const empty = chartData.every((d) => d.defectivePct == null);
  const showDots = chartData.length <= 14;

  return (
    <ChartCard title={title} subtitle={subtitle} height={height} empty={empty}>
      <LineChart data={chartData} margin={chartMargin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" />
        <XAxis dataKey="label" tick={axisStyle} interval="preserveStartEnd" />
        <YAxis tick={axisStyle} width={40} unit="%" />
        <Tooltip contentStyle={tooltipStyle} />
        <ReferenceLine y={3} stroke="#ef4444" strokeDasharray="4 4" />
        <Line
          type="monotone"
          dataKey="defectivePct"
          name="Defective %"
          stroke="#ef4444"
          strokeWidth={2}
          connectNulls={false}
          dot={showDots ? { r: 3, fill: '#fff', stroke: '#ef4444', strokeWidth: 2 } : false}
        />
      </LineChart>
    </ChartCard>
  );
};
