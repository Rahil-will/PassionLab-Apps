import React, { useMemo } from 'react';
import type { CutToShipRow } from '../../lib/mesReportsApi';
import {
  buildFulfillmentSnapshot,
  formatFulfillmentBool,
  formatFulfillmentPct,
  fulfillmentBoolTone,
} from '../../lib/fulfillmentMetrics';
import { formatFabricCutQtyTooltip } from '../../lib/fabricCutQtyDisplay';
import type { ColorwayCompletionStatus } from '../../types';

export interface StyleFulfillmentMetricsBarProps {
  reconRow: CutToShipRow | null;
  deliveryDate: string | null;
  completionStatus: ColorwayCompletionStatus;
  scopedOrderQty: number;
  scopedAdjQty: number;
  /** Captured qty from the first origin visit in flow order. */
  originCutQty?: number;
  /** Produced qty at the first operation in route order. */
  firstOperationProduced?: number;
  /** Produced qty at the last operation in route order. */
  lastOperationProduced?: number;
}

export const StyleFulfillmentMetricsBar: React.FC<StyleFulfillmentMetricsBarProps> = ({
  reconRow,
  deliveryDate,
  completionStatus,
  scopedOrderQty,
  scopedAdjQty,
  originCutQty,
  firstOperationProduced,
  lastOperationProduced,
}) => {
  const fulfillment = useMemo(() => {
    if (!reconRow) return null;
    return buildFulfillmentSnapshot(reconRow, deliveryDate, completionStatus, {
      orderQty: scopedOrderQty > 0 ? scopedOrderQty : reconRow.order_qty,
      adjQty: scopedAdjQty > 0 ? scopedAdjQty : reconRow.order_qty,
      originCutQty,
      firstOperationProduced,
      lastOperationProduced,
    });
  }, [reconRow, deliveryDate, completionStatus, scopedOrderQty, scopedAdjQty, originCutQty, firstOperationProduced, lastOperationProduced]);

  if (!fulfillment) return null;

  const fabricTooltip = formatFabricCutQtyTooltip(reconRow?.cut_qty_by_component ?? []);

  const cells = [
    { label: 'Order → Cut', value: formatFulfillmentPct(fulfillment.orderToCutPct), tone: 'neutral' as const },
    { label: 'Order → Ship', value: formatFulfillmentPct(fulfillment.orderToShipPct), tone: 'neutral' as const },
    {
      label: 'Cut → Ship',
      value: formatFulfillmentPct(fulfillment.cutToShipPct),
      title: fabricTooltip || (reconRow?.cut_qty_source === 'captured' ? 'Primary fabric captured cut qty' : undefined),
      tone: 'neutral' as const,
    },
    { label: 'On time', value: formatFulfillmentBool(fulfillment.onTime), tone: fulfillmentBoolTone(formatFulfillmentBool(fulfillment.onTime)) as 'yes' | 'no' | 'neutral' },
    { label: 'In full', value: formatFulfillmentBool(fulfillment.inFull), tone: fulfillmentBoolTone(formatFulfillmentBool(fulfillment.inFull)) as 'yes' | 'no' | 'neutral' },
    {
      label: 'On time in full',
      value: formatFulfillmentBool(fulfillment.onTimeInFull),
      tone: fulfillmentBoolTone(formatFulfillmentBool(fulfillment.onTimeInFull)) as 'yes' | 'no' | 'neutral',
    },
    {
      label: 'Last shipment',
      value: reconRow?.last_shipment_date?.slice(0, 10) ?? '—',
      tone: 'neutral' as const,
    },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-px bg-slate-100">
        {cells.map((cell) => (
          <div key={cell.label} className="bg-white px-3 py-3" title={'title' in cell ? cell.title : undefined}>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{cell.label}</div>
            <div className={`text-sm font-bold mt-1 tabular-nums ${
              cell.tone === 'yes'
                ? 'text-emerald-700'
                : cell.tone === 'no'
                  ? 'text-red-600'
                  : 'text-slate-800'
            }`}>{cell.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
