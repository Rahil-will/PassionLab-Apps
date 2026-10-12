import React, { useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import type { DayNativeEntry } from '../../lib/mesReportsApi';

function formatDateTime(value: string | undefined): string {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'dd MMM, HH:mm');
  } catch {
    return value;
  }
}

function formatDay(value: string): string {
  try {
    return format(parseISO(value), 'dd MMM yyyy');
  } catch {
    return value;
  }
}

interface DayNativeEntriesProps {
  entries: DayNativeEntry[];
  kind: 'cutting_session' | 'shipment' | 'outsource' | 'batch';
  multiDay: boolean;
  searchQuery?: string;
}

function matchesEntry(query: string, entry: DayNativeEntry): boolean {
  const q = query.toLowerCase();
  const hay = [
    entry.styleName,
    entry.styleRef,
    entry.poNumber,
    entry.buyerName,
    entry.colorName,
    entry.operationName,
    entry.resourceName,
    entry.fabricCode,
    entry.sessionNo,
    entry.refNo,
    entry.activityNo,
    entry.notes,
    entry.comment,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export const DayNativeEntries: React.FC<DayNativeEntriesProps> = ({ entries, kind, multiDay, searchQuery = '' }) => {
  const [collapsed, setCollapsed] = useState(false);
  const title =
    kind === 'cutting_session'
      ? 'Cutting sessions'
      : kind === 'shipment'
        ? 'Shipment logs'
        : kind === 'outsource'
          ? 'Vendor movements'
          : 'Batch output';

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return entries;
    return entries.filter((entry) => matchesEntry(q, entry));
  }, [entries, searchQuery]);

  const total = useMemo(
    () =>
      filteredEntries.reduce((sum, entry) => {
        if (kind === 'outsource') return sum + (entry.receivedQty || 0);
        return sum + entry.outputQty;
      }, 0),
    [filteredEntries, kind],
  );
  const dates = useMemo(
    () => [...new Set(filteredEntries.map((entry) => entry.logDate))].sort(),
    [filteredEntries],
  );

  const colCount =
    kind === 'cutting_session' ? 14 : kind === 'shipment' ? 12 : kind === 'outsource' ? 11 : 12;
  const colSpan = colCount;

  const rows = (list: DayNativeEntry[]) =>
    list.map((entry) => (
      <tr key={entry.id} className="hover:bg-slate-50/80">
        <td className={`${t.firstCell} text-left text-slate-500 tabular-nums whitespace-nowrap`}>
          {formatDateTime(entry.startedAt)}
        </td>
        {kind === 'cutting_session' && (
          <>
            <td className={`${t.deptCell} text-left text-slate-500 tabular-nums whitespace-nowrap`}>
              {formatDateTime(entry.endedAt)}
            </td>
            <td className={`${t.deptCell} text-left text-slate-800`}>{entry.styleName}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.buyerName || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.poNumber || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.operationName}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.resourceName || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.sessionNo || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.refNo || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.fabricType || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-500`}>{entry.layNo || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.colorName}</td>
            <td className={`${t.deptCell} text-left text-slate-600 whitespace-nowrap`}>
              {entry.workerCategories?.length
                ? entry.workerCategories.map((worker) => `${worker.category}: ${worker.count}`).join(' · ')
                : '—'}
            </td>
          </>
        )}
        {kind === 'shipment' && (
          <>
            <td className={`${t.deptCell} text-left text-slate-800`}>{entry.styleName}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.buyerName || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.poNumber || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.operationName}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.colorName}</td>
            <td className={`${t.deptCell} text-left text-slate-600 capitalize`}>{entry.shipmentType || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.destination || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.invoiceNumber || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.awbNumber || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-500`}>{entry.notes || '—'}</td>
          </>
        )}
        {kind === 'outsource' && (
          <>
            <td className={`${t.deptCell} text-left text-slate-800`}>{entry.styleName}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.buyerName || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.poNumber || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-800`}>{entry.resourceName || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.operationName}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.colorName}</td>
            <td className={`${t.deptCell} text-right text-slate-700 tabular-nums`}>
              {(entry.sentQty || 0).toLocaleString()}
            </td>
            <td className={`${t.deptCell} text-right text-slate-700 tabular-nums`}>
              {(entry.receivedQty || 0).toLocaleString()}
            </td>
            <td className={`${t.deptCell} text-left text-slate-500`}>{entry.notes || '—'}</td>
          </>
        )}
        {kind === 'batch' && (
          <>
            <td className={`${t.deptCell} text-left text-slate-500 tabular-nums whitespace-nowrap`}>
              {formatDateTime(entry.endedAt)}
            </td>
            <td className={`${t.deptCell} text-left text-slate-800`}>{entry.styleName}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.buyerName || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.poNumber || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.operationName}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.resourceName || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.activityNo || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-700`}>{entry.refNo || '—'}</td>
            <td className={`${t.deptCell} text-left text-slate-600`}>{entry.colorName}</td>
            <td className={`${t.deptCell} text-left text-slate-600 whitespace-nowrap`}>
              {entry.workerCategories?.length
                ? entry.workerCategories.map((worker) => `${worker.category}: ${worker.count}`).join(' · ')
                : '—'}
            </td>
          </>
        )}
        <td className={`${t.numCell} text-slate-900`}>
          {kind === 'outsource'
            ? (entry.receivedQty || 0).toLocaleString()
            : entry.outputQty.toLocaleString()}
        </td>
      </tr>
    ));

  const emptyLabel =
    kind === 'cutting_session'
      ? 'cutting sessions'
      : kind === 'shipment'
        ? 'shipment logs'
        : kind === 'outsource'
          ? 'vendor movements'
          : 'batch records';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="w-full px-4 py-2.5 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors"
      >
        <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">{title}</h3>
        <span className="text-[9px] text-slate-500 tabular-nums">
          {filteredEntries.length} entries · {total.toLocaleString()} pcs
        </span>
        <span className="ml-auto text-slate-400 shrink-0">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>
      {!collapsed && (
        <div className="w-full overflow-x-auto">
          <table className={`${t.table} w-full min-w-max`}>
            <thead className={t.thead}>
              <tr>
                <th className={`${t.firstHead} text-left`}>
                  {kind === 'outsource' ? 'Date / Time' : kind === 'shipment' ? 'Logged' : 'Start'}
                </th>
                {kind === 'cutting_session' && (
                  <>
                    <th className={`${t.deptHead} text-left`}>End</th>
                    <th className={`${t.deptHead} text-left`}>Style</th>
                    <th className={`${t.deptHead} text-left`}>Buyer</th>
                    <th className={`${t.deptHead} text-left`}>PO</th>
                    <th className={`${t.deptHead} text-left`}>Operation</th>
                    <th className={`${t.deptHead} text-left`}>Resource</th>
                    <th className={`${t.deptHead} text-left`}>Session no</th>
                    <th className={`${t.deptHead} text-left`}>Ref no</th>
                    <th className={`${t.deptHead} text-left`}>Fabric type</th>
                    <th className={`${t.deptHead} text-left`}>Lay no</th>
                    <th className={`${t.deptHead} text-left`}>Color</th>
                    <th className={`${t.deptHead} text-left`}>Workers by category</th>
                  </>
                )}
                {kind === 'shipment' && (
                  <>
                    <th className={`${t.deptHead} text-left`}>Style</th>
                    <th className={`${t.deptHead} text-left`}>Buyer</th>
                    <th className={`${t.deptHead} text-left`}>PO</th>
                    <th className={`${t.deptHead} text-left`}>Operation</th>
                    <th className={`${t.deptHead} text-left`}>Color</th>
                    <th className={`${t.deptHead} text-left`}>Type</th>
                    <th className={`${t.deptHead} text-left`}>Destination</th>
                    <th className={`${t.deptHead} text-left`}>Invoice</th>
                    <th className={`${t.deptHead} text-left`}>AWB</th>
                    <th className={`${t.deptHead} text-left`}>Notes</th>
                  </>
                )}
                {kind === 'outsource' && (
                  <>
                    <th className={`${t.deptHead} text-left`}>Style</th>
                    <th className={`${t.deptHead} text-left`}>Buyer</th>
                    <th className={`${t.deptHead} text-left`}>PO</th>
                    <th className={`${t.deptHead} text-left`}>Vendor</th>
                    <th className={`${t.deptHead} text-left`}>Operation</th>
                    <th className={`${t.deptHead} text-left`}>Color</th>
                    <th className={`${t.deptHead} text-right`}>Sent</th>
                    <th className={`${t.deptHead} text-right`}>Received</th>
                    <th className={`${t.deptHead} text-left`}>Notes</th>
                  </>
                )}
                {kind === 'batch' && (
                  <>
                    <th className={`${t.deptHead} text-left`}>End</th>
                    <th className={`${t.deptHead} text-left`}>Style</th>
                    <th className={`${t.deptHead} text-left`}>Buyer</th>
                    <th className={`${t.deptHead} text-left`}>PO</th>
                    <th className={`${t.deptHead} text-left`}>Operation</th>
                    <th className={`${t.deptHead} text-left`}>Resource</th>
                    <th className={`${t.deptHead} text-left`}>Activity no</th>
                    <th className={`${t.deptHead} text-left`}>Ref no</th>
                    <th className={`${t.deptHead} text-left`}>Color</th>
                    <th className={`${t.deptHead} text-left`}>Workers by category</th>
                  </>
                )}
                <th className={t.numHead}>Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="py-8 px-4 text-center text-[10px] text-slate-400 italic">
                    No {emptyLabel} recorded for this period.
                  </td>
                </tr>
              ) : multiDay ? (
                dates.map((date) => (
                  <React.Fragment key={date}>
                    <tr className="bg-slate-50">
                      <td
                        colSpan={colSpan}
                        className="py-1.5 px-3 text-[9px] font-bold uppercase tracking-wide text-slate-500 border-y border-slate-200"
                      >
                        {formatDay(date)}
                      </td>
                    </tr>
                    {rows(filteredEntries.filter((entry) => entry.logDate === date))}
                  </React.Fragment>
                ))
              ) : (
                rows(filteredEntries)
              )}
              {filteredEntries.length > 0 && (
                <tr className="bg-slate-100 font-semibold">
                  <td className={t.footFirst}>Totals</td>
                  <td className={t.footDept} colSpan={colSpan - 2} />
                  <td className={t.footNum}>{total.toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
