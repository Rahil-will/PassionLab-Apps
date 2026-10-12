import React from 'react';
import { AlertTriangle, Factory, Package } from 'lucide-react';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import type { StyleJourneyDept } from '../../lib/mesReportsApi';
import { shipmentFlowDisplayQty } from '../../lib/orderFlowMetrics';

export interface StyleFlowTableProps {
  flowDepts: StyleJourneyDept[];
  adjQty: number;
}

function qtyCell(value: number): string {
  return value > 0 ? value.toLocaleString() : '—';
}

export const StyleFlowTable: React.FC<StyleFlowTableProps> = ({ flowDepts, adjQty }) => {
  const sorted = [...flowDepts].sort((a, b) => a.flowStep - b.flowStep);

  return (
    <section>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Package size={14} className="text-blue-500" />
        <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
          Department flow
        </h2>
        <span className="ml-auto text-[9px] text-slate-500 tabular-nums">
          Adj qty: <strong className="text-slate-800">{adjQty.toLocaleString()}</strong>
        </span>
      </div>
      <div className={`${t.wrapper} rounded-2xl`}>
        <div className={t.scroll}>
          <table className={t.table}>
            <thead className={t.thead}>
              <tr>
                <th className={`${t.deptHead} text-left min-w-[6rem]`}>Department</th>
                <th className={`${t.deptHead} text-left min-w-[6rem]`}>Operations</th>
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
            <tbody className="divide-y divide-slate-100">
              {sorted.map((dept, index) => {
                const isFirst = dept.flowStep === sorted[0]?.flowStep;
                const isLast = index === sorted.length - 1;
                const operationLabel = dept.activitiesLabel || '—';
                const inTransit = dept.inTransit ?? 0;
                const missing = dept.missingInTransit ?? 0;
                const cols = shipmentFlowDisplayQty(dept);

                return (
                  <tr key={dept.visitId} className="hover:bg-slate-50/80">
                    <td className={`${t.deptCell} text-left font-semibold text-slate-800`}>
                      <span className="inline-flex items-center gap-1.5">
                        <Factory size={11} className="text-blue-400" />
                        {dept.deptName}
                        {dept.isQcDept && (
                          <span className="text-[8px] font-bold uppercase text-amber-700 bg-amber-50 px-1 rounded">
                            QC
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      className={`${t.deptCell} text-left text-[10px] text-slate-600`}
                      title={operationLabel}
                    >
                      {operationLabel}
                    </td>
                    <td className={t.numCell}>{isFirst ? '—' : dept.received.toLocaleString()}</td>
                    <td className={`${t.numCell} text-slate-900`}>{qtyCell(cols.produced)}</td>
                    <td className={t.numCell}>
                      {cols.isShipment ? qtyCell(cols.sent) : isLast ? '—' : dept.sent.toLocaleString()}
                    </td>
                    <td className={t.numCell}>{qtyCell(inTransit)}</td>
                    <td className={t.numCell}>
                      {missing > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-amber-700 font-bold">
                          <AlertTriangle size={10} />
                          {missing.toLocaleString()}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={t.numCell}>{qtyCell(cols.wip)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
