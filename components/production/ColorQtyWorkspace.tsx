import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Colorway } from '../../types';
import { sizeOrderQty, sizeAdjQty } from '../../lib/colorwaySizesUtils';
import { swatchStyleFromColorName } from '../../lib/colorNameSwatch';

export interface ColorTemplateAddPayload {
  name: string;
  sizes: Colorway['sizes'];
}

const ROW_H = 'h-9';
const thCls = 'px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border border-slate-200 bg-slate-50 whitespace-nowrap text-center';
const thLeftCls = 'px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border border-slate-200 bg-slate-50 whitespace-nowrap text-left';
const dataCellCls = `p-0 border border-slate-200 align-middle ${ROW_H}`;
const metaOrderCls = `px-3 py-0 text-[9px] font-bold text-slate-500 uppercase border border-slate-200 bg-white align-middle ${ROW_H}`;
const metaAdjCls = `px-3 py-0 text-[9px] font-bold text-blue-600 uppercase border border-slate-200 bg-blue-50 align-middle ${ROW_H}`;
const dataAdjCls = `p-0 border border-slate-200 align-middle bg-blue-50 ${ROW_H}`;
const totalCellCls = 'px-2 text-center text-[11px] font-bold tabular-nums text-slate-700 border border-slate-200 bg-slate-50/80 align-middle';
const totalAdjCellCls = 'px-2 text-center text-[11px] font-bold tabular-nums text-blue-700 border border-slate-200 bg-blue-100/60 align-middle';

const qtyInputCls =
  `w-full ${ROW_H} px-2 text-center text-[11px] bg-transparent border-0 rounded-none outline-none tabular-nums ` +
  'focus:bg-blue-50/60 focus:ring-1 focus:ring-inset focus:ring-blue-400 transition-colors placeholder:text-slate-300';
const qtyAdjInputCls =
  `w-full ${ROW_H} px-2 text-center text-[11px] text-blue-700 bg-transparent border-0 rounded-none outline-none tabular-nums ` +
  'focus:bg-blue-100/60 focus:ring-1 focus:ring-inset focus:ring-blue-400 transition-colors placeholder:text-blue-200';

interface ColorQtyWorkspaceProps {
  colorways: Colorway[];
  displaySizes: string[];
  totalAllowancePct: number;
  hasSizeContext: boolean;
  selectedColorId: string | null;
  cuttingAllowance: number;
  applyExtraAllowance: boolean;
  buyerExtraPct: number;
  selectedBuyer: string;
  onSelectColor: (id: string) => void;
  /** @deprecated Colour details page removed — kept optional for callers. */
  onOpenColorPage?: (id: string) => void;
  /** When true, name/qty are display-only. */
  readOnly?: boolean;
  onAddColor: () => void;
  onClearColorSelection: () => void;
  onNameChange: (id: string, name: string) => void;
  onOrderChange: (id: string, size: string, qty: number) => void;
  onAdjChange: (id: string, size: string, qty: number) => void;
  onDelete: (id: string) => void;
  onCuttingAllowanceChange: (pct: number) => void;
  onToggleExtraAllowance: () => void;
  onNotify: (message: string) => void;
  rowOrderTotal: (cw: Colorway) => number;
  rowAdjTotal: (cw: Colorway) => number;
  aggregateBySize: Record<string, { order: number; adjusted: number }>;
  totalOrderQty: number;
  totalAdjustedQty: number;
}

export const ColorQtyWorkspace: React.FC<ColorQtyWorkspaceProps> = ({
  colorways,
  displaySizes,
  hasSizeContext,
  selectedColorId,
  onSelectColor,
  readOnly = false,
  onAddColor,
  onNameChange,
  onOrderChange,
  onAdjChange,
  onDelete,
  rowOrderTotal,
  rowAdjTotal,
  aggregateBySize,
  totalOrderQty,
  totalAdjustedQty,
}) => {
  const hasSizes = displaySizes.length > 0;
  const totalCols = 3 + (hasSizes ? displaySizes.length : 0) + 1 + 1;

  return (
    <div className="p-4">
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
        <div className="overflow-x-auto">
      <table className="w-full border-collapse table-fixed" style={{ width: '100%' }}>
        <colgroup>
          <col style={{ width: '6%' }} />
          <col style={{ width: '24%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={thCls}>#</th>
            <th className={thLeftCls}>Color</th>
            <th className={thLeftCls}>Type</th>
            {hasSizes && displaySizes.map((s) => <th key={s} className={thCls}>{s}</th>)}
            <th className={thCls}>Total</th>
            <th className="border border-slate-200 bg-slate-50 w-8" />
          </tr>
        </thead>
        <tbody>
          {colorways.length === 0 ? (
            <tr>
              <td colSpan={totalCols} className="text-center py-8 text-[11px] text-slate-400 italic border-b border-slate-200">
                {hasSizeContext ? 'Add a colour below to enter name and quantities' : 'Select a size group to enter colors'}
              </td>
            </tr>
          ) : (
            colorways.map((cw, idx) => {
              const swatch = swatchStyleFromColorName(cw.name || '');
              const orderTotal = rowOrderTotal(cw);
              const adjTotal = rowAdjTotal(cw);
              const isSelected = selectedColorId === cw.id;
              return (
                <React.Fragment key={cw.id}>
                  <tr
                    className={isSelected ? 'bg-blue-50/40' : 'bg-white'}
                    onClick={() => onSelectColor(cw.id)}
                  >
                    <td className="border-b border-slate-200 text-center text-[10px] font-semibold text-slate-400 tabular-nums align-middle" rowSpan={2}>
                      {idx + 1}
                    </td>
                    <td className="border-b border-slate-200 px-3 align-middle" rowSpan={2}>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-3 h-3 rounded-full shrink-0 border border-slate-200" style={swatch} />
                        {readOnly ? (
                          <span className={`text-[11px] font-semibold truncate ${cw.name ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                            {cw.name || 'Untitled'}
                          </span>
                        ) : (
                          <input
                            type="text"
                            value={cw.name || ''}
                            onChange={(e) => onNameChange(cw.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => onSelectColor(cw.id)}
                            placeholder="Color name"
                            className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 bg-transparent border-0 border-b border-transparent focus:border-blue-400 focus:outline-none py-0.5 placeholder:text-slate-300"
                          />
                        )}
                      </div>
                    </td>
                    <td className={metaOrderCls}>Order</td>
                    {hasSizes && displaySizes.map((s) => (
                      <td key={s} className={dataCellCls}>
                        {readOnly ? (
                          <span className="block h-9 px-2 text-center text-[11px] tabular-nums leading-9 text-slate-700">
                            {sizeOrderQty(cw.sizes.find((sz) => sz.size === s)) || '—'}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={sizeOrderQty(cw.sizes.find((sz) => sz.size === s)) || ''}
                            placeholder="0"
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => onSelectColor(cw.id)}
                            onChange={(e) => onOrderChange(cw.id, s, parseInt(e.target.value, 10) || 0)}
                            className={qtyInputCls}
                            aria-label={`${cw.name} ${s} order qty`}
                          />
                        )}
                      </td>
                    ))}
                    <td className={totalCellCls}>{orderTotal.toLocaleString()}</td>
                    <td className="border-b border-slate-200 align-middle text-center p-0" rowSpan={2}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(cw.id);
                        }}
                        className="p-1 rounded text-slate-300 hover:text-red-500 transition-colors"
                        aria-label={`Delete ${cw.name}`}
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                  <tr
                    className={isSelected ? 'bg-blue-100/50' : 'bg-blue-50'}
                    onClick={() => onSelectColor(cw.id)}
                  >
                    <td className={metaAdjCls}>Adj.</td>
                    {hasSizes && displaySizes.map((s) => (
                      <td key={s} className={dataAdjCls}>
                        {readOnly ? (
                          <span className="block h-9 px-2 text-center text-[11px] tabular-nums leading-9 text-blue-700">
                            {sizeAdjQty(cw.sizes.find((sz) => sz.size === s)) || '—'}
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={sizeAdjQty(cw.sizes.find((sz) => sz.size === s)) || ''}
                            placeholder="0"
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => onSelectColor(cw.id)}
                            onChange={(e) => onAdjChange(cw.id, s, parseInt(e.target.value, 10) || 0)}
                            className={qtyAdjInputCls}
                            aria-label={`${cw.name} ${s} adj qty`}
                          />
                        )}
                      </td>
                    ))}
                    <td className={totalAdjCellCls}>{adjTotal.toLocaleString()}</td>
                  </tr>
                </React.Fragment>
              );
            })
          )}
        </tbody>
        {colorways.length > 0 && (
          <tfoot>
            <tr className="bg-slate-50">
              <td className="border-t border-slate-200 bg-slate-50" colSpan={2} rowSpan={2}>
                <div className="px-3 py-1 flex flex-col gap-0">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Total</span>
                  <span className="text-[9px] text-slate-400">{colorways.length} color{colorways.length !== 1 ? 's' : ''}</span>
                </div>
              </td>
              <td className={metaOrderCls}>Order</td>
              {hasSizes && displaySizes.map((s) => (
                <td key={s} className={totalCellCls}>{(aggregateBySize[s]?.order ?? 0).toLocaleString()}</td>
              ))}
              <td className={totalCellCls + ' text-slate-800'}>
                <div className="flex flex-col items-center gap-0">
                  <span>{totalOrderQty.toLocaleString()}</span>
                </div>
              </td>
              <td className="border-t border-slate-200 bg-slate-50" rowSpan={2} />
            </tr>
            <tr className="bg-blue-50">
              <td className={metaAdjCls}>Adj.</td>
              {hasSizes && displaySizes.map((s) => (
                <td key={s} className={totalAdjCellCls}>{(aggregateBySize[s]?.adjusted ?? 0).toLocaleString()}</td>
              ))}
              <td className={totalAdjCellCls}>{totalAdjustedQty.toLocaleString()}</td>
            </tr>
          </tfoot>
        )}
      </table>
        </div>
        {!readOnly ? (
          <button
            type="button"
            disabled={!hasSizeContext}
            onClick={onAddColor}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 border-t border-slate-200 bg-slate-50 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={13} />
            Add Color
          </button>
        ) : null}
      </div>
    </div>
  );
};
