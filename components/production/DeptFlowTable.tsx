import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import type { VisitFlowMetrics } from '../../lib/orderFlowMetrics';
interface DeptFlowTableProps {
  metrics: VisitFlowMetrics[];
  emptyMessage?: string;
}

function qtyCell(value: number): string {
  return value > 0 ? value.toLocaleString() : '—';
}

export const DeptFlowTable: React.FC<DeptFlowTableProps> = ({
  metrics,
  emptyMessage = 'No routing or flow data yet.',
}) => (
  <div className={`${t.wrapper} rounded-2xl`}>
    <div className={t.scroll}>
      <table className={t.table}>
        <thead className={t.thead}>
          <tr>
            <th className={`${t.firstHead} text-left`}>Department</th>
            <th className={`${t.firstHead} text-left`}>Activities</th>
            <th className={t.numHead}>Received</th>
            <th className={t.numHead}>Produced</th>
            <th className={t.numHead}>Sent</th>
            <th className={t.numHead}>In transit</th>
            <th className={t.numHead}>
              <span className="inline-flex items-center gap-0.5 justify-center">
                <AlertTriangle size={10} />
                Missing
              </span>
            </th>
            <th className={t.numHead}>WIP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {metrics.length === 0 ? (
            <tr>
              <td colSpan={8} className="p-6 text-center text-slate-400 italic">{emptyMessage}</td>
            </tr>
          ) : metrics.map((row) => (
            <tr key={row.visitId}>
              <td className={t.firstCell}>
                <span className="font-semibold text-[10px] text-slate-800">{row.deptName}</span>
              </td>
              <td className={t.firstCell}>
                <span className="text-[10px] text-slate-500" title={row.activitiesLabel || undefined}>
                  {row.activitiesLabel || '—'}
                </span>
              </td>
              <td className={t.numCell}>{qtyCell(row.received)}</td>
              <td className={`${t.numCell} text-slate-900`}>{qtyCell(row.produced)}</td>
              <td className={t.numCell}>{qtyCell(row.sent)}</td>
              <td className={t.numCell}>{qtyCell(row.inTransit ?? 0)}</td>
              <td className={t.numCell}>
                {(row.missingInTransit ?? 0) > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-amber-700 font-bold">
                    <AlertTriangle size={10} />
                    {(row.missingInTransit ?? 0).toLocaleString()}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className={t.numCell}>{qtyCell(row.wip)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
