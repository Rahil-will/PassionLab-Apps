import React from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { AlertTriangle } from 'lucide-react';
import type { OrderPriority } from '../../types';
import { OrderPriorityChip } from '../../lib/orderPriority';
import { HandoverDisputeCell } from './HandoverDisputeCell';
import { HandoverStatusBadge } from './HandoverStatusBadge';
import {
  handoverDbToDisplay,
  handoverQtyGap,
} from '../../lib/handoverStatus';
import { useMemo } from 'react';
import {
  groupHandoverRows,
  type HandoverReportRow,
} from '../../lib/transactionReportApi';

const TX_COL_WIDTHS_FULL = [
  '6rem', // sent at
  '9rem', // style
  '6.5rem', // PO
  '6rem', // color
  '8rem', // from department and operation
  '8rem', // to department and operation
  '5.5rem', // sent pcs
  '6rem', // sent by
  '5.5rem', // received pcs
  '6rem', // received by
  '3.75rem', // gap
  '6rem', // received at
  '4.25rem', // status
  '8rem', // comment / dispute time
] as const;

const TX_COL_WIDTHS_STYLE_REPORT = [
  '6rem', // sent at
  '6rem', // color
  '8rem', // from department and operation
  '8rem', // to department and operation
  '5.5rem', // sent pcs
  '6rem', // sent by
  '5.5rem', // received pcs
  '6rem', // received by
  '3.75rem', // gap
  '6rem', // received at
  '4.25rem', // status
  '8rem', // comment / dispute time
] as const;

const TH =
  'px-2 py-2 text-[10px] font-semibold text-slate-600 uppercase bg-slate-50 border-b border-r border-slate-200 last:border-r-0';
const TH_LEFT = `${TH} text-left`;
const TH_CENTER = `${TH} text-center`;
const TD =
  'px-2 py-2 text-[11px] text-slate-700 align-middle border-r border-slate-200 last:border-r-0';
const TD_LEFT = `${TD} text-left`;
const TD_CENTER = `${TD} text-center tabular-nums`;

function TxColGroup({ hideStyleAndPoColumns = false }: { hideStyleAndPoColumns?: boolean }) {
  const widths = hideStyleAndPoColumns ? TX_COL_WIDTHS_STYLE_REPORT : TX_COL_WIDTHS_FULL;
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
}

function formatSentDateTime(iso: string): React.ReactNode {
  try {
    const d = parseISO(iso);
    return (
      <>
        {format(d, 'dd MMM yyyy')}
        <br />
        {format(d, 'HH:mm')}
      </>
    );
  } catch {
    return '—';
  }
}

function formatReceivedDateTime(iso: string | null): React.ReactNode {
  if (!iso) return '—';
  try {
    const d = parseISO(iso);
    return (
      <>
        {format(d, 'dd MMM yyyy')}
        <br />
        {format(d, 'HH:mm')}
      </>
    );
  } catch {
    return '—';
  }
}

function GapCell({ row }: { row: HandoverReportRow }) {
  const gap = handoverQtyGap(row.sentQty, row.receivedQty, row.status);
  if (gap == null) return <span className="text-slate-400">—</span>;
  if (gap === 0) return <span className="text-emerald-600 font-semibold">0</span>;
  return (
    <span className="inline-flex items-center justify-center gap-0.5 text-amber-700 font-bold">
      <AlertTriangle size={11} className="shrink-0" />
      {gap > 0 ? `+${gap}` : gap}
    </span>
  );
}

function TransactionRow({
  row,
  priority,
  styleRef,
  onOpenOrder,
  hideStyleAndPoColumns = false,
}: {
  row: HandoverReportRow;
  priority?: OrderPriority | null;
  styleRef?: string | null;
  onOpenOrder?: (orderId: string, colorwayId: string | null) => void;
  hideStyleAndPoColumns?: boolean;
}) {
  const display = handoverDbToDisplay(row.status);
  const receivedQty =
    display === 'in_transit' ? null : row.receivedQty ?? row.sentQty;
  const fromPrinting = /printing/i.test(row.fromDepartmentName);
  const toPrinting = /printing/i.test(row.toDepartmentName);
  const fromOperationContext = [
    row.fromProduceOperationNames,
    fromPrinting ? row.fromResourceName : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const toOperationContext = [
    row.toProduceOperationNames,
    toPrinting ? row.toResourceName : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <tr className="hover:bg-slate-50/60">
      <td className={`${TD_CENTER} text-slate-600`}>
        {formatSentDateTime(row.sentAt)}
      </td>
      {!hideStyleAndPoColumns && (
        <td className={TD_LEFT}>
          {onOpenOrder ? (
            <button
              type="button"
              className="text-left text-blue-700 hover:underline font-semibold truncate block max-w-full inline-flex items-center gap-1.5"
              onClick={() => onOpenOrder(row.orderId, row.colorwayId)}
            >
              <span className="truncate">{row.styleName || '—'}</span>
              <OrderPriorityChip priority={priority} />
            </button>
          ) : (
            <span className="font-semibold truncate inline-flex items-center gap-1.5">
              <span className="truncate">{row.styleName || '—'}</span>
              <OrderPriorityChip priority={priority} />
            </span>
          )}
          {styleRef ? (
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">{styleRef}</div>
          ) : null}
        </td>
      )}
      {!hideStyleAndPoColumns && (
        <td className={`${TD_LEFT} font-mono text-slate-600 truncate`}>
          {row.poNumber || '—'}
        </td>
      )}
      <td className={`${TD_LEFT} truncate`}>
        {row.colorwayName || <span className="text-slate-400">—</span>}
      </td>
      <td className={TD_LEFT}>
        <div className="font-medium truncate">{row.fromDepartmentName || '—'}</div>
        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
          {fromOperationContext || '—'}
        </div>
      </td>
      <td className={TD_LEFT}>
        <div className="font-medium truncate">{row.toDepartmentName || '—'}</div>
        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
          {toOperationContext || '—'}
        </div>
      </td>
      <td className={`${TD_CENTER} font-bold text-slate-900`}>
        {row.sentQty.toLocaleString()}
      </td>
      <td className={`${TD_LEFT} text-slate-600 truncate`}>{row.sentByName || '—'}</td>
      <td className={`${TD_CENTER} font-bold text-slate-900`}>
        {receivedQty != null ? receivedQty.toLocaleString() : '—'}
      </td>
      <td className={`${TD_LEFT} text-slate-600 truncate`}>
        {display === 'in_transit' ? '—' : row.receivedByName || '—'}
      </td>
      <td className={TD_CENTER}>
        <GapCell row={row} />
      </td>
      <td className={`${TD_CENTER} text-slate-600`}>
        {formatReceivedDateTime(row.receivedAt)}
      </td>
      <td className={TD_CENTER}>
        <HandoverStatusBadge status={row.status} />
      </td>
      <td className={`${TD_LEFT} min-w-0`}>
        <HandoverDisputeCell row={row} />
      </td>
    </tr>
  );
}

const TABLE_HEADERS_FULL: { label: string; align: 'left' | 'center'; key: string }[] = [
  { key: 'sentAt', label: 'Sent at', align: 'center' },
  { key: 'style', label: 'Style', align: 'left' },
  { key: 'po', label: 'PO', align: 'left' },
  { key: 'color', label: 'Color', align: 'left' },
  { key: 'fromDept', label: 'From Department', align: 'left' },
  { key: 'toDept', label: 'To Department', align: 'left' },
  { key: 'sentPcs', label: 'Sent pcs', align: 'center' },
  { key: 'sentBy', label: 'Sent by', align: 'left' },
  { key: 'receivedPcs', label: 'Received pcs', align: 'center' },
  { key: 'receivedBy', label: 'Received by', align: 'left' },
  { key: 'missing', label: 'Missing', align: 'center' },
  { key: 'receivedAt', label: 'Received at', align: 'center' },
  { key: 'status', label: 'Status', align: 'center' },
  { key: 'comment', label: 'Comment', align: 'left' },
];

function tableHeadersFor(hideStyleAndPoColumns: boolean) {
  if (!hideStyleAndPoColumns) return TABLE_HEADERS_FULL;
  return TABLE_HEADERS_FULL.filter((h) => h.key !== 'style' && h.key !== 'po');
}

export interface HandoverReportTableProps {
  rows: HandoverReportRow[];
  shifts?: Array<{ id: string; name?: string }>;
  onOpenOrder?: (orderId: string, colorwayId: string | null) => void;
  priorityByOrderId?: Map<string, OrderPriority | null>;
  styleRefByOrderId?: Map<string, string | null>;
  className?: string;
  /** Embed inside a rounded card — normal padding, no top border on first date group. */
  inset?: boolean;
  /** Edge-to-edge table — no horizontal padding on date/shift group headers. */
  flush?: boolean;
  /** Style report: order/style already shown in page header — hide Style + PO columns. */
  hideStyleAndPoColumns?: boolean;
}

export const HandoverReportTable: React.FC<HandoverReportTableProps> = ({
  rows,
  shifts,
  onOpenOrder,
  priorityByOrderId,
  styleRefByOrderId,
  className,
  inset = false,
  flush = false,
  hideStyleAndPoColumns = false,
}) => {
  const shiftOrder = useMemo(() => (shifts ?? []).map((s) => s.id), [shifts]);
  const dateGroups = useMemo(() => groupHandoverRows(rows, shiftOrder), [rows, shiftOrder]);
  const groupPad = flush && !inset ? 'px-0' : 'px-4';
  const tableHeaders = useMemo(
    () => tableHeadersFor(hideStyleAndPoColumns),
    [hideStyleAndPoColumns],
  );

  if (dateGroups.length === 0) return null;

  return (
    <div className={className}>
      {dateGroups.map((dateGroup, dateIdx) => (
        <div
          key={dateGroup.logDate}
          className={dateIdx === 0 && inset ? '' : 'border-t border-slate-100'}
        >
          <div className={`${groupPad} py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between`}>
            <h2 className="text-xs font-bold text-slate-800">
              {format(parseISO(dateGroup.logDate), 'EEEE, d MMM yyyy')}
            </h2>
            <span className="text-[10px] font-semibold text-slate-500 tabular-nums">
              {dateGroup.totalQty.toLocaleString()} pcs
            </span>
          </div>

          {dateGroup.shiftGroups.map((shiftGroup) => (
            <div key={`${dateGroup.logDate}-${shiftGroup.shiftId ?? ''}-${shiftGroup.shiftName}`}>
              <div className={`${groupPad} py-2 border-b border-slate-100 flex items-center justify-between bg-white`}>
                <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">
                  {shiftGroup.shiftName}
                </span>
                <span className="text-[10px] text-slate-500 tabular-nums">
                  {shiftGroup.hourSlotGroups.reduce((n, g) => n + g.rows.length, 0)} moves ·{' '}
                  {shiftGroup.totalQty.toLocaleString()} pcs
                </span>
              </div>

              {shiftGroup.hourSlotGroups.map((hourGroup) => (
                <div key={`${shiftGroup.shiftId}-${hourGroup.hourSlot}`}>
                  <div className="px-4 py-1.5 bg-slate-50/60 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-600 tabular-nums">
                      {hourGroup.hourSlot}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      {hourGroup.rows.length} · {hourGroup.totalQty.toLocaleString()} pcs
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed border-collapse">
                      <TxColGroup hideStyleAndPoColumns={hideStyleAndPoColumns} />
                      <thead>
                        <tr>
                          {tableHeaders.map(({ key, label, align }) => (
                            <th key={key} className={align === 'center' ? TH_CENTER : TH_LEFT}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hourGroup.rows.map((row) => (
                          <TransactionRow
                            key={row.id}
                            row={row}
                            priority={priorityByOrderId?.get(row.orderId)}
                            styleRef={styleRefByOrderId?.get(row.orderId)}
                            onOpenOrder={onOpenOrder}
                            hideStyleAndPoColumns={hideStyleAndPoColumns}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
