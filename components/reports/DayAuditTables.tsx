import React, { useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import {
  computeDayAuditKpis,
  isAuditLotPass,
  type DayAuditRow,
} from '../../lib/reports/day/auditReport';
import { formatPct2 } from '../../lib/mesMetrics';

function formatDayLabel(iso: string): string {
  try {
    return format(parseISO(iso), 'dd MMM yyyy');
  } catch {
    return iso;
  }
}

function qtyCell(value: number): string {
  return value > 0 ? value.toLocaleString() : '—';
}

export interface DayAuditTablesProps {
  deptName: string;
  rows: DayAuditRow[];
  loading?: boolean;
  multiDay?: boolean;
  shipmentDesk?: boolean;
}

export const DayAuditTables: React.FC<DayAuditTablesProps> = ({
  deptName,
  rows,
  loading = false,
  multiDay = false,
  shipmentDesk = false,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const kpis = useMemo(() => computeDayAuditKpis(rows), [rows]);
  const shipmentMode = shipmentDesk || rows.some((r) => Boolean(r.auditType));
  const colSpan = (multiDay ? 1 : 0) + (shipmentMode ? 10 : 11);

  const grouped = useMemo(() => {
    if (!multiDay) return [{ date: rows[0]?.logDate ?? '', rows }];
    const byDate = new Map<string, DayAuditRow[]>();
    for (const row of rows) {
      const list = byDate.get(row.logDate) ?? [];
      list.push(row);
      byDate.set(row.logDate, list);
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayRows]) => ({ date, rows: dayRows }));
  }, [rows, multiDay]);

  return (
    <div className="flex flex-col w-full rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors shrink-0"
      >
        <ClipboardCheck size={13} className="text-violet-500 shrink-0" />
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
          {deptName} — Audits
        </h3>
        <span className="text-[9px] text-slate-500 tabular-nums">
          {loading
            ? 'Loading…'
            : rows.length === 0
              ? 'No sessions'
              : `Lots ${kpis.lots.toLocaleString()} · Passed ${kpis.lotsPassed.toLocaleString()} · Failed ${kpis.lotsFailed.toLocaleString()}${
                  kpis.passPct != null ? ` · Pass ${formatPct2(kpis.passPct)}` : ''
                }`}
        </span>
        <span className="ml-auto text-slate-400 shrink-0">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {!collapsed && (
        <div className={t.scroll}>
          <table className={t.table}>
            <thead className={t.thead}>
              <tr>
                {multiDay && <th className={`${t.firstHead} text-left`}>Date</th>}
                <th className={`${t.firstHead} text-left`}>Style</th>
                <th className={t.numHead}>Buyer</th>
                <th className={t.numHead}>PO</th>
                <th className={t.numHead}>Color</th>
                {!shipmentMode && <th className={t.numHead}>Resource</th>}
                <th className={t.numHead}>{shipmentMode ? 'Type' : 'Operation'}</th>
                <th className={t.numHead}>AQL</th>
                <th className={t.numHead}>Sample</th>
                <th className={t.numHead}>Passed</th>
                <th className={t.numHead}>Failed</th>
                <th className={t.numHead}>Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="py-5 text-center text-slate-400 text-[10px]"
                  >
                    {shipmentMode
                      ? 'No completed shipment audits in this period'
                      : 'No completed audits in this period'}
                  </td>
                </tr>
              ) : (
                grouped.flatMap((group) => {
                  const body = group.rows.map((row) => {
                    const pass = isAuditLotPass(row.result, row.failed);
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        {multiDay && (
                          <td className={`${t.firstCell} text-slate-600 whitespace-nowrap`}>
                            {formatDayLabel(row.logDate)}
                          </td>
                        )}
                        <td className={`${t.firstCell} text-left text-slate-800`}>
                          {row.styleName || '—'}
                        </td>
                        <td className={t.numCell}>{row.buyerName || '—'}</td>
                        <td className={t.numCell}>{row.poNumber || '—'}</td>
                        <td className={t.numCell}>{row.colorName || '—'}</td>
                        {!shipmentMode && (
                          <td className={t.numCell}>{row.resourceName || '—'}</td>
                        )}
                        <td className={t.numCell}>{row.operationName || '—'}</td>
                        <td className={t.numCell}>{row.aqlLevel || '—'}</td>
                        <td className={t.numCell}>{qtyCell(row.sampleSize)}</td>
                        <td className={t.numCell}>{qtyCell(row.passed)}</td>
                        <td className={t.numCell}>{qtyCell(row.failed)}</td>
                        <td className={t.numCell}>
                          <span
                            className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide ${
                              pass
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {pass ? 'Pass' : 'Fail'}
                          </span>
                        </td>
                      </tr>
                    );
                  });
                  return body;
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
