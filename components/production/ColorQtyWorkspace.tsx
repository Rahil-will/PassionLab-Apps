import React from 'react';
import { Trash2, Copy } from 'lucide-react';
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
  onAddColor: (payload: { name: string; sizes: Colorway['sizes'] }) => void;
  onClearColorSelection: () => void;
  onNameChange: (id: string, name: string) => void;
  onOrderChange: (id: string, size: string, qty: number) => void;
  onAdjChange: (id: string, size: string, qty: number) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
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
  totalAllowancePct,
  hasSizeContext,
  onNameChange,
  onOrderChange,
  onAdjChange,
  onDelete,
  onDuplicate,
  rowOrderTotal,
  rowAdjTotal,
  aggregateBySize,
  totalOrderQty,
  totalAdjustedQty,
}) => {
  const hasSizes = displaySizes.length > 0;
  // total cols: sno + color + type + [sizes] + total + actions
  const totalCols = 3 + (hasSizes ? displaySizes.length : 0) + 1 + 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: hasSizes ? '32rem' : '22rem' }}>
        <colgroup>
          <col style={{ width: '2rem' }} />
          <col style={{ width: '11rem' }} />
          <col style={{ width: '4rem' }} />
          {hasSizes && displaySizes.map((s) => <col key={s} style={{ width: '4.5rem' }} />)}
          <col style={{ width: '4.5rem' }} />
          <col style={{ width: '2.5rem' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={thCls}>#</th>
            <th className={thLeftCls}>Color</th>
            <th className={thLeftCls}>Type</th>
            {hasSizes && displaySizes.map((s) => <th key={s} className={thCls}>{s}</th>)}
            <th className={thCls}>Total</th>
            <th className="border border-slate-200 bg-slate-50" />
          </tr>
        </thead>
        <tbody>
          {colorways.length === 0 ? (
            <tr>
              <td colSpan={totalCols} className="text-center py-8 text-[11px] text-slate-400 italic border border-slate-200">
                {hasSizeContext ? 'Click "Add Color" to start' : 'Select a size group to enter colors'}
              </td>
            </tr>
          ) : (
            colorways.map((cw, idx) => {
              const swatch = swatchStyleFromColorName(cw.name || '');
              const orderTotal = rowOrderTotal(cw);
              const adjTotal = rowAdjTotal(cw);
              return (
                <React.Fragment key={cw.id}>
                  {/* Order Qty row */}
                  <tr className="bg-white">
                    {/* S.No — spans both rows */}
                    <td className="border border-slate-200 text-center text-[10px] font-semibold text-slate-400 tabular-nums align-middle" rowSpan={2}>
                      {idx + 1}
                    </td>
                    <td className="border border-slate-200 px-3 align-middle" rowSpan={2}>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full shrink-0 border border-slate-200" style={swatch} />
                        <input
                          type="text"
                          value={cw.name || ''}
                          onChange={(e) => onNameChange(cw.id, e.target.value)}
                          placeholder="Color name"
                          className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 bg-transparent border-0 border-b border-transparent focus:border-blue-400 focus:outline-none py-0.5 placeholder:text-slate-300"
                        />
                      </div>
                    </td>
                    <td className={metaOrderCls}>Order</td>
                    {hasSizes && displaySizes.map((s) => (
                      <td key={s} className={dataCellCls}>
                        <input
                          type="number"
                          min={0}
                          value={sizeOrderQty(cw.sizes.find((sz) => sz.size === s)) || ''}
                          placeholder="0"
                          onChange={(e) => onOrderChange(cw.id, s, parseInt(e.target.value, 10) || 0)}
                          className={qtyInputCls}
                          aria-label={`${cw.name} ${s} order qty`}
                        />
                      </td>
                    ))}
                    <td className={totalCellCls}>{orderTotal.toLocaleString()}</td>
                    {/* Actions — spans both rows */}
                    <td className="border border-slate-200 align-middle text-center p-0" rowSpan={2} style={{ width: '2.5rem' }}>
                      <div className="flex flex-col items-center justify-center gap-0">
                        <button
                          type="button"
                          onClick={() => onDuplicate(cw.id)}
                          className="p-1 rounded text-slate-300 hover:text-blue-500 transition-colors"
                          aria-label={`Duplicate ${cw.name}`}
                          title="Duplicate"
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(cw.id)}
                          className="p-1 rounded text-slate-300 hover:text-red-500 transition-colors"
                          aria-label={`Delete ${cw.name}`}
                          title="Delete"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Adjusted Qty row */}
                  <tr className="bg-blue-50">
                    <td className={metaAdjCls}>Adj.</td>
                    {hasSizes && displaySizes.map((s) => (
                      <td key={s} className={dataAdjCls}>
                        <input
                          type="number"
                          min={0}
                          value={sizeAdjQty(cw.sizes.find((sz) => sz.size === s)) || ''}
                          placeholder="0"
                          onChange={(e) => onAdjChange(cw.id, s, parseInt(e.target.value, 10) || 0)}
                          className={qtyAdjInputCls}
                          aria-label={`${cw.name} ${s} adj qty`}
                        />
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
            {/* Merged total row — spans 2 body rows worth, with stacked order/adj values */}
            <tr className="bg-slate-50">
              <td className="border border-slate-200 bg-slate-50" colSpan={2} rowSpan={2}>
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
              <td className="border border-slate-200 bg-slate-50" rowSpan={2} />
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
  );
};
