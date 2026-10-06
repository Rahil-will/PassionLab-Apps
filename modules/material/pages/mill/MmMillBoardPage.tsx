import React, { useEffect, useMemo, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useOrdersList, type OrderListRow } from '../../../../hooks/useOrdersList';
import { useBuyersCatalog } from '../../../../lib/queries/settingsSlices';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import type { MmMillFabricCell } from '../../lib/mmRpc';
import { useMmMillBoard } from '../../lib/useMmOps';
import { millBoardRowStatus, millBoardStatusRank, millWordDot, millWordText } from './millStatus';
import { fabricTypeCategoryLine } from '../../components/MmFabricSummaryCard';

const PAGE_SIZE = 20;

type MillFilter = '' | 'Pending' | 'Completed' | 'Closed';

function fabricBoardStatus(cell: MmMillFabricCell) {
  return millBoardRowStatus(cell.required_m, Number(cell.qty_dispatched_m), Boolean(cell.mill_short_closed));
}

function fabricTypeKey(cell: MmMillFabricCell): string {
  return (cell.fabric_type || cell.fabric_name || '').trim();
}

function fabricMatches(cell: MmMillFabricCell, status: MillFilter, fabricType: string): boolean {
  if (status && fabricBoardStatus(cell).key !== status) return false;
  if (fabricType && fabricTypeKey(cell) !== fabricType) return false;
  return true;
}

function fmtQty(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function fmtRolls(count: number): string {
  return String(Number(count) || 0);
}

function fabricUom(cell: MmMillFabricCell): string {
  return (cell.uom ?? '').trim();
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const thReqCls =
  'px-2 py-2 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 text-center whitespace-nowrap';
const thProdCls =
  'px-2 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap';
const thDispCls =
  'px-2 py-2 text-[10px] font-semibold text-green-800 uppercase tracking-wide border-b border-slate-200 bg-green-100 text-center whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdReqCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-blue-50/60';
const tdProdCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-yellow-50';
const tdDispCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-green-50';

interface FabricRow {
  order: OrderListRow;
  cell: MmMillFabricCell;
}

export default function MmMillBoardPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { buyers } = useBuyersCatalog(factoryId, 'core');

  const [searchQuery, setSearchQuery] = useState('');
  const [filterFabric, setFilterFabric] = useState('');
  const [filterBuyer, setFilterBuyer] = useState('');
  const [filterStatus, setFilterStatus] = useState<MillFilter>('');
  const [page, setPage] = useState(1);
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

  const boardQuery = useMmMillBoard(pageOrderIds, pageOrderIds.length > 0);
  const fabricsByOrder = useMemo(() => {
    const map = new Map<string, MmMillFabricCell[]>();
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
    for (const cells of fabricsByOrder.values()) {
      for (const cell of cells) {
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
    return rows.sort((a, b) => {
      const rank = millBoardStatusRank(fabricBoardStatus(a.cell).key) - millBoardStatusRank(fabricBoardStatus(b.cell).key);
      if (rank !== 0) return rank;
      const style = a.order.style_name.localeCompare(b.order.style_name);
      if (style !== 0) return style;
      const color = a.cell.color_name.localeCompare(b.cell.color_name);
      if (color !== 0) return color;
      return a.cell.fabric_name.localeCompare(b.cell.fabric_name);
    });
  }, [listQuery.data?.rows, fabricsByOrder, filterFabric, filterStatus]);

  usePageHeader({
    subtitle: 'One row per style, color, and fabric. Open a row for fabric details.',
  });

  const pageReady = !listQuery.isLoading && (pageOrderIds.length === 0 || !boardQuery.isLoading);

  const openLine = (orderId: string, cell: MmMillFabricCell) => {
    requestNavigate(RoutePath.MATERIAL_MILL_LINE, {
      orderId,
      colorwayId: cell.colorway_id,
      fabricLineId: cell.fabric_line_id,
    });
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
              onChange={(v) => setFilterStatus(v as MillFilter)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'Pending', label: 'Pending' },
                { value: 'Completed', label: 'Completed' },
                { value: 'Closed', label: 'Closed' },
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
          <table className="w-full min-w-[1040px] table-fixed border-collapse">
            <colgroup>
              <col style={{ width: '16%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '4.75rem' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={thFirstCls}>Style</th>
                <th className={thCls}>Buyer / PO</th>
                <th className={thCls}>Color</th>
                <th className={thCls}>Fabric</th>
                <th className={thCenterCls}>UOM</th>
                <th className={thReqCls}>Required</th>
                <th className={thProdCls}>Produced</th>
                <th className={thProdCls}>Produced rolls</th>
                <th className={thDispCls}>Dispatched</th>
                <th className={thDispCls}>Dispatched rolls</th>
                <th className={thCenterCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {fabricRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No fabrics match this page.
                  </td>
                </tr>
              )}
              {fabricRows.map(({ order, cell }) => {
                const producedQty = Number(cell.qty_at_mill_m) + Number(cell.qty_dispatched_m);
                const producedRolls = Number(cell.rolls_at_mill) + Number(cell.rolls_dispatched);
                const requiredWord = fabricBoardStatus(cell);
                const typeCategory = fabricTypeCategoryLine(cell.fabric_type, cell.fabric_category);
                return (
                <tr
                  key={`${order.id}-${cell.colorway_id}-${cell.fabric_line_id}`}
                  className="hover:bg-slate-50/80 cursor-pointer"
                  onClick={() => openLine(order.id, cell)}
                >
                  <td className={`${tdFirstCls} font-semibold text-slate-800`}>
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
                  <td className={tdProdCls}>
                    <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">{fmtQty(producedQty)}</span>
                  </td>
                  <td className={tdProdCls}>
                    <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">{fmtRolls(producedRolls)}</span>
                  </td>
                  <td className={tdDispCls}>
                    <span className="block text-[11px] font-semibold text-green-900 tabular-nums">{fmtQty(cell.qty_dispatched_m)}</span>
                  </td>
                  <td className={tdDispCls}>
                    <span className="block text-[11px] font-semibold text-green-900 tabular-nums">{fmtRolls(cell.rolls_dispatched)}</span>
                  </td>
                  <td className={`${tdCls} text-center`}>
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${millWordDot(requiredWord.key)}`} />
                      <span className={`text-[10px] font-bold ${millWordText(requiredWord.key)}`}>
                        {requiredWord.label}
                      </span>
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination {...pagination} />
      </Card>
    </PageShell>
  );
}
