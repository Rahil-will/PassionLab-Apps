import React, { useMemo } from 'react';
import { Card } from '../ui';
import { formatDateDDMMYYYY } from '../../lib/orderDateUtils';
import {
  rowTotal,
  expandShipmentPlanLines,
  isActiveShipmentLine,
  shipmentPlanRescheduleReason,
} from '../../lib/orderShipmentPlan';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import type { OrderShipmentPlan, ShipmentPlanLine } from '../../lib/orderShipmentPlan';
import type { Colorway } from '../../types';
import { ShipmentPlanRescheduleCommentRow } from './ShipmentPlanRescheduleCommentRow';

interface ShipmentPlanReadOnlyProps {
  plan: OrderShipmentPlan;
  colorways: Colorway[];
  /** If set, only show lines for this colorway ID */
  colorwayId?: string;
  displaySizes?: string[];
  /** Render table only — no outer Card (for embedding in report sections). */
  embedded?: boolean;
}

function colorName(colorways: Colorway[], id: string): string {
  return colorways.find((c) => c.id === id)?.name || '—';
}

// Local overrides of the shared flowTableClasses "adj" column: same look, but
// the column-divider border is the same light shade as every other column
// (the shared class uses a darker border-slate-200, which stands out here).
const typeHeadCls =
  'px-3 py-3 text-center min-w-[68px] border-b-2 border-slate-200 border-r border-slate-100 text-blue-600';
const typeCellCls =
  'px-3 py-2 text-center font-bold text-[10px] text-blue-700 bg-blue-50/10 border-r border-slate-100';

function ShipmentPlanDataRow({
  line,
  colorways,
  sizes,
  commentRowSpan,
  showDestCol,
}: {
  line: ShipmentPlanLine;
  colorways: Colorway[];
  sizes: string[];
  commentRowSpan?: number;
  showDestCol?: boolean;
}) {
  const total = rowTotal(line);
  const isRescheduled = line.status === 'rescheduled';

  return (
    <tr className={isRescheduled ? 'bg-slate-100 grayscale opacity-70' : 'hover:bg-slate-50'}>
      <td rowSpan={commentRowSpan} className={t.firstCell}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
          <span className="font-medium text-[10px] text-slate-700 truncate">
            {colorName(colorways, line.colorwayId)}
          </span>
        </div>
      </td>
      <td className={t.numCell} style={{ textAlign: 'left' }}>
        <div className="flex flex-col gap-0.5 px-1">
          <span className={`font-semibold ${isRescheduled ? 'text-slate-500 line-through' : 'text-slate-700'}`}>
            {line.shipmentDate ? formatDateDDMMYYYY(line.shipmentDate) : '—'}
          </span>
          {isRescheduled && (
            <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700">Rescheduled</span>
          )}
        </div>
      </td>
      <td className={t.numCell} style={{ textAlign: 'left' }}>
        {line.shipMode || <span className="text-slate-300">—</span>}
      </td>
      <td className={typeCellCls} style={{ textAlign: 'left' }}>
        {line.shipmentType || <span className="text-slate-300">—</span>}
      </td>
      {showDestCol && (
        <td className={t.numCell} style={{ textAlign: 'left' }}>
          {line.destinationCountry?.trim() || <span className="text-slate-300">—</span>}
        </td>
      )}
      {sizes.map((s) => (
        <td key={s} className={t.deptCell}>
          {(line.sizes[s] ?? 0) > 0 ? (line.sizes[s]).toLocaleString() : <span className="text-slate-200">—</span>}
        </td>
      ))}
      <td className={`${t.statusCell} font-bold text-slate-800`}>
        {total > 0 ? total.toLocaleString() : '—'}
      </td>
    </tr>
  );
}

export const ShipmentPlanReadOnly: React.FC<ShipmentPlanReadOnlyProps> = ({
  plan,
  colorways,
  colorwayId,
  displaySizes,
  embedded = false,
}) => {
  const lines: ShipmentPlanLine[] = useMemo(() => {
    const base = colorwayId
      ? plan.lines.filter((l) => l.colorwayId === colorwayId)
      : plan.lines;
    return expandShipmentPlanLines(base);
  }, [plan.lines, colorwayId]);

  const activeLines = useMemo(
    () => lines.filter(isActiveShipmentLine),
    [lines],
  );

  const sizes = useMemo(
    () =>
      displaySizes ??
      Array.from(new Set(lines.flatMap((l) => Object.keys(l.sizes)))).sort(),
    [displaySizes, lines],
  );

  const showDestCol = lines.some((l) => l.destinationCountry?.trim());
  const metaCols = 4 + (showDestCol ? 1 : 0); // Color · Date · Mode · Type · (Dest)
  const totalCols = metaCols + sizes.length + 1;
  const colWidth = `${100 / totalCols}%`;
  const totalQty = activeLines.reduce((s, l) => s + rowTotal(l), 0);

  const sizeTotals = useMemo(
    () =>
      sizes.map((size) =>
        activeLines.reduce((sum, line) => sum + (line.sizes[size] ?? 0), 0),
      ),
    [activeLines, sizes],
  );

  if (lines.length === 0) {
    if (embedded) return null;
    return (
      <Card
        title="Shipment Plan"
        subtitle={colorwayId ? 'Colorway shipment schedule' : 'Order shipment schedule'}
        className="shadow-sm border-slate-200"
      >
        <p className="text-xs text-slate-400 italic py-4 text-center">No shipment lines planned yet.</p>
      </Card>
    );
  }

  const tableBlock = (
    <div className={embedded ? '' : 'p-6'}>
      <div className={`${t.wrapper}${embedded ? ' rounded-2xl' : ''}`}>
        <div className={t.scroll}>
          <table className={`${t.table} table-fixed w-full`}>
            <colgroup>
              {Array.from({ length: totalCols }).map((_, i) => (
                <col key={i} style={{ width: colWidth }} />
              ))}
            </colgroup>
            <thead className={t.thead}>
              <tr>
                <th className={t.firstHead}>Color</th>
                <th className={t.numHead} style={{ textAlign: 'left' }}>Date</th>
                <th className={t.numHead} style={{ textAlign: 'left' }}>Mode</th>
                <th className={typeHeadCls} style={{ textAlign: 'left' }}>Type</th>
                {showDestCol && (
                  <th className={t.numHead} style={{ textAlign: 'left' }}>Destination</th>
                )}
                {sizes.map((s) => (
                  <th key={s} className={t.deptHead}>{s}</th>
                ))}
                <th className={t.statusHead}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.flatMap((line) => {
                const reason = shipmentPlanRescheduleReason(line);
                const isRescheduled = line.status === 'rescheduled';
                const hasComment = isRescheduled && !!reason;
                const commentColSpan = totalCols - 1;
                const rows = [
                  <ShipmentPlanDataRow
                    key={line.id}
                    line={line}
                    colorways={colorways}
                    sizes={sizes}
                    commentRowSpan={hasComment ? 2 : undefined}
                    showDestCol={showDestCol}
                  />,
                ];
                if (hasComment) {
                  rows.push(
                    <ShipmentPlanRescheduleCommentRow
                      key={`${line.id}-comment`}
                      commentColSpan={commentColSpan}
                      reason={reason}
                    />,
                  );
                }
                return rows;
              })}
            </tbody>
            <tfoot className="bg-slate-100 border-t-2 border-slate-200 font-bold text-slate-700">
              <tr>
                <td colSpan={metaCols} className={t.footFirst}>
                  Total
                </td>
                {sizes.map((s, idx) => (
                  <td key={s} className={t.footDept}>
                    {sizeTotals[idx] > 0 ? sizeTotals[idx].toLocaleString() : '—'}
                  </td>
                ))}
                <td className={t.footStatus}>{totalQty > 0 ? totalQty.toLocaleString() : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );

  if (embedded) return tableBlock;

  return (
    <Card
      title="Shipment Plan"
      subtitle={colorwayId ? 'Colorway shipment schedule' : 'Order shipment schedule'}
      className="shadow-sm border-slate-200"
      noPadding
    >
      {tableBlock}
    </Card>
  );
};
