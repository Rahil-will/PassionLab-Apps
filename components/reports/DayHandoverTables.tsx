import React, { useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import {
  type DayDeptReceivedRow,
  type DayDeptSentRow,
  type DayHandoverRowStatus,
  type DayHandoverSummary,
} from '../../lib/mesReportsApi';
import { HandoverStatusBadge } from './HandoverStatusBadge';

function formatDayRow(iso: string): string {
  try {
    return format(parseISO(iso), 'dd MMM yyyy');
  } catch {
    return iso;
  }
}

function DateDividerRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr className="bg-slate-50">
      <td
        colSpan={colSpan}
        className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-wide text-slate-500 border-y border-slate-200"
      >
        {label}
      </td>
    </tr>
  );
}

type HandoverDay = { date: string; handover: DayHandoverSummary };

function dayHasHandover(handover: DayHandoverSummary): boolean {
  return handover.received.length > 0 || handover.sent.length > 0;
}

function qtyCell(value: number): string {
  return value > 0 ? value.toLocaleString() : '—';
}

function missingCell(value: number | null): string {
  if (value == null) return '—';
  return value > 0 ? value.toLocaleString() : '0';
}

function ReceivedTableBody({
  days,
  multiDay,
}: {
  days: HandoverDay[];
  multiDay: boolean;
}) {
  const colSpan = 10;

  if (!multiDay) {
    const received = days[0]?.handover.received ?? [];
    if (received.length === 0) {
      return (
        <tbody className="divide-y divide-slate-100">
          <tr>
            <td colSpan={colSpan} className="py-5 text-center text-slate-400 text-[10px]">
              Nothing received
            </td>
          </tr>
        </tbody>
      );
    }
    return (
      <tbody className="divide-y divide-slate-100">
        {received.map((row, i) => (
          <ReceivedDataRow key={`recv-${row.fromDepartmentName}-${row.styleName}-${i}`} row={row} />
        ))}
      </tbody>
    );
  }

  return (
    <tbody className="divide-y divide-slate-100">
      {days.map(({ date, handover }) => (
        <React.Fragment key={date}>
          <DateDividerRow colSpan={colSpan} label={formatDayRow(date)} />
          {handover.received.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="py-3 text-center text-slate-400 text-[10px]">
                Nothing received
              </td>
            </tr>
          ) : (
            handover.received.map((row, i) => (
              <ReceivedDataRow
                key={`recv-${date}-${row.fromDepartmentName}-${row.styleName}-${i}`}
                row={row}
              />
            ))
          )}
        </React.Fragment>
      ))}
    </tbody>
  );
}

function SentTableBody({ days, multiDay }: { days: HandoverDay[]; multiDay: boolean }) {
  const colSpan = 10;

  if (!multiDay) {
    const sent = days[0]?.handover.sent ?? [];
    if (sent.length === 0) {
      return (
        <tbody className="divide-y divide-slate-100">
          <tr>
            <td colSpan={colSpan} className="py-5 text-center text-slate-400 text-[10px]">
              Nothing sent
            </td>
          </tr>
        </tbody>
      );
    }
    return (
      <tbody className="divide-y divide-slate-100">
        {sent.map((row, i) => (
          <SentDataRow key={`sent-${row.toDepartmentName}-${row.styleName}-${i}`} row={row} />
        ))}
      </tbody>
    );
  }

  return (
    <tbody className="divide-y divide-slate-100">
      {days.map(({ date, handover }) => (
        <React.Fragment key={date}>
          <DateDividerRow colSpan={colSpan} label={formatDayRow(date)} />
          {handover.sent.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="py-3 text-center text-slate-400 text-[10px]">
                Nothing sent
              </td>
            </tr>
          ) : (
            handover.sent.map((row, i) => (
              <SentDataRow key={`sent-${date}-${row.toDepartmentName}-${row.styleName}-${i}`} row={row} />
            ))
          )}
        </React.Fragment>
      ))}
    </tbody>
  );
}

function HandoverStatusCell({ status }: { status: DayHandoverRowStatus }) {
  const badgeStatus =
    status === 'received' || status === 'received_disputed'
      ? 'received'
      : status === 'disputed'
        ? 'disputed'
        : 'pending';
  return (
    <td className={`${t.deptCell} text-center`}>
      <HandoverStatusBadge status={badgeStatus} />
    </td>
  );
}

function ReceivedDataRow({ row }: { row: DayDeptReceivedRow }) {
  return (
    <tr>
      <td className={`${t.firstCell} text-left font-medium text-slate-700`}>{row.fromDepartmentName}</td>
      <td className={`${t.deptCell} text-left text-slate-800`}>{row.styleName}</td>
      <td className={`${t.deptCell} text-left text-slate-600`}>{row.buyerName || '—'}</td>
      <td className={`${t.deptCell} text-left text-slate-500`}>{row.poNumber || '—'}</td>
      <td className={`${t.deptCell} text-left text-slate-600`}>{row.operationName}</td>
      <td className={`${t.deptCell} text-left text-slate-600`}>{row.colorName}</td>
      <HandoverStatusCell status={row.status} />
      <td className={t.numCell}>{qtyCell(row.sentQty)}</td>
      <td className={t.numCell}>{qtyCell(row.receivedQty)}</td>
      <td className={`${t.numCell} ${row.missingInTransit != null && row.missingInTransit > 0 ? 'text-amber-700 font-semibold' : ''}`}>
        {missingCell(row.missingInTransit)}
      </td>
    </tr>
  );
}

function SentDataRow({ row }: { row: DayDeptSentRow }) {
  return (
    <tr>
      <td className={`${t.firstCell} text-left font-medium text-slate-700`}>{row.toDepartmentName}</td>
      <td className={`${t.deptCell} text-left text-slate-800`}>{row.styleName}</td>
      <td className={`${t.deptCell} text-left text-slate-600`}>{row.buyerName || '—'}</td>
      <td className={`${t.deptCell} text-left text-slate-500`}>{row.poNumber || '—'}</td>
      <td className={`${t.deptCell} text-left text-slate-600`}>{row.operationName}</td>
      <td className={`${t.deptCell} text-left text-slate-600`}>{row.colorName}</td>
      <HandoverStatusCell status={row.status} />
      <td className={t.numCell}>{qtyCell(row.sentQty)}</td>
      <td className={t.numCell}>{qtyCell(row.receivedQty)}</td>
      <td className={`${t.numCell} ${row.missingInTransit != null && row.missingInTransit > 0 ? 'text-amber-700 font-semibold' : ''}`}>
        {missingCell(row.missingInTransit)}
      </td>
    </tr>
  );
}

function sumReceived(rows: DayDeptReceivedRow[]) {
  return rows.reduce(
    (acc, row) => ({
      sent: acc.sent + row.sentQty,
      received: acc.received + row.receivedQty,
      missing: acc.missing + (row.missingInTransit ?? 0),
    }),
    { sent: 0, received: 0, missing: 0 },
  );
}

function sumSent(rows: DayDeptSentRow[]) {
  return rows.reduce(
    (acc, row) => ({
      sent: acc.sent + row.sentQty,
      received: acc.received + row.receivedQty,
      missing: acc.missing + (row.missingInTransit ?? 0),
    }),
    { sent: 0, received: 0, missing: 0 },
  );
}

export interface DayHandoverTablesProps {
  deptName: string;
  handover: DayHandoverSummary;
  handoverByDay?: Array<{ date: string; handover: DayHandoverSummary }>;
  multiDay?: boolean;
}

export const DayHandoverTables: React.FC<DayHandoverTablesProps> = ({
  deptName,
  handover,
  handoverByDay,
  multiDay = false,
}) => {
  const activeDays = useMemo(() => {
    const raw: HandoverDay[] =
      multiDay && handoverByDay && handoverByDay.length > 0
        ? handoverByDay
        : [{ date: '', handover }];
    return multiDay ? raw.filter((d) => dayHasHandover(d.handover)) : raw;
  }, [multiDay, handoverByDay, handover]);

  const showMultiDay = multiDay && activeDays.length > 0;

  const recvTotals = useMemo(() => {
    if (showMultiDay) {
      return activeDays.reduce(
        (sum, d) => {
          const part = sumReceived(d.handover.received);
          return {
            sent: sum.sent + part.sent,
            received: sum.received + part.received,
            missing: sum.missing + part.missing,
          };
        },
        { sent: 0, received: 0, missing: 0 },
      );
    }
    return sumReceived(handover.received);
  }, [showMultiDay, activeDays, handover.received]);

  const sentTotals = useMemo(() => {
    if (showMultiDay) {
      return activeDays.reduce(
        (sum, d) => {
          const part = sumSent(d.handover.sent);
          return {
            sent: sum.sent + part.sent,
            received: sum.received + part.received,
            missing: sum.missing + part.missing,
          };
        },
        { sent: 0, received: 0, missing: 0 },
      );
    }
    return sumSent(handover.sent);
  }, [showMultiDay, activeDays, handover.sent]);

  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors"
      >
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
          {deptName} — handovers
        </h3>
        <span className="text-[9px] text-slate-500 tabular-nums font-semibold">
          In {recvTotals.received.toLocaleString()} · Out {sentTotals.sent.toLocaleString()}
          {recvTotals.missing + sentTotals.missing > 0
            ? ` · Missing ${(recvTotals.missing + sentTotals.missing).toLocaleString()}`
            : ''}
        </span>
        <span className="ml-auto text-slate-400 shrink-0">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {!collapsed && (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
              <ArrowDownLeft size={13} className="text-blue-500" />
              <p className="text-[9px] font-semibold uppercase text-slate-600">Received from</p>
              <span className="ml-auto text-[9px] font-bold tabular-nums text-slate-700">
                {recvTotals.received.toLocaleString()}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className={`${t.table} w-full`}>
                <thead className={t.thead}>
                  <tr>
                    <th className={`${t.firstHead} text-left`}>From dept</th>
                    <th className={`${t.deptHead} text-left`}>Style</th>
                    <th className={`${t.deptHead} text-left`}>Buyer</th>
                    <th className={`${t.deptHead} text-left`}>PO</th>
                    <th className={`${t.deptHead} text-left`}>Operation</th>
                    <th className={`${t.deptHead} text-left`}>Color</th>
                    <th className={`${t.deptHead} text-center`}>Status</th>
                    <th className={t.numHead}>Sent</th>
                    <th className={t.numHead}>Received</th>
                    <th className={t.numHead}>Missing</th>
                  </tr>
                </thead>
                <ReceivedTableBody days={activeDays} multiDay={showMultiDay} />
              </table>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
              <ArrowUpRight size={13} className="text-blue-500" />
              <p className="text-[9px] font-semibold uppercase text-slate-600">Sent to</p>
              <span className="ml-auto text-[9px] font-bold tabular-nums text-slate-700">
                {sentTotals.sent.toLocaleString()}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className={`${t.table} w-full`}>
                <thead className={t.thead}>
                  <tr>
                    <th className={`${t.firstHead} text-left`}>To dept</th>
                    <th className={`${t.deptHead} text-left`}>Style</th>
                    <th className={`${t.deptHead} text-left`}>Buyer</th>
                    <th className={`${t.deptHead} text-left`}>PO</th>
                    <th className={`${t.deptHead} text-left`}>Operation</th>
                    <th className={`${t.deptHead} text-left`}>Color</th>
                    <th className={`${t.deptHead} text-center`}>Status</th>
                    <th className={t.numHead}>Sent</th>
                    <th className={t.numHead}>Received</th>
                    <th className={t.numHead}>Missing</th>
                  </tr>
                </thead>
                <SentTableBody days={activeDays} multiDay={showMultiDay} />
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
