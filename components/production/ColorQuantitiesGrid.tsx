import React, { useMemo } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import type { Colorway } from '../../types';
import { sizeAdjQty, sizeOrderQty } from '../../lib/colorwaySizesUtils';
import { swatchStyleFromColorName } from '../../lib/colorNameSwatch';

interface ColorQuantitiesGridProps {
  colorways: Colorway[];
  displaySizes: string[];
  totalAllowancePct: number;
  onNameChange?: (id: string, name: string) => void;
  onOrderChange?: (id: string, size: string, qty: number) => void;
  onAdjChange?: (id: string, size: string, qty: number) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
  rowOrderTotal: (cw: Colorway) => number;
  rowAdjTotal: (cw: Colorway) => number;
  aggregateBySize: Record<string, { order: number; adjusted: number }>;
  totalOrderQty: number;
  totalAdjustedQty: number;
  hasSizeContext: boolean;
  readOnly?: boolean;
  /** When true, grid grows with content (page scrolls). */
  layoutExpand?: boolean;
  selectedColorId?: string | null;
  onSelectColor?: (id: string) => void;
  /** When false, summary footer is omitted (render at card level). */
  showSummary?: boolean;
}

function buildRowCols(sizeCount: number, readOnly: boolean, includeTotals = false) {
  const perSize = Array.from({ length: sizeCount }, () => 'minmax(3.25rem, 1fr) minmax(3.25rem, 1fr)').join(' ');
  const actions = readOnly ? '' : ' 2.5rem';
  const totals = includeTotals ? ' minmax(4rem, 1fr) minmax(4rem, 1fr)' : '';
  return `2rem minmax(8rem, 2fr) ${perSize}${totals}${actions}`;
}

const colorNameInput =
  'w-full min-w-0 text-[11px] font-semibold text-slate-800 bg-transparent border-0 border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1.5 placeholder:text-slate-400 shadow-none rounded-none';

const qtyInputCls =
  'w-full min-w-0 text-center border-0 bg-transparent text-[10px] font-semibold focus:outline-none tabular-nums shadow-none rounded-none p-0';

function GridCell({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center min-h-[2.5rem] px-2 py-1.5 ${className}`}>
      {children}
    </div>
  );
}

function QtyInput({
  value,
  onChange,
  className = '',
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value || ''}
      placeholder="0"
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      className={`${qtyInputCls} ${className}`}
      aria-label={ariaLabel}
    />
  );
}

const headerLabel = 'text-[9px] font-bold text-slate-500 uppercase tracking-wide';
const headerSub = 'text-[8px] font-medium text-slate-400 normal-case tracking-normal';
const qtyText = 'text-[10px] font-semibold tabular-nums';

export const ColorQuantitiesGrid: React.FC<ColorQuantitiesGridProps> = ({
  colorways,
  displaySizes,
  totalAllowancePct,
  onNameChange,
  onOrderChange,
  onAdjChange,
  onDuplicate,
  onDelete,
  rowOrderTotal,
  rowAdjTotal,
  aggregateBySize,
  totalOrderQty,
  totalAdjustedQty,
  hasSizeContext,
  readOnly = false,
  layoutExpand = false,
  selectedColorId = null,
  onSelectColor,
  showSummary = true,
}) => {
  const rowCols = useMemo(
    () => buildRowCols(displaySizes.length, readOnly, readOnly),
    [displaySizes.length, readOnly],
  );

  const body = !hasSizeContext ? (
    <div className="flex-1 flex items-center justify-center py-10 text-slate-400 text-[11px] italic px-4">
      Select a size group to enter quantities.
    </div>
  ) : colorways.length === 0 ? (
    <div className="flex-1 flex items-center justify-center px-4 pt-8 pb-6">
      <p className="text-[11px] text-slate-400 italic py-8 text-center w-full rounded-lg border border-dashed border-slate-200 bg-slate-50/40">
        {readOnly ? 'No colors yet. Use Add color.' : 'No colors yet. Use Add color above.'}
      </p>
    </div>
  ) : (
    <div className={layoutExpand ? 'overflow-x-auto' : 'flex-1 min-h-0 overflow-x-auto overflow-y-auto thin-scrollbar'}>
      <div className="w-full min-w-[40rem]">
        <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
          <div className="grid w-full" style={{ gridTemplateColumns: rowCols }}>
            <GridCell className="justify-center bg-slate-50/95">
              <span className={headerLabel}>#</span>
            </GridCell>
            <GridCell className="justify-start bg-slate-50/95">
              <span className={headerLabel}>Color</span>
            </GridCell>
            {displaySizes.map((s) => (
              <GridCell key={`${s}-head`} className="justify-center bg-slate-50/95 col-span-2 border-l border-slate-100">
                <span className={`${headerLabel} truncate max-w-full`}>{s}</span>
              </GridCell>
            ))}
            {readOnly && (
              <GridCell className="justify-center items-center bg-slate-50/95 col-span-2 border-l border-slate-200 min-h-[2.5rem]">
                <span className={headerLabel}>Total</span>
              </GridCell>
            )}
            {!readOnly && (
              <GridCell className="justify-center bg-slate-50/95">
                <span className="sr-only">Actions</span>
              </GridCell>
            )}
          </div>
          <div className="grid w-full border-t border-slate-100" style={{ gridTemplateColumns: rowCols }}>
            <GridCell className="bg-slate-50/95" />
            <GridCell className="bg-slate-50/95" />
            {displaySizes.map((s) => (
              <React.Fragment key={`${s}-sub`}>
                <GridCell className="justify-center bg-slate-50/95 border-l border-slate-100">
                  <span className={headerSub}>Order</span>
                </GridCell>
                <GridCell className="justify-center bg-blue-50/50">
                  <span className={`${headerSub} text-blue-600`}>Adj</span>
                </GridCell>
              </React.Fragment>
            ))}
            {readOnly && (
              <>
                <GridCell className="justify-center bg-slate-50/95 border-l border-slate-200">
                  <span className={headerSub}>Order</span>
                </GridCell>
                <GridCell className="justify-center bg-blue-50/50">
                  <span className={`${headerSub} text-blue-600`}>Adj</span>
                </GridCell>
              </>
            )}
            {!readOnly && <GridCell className="bg-slate-50/95" />}
          </div>
        </div>

        <div>
          {colorways.map((cw, idx) => {
            const isSelected = readOnly && selectedColorId === cw.id;
            return (
            <div
              key={cw.id}
              role={readOnly && onSelectColor ? 'button' : undefined}
              tabIndex={readOnly && onSelectColor ? 0 : undefined}
              onClick={readOnly && onSelectColor ? () => onSelectColor(cw.id) : undefined}
              onKeyDown={
                readOnly && onSelectColor
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectColor(cw.id);
                      }
                    }
                  : undefined
              }
              className={`grid w-full border-b border-slate-100 items-center ${
                idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'
              } ${readOnly && onSelectColor ? 'cursor-pointer hover:bg-blue-50/40' : ''} ${
                isSelected ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-200' : ''
              }`}
              style={{ gridTemplateColumns: rowCols }}
            >
              <GridCell className="justify-center">
                <span className={`${qtyText} text-slate-400`}>{idx + 1}</span>
              </GridCell>
              <GridCell className="justify-start gap-1.5">
                {readOnly ? (
                  <>
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-slate-200 shrink-0"
                      style={swatchStyleFromColorName(cw.name)}
                    />
                    <span className={`${qtyText} text-slate-800 truncate`} title={cw.name}>
                      {cw.name.trim() || '—'}
                    </span>
                  </>
                ) : (
                  <input
                    value={cw.name}
                    onChange={(e) => onNameChange?.(cw.id, e.target.value)}
                    placeholder="Color name"
                    className={colorNameInput}
                    title={cw.name}
                  />
                )}
              </GridCell>
              {displaySizes.map((s) => {
                const row = cw.sizes.find((sz) => sz.size === s) ?? { size: s, order_qty: 0, adj_qty: 0 };
                return (
                  <React.Fragment key={s}>
                    <GridCell className="justify-center">
                      {readOnly ? (
                        <span className={`${qtyText} text-slate-800`}>
                          {sizeOrderQty(row) > 0 ? sizeOrderQty(row).toLocaleString() : '—'}
                        </span>
                      ) : (
                        <QtyInput
                          value={sizeOrderQty(row)}
                          onChange={(v) => onOrderChange?.(cw.id, s, v)}
                          className="text-slate-800"
                          ariaLabel={`${s} order qty`}
                        />
                      )}
                    </GridCell>
                    <GridCell className="justify-center bg-blue-50/50">
                      {readOnly ? (
                        <span className={`${qtyText} text-blue-700`}>
                          {sizeAdjQty(row) > 0 ? sizeAdjQty(row).toLocaleString() : '—'}
                        </span>
                      ) : (
                        <QtyInput
                          value={sizeAdjQty(row)}
                          onChange={(v) => onAdjChange?.(cw.id, s, v)}
                          className="text-blue-700"
                          ariaLabel={`${s} adj qty`}
                        />
                      )}
                    </GridCell>
                  </React.Fragment>
                );
              })}
              {readOnly && (
                <>
                  <GridCell className="justify-center items-center border-l border-slate-200 min-h-[2.5rem]">
                    <span className={`${qtyText} text-slate-800`}>
                      {rowOrderTotal(cw) > 0 ? rowOrderTotal(cw).toLocaleString() : '—'}
                    </span>
                  </GridCell>
                  <GridCell className="justify-center items-center bg-blue-50/50 min-h-[2.5rem]">
                    <span className={`${qtyText} text-blue-700`}>
                      {rowAdjTotal(cw) > 0 ? rowAdjTotal(cw).toLocaleString() : '—'}
                    </span>
                  </GridCell>
                </>
              )}
              {!readOnly && (
                <GridCell className="flex-col gap-0.5 justify-center py-1">
                  <button
                    type="button"
                    title="Duplicate"
                    onClick={() => onDuplicate?.(cw.id)}
                    className="p-0.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50"
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => onDelete?.(cw.id)}
                    className="p-0.5 text-slate-300 hover:text-red-500 rounded hover:bg-red-50"
                  >
                    <Trash2 size={12} />
                  </button>
                </GridCell>
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div className={layoutExpand ? 'flex flex-col' : 'flex flex-col flex-1 min-h-0 h-full'}>
      <div className={layoutExpand ? '' : 'flex-1 flex flex-col min-h-0 px-0 pt-0'}>
        {body}
      </div>
      {showSummary && (
      <MatrixSummaryFooter
        displaySizes={displaySizes}
        aggregateBySize={aggregateBySize}
        totalOrderQty={totalOrderQty}
        totalAdjustedQty={totalAdjustedQty}
        totalAllowancePct={totalAllowancePct}
        colorCount={colorways.length}
        readOnly={readOnly}
      />
      )}
    </div>
  );
};

export function MatrixSummaryFooter({
  displaySizes,
  aggregateBySize,
  totalOrderQty,
  totalAdjustedQty,
  totalAllowancePct,
  colorCount,
  readOnly = true,
}: {
  displaySizes: string[];
  aggregateBySize: Record<string, { order: number; adjusted: number }>;
  totalOrderQty: number;
  totalAdjustedQty: number;
  totalAllowancePct: number;
  colorCount: number;
  readOnly?: boolean;
}) {
  const rowCols = useMemo(
    () => buildRowCols(displaySizes.length, readOnly, true),
    [displaySizes.length, readOnly],
  );
  const summaryLine = (
    label: string,
    labelClass: string,
    pick: 'order' | 'adjusted',
    total: number,
    totalClass: string,
  ) => (
    <div className="grid w-full min-w-[40rem] border-t border-slate-200 items-center" style={{ gridTemplateColumns: rowCols }}>
      <GridCell className="justify-center" />
      <GridCell className="justify-start">
        <span className={`text-[9px] font-bold uppercase ${labelClass}`}>{label}</span>
      </GridCell>
      {displaySizes.map((s) => {
        const orderVal = aggregateBySize[s]?.order || 0;
        const adjVal = aggregateBySize[s]?.adjusted || 0;
        const value = pick === 'order' ? orderVal : adjVal;
        return (
          <GridCell
            key={`${label}-${s}`}
            className={`justify-center col-span-2 border-l border-slate-100 ${
              pick === 'adjusted' ? 'bg-blue-50/50' : ''
            }`}
          >
            <span className={`${qtyText} ${pick === 'adjusted' ? 'text-blue-700' : 'text-slate-700'}`}>
              {value > 0 ? value.toLocaleString() : '—'}
            </span>
          </GridCell>
        );
      })}
      <GridCell className={`justify-center items-center col-span-2 min-h-[2.5rem] ${pick === 'adjusted' ? 'bg-blue-50/50' : ''}`}>
        <span className={`text-[11px] font-bold tracking-wide tabular-nums ${totalClass}`}>
          {total.toLocaleString()}
        </span>
      </GridCell>
      {!readOnly && <GridCell />}
    </div>
  );

  return (
    <div className="mt-auto shrink-0 border-t border-slate-200 bg-slate-50/80 rounded-b-xl overflow-x-auto thin-scrollbar">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-100 min-w-[40rem]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[9px] font-bold uppercase text-slate-500 shrink-0">Summary</span>
          <span className="text-[9px] text-slate-400 shrink-0">·</span>
          <span className="text-[9px] font-medium text-slate-600 truncate">
            {colorCount} {colorCount === 1 ? 'color' : 'colors'}
          </span>
        </div>
        <span className="text-[9px] font-medium text-slate-500 shrink-0">
          Allowance <span className="text-slate-700 font-semibold">+{totalAllowancePct}%</span>
        </span>
      </div>
      {summaryLine('Order', 'text-slate-500', 'order', totalOrderQty, 'text-slate-900')}
      {summaryLine('Adj', 'text-blue-600', 'adjusted', totalAdjustedQty, 'text-blue-800')}
    </div>
  );
}
