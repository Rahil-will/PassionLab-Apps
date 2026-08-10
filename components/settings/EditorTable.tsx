import React from 'react';

/** Header/cell classes aligned with Planning Board resource allocation table. */
export const editorThCls =
  'px-2 py-2.5 text-[10px] font-semibold text-slate-600 uppercase border border-slate-200 bg-slate-50 whitespace-nowrap';
export const editorTdCls =
  'px-2 py-2 text-[11px] text-slate-700 border border-slate-200 align-middle';
export const editorTdMutedCls =
  'px-2 py-2 text-[11px] text-slate-500 border border-slate-200 align-middle';
export const editorTdSnoCls =
  'px-2 py-2 text-[11px] text-slate-500 border border-slate-200 align-middle text-center tabular-nums w-10';

interface EditorTableProps {
  headers: string[];
  children: React.ReactNode;
  headerAligns?: ('left' | 'center' | 'right')[];
}

/** Bordered grid table — same visual language as PlanningTable allocations. */
export const EditorTable: React.FC<EditorTableProps> = ({
  headers,
  children,
  headerAligns = [],
}) => (
  <div className="overflow-x-auto thin-scrollbar">
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={`${h}-${i}`}
              className={`${editorThCls} text-${headerAligns[i] || 'left'}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

interface EditorTableRowProps {
  children: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
}

export const EditorTableRow: React.FC<EditorTableRowProps> = ({
  children,
  onClick,
  selected,
}) => (
  <tr
    onClick={onClick}
    className={`transition-colors ${onClick ? 'cursor-pointer hover:bg-slate-50/60' : ''} ${
      selected ? 'bg-blue-50/70' : ''
    }`}
  >
    {children}
  </tr>
);

interface EditorTableCellProps {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
  colSpan?: number;
  variant?: 'default' | 'muted' | 'sno' | 'strong';
}

export const EditorTableCell: React.FC<EditorTableCellProps> = ({
  children,
  className = '',
  align = 'left',
  colSpan,
  variant = 'default',
}) => {
  const base =
    variant === 'sno'
      ? editorTdSnoCls
      : variant === 'muted'
        ? editorTdMutedCls
        : variant === 'strong'
          ? `${editorTdCls} font-semibold text-slate-800`
          : editorTdCls;
  return (
    <td colSpan={colSpan} className={`${base} text-${align} ${className}`}>
      {children}
    </td>
  );
};
