import React, { useMemo } from 'react';
import { Card } from '../ui';
import {
  DailyTrendChart,
  DefectivePctLineChart,
  DhuLineChart,
  EfficiencyLineChart,
  KpiStrip,
} from './ReportCharts';
import type { StyleDeptDailyRow, StyleJourneyDept } from '../../lib/mesReportsApi';
import { dailyRowsForVisit } from '../../lib/reportVisitDailyRows';
import { formatDhu, formatPct } from '../../lib/mesReportsApi';
import { isDeptPerformanceEligible, isQcDept } from '../../lib/reportDeptUtils';

const HOURLY_QUALITY_MESSAGE =
  'This department uses hourly output capture — quality charts are not available';

function efficiencyAccent(efficiency: number | null): string {
  if (efficiency == null) return 'text-slate-800';
  if (efficiency >= 100) return 'text-emerald-600';
  if (efficiency >= 75) return 'text-amber-600';
  return 'text-red-600';
}

function QualityPlaceholder({ title }: { title: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3">
      <p className="text-[10px] font-semibold text-slate-700 mb-0.5">{title}</p>
      <div
        className="flex items-center justify-center text-[10px] text-slate-400 text-center px-4"
        style={{ height: 200 }}
      >
        {HOURLY_QUALITY_MESSAGE}
      </div>
    </div>
  );
}

interface DeptKpiSummary {
  totalOutput: number;
  avgDailyOutput: number;
  avgEfficiency: number | null;
  avgDhu: number | null;
}

function computeDeptKpis(
  rows: StyleDeptDailyRow[],
  dateFrom: string,
  dateTo: string,
): DeptKpiSummary {
  const filtered = rows.filter((r) => r.date >= dateFrom && r.date <= dateTo);
  const totalOutput = filtered.reduce((s, r) => s + r.output, 0);
  const dayCount = new Set(filtered.map((r) => r.date)).size || 1;
  let effSum = 0;
  let effCount = 0;
  let dhuSum = 0;
  let dhuWeight = 0;

  for (const r of filtered) {
    if (r.efficiency != null) {
      effSum += r.efficiency;
      effCount += 1;
    }
    if (r.dhu != null) {
      const weight = r.output > 0 ? r.output : 1;
      dhuSum += r.dhu * weight;
      dhuWeight += weight;
    }
  }

  return {
    totalOutput,
    avgDailyOutput: totalOutput / dayCount,
    avgEfficiency: effCount ? effSum / effCount : null,
    avgDhu: dhuWeight > 0 ? dhuSum / dhuWeight : null,
  };
}

interface DeptChartsBlockProps {
  dept: StyleJourneyDept;
  rows: StyleDeptDailyRow[];
  deptApps: Map<string, string[] | null>;
  dateFrom: string;
  dateTo: string;
}

const DeptChartsBlock: React.FC<DeptChartsBlockProps> = ({
  dept,
  rows,
  deptApps,
  dateFrom,
  dateTo,
}) => {
  const qcDept = isQcDept(deptApps.get(dept.deptId) ?? null);
  const opLabel = dept.activitiesLabel || dept.deptName;
  const deptBadge =
    dept.activitiesLabel && dept.activitiesLabel !== dept.deptName
      ? ` · ${opLabel} (${dept.deptName})`
      : ` · ${opLabel}`;

  const filtered = useMemo(
    () => rows.filter((r) => r.date >= dateFrom && r.date <= dateTo),
    [rows, dateFrom, dateTo],
  );

  const kpi = useMemo(() => computeDeptKpis(rows, dateFrom, dateTo), [rows, dateFrom, dateTo]);

  const trendData = useMemo(
    () => filtered.map((r) => ({ date: r.date, output: r.output, target: r.target })),
    [filtered],
  );

  const efficiencyData = useMemo(
    () => filtered.map((r) => ({ date: r.date, efficiency: r.efficiency })),
    [filtered],
  );

  const dhuData = useMemo(
    () => filtered.map((r) => ({ date: r.date, dhu: r.dhu })),
    [filtered],
  );

  const defectiveData = useMemo(
    () => filtered.map((r) => ({ date: r.date, defectivePct: r.defectivePct })),
    [filtered],
  );

  const hasData = filtered.length > 0;

  return (
    <Card noPadding className="overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-white">
        <h3 className="text-[10px] font-semibold text-slate-800 uppercase tracking-wide">
          {opLabel}
        </h3>
        {dept.activitiesLabel && dept.activitiesLabel !== dept.deptName && (
          <p className="text-[9px] text-slate-500 mt-0.5">{dept.deptName}</p>
        )}
      </div>

      <KpiStrip
        compact
        items={[
          { label: 'Total Output', value: String(Math.round(kpi.totalOutput)) },
          { label: 'Avg Daily Output', value: String(Math.round(kpi.avgDailyOutput)) },
          {
            label: 'Avg Efficiency',
            value: formatPct(kpi.avgEfficiency),
            accent: efficiencyAccent(kpi.avgEfficiency),
          },
          { label: 'Avg DHU', value: formatDhu(kpi.avgDhu) },
        ]}
      />

      {!hasData ? (
        <p className="px-4 py-8 text-center text-[10px] text-slate-400">No data in this range</p>
      ) : (
        <div className="p-4 grid gap-4 md:grid-cols-2">
          <DailyTrendChart
            title="Daily Output"
            subtitle={`pieces per day${deptBadge}`}
            data={trendData}
          />
          <EfficiencyLineChart
            title="Efficiency %"
            subtitle={`daily average${deptBadge}`}
            data={efficiencyData}
          />
          {qcDept ? (
            <DhuLineChart
              title="DHU by Day"
              subtitle={`DHU (Defects Per Hundred Units)${deptBadge}`}
              data={dhuData}
            />
          ) : (
            <QualityPlaceholder title="DHU by Day" />
          )}
          {qcDept ? (
            <DefectivePctLineChart
              title="Defective %"
              subtitle={`failed + rework vs inspected${deptBadge}`}
              data={defectiveData}
            />
          ) : (
            <QualityPlaceholder title="Defective %" />
          )}
        </div>
      )}
    </Card>
  );
};

export interface StyleDailyChartsSectionProps {
  dailyRows: StyleDeptDailyRow[];
  flowDepts: StyleJourneyDept[];
  deptApps: Map<string, string[] | null>;
  dateFrom: string;
  dateTo: string;
  /** Empty string = show all departments stacked. */
  selectedDeptId: string;
}

export const StyleDailyChartsSection: React.FC<StyleDailyChartsSectionProps> = ({
  dailyRows,
  flowDepts,
  deptApps,
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
    return eligible;
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
    return (
      <Card className="p-8 text-center text-[10px] text-slate-400">
        No departments in process flow.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {deptsToShow.map((dept) => (
        <DeptChartsBlock
          key={dept.visitId}
          dept={dept}
          rows={dailyRowsForVisit(dept, flowDepts, rowsByDept)}
          deptApps={deptApps}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      ))}
    </div>
  );
};
