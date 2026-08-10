import React, { useCallback, useEffect, useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { AlertTriangle } from 'lucide-react';
import { useNavigationStore } from '../../stores';
import { useDepartmentsCatalog, useShiftsCatalog } from '../../lib/queries/settingsSlices';
import { useOrdersEnrichedPage } from '../../lib/queries/factoryOrders';
import { RoutePath } from '../../types';
import type { OrderPriority } from '../../types';
import { SelectDropdown } from '../../components/ui';
import { PageShell } from '../../components/layout/PageShell';
import { ReportToolbar } from '../../components/reports/ReportToolbar';
import { HandoverDisputeCell } from '../../components/reports/HandoverDisputeCell';
import { HandoverStatusBadge } from '../../components/reports/HandoverStatusBadge';
import { OrderPriorityChip } from '../../lib/orderPriority';
import {
  handoverDbToDisplay,
  handoverQtyGap,
} from '../../lib/handoverStatus';
import {
  defaultTransactionReportRange,
  fetchHandoverReport,
  groupHandoverRows,
  type HandoverReportRow,
  type HandoverReportFilters,
} from '../../lib/transactionReportApi';

const POLL_MS = 60_000;

/** Vertical dividers only — no outer left/right or row lines. */
const TH =
  'px-2 py-2 text-[10px] font-semibold text-slate-600 uppercase bg-slate-50 border-b border-r border-slate-200 last:border-r-0';
const TH_LEFT = `${TH} text-left`;
const TH_CENTER = `${TH} text-center`;
const TD =
  'px-2 py-2 text-[11px] text-slate-700 align-middle border-r border-slate-200 last:border-r-0';
const TD_LEFT = `${TD} text-left`;
const TD_CENTER = `${TD} text-center tabular-nums`;

const TX_COL_WIDTHS = [
  '6rem',    // sent at
  '9rem',    // style
  '6.5rem',  // PO
  '6rem',    // color
  '8rem',    // from department and operation
  '8rem',    // to department and operation
  '5.5rem',  // sent pcs
  '6rem',    // sent by
  '5.5rem',  // received pcs
  '6rem',    // received by
  '3.75rem', // gap
  '6rem',    // received at
  '4.25rem', // status
  '8rem',    // comment / dispute time
] as const;

function TxColGroup() {
  return (
    <colgroup>
      {TX_COL_WIDTHS.map((w, i) => (
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
}: {
  row: HandoverReportRow;
  priority?: OrderPriority | null;
  styleRef?: string | null;
  onOpenOrder: (orderId: string, colorwayId: string | null) => void;
}) {
  const display = handoverDbToDisplay(row.status);
  const receivedQty =
    display === 'in_transit' ? null : row.receivedQty ?? row.sentQty;
  const fromPrinting = /printing/i.test(row.fromDepartmentName);
  const toPrinting = /printing/i.test(row.toDepartmentName);
  const fromOperationContext = [
    row.fromProduceOperationNames,
    fromPrinting ? row.fromResourceName : null,
  ].filter(Boolean).join(' · ');
  const toOperationContext = [
    row.toProduceOperationNames,
    toPrinting ? row.toResourceName : null,
  ].filter(Boolean).join(' · ');

  return (
    <tr className="hover:bg-slate-50/60">
      <td className={`${TD_CENTER} text-slate-600`}>
        {formatSentDateTime(row.sentAt)}
      </td>
      <td className={TD_LEFT}>
        <button
          type="button"
          className="text-left text-blue-700 hover:underline font-semibold truncate block max-w-full inline-flex items-center gap-1.5"
          onClick={() => onOpenOrder(row.orderId, row.colorwayId)}
        >
          <span className="truncate">{row.styleName || '—'}</span>
          <OrderPriorityChip priority={priority} />
        </button>
        {styleRef ? (
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">{styleRef}</div>
        ) : null}
      </td>
      <td className={`${TD_LEFT} font-mono text-slate-600 truncate`}>
        {row.poNumber || '—'}
      </td>
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

type StatusFilter = 'all' | 'in_transit' | 'received' | 'disputed';

export const TransactionReport: React.FC = () => {
  const { factoryId, navigate } = useNavigationStore();
  const { departments } = useDepartmentsCatalog(factoryId, 'core');
  const { shifts } = useShiftsCatalog(factoryId, 'core');
  const defaults = defaultTransactionReportRange();

  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fromDept, setFromDept] = useState('');
  const [toDept, setToDept] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rows, setRows] = useState<HandoverReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const filters = useMemo((): HandoverReportFilters => ({
    dateFrom,
    dateTo,
    fromDepartmentId: fromDept || null,
    toDepartmentId: toDept || null,
    status:
      statusFilter === 'all'
        ? null
        : statusFilter === 'in_transit'
          ? 'pending'
          : statusFilter,
    search: debouncedSearch,
  }), [dateFrom, dateTo, fromDept, toDept, statusFilter, debouncedSearch]);

  const load = useCallback(async (silent = false) => {
    if (!factoryId) {
      setLoading(false);
      return;
    }
    if (silent) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchHandoverReport(factoryId, filters);
      setRows(data);
      setLastUpdated(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load transactions';
      setLoadError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [factoryId, filters]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!factoryId) return undefined;
    const id = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [factoryId, load]);

  const shiftOrder = useMemo(() => shifts.map((s) => s.id), [shifts]);
  const dateGroups = useMemo(() => groupHandoverRows(rows, shiftOrder), [rows, shiftOrder]);
  const rowOrderIds = useMemo(
    () => [...new Set(rows.map((r) => r.orderId).filter(Boolean))],
    [rows],
  );
  const enrichedOrdersQuery = useOrdersEnrichedPage(
    factoryId,
    rowOrderIds,
    rowOrderIds.length > 0,
  );
  const priorityByOrderId = useMemo(
    () => new Map((enrichedOrdersQuery.data ?? []).map((o) => [o.id, o.priority])),
    [enrichedOrdersQuery.data],
  );
  const styleRefByOrderId = useMemo(
    () => new Map((enrichedOrdersQuery.data ?? []).map((o) => [o.id, o.styleRef ?? ''])),
    [enrichedOrdersQuery.data],
  );

  const deptOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments],
  );

  const openOrder = (orderId: string, colorwayId: string | null) => {
    if (colorwayId) {
      navigate(RoutePath.STYLE_COLOR_DETAILS, { id: orderId, colorId: colorwayId });
    } else {
      navigate(RoutePath.STYLE_DETAILS, { id: orderId });
    }
  };

  const tableHeaders: { label: string; align: 'left' | 'center' }[] = [
    { label: 'Sent at', align: 'center' },
    { label: 'Style', align: 'left' },
    { label: 'PO', align: 'left' },
    { label: 'Color', align: 'left' },
    { label: 'From Department', align: 'left' },
    { label: 'To Department', align: 'left' },
    { label: 'Sent pcs', align: 'center' },
    { label: 'Sent by', align: 'left' },
    { label: 'Received pcs', align: 'center' },
    { label: 'Received by', align: 'left' },
    { label: 'Missing', align: 'center' },
    { label: 'Received at', align: 'center' },
    { label: 'Status', align: 'center' },
    { label: 'Comment', align: 'left' },
  ];

  return (
    <PageShell loading={loading} skeleton="table" className="w-full pb-16">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-visible">
        <ReportToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchSubmit={(value) => setDebouncedSearch(value.trim())}
          searchPlaceholder="Style, PO, department, operation, resource…"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateRangeChange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
          onRefresh={() => void load(true)}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
        >
          <SelectDropdown
            value={fromDept}
            onChange={setFromDept}
            options={[{ value: '', label: 'From: All' }, ...deptOptions]}
            className="w-full sm:min-w-[130px] sm:w-auto"
          />
          <SelectDropdown
            value={toDept}
            onChange={setToDept}
            options={[{ value: '', label: 'To: All' }, ...deptOptions]}
            className="w-full sm:min-w-[130px] sm:w-auto"
          />
          <SelectDropdown
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={[
              { value: 'all', label: 'All status' },
              { value: 'in_transit', label: 'In transit' },
              { value: 'received', label: 'Received' },
              { value: 'disputed', label: 'Disputed' },
            ]}
            className="w-full sm:min-w-[110px] sm:w-auto"
          />
        </ReportToolbar>

        {loadError && (
          <div className="px-4 py-6 text-center text-xs text-red-600 border-t border-slate-100">{loadError}</div>
        )}

        {!loadError && dateGroups.length === 0 && !loading && (
          <div className="px-4 py-16 text-center text-xs text-slate-400 italic border-t border-slate-100">
            No handover transactions in this date range.
          </div>
        )}

        {!loadError && dateGroups.map((dateGroup) => (
          <div key={dateGroup.logDate} className="border-t border-slate-100">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-800">
                {format(parseISO(dateGroup.logDate), 'EEEE, d MMM yyyy')}
              </h2>
              <span className="text-[10px] font-semibold text-slate-500 tabular-nums">
                {dateGroup.totalQty.toLocaleString()} pcs
              </span>
            </div>

            {dateGroup.shiftGroups.map((shiftGroup) => (
              <div key={`${dateGroup.logDate}-${shiftGroup.shiftId ?? ''}-${shiftGroup.shiftName}`}>
                <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between bg-white">
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
                        <TxColGroup />
                        <thead>
                          <tr>
                            {tableHeaders.map(({ label, align }) => (
                              <th key={label} className={align === 'center' ? TH_CENTER : TH_LEFT}>
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
                              priority={priorityByOrderId.get(row.orderId)}
                              styleRef={styleRefByOrderId.get(row.orderId)}
                              onOpenOrder={openOrder}
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
    </PageShell>
  );
};
