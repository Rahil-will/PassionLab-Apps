import React, { useMemo } from 'react';
import { Grid3x3 } from 'lucide-react';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import type { SizeMap } from '../../lib/mesSizeDisplay';
import { buildMatrixDeptHeaderGroups, matrixColumnKey, operationHeaderLabel } from '../../lib/productionMatrixHeaders';

export interface ProductionMatrixVisitCol {
  /** Unique column key — one per routing step / operation. */
  stepId: string;
  visitId: string;
  deptId: string;
  deptName: string;
  activitiesLabel?: string;
}

export interface ProductionMatrixTableProps {
  sizeKeys: string[];
  visitColumns: ProductionMatrixVisitCol[];
  orderQtyBySize: SizeMap;
  adjQtyBySize: SizeMap;
  rejectedBySize: SizeMap;
  readyToShipBySize: SizeMap;
  shippedBySize: SizeMap;
  balanceBySize: SizeMap;
  sumColumnSize: (column: ProductionMatrixVisitCol, size: string) => number;
  sumColumnTotal: (column: ProductionMatrixVisitCol) => number;
  renderOperationValue?: (value: number, column: ProductionMatrixVisitCol, size?: string) => React.ReactNode;
  totals: {
    order: number;
    adj: number;
    rejected: number;
    ready: number;
    shipped: number;
    balance: number;
  };
  loading?: boolean;
}

export const ProductionMatrixTable: React.FC<ProductionMatrixTableProps> = ({
  sizeKeys,
  visitColumns,
  orderQtyBySize,
  adjQtyBySize,
  rejectedBySize,
  readyToShipBySize,
  shippedBySize,
  balanceBySize,
  sumColumnSize,
  sumColumnTotal,
  renderOperationValue,
  totals,
  loading = false,
}) => {
  const deptGroups = useMemo(() => buildMatrixDeptHeaderGroups(visitColumns), [visitColumns]);

  return (
  <section>
    <div className="flex items-center gap-2 mb-2 px-1">
      <Grid3x3 size={14} className="text-blue-500" />
      <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
        Production matrix
      </h2>
      {loading && (
        <span className="no-print text-[9px] font-normal text-slate-400">Loading sizes…</span>
      )}
      <span className="ml-auto text-[9px] text-slate-500 tabular-nums">
        Adj qty: <strong className="text-slate-800">{totals.adj.toLocaleString()}</strong>
      </span>
    </div>
    <div className={`${t.wrapper} rounded-2xl`}>
      <div className={t.scroll}>
        <table className={`${t.table} mes-report-matrix`}>
          <thead className={t.thead}>
            <tr>
              <th rowSpan={2} className={t.firstHead}>Size</th>
              <th rowSpan={2} className={t.numHead}>Order qty</th>
              <th rowSpan={2} className={t.adjHead}>Adj qty</th>
              {deptGroups.map((group) => (
                <th
                  key={`dept-${matrixColumnKey(group.cols[0])}`}
                  colSpan={group.cols.length}
                  className={`${t.deptHead} text-center border-b border-slate-200/80`}
                >
                  {group.deptName}
                </th>
              ))}
              <th rowSpan={2} className={t.numHead}>Rejected</th>
              <th rowSpan={2} className={t.numHead}>Ready to ship</th>
              <th rowSpan={2} className={t.numHead}>Shipped</th>
              <th rowSpan={2} className={`${t.numHead} border-r-0`}>Balance</th>
            </tr>
            <tr>
              {visitColumns.map((col) => (
                <th
                  key={`op-${matrixColumnKey(col)}`}
                  className={`${t.deptHead} text-[9px] font-semibold normal-case tracking-normal text-slate-500`}
                  title={col.activitiesLabel || col.deptName}
                >
                  {operationHeaderLabel(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sizeKeys.map((size) => (
              <tr key={size} className="hover:bg-slate-50/80">
                <td className={`${t.firstCell} font-bold text-slate-800`}>{size}</td>
                <td className={t.numCell}>{orderQtyBySize[size] ?? 0}</td>
                <td className={t.adjCell}>{adjQtyBySize[size] ?? 0}</td>
                {visitColumns.map((col) => (
                  <td key={matrixColumnKey(col)} className={t.deptCell}>
                    {renderOperationValue
                      ? renderOperationValue(sumColumnSize(col, size), col, size)
                      : sumColumnSize(col, size) || '—'}
                  </td>
                ))}
                <td className={t.numCell}>{rejectedBySize[size] ?? 0}</td>
                <td className={`${t.numCell} text-slate-800`}>{readyToShipBySize[size] ?? 0}</td>
                <td className={t.numCell}>{shippedBySize[size] ?? 0}</td>
                <td className={`${t.numCell} border-r-0 font-semibold text-slate-800`}>
                  {balanceBySize[size] ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className={t.footFirst}>Total</td>
              <td className={t.footNum}>{totals.order.toLocaleString()}</td>
              <td className={t.footAdj}>{totals.adj.toLocaleString()}</td>
              {visitColumns.map((col) => (
                <td key={matrixColumnKey(col)} className={t.footDept}>
                  {renderOperationValue
                    ? renderOperationValue(sumColumnTotal(col), col)
                    : sumColumnTotal(col) || '—'}
                </td>
              ))}
              <td className={t.footNum}>{totals.rejected.toLocaleString()}</td>
              <td className={t.footNum}>{totals.ready.toLocaleString()}</td>
              <td className={t.footNum}>{totals.shipped.toLocaleString()}</td>
              <td className={`${t.footNum} border-r-0 font-bold`}>{totals.balance.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </section>
  );
};
