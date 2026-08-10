import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigationStore } from '../../stores';
import { RoutePath } from '../../types';
import { useRefreshFactoryData } from '../../hooks/useFactoryDataBootstrap';
import { useProductionSummary } from '../../lib/queries/productionSummary';
import { useBuyersCatalog, useDepartmentsCatalog } from '../../lib/queries/settingsSlices';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useOrdersListPipelinePage } from '../../hooks/useOrdersList';
import {
  orderMatchesPipelineStatusFilter,
  type PipelineStatusFilter,
} from '../../lib/orderPipelineFilter';
import { ChevronDown, ChevronRight, Search, User, Layers, Package, Filter, ChevronLeft, RefreshCw, CheckCircle } from 'lucide-react';
import { Card, SelectDropdown, Spinner, Toast } from '../../components/ui';
import { Pagination } from '../../components/Pagination';
import { PageShell } from '../../components/layout/PageShell';
import { sizeAdjQty } from '../../lib/colorwaySizesUtils';
import { OrderPriorityChip } from '../../lib/orderPriority';
import {
    visitPipelineCellsFromRouting,
    type VisitPipelineCell,
} from '../../lib/orderRoutingFlow';
import differenceInCalendarDays from 'date-fns/differenceInCalendarDays';
import parseISO from 'date-fns/parseISO';
import startOfDay from 'date-fns/startOfDay';
import { activeShipmentDeliveryDates } from '../../lib/orderShipmentPlan';

const PAGE_SIZE = 20;

function deliverySortKey(deliveryDate: string | undefined): string {
  return deliveryDate?.split('T')[0] || '9999-12-31';
}

const isStoreTypeVisit = (cell: VisitPipelineCell) => cell.stepType === 'store';

export const StatusTracker: React.FC = () => {
    const { navigate, factoryId } = useNavigationStore();
    const { departments, loading: deptLoading } = useDepartmentsCatalog(factoryId, 'core');
    const { buyers, loading: buyersLoading } = useBuyersCatalog(factoryId, 'core');
    const refreshFactoryData = useRefreshFactoryData(factoryId, RoutePath.STATUS_TRACKER);

    const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [filterBuyer, setFilterBuyer] = useState('');
    const [filterStatus, setFilterStatus] = useState<PipelineStatusFilter>('');
    const [page, setPage] = useState(1);
    const debouncedSearch = useDebouncedValue(searchQuery, 300);
    const buyerIdFilter = useMemo(
        () => buyers.find((b) => b.name === filterBuyer)?.id ?? '',
        [buyers, filterBuyer],
    );

    const {
        listQuery,
        enrichedOrders,
        enrichedQuery: enrichedPageQuery,
        summaryQuery,
        orderDeptProgress,
    } = useOrdersListPipelinePage({
        factoryId,
        page,
        pageSize: PAGE_SIZE,
        filters: {
            search: debouncedSearch || undefined,
            buyerId: buyerIdFilter || undefined,
        },
        pipelineStatus: filterStatus,
        enabled: Boolean(factoryId),
    });

    // Default view still needs visit progress to hide pipeline-completed rows.
    const { data: defaultSummaryBundle, isLoading: defaultSummaryLoading } = useProductionSummary(
        factoryId,
        Boolean(factoryId && !filterStatus),
    );
    const visitProgress = filterStatus
        ? orderDeptProgress
        : (defaultSummaryBundle?.orderDeptProgress ?? []);
    const summaryLoading = filterStatus ? summaryQuery.isLoading : defaultSummaryLoading;

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, filterBuyer, filterStatus]);
    const [carouselPositions, setCarouselPositions] = useState<Record<string, number>>({});
    const carouselRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const [refreshing, setRefreshing] = useState(false);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // Get unique buyers
    const allBuyers = useMemo(() => {
        return buyers.map((b) => b.name).filter(Boolean).sort();
    }, [buyers]);

    /** Visit-primary pipeline cells per order (one cell per visit, not per routing row). Store visits omitted from high-level tracker. */
    const pipelineVisitsByOrderId = useMemo(() => {
        const sourceOrders = enrichedOrders;
        const map = new Map<string, VisitPipelineCell[]>();
        for (const order of sourceOrders) {
            map.set(
                order.id,
                visitPipelineCellsFromRouting(order.routingSteps ?? [], departments)
                    .filter((cell) => !isStoreTypeVisit(cell)),
            );
        }
        return map;
    }, [enrichedOrders, departments]);

    function visitProducedFromProgress(
        orderId: string,
        visitId: string,
        colorwayId?: string,
    ): number {
        return visitProgress
            .filter((r) =>
                r.order_id === orderId &&
                r.visit_id === visitId &&
                (colorwayId ? r.colorway_id === colorwayId : true)
            )
            .reduce((sum, r) => sum + (r.qty_produced ?? 0), 0);
    }

    const orderVisitCounts = useMemo(() => {
        const sourceOrders = enrichedOrders;
        const result: Record<string, Record<string, number>> = {};
        for (const order of sourceOrders) {
            const cells = pipelineVisitsByOrderId.get(order.id) ?? [];
            for (const cell of cells) {
                const count = visitProducedFromProgress(order.id, cell.visitId);
                if (count <= 0) continue;
                if (!result[order.id]) result[order.id] = {};
                result[order.id][cell.visitId] = count;
            }
        }
        return result;
    }, [visitProgress, enrichedOrders, pipelineVisitsByOrderId]);

    const pageReady =
        !listQuery.isLoading
        && !enrichedPageQuery.isLoading
        && !deptLoading
        && !buyersLoading
        && !summaryLoading;

    const toggleExpand = (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
        e.stopPropagation();
        const newSet = new Set(expandedOrderIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setExpandedOrderIds(newSet);
    };

    const goToDetails = (id: string) => {
        navigate(RoutePath.STYLE_DETAILS, { id });
    };

    const getOrderPipelineVisits = (orderId: string) => {
        return pipelineVisitsByOrderId.get(orderId) ?? [];
    };

    const colorwayVisitCount = (
        orderId: string,
        colorwayId: string,
        cell: VisitPipelineCell,
    ): number =>
        visitProducedFromProgress(orderId, cell.visitId, colorwayId);

    const getDaysToDelivery = (deliveryDate: string) => {
        return differenceInCalendarDays(
            startOfDay(parseISO(deliveryDate)),
            startOfDay(new Date()),
        );
    };

    const scrollCarousel = (orderId: string, direction: 'left' | 'right', maxItems: number) => {
        const currentPos = carouselPositions[orderId] || 0;
        const maxPos = Math.max(0, maxItems - 3);
        const nextPos = direction === 'left'
            ? Math.max(0, currentPos - 1)
            : Math.min(maxPos, currentPos + 1);
        const carousel = carouselRefs.current[orderId];
        if (carousel) {
            const card = carousel.firstElementChild?.firstElementChild as HTMLElement | null;
            const cardWidth = card?.offsetWidth ?? 0;
            carousel.scrollTo({ left: nextPos * (cardWidth + 12), behavior: 'smooth' });
        }
        setCarouselPositions(prev => ({ ...prev, [orderId]: nextPos }));
    };

    const displayOrdersFinal = useMemo(() => {
        const orders = enrichedOrders;
        const filtered = filterStatus
            ? orders
            : orders.filter((order) => {
                const visits = pipelineVisitsByOrderId.get(order.id) ?? [];
                const visitCounts = orderVisitCounts[order.id] ?? {};
                return !orderMatchesPipelineStatusFilter(order, 'Completed', visits, visitCounts);
            });

        return filtered.sort((a, b) => {
            const aDate = activeShipmentDeliveryDates(a.shipmentPlan)[0];
            const bDate = activeShipmentDeliveryDates(b.shipmentPlan)[0];
            return deliverySortKey(aDate).localeCompare(deliverySortKey(bDate));
        });
    }, [
        enrichedOrders,
        filterStatus,
        pipelineVisitsByOrderId,
        orderVisitCounts,
    ]);

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

    // Get status label
    const getStatusLabel = (status: string | undefined, actual: number, planned: number) => {
        if (status === 'completed' || actual >= planned) return 'Done';
        if (status === 'active' || actual > 0) return 'Active';
        if (status === 'delayed') return 'Delayed';
        return 'Pending';
    };

    return (
        <PageShell loading={!pageReady} skeleton="table" className="w-full pb-20">

            {/* Single Giant Card */}
            <Card noPadding className="shadow-sm border-slate-200 overflow-visible">
                {/* Filter Bar - Standard Pattern */}
                <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
                    {/* Left: Search */}
                    <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
                        <Search size={14} className="text-slate-400 shrink-0" />
                        <input
                            className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                            placeholder="Search style, PO, buyer..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {/* Right: Filter Pills + Refresh */}
                    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:ml-auto">
                        <button 
                            onClick={async () => {
                                setRefreshing(true);
                                try {
                                    await refreshFactoryData();
                                    setLastRefresh(new Date());
                                    setToast({ message: 'Table data refreshed', type: 'success' });
                                } catch (err: unknown) {
                                    const message = err instanceof Error ? err.message : 'Refresh failed';
                                    setToast({ message: `Refresh failed: ${message}`, type: 'error' });
                                } finally {
                                    setRefreshing(false);
                                }
                            }} 
                            disabled={refreshing}
                            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${refreshing ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}`}
                            title="Refresh summary tables"
                        >
                            {refreshing ? <Spinner size="sm" /> : <RefreshCw size={14} />}
                        </button>
                        {lastRefresh && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                <CheckCircle size={10} className="text-emerald-500" />
                                {lastRefresh.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                        )}
                        <SelectDropdown
                            value={filterStatus}
                            onChange={(v) => setFilterStatus(v as PipelineStatusFilter)}
                            options={[
                                { value: '', label: 'All Status' },
                                { value: 'Active', label: 'Active' },
                                { value: 'Completed', label: 'Completed' },
                                { value: 'Delayed', label: 'Delayed' }
                            ]}
                            icon={Filter}
                            className="w-32"
                        />
                        <SelectDropdown
                            value={filterBuyer}
                            onChange={setFilterBuyer}
                            options={[
                                { value: '', label: 'All Buyers' },
                                ...allBuyers.map(b => ({ value: b, label: b }))
                            ]}
                            className="w-full sm:w-36"
                        />
                    </div>
                </div>
                {(totalOrders > PAGE_SIZE || filterStatus) && (
                    <div className="px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
                        Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {totalOrders} orders)
                        {filterStatus ? ` · ${filterStatus} pipeline` : ''}
                        {!filterStatus ? ' · nearest delivery first · completed hidden' : ' · nearest delivery first'}
                    </div>
                )}
                {/* Table Header */}
                <div className="flex items-center border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <div className="w-10 p-3"></div>
                    <div className="flex-1 p-3 min-w-[200px]">Order Details</div>
                    <div className="w-[55%] p-3 flex">
                        <div className="flex-1 text-center">Production Pipeline</div>
                    </div>
                    <div className="w-28 p-3 text-center">Status</div>
                </div>

                {/* Order Rows */}
                <div className="flex flex-col">
                    {displayOrdersFinal.map((order, orderIdx) => {
                        const isExpanded = expandedOrderIds.has(order.id);
                        const visits = getOrderPipelineVisits(order.id);
                        const totalAdjusted = order.colorways.reduce((acc, cw) => acc + cw.sizes.reduce((sAcc, s) => sAcc + sizeAdjQty(s), 0), 0);
                        const carouselPos = carouselPositions[order.id] || 0;
                        const maxCarouselPos = Math.max(0, order.colorways.length - 3);

                        return (
                            <React.Fragment key={order.id}>
                                {/* Spacer between rows */}
                                {orderIdx > 0 && <div className="h-3 bg-slate-100"></div>}
                                
                                {/* Main Row */}
                                <div className={`flex items-stretch hover:bg-slate-50/50 transition-colors ${isExpanded ? 'bg-slate-50/30' : ''}`}>
                                    {/* Expand Button */}
                                    <div 
                                        className="w-10 flex items-center justify-center cursor-pointer"
                                        onClick={(e) => toggleExpand(e, order.id)}
                                        role="button"
                                        tabIndex={0}
                                        aria-expanded={isExpanded}
                                        aria-controls={`order-panel-${order.id}`}
                                        aria-label={isExpanded ? 'Collapse order details' : 'Expand order details'}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(e, order.id); } }}
                                    >
                                        <div className={`p-1 rounded-md ${isExpanded ? 'bg-slate-200 text-slate-600' : 'text-slate-400 hover:text-slate-600'}`}>
                                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        </div>
                                    </div>

                                    {/* Order Info */}
                                    <div className="flex-1 py-3 pr-4 cursor-pointer min-w-[200px]" onClick={() => goToDetails(order.id)}>
                                        <div className="flex items-center gap-3">
                                            {/* Image */}
                                            <div className="w-12 h-12 bg-slate-100 rounded-lg border border-slate-200 flex-shrink-0 overflow-hidden">
                                                {order.image ? (
                                                    <img src={order.image} alt={order.styleName} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                                                        <Layers size={18} />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Details */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className="font-bold text-slate-900 hover:text-blue-600 transition-colors" style={{ fontSize: '12px' }}>{order.styleName}</span>
                                                    <OrderPriorityChip priority={order.priority} />
                                                </div>
                                                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                                                    <span className="flex items-center gap-1"><Package size={11} className="text-slate-400" /> {order.poNumber}</span>
                                                    <span className="text-slate-300">|</span>
                                                    <span className="flex items-center gap-1"><User size={11} /> {order.buyer}</span>
                                                    <span className="text-slate-300">|</span>
                                                    {order.styleRef && <><span className="font-medium text-slate-500">{order.styleRef}</span><span className="text-slate-300">|</span></>}
                                                    <span className="flex items-center gap-1"><Package size={11} /> {totalAdjusted.toLocaleString()} pcs</span>
                                                    <span className="text-slate-300">|</span>
                                                    <span>{order.colorways.length} Colors</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Production Pipeline - 55% */}
                                    <div className="w-[55%] flex border-l border-slate-100">
                                        {visits.map((cell, idx) => {
                                            const actual = orderVisitCounts[order.id]?.[cell.visitId] ?? 0;
                                            const pct = totalAdjusted > 0 ? Math.round((actual / totalAdjusted) * 100) : 0;
                                            const statusLabel = getStatusLabel(undefined, actual, totalAdjusted);

                                            return (
                                                <div key={cell.visitId} className={`flex-1 flex flex-col justify-center p-3 relative ${idx < visits.length - 1 ? 'border-r border-slate-100' : ''}`}>
                                                    {/* Progress bar at bottom */}
                                                    <div className="absolute bottom-0 left-0 h-1 bg-slate-100 w-full">
                                                        <div 
                                                            className={`h-full transition-all ${statusLabel === 'Done' ? 'bg-emerald-500' : statusLabel === 'Active' ? 'bg-blue-500' : statusLabel === 'Delayed' ? 'bg-red-500' : 'bg-slate-200'}`} 
                                                            style={{ width: `${Math.min(pct, 100)}%` }}
                                                        ></div>
                                                    </div>
                                                    
                                                    {/* Department (visit) — activities secondary */}
                                                    <div className="mb-1 min-w-0">
                                                        <div className="text-[10px] font-bold text-slate-600 uppercase truncate">{cell.deptName}</div>
                                                        {cell.activitiesLabel && (
                                                            <div className="text-[8px] text-slate-400 truncate mt-0.5" title={cell.activitiesLabel}>
                                                                {cell.activitiesLabel}
                                                            </div>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Produce count only */}
                                                    <div className="text-xs font-bold text-slate-800 mb-1">
                                                        {actual.toLocaleString()}
                                                        <span className="text-slate-400 font-normal text-xs"> / {totalAdjusted.toLocaleString()}</span>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-1">
                                                        <div className={`w-1.5 h-1.5 rounded-full ${statusLabel === 'Done' ? 'bg-emerald-500' : statusLabel === 'Active' ? 'bg-blue-500' : statusLabel === 'Delayed' ? 'bg-red-500' : 'bg-slate-300'}`}></div>
                                                        <span className={`text-[10px] font-medium ${statusLabel === 'Done' ? 'text-emerald-600' : statusLabel === 'Active' ? 'text-blue-600' : statusLabel === 'Delayed' ? 'text-red-600' : 'text-slate-400'}`}>
                                                            {statusLabel}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Status Column */}
                                    <div className="w-28 flex flex-col items-center justify-center border-l border-slate-100 py-2 px-2">
                                        {(() => {
                                            const totalAdj = totalAdjusted;
                                            const visitCounts = orderVisitCounts[order.id] || {};
                                            const terminalVisit = visits[visits.length - 1];
                                            const terminalProduced = terminalVisit ? (visitCounts[terminalVisit.visitId] ?? 0) : 0;
                                            const allDone = terminalProduced >= totalAdj;
                                            const anyActive = visits.some((c) => (visitCounts[c.visitId] ?? 0) > 0);
                                            const activeDates = activeShipmentDeliveryDates(order.shipmentPlan);
                                            const earliestDate = activeDates[0];
                                            const daysLeft = earliestDate ? getDaysToDelivery(earliestDate) : 1;
                                            const isDelayed = daysLeft < 0 && !allDone;
                                            const label = allDone ? 'Complete' : isDelayed ? 'Delayed' : anyActive ? 'Active' : 'Not Started';
                                            const dot = allDone ? 'bg-emerald-500' : isDelayed ? 'bg-red-500' : anyActive ? 'bg-blue-500' : 'bg-slate-300';
                                            const text = allDone ? 'text-emerald-700' : isDelayed ? 'text-red-700' : anyActive ? 'text-blue-700' : 'text-slate-500';
                                            const bg = allDone ? 'bg-emerald-50 border-emerald-100' : isDelayed ? 'bg-red-50 border-red-100' : anyActive ? 'bg-blue-50 border-blue-100' : 'bg-slate-50 border-slate-200';
                                            return (
                                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-bold ${bg} ${text}`}>
                                                    <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                                                    {label}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* Expanded: Colorways Carousel */}
                                {isExpanded && (
                                    <div id={`order-panel-${order.id}`} role="region" className="bg-slate-50/50 py-4 border-t border-slate-100 overflow-hidden min-w-0">
                                        <div className="flex items-center gap-2 px-2 min-w-0">
                                            {/* Left Arrow */}
                                            <button 
                                                onClick={() => scrollCarousel(order.id, 'left', order.colorways.length)}
                                                disabled={carouselPos === 0}
                                                className={`p-1 rounded transition-colors flex-shrink-0 ${carouselPos === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'}`}
                                            >
                                                <ChevronLeft size={18} />
                                            </button>

                                            <div
                                                ref={(node) => { carouselRefs.current[order.id] = node; }}
                                                className="flex-1 min-w-0 overflow-x-auto scroll-smooth snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                                            >
                                                <div
                                                    className="grid w-full grid-flow-col gap-3"
                                                    style={{ gridAutoColumns: 'minmax(13rem, 33%)' }}
                                                >
                                                    {order.colorways.map((cw: any) => {
                                                        const cwQty = cw.sizes.reduce((a: number, b: any) => a + sizeAdjQty(b), 0);

                                                        return (
                                                            <div 
                                                                key={cw.id} 
                                                                className="min-w-0 snap-start bg-white rounded-lg border border-slate-200 p-3 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
                                                                onClick={() => navigate(RoutePath.STYLE_COLOR_DETAILS, { id: order.id, colorId: cw.id })}
                                                            >
                                                                {/* Color Header */}
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                                                                        <span className="font-bold text-[10px] text-slate-800">{cw.name}</span>
                                                                    </div>
                                                                    <span className="text-[10px] text-slate-400">{cwQty.toLocaleString()} pcs</span>
                                                                </div>
                                                                
                                                                <div className="flex gap-1 min-w-0">
                                                                    {visits.map((cell) => {
                                                                        const cwActual = colorwayVisitCount(order.id, cw.id, cell);
                                                                        const pct = cwQty > 0 ? Math.round((cwActual / cwQty) * 100) : 0;
                                                                        
                                                                        return (
                                                                            <div key={cell.visitId} className="flex-1 min-w-0 max-w-[5.5rem]">
                                                                                <div className="text-[8px] font-semibold text-slate-500 uppercase truncate mb-0.5">{cell.deptName}</div>
                                                                                {cell.activitiesLabel && (
                                                                                    <div className="text-[7px] text-slate-400 truncate mb-0.5" title={cell.activitiesLabel}>
                                                                                        {cell.activitiesLabel}
                                                                                    </div>
                                                                                )}
                                                                                <div className="text-xs font-bold text-slate-700 mb-0.5">
                                                                                    {cwActual.toLocaleString()}
                                                                                </div>
                                                                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                                    <div 
                                                                                        className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-slate-200'}`} 
                                                                                        style={{ width: `${pct}%` }}
                                                                                    ></div>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Right Arrow */}
                                            <button 
                                                onClick={() => scrollCarousel(order.id, 'right', order.colorways.length)}
                                                disabled={carouselPos >= maxCarouselPos}
                                                className={`p-1 rounded transition-colors flex-shrink-0 ${carouselPos >= maxCarouselPos ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200'}`}
                                            >
                                                <ChevronRight size={18} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}

                    {displayOrdersFinal.length === 0 && !pageReady && (
                        <div className="p-10 text-center text-[12px] text-slate-400">
                            Loading orders…
                        </div>
                    )}
                    {displayOrdersFinal.length === 0 && pageReady && (
                        <div className="p-10 text-center text-[12px] text-slate-400 italic">
                            {filterStatus
                                ? `No ${filterStatus.toLowerCase()} orders found.`
                                : 'No orders found matching criteria.'}
                        </div>
                    )}
                </div>
            </Card>
            <Pagination {...pagination} />
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        </PageShell>
    );
};
