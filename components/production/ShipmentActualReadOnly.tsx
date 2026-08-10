import React, { useMemo } from 'react';
import { formatDateDDMMYYYY } from '../../lib/orderDateUtils';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import type { FulfillmentShipmentRow } from '../../lib/fulfillmentData';
import type { Colorway } from '../../types';
import { supportDropdownLabel } from '../../lib/supportDropdownValues';

interface ShipmentActualReadOnlyProps {
  shipments: FulfillmentShipmentRow[];
  colorways: Colorway[];
  /** If set, only show rows for this colorway */
  colorwayId?: string;
  displaySizes?: string[];
  shipmentTypeOptions?: Array<{ value: string; label: string }>;
  embedded?: boolean;
}

function colorName(colorways: Colorway[], id: string | null | undefined): string {
  if (!id) return '—';
  return colorways.find((c) => c.id === id)?.name || '—';
}

const typeHeadCls =
  'px-3 py-3 text-center min-w-[68px] border-b-2 border-slate-200 border-r border-slate-100 text-blue-600';
const typeCellCls =
  'px-3 py-2 text-center font-bold text-[10px] text-blue-700 bg-blue-50/10 border-r border-slate-100';

function shipmentTypeLabel(
  raw: string,
  options?: Array<{ value: string; label: string }>,
): string {
  if (!raw) return '—';
  return supportDropdownLabel(options ?? [], raw) || raw.replace(/_/g, ' ');
}

function ShipmentActualDataRow({
  row,
  colorways,
  sizes,
  showDestCol,
  showInvoiceCol,
  showAwbCol,
  shipmentTypeOptions,
}: {
  row: FulfillmentShipmentRow;
  colorways: Colorway[];
  sizes: string[];
  showDestCol: boolean;
  showInvoiceCol: boolean;
  showAwbCol: boolean;
  shipmentTypeOptions?: Array<{ value: string; label: string }>;
}) {
  const qtyBySize = row.qtyBySize ?? {};
  const total = row.qty > 0 ? row.qty : sizes.reduce((s, size) => s + (qtyBySize[size] ?? 0), 0);

  return (
    <tr className="hover:bg-slate-50">
      <td className={t.firstCell}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
          <span className="font-medium text-[10px] text-slate-700 truncate">
            {row.colorwayName || colorName(colorways, row.colorwayId)}
          </span>
        </div>
      </td>
      <td className={t.numCell} style={{ textAlign: 'left' }}>
        <span className="font-semibold text-slate-700">
          {row.date ? formatDateDDMMYYYY(row.date.split('T')[0]) : '—'}
        </span>
      </td>
      <td className={typeCellCls} style={{ textAlign: 'left' }}>
        {shipmentTypeLabel(row.shipmentType, shipmentTypeOptions)}
      </td>
      {showDestCol && (
        <td className={t.numCell} style={{ textAlign: 'left' }}>
          {row.destination?.trim() || <span className="text-slate-300">—</span>}
        </td>
      )}
      {sizes.map((size) => (
        <td key={size} className={t.deptCell}>
          {(qtyBySize[size] ?? 0) > 0
            ? (qtyBySize[size] ?? 0).toLocaleString()
            : <span className="text-slate-200">—</span>}
        </td>
      ))}
      <td className={`${t.statusCell} font-bold text-slate-800`}>
        {total > 0 ? total.toLocaleString() : '—'}
      </td>
      {showInvoiceCol && (
        <td className={t.numCell} style={{ textAlign: 'left' }}>
          {row.invoiceNumber?.trim() || <span className="text-slate-300">—</span>}
        </td>
      )}
      {showAwbCol && (
        <td className={t.numCell} style={{ textAlign: 'left' }}>
          {row.awbNumber?.trim() || <span className="text-slate-300">—</span>}
        </td>
      )}
    </tr>
  );
}

export const ShipmentActualReadOnly: React.FC<ShipmentActualReadOnlyProps> = ({
  shipments,
  colorways,
  colorwayId,
  displaySizes,
  shipmentTypeOptions,
  embedded = false,
}) => {
  const rows = useMemo(() => {
    const base = colorwayId
      ? shipments.filter((s) => s.colorwayId === colorwayId)
      : shipments;
    return [...base].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [shipments, colorwayId]);

  const sizes = useMemo(() => {
    if (displaySizes?.length) return displaySizes;
    return Array.from(
      new Set(rows.flatMap((r) => Object.keys(r.qtyBySize ?? {}))),
    ).sort();
  }, [displaySizes, rows]);

  const showDestCol = rows.some((r) => r.destination?.trim());
  const showInvoiceCol = rows.some((r) => r.invoiceNumber?.trim());
  const showAwbCol = rows.some((r) => r.awbNumber?.trim());
  const leadingMetaCols = 3 + (showDestCol ? 1 : 0);
  const totalCols = leadingMetaCols + sizes.length + 1 + (showInvoiceCol ? 1 : 0) + (showAwbCol ? 1 : 0);
  const colWidth = `${100 / totalCols}%`;

  const sizeTotals = useMemo(
    () =>
      sizes.map((size) =>
        rows.reduce((sum, row) => sum + (row.qtyBySize?.[size] ?? 0), 0),
      ),
    [rows, sizes],
  );

  const totalQty = rows.reduce((s, r) => s + (r.qty || 0), 0);

  if (rows.length === 0) {
    if (embedded) {
      return (
        <p className="text-xs text-slate-400 italic py-4 text-center">No shipments logged</p>
      );
    }
    return null;
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
                <th className={typeHeadCls} style={{ textAlign: 'left' }}>Type</th>
                {showDestCol && (
                  <th className={t.numHead} style={{ textAlign: 'left' }}>Destination</th>
                )}
                {sizes.map((s) => (
                  <th key={s} className={t.deptHead}>{s}</th>
                ))}
                <th className={t.statusHead}>Total</th>
                {showInvoiceCol && (
                  <th className={t.numHead} style={{ textAlign: 'left' }}>Invoice</th>
                )}
                {showAwbCol && (
                  <th className={t.numHead} style={{ textAlign: 'left' }}>AWB</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <ShipmentActualDataRow
                  key={row.id ?? `${row.date}-${row.colorwayId}-${row.qty}`}
                  row={row}
                  colorways={colorways}
                  sizes={sizes}
                  showDestCol={showDestCol}
                  showInvoiceCol={showInvoiceCol}
                  showAwbCol={showAwbCol}
                  shipmentTypeOptions={shipmentTypeOptions}
                />
              ))}
            </tbody>
            <tfoot className="bg-slate-100 border-t-2 border-slate-200 font-bold text-slate-700">
              <tr>
                <td colSpan={leadingMetaCols} className={t.footFirst}>
                  Total
                </td>
                {sizes.map((s, idx) => (
                  <td key={s} className={t.footDept}>
                    {sizeTotals[idx] > 0 ? sizeTotals[idx].toLocaleString() : '—'}
                  </td>
                ))}
                <td className={t.footStatus}>{totalQty > 0 ? totalQty.toLocaleString() : '—'}</td>
                {showInvoiceCol && <td className={t.footDept}> </td>}
                {showAwbCol && <td className={t.footDept}> </td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );

  return tableBlock;
};
