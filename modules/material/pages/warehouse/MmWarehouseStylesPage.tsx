import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useOrdersList, type OrderListRow } from '../../../../hooks/useOrdersList';
import { useBuyersCatalog } from '../../../../lib/queries/settingsSlices';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { fabricTypeCategoryLine } from '../../components/MmFabricSummaryCard';
import type { MmWarehouseFabricCell } from '../../lib/mmRpc';
import { useMmWarehouseBoard } from '../../lib/useMmOps';
import { millRequiredWord, millWordDot, millWordText } from '../mill/millStatus';

const PAGE_SIZE = 20;

type WhFilter = '' | 'Pending' | 'Met';

function fabricRequiredWord(cell: MmWarehouseFabricCell) {
  const have = Number(cell.qty_passed_m ?? 0);
  return millRequiredWord(cell.required_m, have);
}

function fabricTypeKey(cell: MmWarehouseFabricCell): string {
  return (cell.fabric_type || cell.fabric_name || '').trim();
}

function fabricMatches(cell: MmWarehouseFabricCell, status: WhFilter, fabricType: string): boolean {
  if (status && fabricRequiredWord(cell) !== status) return false;
  if (fabricType && fabricTypeKey(cell) !== fabricType) return false;
  return true;
}

function fmtQty(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtRolls(count: number): string {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? 'roll' : 'rolls'}`;
}

function QtyRollsCell({
  qty,
  rolls,
  tdClass,
  qtyClass,
  subClass,
}: {
  qty: number | null | undefined;
  rolls: number | null | undefined;
  tdClass: string;
  qtyClass: string;
  subClass: string;
}) {
  return (
    <td className={tdClass}>
      <span className={`block text-[11px] font-semibold tabular-nums ${qtyClass}`}>{fmtQty(qty)}</span>
      <span className={`block text-[10px] tabular-nums ${subClass}`}>{fmtRolls(Number(rolls) || 0)}</span>
    </td>
  );
}

function uniqueLabels(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const label = (value ?? '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-slate-400">—</span>;
  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <span
          key={item}
          className="inline-flex max-w-full truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
        >
          {item}
        </span>
      ))}
      {extra > 0 ? (
        <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

function fabricUom(cell: MmWarehouseFabricCell): string {
  return (cell.uom ?? '').trim();
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thReqCls =
  'px-2 py-2 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 text-center whitespace-nowrap';
const thRecvCls =
  'px-2 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap';
const thPassCls =
  'px-2 py-2 text-[10px] font-semibold text-emerald-800 uppercase tracking-wide border-b border-slate-200 bg-emerald-100 text-center whitespace-nowrap';
const thCutCls =
  'px-2 py-2 text-[10px] font-semibold text-green-800 uppercase tracking-wide border-b border-slate-200 bg-green-100 text-center whitespace-nowrap';
const tdPassCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-emerald-50';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdReqCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-blue-50/60';
const tdRecvCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-yellow-50';
const tdCutCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-green-50';

interface FabricRow {
  order: OrderListRow;
  cell: MmWarehouseFabricCell;
}

export default function MmWarehouseStylesPage({ intent = 'summary' }: { intent?: 'summary' | 'dispatch' }) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { buyers } = useBuyersCatalog(factoryId, 'core');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('');
  const [filterFabric, setFilterFabric] = useState('');
  const [filterStatus, setFilterStatus] = useState<WhFilter>('');
  const [page, setPage] = useState(1);
  const [openStyleId, setOpenStyleId] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  const buyerIdFilter = useMemo(
    () => buyers.find((b) => b.name === filterBuyer)?.id ?? '',
    [buyers, filterBuyer],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterBuyer, filterFabric, filterStatus]);

  const listQuery = useOrdersList(
    factoryId,
    page,
    PAGE_SIZE,
    {
      search: debouncedSearch || undefined,
      buyerId: buyerIdFilter || undefined,
      excludeCompleted: true,
    },
    Boolean(factoryId),
  );

  const pageOrderIds = useMemo(
    () => (listQuery.data?.rows ?? []).map((row) => row.id),
    [listQuery.data?.rows],
  );

  const boardQuery = useMmWarehouseBoard(pageOrderIds, pageOrderIds.length > 0);
  const fabricsByOrder = useMemo(() => {
    const map = new Map<string, MmWarehouseFabricCell[]>();
    for (const row of boardQuery.data ?? []) {
      map.set(row.order_id, row.fabrics ?? []);
    }
    return map;
  }, [boardQuery.data]);

  const totalOrders = listQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total: totalOrders,
    start: totalOrders === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
    end: Math.min(safePage * PAGE_SIZE, totalOrders),
  };

  const fabricTypeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const fabrics of fabricsByOrder.values()) {
      for (const cell of fabrics) {
        const key = fabricTypeKey(cell);
        if (key) names.add(key);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [fabricsByOrder]);

  const fabricRows = useMemo((): FabricRow[] => {
    const orders = listQuery.data?.rows ?? [];
    const rows: FabricRow[] = [];
    for (const order of orders) {
      const fabrics = fabricsByOrder.get(order.id) ?? [];
      const visible = fabrics.filter((cell) => fabricMatches(cell, filterStatus, filterFabric));
      for (const cell of visible) {
        rows.push({ order, cell });
      }
    }
    return rows;
  }, [listQuery.data?.rows, fabricsByOrder, filterStatus, filterFabric]);

  const styleRows = useMemo(() => {
    const byOrder = new Map<string, FabricRow[]>();
    for (const row of fabricRows) {
      const list = byOrder.get(row.order.id) ?? [];
      list.push(row);
      byOrder.set(row.order.id, list);
    }
    return [...byOrder.values()].map((rows) => {
      const order = rows[0].order;
      const cells = rows.map((row) => row.cell);
      const pending = cells.filter((cell) => fabricRequiredWord(cell) !== 'Met').length;
      const met = cells.length - pending;
      return {
        order,
        cells,
        colors: uniqueLabels(cells.map((cell) => cell.color_name)),
        fabrics: uniqueLabels(cells.map((cell) => cell.fabric_name || cell.fabric_type)),
        lineCount: cells.length,
        pending,
        met,
        status: pending > 0 ? 'Pending' : 'Met',
      };
    });
  }, [fabricRows]);

  usePageHeader({
    subtitle:
      intent === 'dispatch'
        ? 'Each row is one style, color, and fabric. Open it to see dispatches or send more to cutting.'
        : 'One row per style. Expand to see each fabric with its own qty. Meters are never added across fabrics.',
  }, [intent]);

  const pageReady = !listQuery.isLoading && (pageOrderIds.length === 0 || !boardQuery.isLoading);

  const openStyle = (orderId: string, cell?: MmWarehouseFabricCell) => {
    if (intent === 'dispatch' && cell) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE, {
        orderId,
        colorwayId: cell.colorway_id,
        fabricLineId: cell.fabric_line_id,
      });
      return;
    }
    requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId });
  };

  return (
    <PageShell
      loading={!pageReady}
      error={listQuery.error ?? boardQuery.error}
      onRetry={() => {
        void listQuery.refetch();
        void boardQuery.refetch();
      }}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search style, PO, buyer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:ml-auto">
            <SelectDropdown
              value={filterFabric}
              onChange={setFilterFabric}
              options={[
                { value: '', label: 'All fabrics' },
                ...fabricTypeOptions.map((name) => ({ value: name, label: name })),
              ]}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              value={filterStatus}
              onChange={(v) => setFilterStatus(v as WhFilter)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'Pending', label: 'Pending' },
                { value: 'Met', label: 'Met' },
              ]}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              value={filterBuyer}
              onChange={setFilterBuyer}
              options={[
                { value: '', label: 'All Buyers' },
                ...buyers.map((b) => ({ value: b.name, label: b.name })),
              ]}
              icon={Filter}
              className="w-full sm:w-36"
            />
          </div>
        </div>
        {(totalOrders > PAGE_SIZE || filterStatus || filterFabric) && (
          <div className="px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
            Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {totalOrders} orders)
            {filterStatus ? ` · ${filterStatus} on this page` : ''}
            {filterFabric ? ` · ${filterFabric}` : ''}
            {!filterStatus && !filterFabric ? ' · completed orders hidden' : ''}
          </div>
        )}
        <div className="overflow-x-auto">
          {intent === 'summary' ? (
          <table className="w-full min-w-[920px] table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '3%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '7%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thCls} />
                <th className={thCls}>Style</th>
                <th className={thCls}>Buyer / PO</th>
                <th className={thCls}>Colors</th>
                <th className={thCls}>Fabrics</th>
                <th className={thCenterCls}>Lines</th>
                <th className={thCenterCls}>Coverage</th>
                <th className={thCenterCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {styleRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No styles match this page.
                  </td>
                </tr>
              )}
              {styleRows.map((row) => {
                const open = openStyleId === row.order.id;
                return (
                  <React.Fragment key={row.order.id}>
                    <tr className={open ? 'bg-slate-50' : 'hover:bg-slate-50/80'}>
                      <td className={tdCls}>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center text-slate-400 hover:text-slate-700"
                          aria-label={open ? 'Collapse fabrics' : 'Expand fabrics'}
                          onClick={() => setOpenStyleId(open ? '' : row.order.id)}
                        >
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className={`${tdCls} font-semibold text-slate-800`}>
                        <button
                          type="button"
                          className="text-left w-full"
                          onClick={() => openStyle(row.order.id)}
                        >
                          <span className="block truncate text-blue-700 hover:underline">{row.order.style_name}</span>
                          {row.order.style_ref ? (
                            <span className="block text-[10px] font-medium text-slate-400 truncate">{row.order.style_ref}</span>
                          ) : null}
                        </button>
                      </td>
                      <td className={tdCls}>
                        <span className="block truncate">{row.order.buyer_name || '—'}</span>
                        <span className="block text-[10px] text-slate-400 truncate">{row.order.po_number || '—'}</span>
                      </td>
                      <td className={tdCls}><TagList items={row.colors} /></td>
                      <td className={tdCls}><TagList items={row.fabrics} /></td>
                      <td className={`${tdCls} text-center tabular-nums`}>
                        {row.lineCount} {row.lineCount === 1 ? 'fabric' : 'fabrics'}
                      </td>
                      <td className={`${tdCls} text-center text-[10px] tabular-nums`}>
                        {row.pending > 0 ? `${row.pending} open` : '—'}
                        {row.met > 0 ? `${row.pending > 0 ? ' · ' : ''}${row.met} met` : ''}
                      </td>
                      <td className={`${tdCls} text-center`}>
                        <span className="inline-flex items-center justify-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(row.status)}`} />
                          <span className={`text-[10px] font-bold ${millWordText(row.status)}`}>
                            {row.status}
                          </span>
                        </span>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-3 bg-slate-50/80 border-b border-slate-100">
                          <table className="w-full table-fixed border-collapse">
                            <colgroup>
                              <col style={{ width: '13%' }} />
                              <col style={{ width: '20%' }} />
                              <col style={{ width: '7%' }} />
                              <col style={{ width: '13%' }} />
                              <col style={{ width: '13%' }} />
                              <col style={{ width: '13%' }} />
                              <col style={{ width: '13%' }} />
                              <col style={{ width: '8%' }} />
                            </colgroup>
                            <thead>
                              <tr>
                                <th className={thCls}>Color</th>
                                <th className={thCls}>Fabric</th>
                                <th className={thCenterCls}>UOM</th>
                                <th className={thReqCls}>Required</th>
                                <th className={thRecvCls}>Received</th>
                                <th className={thPassCls}>Passed</th>
                                <th className={thCutCls}>To cutting</th>
                                <th className={thCenterCls}>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.cells.map((cell) => {
                                const typeCategory = fabricTypeCategoryLine(cell.fabric_type, cell.fabric_category);
                                const word = fabricRequiredWord(cell);
                                return (
                                  <tr
                                    key={`${row.order.id}-${cell.colorway_id}-${cell.fabric_line_id}`}
                                    className="hover:bg-white cursor-pointer"
                                    onClick={() => openStyle(row.order.id, cell)}
                                  >
                                    <td className={`${tdCls} truncate`}>{cell.color_name}</td>
                                    <td className={tdCls}>
                                      <span className="block font-medium truncate">{cell.fabric_name}</span>
                                      {typeCategory !== '—' ? (
                                        <span className="block text-[10px] text-slate-400 truncate">{typeCategory}</span>
                                      ) : null}
                                    </td>
                                    <td className={`${tdCls} text-center`}>{fabricUom(cell) || '—'}</td>
                                    <td className={tdReqCls}>
                                      <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">
                                        {fmtQty(cell.required_m)}
                                      </span>
                                    </td>
                                    <QtyRollsCell
                                      qty={cell.qty_received_m}
                                      rolls={cell.rolls_received}
                                      tdClass={tdRecvCls}
                                      qtyClass="text-yellow-900"
                                      subClass="text-yellow-800/80"
                                    />
                                    <QtyRollsCell
                                      qty={cell.qty_passed_m ?? 0}
                                      rolls={cell.rolls_passed ?? 0}
                                      tdClass={tdPassCls}
                                      qtyClass="text-emerald-900"
                                      subClass="text-emerald-800/80"
                                    />
                                    <QtyRollsCell
                                      qty={cell.qty_to_cutting_m}
                                      rolls={cell.rolls_to_cutting}
                                      tdClass={tdCutCls}
                                      qtyClass="text-green-900"
                                      subClass="text-green-800/80"
                                    />
                                    <td className={`${tdCls} text-center`}>
                                      <span className="inline-flex items-center justify-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(word)}`} />
                                        <span className={`text-[10px] font-bold ${millWordText(word)}`}>{word}</span>
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          ) : (
          <table className="w-full min-w-[980px] table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '4.75rem' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thCls}>Style</th>
                <th className={thCls}>Buyer / PO</th>
                <th className={thCls}>Color</th>
                <th className={thCls}>Fabric</th>
                <th className={thCenterCls}>UOM</th>
                <th className={thReqCls}>Required</th>
                <th className={thRecvCls}>Received</th>
                <th className={thPassCls}>Passed</th>
                <th className={thCutCls}>Dispatched to cutting</th>
                <th className={thCenterCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {fabricRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No fabrics match this page.
                  </td>
                </tr>
              )}
              {fabricRows.map(({ order, cell }) => {
                const requiredWord = fabricRequiredWord(cell);
                const typeCategory = fabricTypeCategoryLine(cell.fabric_type, cell.fabric_category);
                return (
                <tr
                  key={`${order.id}-${cell.colorway_id}-${cell.fabric_line_id}`}
                  className="hover:bg-slate-50/80 cursor-pointer"
                  onClick={() => openStyle(order.id, cell)}
                >
                  <td className={`${tdCls} font-semibold text-slate-800`}>
                    <span className="block truncate">{order.style_name}</span>
                    {order.style_ref ? (
                      <span className="block text-[10px] font-medium text-slate-400 truncate">{order.style_ref}</span>
                    ) : null}
                  </td>
                  <td className={tdCls}>
                    <span className="block truncate">{order.buyer_name || '—'}</span>
                    <span className="block text-[10px] text-slate-400 truncate">{order.po_number || '—'}</span>
                  </td>
                  <td className={`${tdCls} truncate`}>{cell.color_name}</td>
                  <td className={`${tdCls} truncate`}>
                    <span className="block font-medium text-slate-800 truncate">{cell.fabric_name}</span>
                    {typeCategory !== '—' && (
                      <span className="block text-[10px] text-slate-400 truncate">
                        {typeCategory}
                      </span>
                    )}
                  </td>
                  <td className={`${tdCls} text-center tabular-nums`}>{fabricUom(cell) || '—'}</td>
                  <td className={tdReqCls}>
                    <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">{fmtQty(cell.required_m)}</span>
                  </td>
                  <QtyRollsCell
                    qty={cell.qty_received_m}
                    rolls={cell.rolls_received}
                    tdClass={tdRecvCls}
                    qtyClass="text-yellow-900"
                    subClass="text-yellow-800/80"
                  />
                  <QtyRollsCell
                    qty={cell.qty_passed_m ?? 0}
                    rolls={cell.rolls_passed ?? 0}
                    tdClass={tdPassCls}
                    qtyClass="text-emerald-900"
                    subClass="text-emerald-800/80"
                  />
                  <QtyRollsCell
                    qty={cell.qty_to_cutting_m}
                    rolls={cell.rolls_to_cutting}
                    tdClass={tdCutCls}
                    qtyClass="text-green-900"
                    subClass="text-green-800/80"
                  />
                  <td className={`${tdCls} text-center`}>
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(requiredWord)}`} />
                      <span className={`text-[10px] font-bold ${millWordText(requiredWord)}`}>
                        {requiredWord}
                      </span>
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
        <Pagination {...pagination} />
      </Card>
    </PageShell>
  );
}
