import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface CatalogTablePanelProps {
  title: string;
  subtitle?: string;
  meta?: string;
  icon?: LucideIcon;
  emptyMessage?: string;
  isEmpty?: boolean;
  /** Renders below the panel header (e.g. Active / History tabs). */
  toolbar?: React.ReactNode;
  /** Renders on the right of the title row (e.g. Add). */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export const CatalogTablePanel: React.FC<CatalogTablePanelProps> = ({
  title,
  subtitle = 'Click a row to edit',
  meta,
  icon: Icon,
  emptyMessage = 'No items yet.',
  isEmpty = false,
  toolbar,
  headerAction,
  children,
}) => (
  <div className="h-full flex flex-col min-h-0">
    <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50 shrink-0 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
          {Icon && <Icon size={14} />}
          {title}
        </h4>
        {meta ? (
          <>
            {subtitle && <p className="text-[11px] font-semibold text-slate-700 mt-1">{subtitle}</p>}
            <p className="text-[10px] text-slate-400 mt-0.5">{meta}</p>
          </>
        ) : subtitle ? (
          <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
    </div>
    {toolbar && (
      <div className="px-4 py-2 border-b border-slate-200 bg-white shrink-0">
        {toolbar}
      </div>
    )}
    {isEmpty ? (
      <p className="text-xs text-slate-400 italic py-12 text-center">{emptyMessage}</p>
    ) : (
      <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar">{children}</div>
    )}
  </div>
);

interface CatalogTableProps {
  headers: string[];
  children: React.ReactNode;
  /** Column indices (0-based) to left-align. Default: first two columns. */
  leftColumns?: number[];
  /** @deprecated Prefer leftColumns — extra center columns beyond default (all except leftColumns). */
  centerColumns?: number[];
  /** Center-align every header and default cell alignment hint. */
  centerAll?: boolean;
  /** Blank row after data so the table does not feel cramped at the bottom. */
  padBottomRow?: boolean;
  /** Optional per-column widths (CSS). Unset columns share remaining space. */
  widths?: (string | undefined)[];
}

const thBorder = 'border-r border-slate-200 last:border-r-0';
const tdBorder = 'border-r border-slate-200 last:border-r-0';

export const CatalogTable: React.FC<CatalogTableProps> = ({
  headers,
  children,
  leftColumns: _leftColumns = [0, 1],
  centerColumns = [],
  centerAll = false,
  padBottomRow = false,
  widths,
}) => {
  void _leftColumns;
  const extraCenter = new Set(centerColumns);
  const serialWidth = '3.5rem';
  const lastHeader = headers[headers.length - 1] ?? '';
  const actionCol = lastHeader === '' || lastHeader === 'Action' ? 1 : 0;
  const actionWidth = '3.75rem';
  const dataCols = headers.length - actionCol;
  const dataWidth =
    dataCols > 0
      ? `calc((100% - ${actionCol ? actionWidth : '0px'}) / ${dataCols})`
      : 'auto';

  return (
    <table className="w-full text-xs table-fixed border-collapse">
      <colgroup>
        {headers.map((h, i) => {
          const isSerial = i === 0 && (h === '#' || h === 'S.No');
          const isAction = actionCol > 0 && i === headers.length - 1;
          const width = widths?.[i]
            ?? (isSerial ? serialWidth : isAction ? actionWidth : dataWidth);
          return <col key={`${h}-${i}`} style={{ width }} />;
        })}
      </colgroup>
      <thead className="text-[10px] uppercase text-slate-500 font-semibold border-b border-slate-200 sticky top-0 bg-white z-10">
        <tr>
          {headers.map((h, i) => {
            const centered = centerAll || extraCenter.has(i);
            return (
              <th
                key={`${h}-${i}`}
                className={`px-3 py-2 ${centered ? 'text-center' : 'text-left'} ${thBorder}`}
              >
                {h}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody className="[&_tr]:border-b [&_tr]:border-slate-200">
        {children}
        {padBottomRow ? (
          <tr aria-hidden>
            <td colSpan={headers.length} className="h-10 border-0 p-0" />
          </tr>
        ) : null}
      </tbody>
    </table>
  );
};

interface CatalogTableRowProps {
  children: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
}

export const CatalogTableRow: React.FC<CatalogTableRowProps> = ({
  children,
  onClick,
  selected,
}) => (
  <tr
    onClick={onClick}
    className={`transition-colors ${onClick ? 'cursor-pointer' : ''} ${
      selected
        ? 'bg-blue-50 ring-1 ring-inset ring-blue-200'
        : onClick
          ? 'hover:bg-slate-50'
          : ''
    }`}
  >
    {children}
  </tr>
);

interface CatalogTableCellProps {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
  align?: 'left' | 'center';
}

export const catalogSerialCellClass =
  `text-left text-slate-500 tabular-nums w-14 min-w-[3.5rem] ${tdBorder}`;

export const catalogNumericCellClass =
  `text-center text-slate-500 tabular-nums text-[10px] ${tdBorder}`;

export const CatalogTableCell: React.FC<CatalogTableCellProps> = ({
  children,
  className = '',
  colSpan,
  align,
}) => (
  <td
    colSpan={colSpan}
    className={`px-3 py-2.5 align-middle ${tdBorder} ${
      align === 'center' ? 'text-center' : 'text-left'
    } ${className}`}
  >
    {children}
  </td>
);
