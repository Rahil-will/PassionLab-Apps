import React, { useState, useMemo, useEffect } from "react";
import {
  useNavigationStore,
} from "../../stores";
import { useDepartmentsCatalog, useBuyersCatalog } from "../../lib/queries/settingsSlices";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useOrdersList } from "../../hooks/useOrdersList";
import {
  useAllocationsForOrderIds,
  useOrdersEnrichedPage,
} from "../../lib/queries/factoryOrders";
import { RoutePath } from "../../types";
import { Search, ChevronRight, Filter } from "lucide-react";
import { Card, SelectDropdown } from '../../components/ui';
import { Pagination } from '../../components/Pagination';
import { PageShell } from '../../components/layout/PageShell';
import { OrderPriorityChip } from '../../lib/orderPriority';
import {
  buildPlanningColorwayRows,
  filterPlanningRows,
  sortPlanningRows,
} from '../../lib/planningOrderStatus';

const PAGE_SIZE = 20;

function formatDeliveryDates(dates: string[]): string {
  if (!dates.length) return '—';
  const sorted = dates.slice().sort();
  if (sorted.length === 1) return sorted[0];
  return sorted[0] + ` (+${sorted.length - 1})`;
}

export const PlanningOrderList: React.FC = () => {
  const { factoryId, navigate } = useNavigationStore();
  const { departments, loading: deptLoading } = useDepartmentsCatalog(factoryId, 'core');
  const { buyers, loading: buyersLoading } = useBuyersCatalog(factoryId, 'core');
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBuyer, setFilterBuyer] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const buyerIdFilter = useMemo(
    () => buyers.find((b) => b.name === filterBuyer)?.id ?? '',
    [buyers, filterBuyer],
  );

  const listQuery = useOrdersList(
    factoryId,
    page,
    PAGE_SIZE,
    {
      search: debouncedSearch || undefined,
      buyerId: buyerIdFilter || undefined,
    },
    Boolean(factoryId),
  );
  const pageOrderIds = useMemo(
    () => (listQuery.data?.rows ?? []).map((r) => r.id),
    [listQuery.data?.rows],
  );
  const enrichedPageQuery = useOrdersEnrichedPage(
    factoryId,
    pageOrderIds,
    Boolean(factoryId && pageOrderIds.length > 0),
  );
  const allocationsPageQuery = useAllocationsForOrderIds(
    factoryId,
    pageOrderIds,
    Boolean(factoryId && pageOrderIds.length > 0),
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterBuyer, filterStatus]);

  const orders = enrichedPageQuery.data ?? [];
  const allocations = allocationsPageQuery.data ?? [];

  const allBuyers = useMemo(() => {
    return buyers.map((b) => b.name).filter(Boolean).sort();
  }, [buyers]);

  const pageLoading =
    listQuery.isLoading
    || enrichedPageQuery.isLoading
    || allocationsPageQuery.isLoading
    || deptLoading
    || buyersLoading;

  const tableData = useMemo(
    () => buildPlanningColorwayRows(orders, allocations, departments),
    [orders, allocations, departments],
  );

  const displayRows = useMemo(() => {
    const filtered = filterPlanningRows(tableData, filterStatus);
    return sortPlanningRows(filtered);
  }, [tableData, filterStatus]);

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

  const handleNavigate = (orderId: string, color: string) => {
    navigate(RoutePath.PLANNING_DETAIL, { orderId, color });
  };

  return (
    <PageShell loading={pageLoading} skeleton="table" className="w-full pb-20">
      <Card noPadding className="shadow-sm border-slate-200">
        {/* Filter Bar - Standard Pattern */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 gap-4">
          {/* Left: Search */}
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <Search size={14} className="text-slate-400" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1"
              placeholder="Search style, PO, buyer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Right: Filter Pills */}
          <div className="flex items-center gap-3">
            <SelectDropdown
              value={filterBuyer}
              onChange={setFilterBuyer}
              options={[
                { value: '', label: 'All Buyers' },
                ...allBuyers.map(b => ({ value: b, label: b }))
              ]}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              value={filterStatus}
              onChange={setFilterStatus}
              options={[
                { value: '', label: 'All Status' },
                { value: 'Planning Pending', label: 'Planning Pending' },
                { value: 'Unplanned', label: 'Unplanned' },
                { value: 'Partial', label: 'Partial' },
                { value: 'Planned', label: 'Planned' },
              ]}
              className="w-32"
            />
          </div>
        </div>

        {(totalOrders > PAGE_SIZE || filterStatus || displayRows.length < tableData.length) && (
          <div className="px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
            Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {totalOrders} orders)
            {filterStatus ? ` · ${displayRows.length} match on this page` : ''}
            {!filterStatus ? ' · unplanned & partial first' : ''}
          </div>
        )}

      <div className="overflow-x-auto">
          <table className="w-full text-[10px] text-left border-collapse">
            <thead className="bg-slate-50 text-slate-500 font-semibold text-[9px] uppercase border-b border-slate-200">
              <tr>
                <th className="px-4 py-2.5 w-[18%] border-r border-blue-100 text-left">
                  Style
                </th>
                <th className="px-4 py-2.5 w-[12%] border-r border-blue-100 text-left">
                  Colorway
                </th>
                <th className="px-4 py-2.5 w-[10%] border-r border-blue-100 text-center">
                  Buyer
                </th>
                <th className="px-4 py-2.5 w-[10%] border-r border-blue-100 text-center">
                  PO Number
                </th>
                <th className="px-4 py-2.5 w-[10%] border-r border-blue-100 text-center">
                  Adj. Qty
                </th>
                <th className="px-4 py-2.5 w-[10%] border-r border-blue-100 text-center">
                  Planned Qty
                </th>
                <th className="px-4 py-2.5 w-[12%] border-r border-blue-100 text-center">
                  Delivery
                </th>
                <th className="px-4 py-2.5 w-[12%] border-r border-blue-100 text-center">
                  Status
                </th>
                <th className="px-4 py-2.5 w-[6%] text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayRows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => handleNavigate(row.orderId, row.colorway)}
                  className="hover:bg-blue-50/50 cursor-pointer group transition-colors"
                >
                  <td className="px-4 py-1.5 border-r border-blue-50 group-hover:border-blue-100 transition-colors">
                    <div className="text-xs font-bold text-slate-800 inline-flex items-center gap-2 flex-wrap">
                      <span>{row.styleName}</span>
                      <OrderPriorityChip priority={row.priority} />
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {row.styleRef}
                    </div>
                  </td>
                  <td className="px-4 py-1.5 border-r border-blue-50 group-hover:border-blue-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500 shadow-sm"></div>
                      <span className="text-xs text-slate-700">
                        {row.colorway}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-1.5 text-center text-xs text-slate-700 border-r border-blue-50 group-hover:border-blue-100 transition-colors">
                    {row.buyer}
                  </td>
                  <td className="px-4 py-1.5 text-center text-xs text-slate-600 border-r border-blue-50 group-hover:border-blue-100 transition-colors">
                    {row.poNumber}
                  </td>
                  <td className="px-4 py-1.5 text-center text-xs text-slate-700 border-r border-blue-50 group-hover:border-blue-100 transition-colors">
                    {row.totalQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-1.5 text-center text-xs text-blue-600 border-r border-blue-50 group-hover:border-blue-100 transition-colors">
                    {row.plannedQty > 0 ? row.plannedQty.toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-1.5 text-center text-xs border-r border-blue-50 group-hover:border-blue-100 transition-colors">
                    {row.deliveryDates.length > 0 ? (
                      <span className="text-blue-700 font-medium" title={row.deliveryDates.slice().sort().join(', ')}>
                        {formatDeliveryDates(row.deliveryDates)}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-1.5 border-r border-blue-50 group-hover:border-blue-100 transition-colors">
                    <div className="flex items-center justify-center gap-1.5">
                      {row.status === 'Planning Pending' && (
                        <>
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          <span className="text-[10px] text-amber-700 font-medium">
                            Planning pending
                          </span>
                        </>
                      )}
                      {row.status === 'Unplanned' && (
                        <>
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                          <span className="text-[10px] text-slate-400">
                            Unplanned
                          </span>
                        </>
                      )}
                      {row.status === "Partial" && (
                        <>
                          <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
                          <span className="text-xs text-amber-600">
                            Partial
                          </span>
                        </>
                      )}
                      {row.status === "Planned" && (
                        <>
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                          <span className="text-xs text-emerald-700">
                            Planned
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-1.5 text-center">
                    <ChevronRight
                      size={14}
                      className="text-slate-300 group-hover:text-blue-500 transition-colors mx-auto"
                    />
                  </td>
                </tr>
              ))}
              {displayRows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="p-8 text-center text-slate-400 italic"
                  >
                    {filterStatus
                      ? 'No matches on this page. Try another page or clear the status filter.'
                      : 'No orders found. Create a new order to get started.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <Pagination {...pagination} />
    </PageShell>
  );
};
