import React from 'react';

interface ChartPrintTableProps {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

/** Print-only data table companion for on-screen charts. */
export const ChartPrintTable: React.FC<ChartPrintTableProps> = ({ title, columns, rows }) => {
  if (rows.length === 0) return null;
  return (
    <div className="print-only mt-3 mb-4">
      <h4 className="text-[10px] font-bold uppercase text-slate-600 mb-1">{title}</h4>
      <table className="w-full text-[9px] border-collapse mes-report-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className="border border-slate-300 px-2 py-1 text-left font-semibold bg-slate-100"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="border border-slate-300 px-2 py-1 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
