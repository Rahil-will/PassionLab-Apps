import React, { useState, useMemo } from 'react';
import { useNavigationStore } from '../../stores';
import { useDepartmentsCatalog } from '../../lib/queries/settingsSlices';
import { RoutePath } from '../../types';
import { Card } from '../../components/ui';
import { PageShell } from '../../components/layout/PageShell';
import { useDesktopWriteRole } from '../../components/DesktopWriteGate';
import { StyleInformationCard } from '../../components/production/StyleInformationCard';
import { ShipmentPlanReadOnly } from '../../components/production/ShipmentPlanReadOnly';
import { OrderDepartmentScheduleGantt } from '../../components/production/OrderDepartmentScheduleGantt';
import { DeptFlowTable } from '../../components/production/DeptFlowTable';
import { FabricOutputBreakdownPopover } from '../../components/production/FabricOutputBreakdownPopover';
import { StyleDetailsPageSkeleton } from '../../components/production/StyleDetailsPageSkeleton';
import { useOrderCutFabricByRoute } from '../../hooks/useOrderCutFabricByRoute';
import { useCuttingComponentProgress } from '../../hooks/useCuttingComponentProgress';
import { useOrderForEdit } from '../../hooks/useOrderForEdit';
import { useOrderAllocations } from '../../hooks/useOrderAllocations';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import { sizeAdjQty, sizeOrderQty, sumSizeAdjQty, orderedSizeKeys } from '../../lib/colorwaySizesUtils';
import { allocationsForColorway } from '../../lib/allocationUtils';
import { useOrderDetailMetrics } from '../../hooks/useOrderDetailMetrics';
import {
    colorwayStatusLabel,
    deriveColorwayProgressPhase,
    deriveSizeProgressPhase,
    formatProductionStatus,
    statusColorClass,
} from '../../lib/orderSizeProgress';
import { visitPipelineCellsFromRouting } from '../../lib/orderRoutingFlow';
import {
    buildMatrixDeptHeaderGroups,
    matrixColumnKey,
    matrixColumnsFromRoutingSteps,
    operationHeaderLabel,
    sumMatrixColumnSize,
    sumMatrixColumnTotal,
} from '../../lib/productionMatrixHeaders';
import type { ProductionMatrixVisitCol } from '../../components/production/ProductionMatrixTable';

function formatCount(count: number): React.ReactNode {
    if (count > 0) return count.toLocaleString();
    return <span className="text-slate-200">—</span>;
}

export const StyleDetails: React.FC = () => {
    const { navigate, routeParams, factoryId } = useNavigationStore();
    const canWrite = useDesktopWriteRole();
    const { loading: settingsLoading, departments } = useDepartmentsCatalog(factoryId, 'core');

    const [matrixView, setMatrixView] = useState<'aggregate' | 'breakdown'>('aggregate');

    const orderId = routeParams?.id;
    const { order, loading: orderLoading } = useOrderForEdit(factoryId, orderId ?? null);
    const { data: pageAllocations = [], isLoading: allocationsLoading } = useOrderAllocations(
        factoryId,
        orderId,
        Boolean(factoryId && orderId),
    );

    const visitCells = useMemo(
        () => visitPipelineCellsFromRouting(order?.routingSteps ?? [], departments),
        [order?.routingSteps, departments],
    );

    const flowLabel = visitCells.length > 0 ? `${visitCells.length} visits` : null;

    const sizeGroupName = order?.sizeGroupName || 'Standard';

    const totalAdjustedQty = useMemo(() => {
        if (!order) return 0;
        return order.colorways.reduce((acc, cw) => acc + sumSizeAdjQty(cw.sizes), 0);
    }, [order]);

    const allSizes = useMemo(() => {
        if (!order) return [] as string[];
        const fromColorways = orderedSizeKeys(order.colorways.flatMap((cw) => cw.sizes));
        if (fromColorways.length > 0) return fromColorways;
        if (order.sizeLabels) {
            return order.sizeLabels.split(',').map((s) => s.trim()).filter(Boolean);
        }
        return [];
    }, [order]);

    const colorwayIds = useMemo(() => order?.colorways.map((cw) => cw.id) ?? [], [order]);
    const storeReady = !orderLoading && !settingsLoading && !!order;

    const {
        flowMetrics,
        flowByColor,
        sizeProgress,
        metricsReady,
        flowLoading,
        bundleError,
    } = useOrderDetailMetrics({
        factoryId,
        orderId,
        colorwayIds,
        routingSteps: order?.routingSteps ?? [],
        departments,
        enabled: storeReady,
    });

    const { fabricActuals, loading: fabricLoading } = useOrderCutFabricByRoute(
        factoryId,
        orderId,
    );

    const { componentsFor } = useCuttingComponentProgress(factoryId, orderId);

    const pageReady = storeReady;

    const getVisitTotal = (colorwayId: string | undefined, visitId: string): number => {
        return sizeProgress.getVisitTotal?.(colorwayId, visitId) ?? 0;
    };

    const getVisitSizeCount = (
        colorwayId: string | undefined,
        visitId: string,
        size: string,
    ): number => sizeProgress.getVisitSizeCount?.(colorwayId, visitId, size) ?? 0;

    const matrixColumns = useMemo(() => {
        const fromSteps = matrixColumnsFromRoutingSteps(order?.routingSteps ?? []);
        if (fromSteps.length > 0) return fromSteps;
        return visitCells.map((cell) => ({
            stepId: cell.visitId,
            visitId: cell.visitId,
            deptId: cell.deptId,
            deptName: cell.deptName,
            activitiesLabel: cell.activitiesLabel,
        }));
    }, [order?.routingSteps, visitCells]);

    const getColumnSizeCount = (
        colorwayId: string | undefined,
        col: ProductionMatrixVisitCol,
        size: string,
    ): number =>
        sumMatrixColumnSize(
            col,
            size,
            matrixColumns,
            order?.routingSteps ?? [],
            colorwayId ? [colorwayId] : colorwayIds,
            sizeProgress,
        );

    const getColumnTotal = (
        colorwayId: string | undefined,
        col: ProductionMatrixVisitCol,
    ): number =>
        sumMatrixColumnTotal(
            col,
            matrixColumns,
            order?.routingSteps ?? [],
            colorwayId ? [colorwayId] : colorwayIds,
            allSizes,
            sizeProgress,
        );

    const matrixDeptGroups = useMemo(
        () => buildMatrixDeptHeaderGroups(matrixColumns),
        [matrixColumns],
    );

    const colorwayHasAllocations = (colorwayId: string): boolean =>
        allocationsForColorway(pageAllocations, colorwayId).length > 0;

    const originDepartmentId = useMemo(
        () => departments.find((department) => department.role === 'origin')?.id,
        [departments],
    );

    const renderOperationValue = (
        value: number,
        colorwayId: string | undefined,
        column: ProductionMatrixVisitCol,
        size?: string,
    ) => {
        if (value <= 0 || column.deptId !== originDepartmentId) return formatCount(value);
        const components = componentsFor(column.stepId, colorwayId, size);
        return <FabricOutputBreakdownPopover value={value} components={components} size={size} />;
    };

    React.useEffect(() => {
        if (!import.meta.env.DEV || !orderId) return;
        console.info('[StyleDetails] state', {
            orderId,
            storeReady,
            metricsReady,
            flowLoading,
            bundleError,
            visitCells: visitCells.length,
            flowMetrics: flowMetrics.length,
            colorways: colorwayIds.length,
        });
    }, [orderId, storeReady, metricsReady, flowLoading, bundleError, visitCells.length, flowMetrics.length, colorwayIds.length]);

    React.useEffect(() => {
        if (!import.meta.env.DEV || !order) return;
        console.info('[StyleDetails] data load summary', {
            orderId: order.id,
            rpc: {
                name: 'get_order_detail_bundle',
                source: 'useOrderDetailMetrics',
                returns: [
                    'routing_cells',
                    'journey',
                    'size_produced',
                    'planned_by_colorway',
                    'reconciliation',
                    'shipments',
                    'rejections',
                ],
                ready: metricsReady,
            },
            directTableFetches: {
                useOrderCutFabricByRoute: [
                    'cutting_bundles',
                    'cutting_sessions',
                    'fabric_components',
                ],
                globalStores: [
                    'useOrderForEdit + useProductionSummary (React Query)',
                    'useSettingsBootstrap slice queries (buyers, departments, shifts, …)',
                ],
            },
            ganttFabricActuals: {
                source: 'useOrderCutFabricByRoute (shared)',
                loading: fabricLoading,
            },
        });
    }, [order, metricsReady, fabricLoading]);

    React.useEffect(() => {
        if (orderLoading || settingsLoading) return;
        if (!orderId) {
            navigate(RoutePath.STATUS_TRACKER);
            return;
        }
        if (!order) navigate(RoutePath.STATUS_TRACKER);
    }, [orderLoading, settingsLoading, orderId, order, navigate]);

    if (!pageReady) {
        return (
            <PageShell className="w-full">
                <StyleDetailsPageSkeleton />
            </PageShell>
        );
    }

    if (!order) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] text-slate-400">
                <p>Redirecting...</p>
            </div>
        );
    }

    const renderMatrixTable = (colorName?: string) => {
        const colorwayId = colorName ? order.colorways.find(c => c.name === colorName)?.id : undefined;
        let totalOrderQty = 0;
        let totalAdjQty = 0;

        allSizes.forEach(size => {
            if (colorName) {
                const cw = order.colorways.find(c => c.name === colorName);
                const s = cw?.sizes.find(sz => sz.size === size);
                if (s) {
                    totalOrderQty += sizeOrderQty(s);
                    totalAdjQty += sizeAdjQty(s);
                }
            } else {
                order.colorways.forEach(cw => {
                    const s = cw.sizes.find(sz => sz.size === size);
                    if (s) {
                        totalOrderQty += sizeOrderQty(s);
                        totalAdjQty += sizeAdjQty(s);
                    }
                });
            }
        });

        return (
            <div className={t.scroll}>
                <table className={t.table}>
                    <thead className={t.thead}>
                        <tr>
                            <th rowSpan={2} className={t.firstHead}>Size</th>
                            <th rowSpan={2} className={t.numHead}>Order</th>
                            <th rowSpan={2} className={t.adjHead}>Adj.</th>
                            {matrixDeptGroups.map((group) => (
                                <th
                                    key={`dept-${matrixColumnKey(group.cols[0])}`}
                                    colSpan={group.cols.length}
                                    className={`${t.deptHead} text-center border-b border-slate-200/80`}
                                >
                                    {group.deptName}
                                </th>
                            ))}
                            <th rowSpan={2} className={t.statusHead}>Status</th>
                        </tr>
                        <tr>
                            {matrixColumns.map((col) => (
                                <th
                                    key={`op-${matrixColumnKey(col)}`}
                                    className={`${t.deptHead} text-[9px] font-semibold normal-case tracking-normal text-slate-500`}
                                    title={col.activitiesLabel || col.deptName}
                                >
                                    {operationHeaderLabel(col)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                        {allSizes.length === 0 ? (
                            <tr><td colSpan={4 + matrixColumns.length} className="p-6 text-center text-slate-400 italic">No size data.</td></tr>
                        ) : allSizes.map(size => {
                            let orderQty = 0;
                            let adjQty = 0;
                            if (colorName) {
                                const cw = order.colorways.find(c => c.name === colorName);
                                const s = cw?.sizes.find(sz => sz.size === size);
                                if (s) {
                                    orderQty = sizeOrderQty(s);
                                    adjQty = sizeAdjQty(s);
                                }
                            } else {
                                order.colorways.forEach(cw => {
                                    const s = cw.sizes.find(sz => sz.size === size);
                                    if (s) {
                                        orderQty += sizeOrderQty(s);
                                        adjQty += sizeAdjQty(s);
                                    }
                                });
                            }
                            const phaseFlowMetrics = colorwayId ? (flowByColor[colorwayId] ?? []) : flowMetrics;
                            const phase = deriveSizeProgressPhase(
                                phaseFlowMetrics,
                                adjQty,
                                (visitId) => getVisitSizeCount(colorwayId, visitId, size),
                            );
                            return (
                                <tr key={size} className="hover:bg-slate-50">
                                    <td className={`${t.firstCell} font-bold text-slate-700`}>{size}</td>
                                    <td className={t.numCell}>{orderQty > 0 ? orderQty.toLocaleString() : <span className="text-slate-300">—</span>}</td>
                                    <td className={t.adjCell}>{adjQty > 0 ? adjQty.toLocaleString() : <span className="text-slate-300">—</span>}</td>
                                    {matrixColumns.map((col) => (
                                        <td key={matrixColumnKey(col)} className={t.deptCell}>
                                            {renderOperationValue(getColumnSizeCount(colorwayId, col, size), colorwayId, col, size)}
                                        </td>
                                    ))}
                                    <td className={`${t.statusCell} ${statusColorClass(phase)}`}>
                                        {formatProductionStatus(phase)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot className="bg-slate-100 border-t-2 border-slate-200 font-bold text-slate-700">
                        <tr>
                            <td className={t.footFirst}>Total</td>
                            <td className={t.footNum}>{totalOrderQty.toLocaleString()}</td>
                            <td className={t.footAdj}>{totalAdjQty.toLocaleString()}</td>
                            {matrixColumns.map((col) => (
                                <td key={matrixColumnKey(col)} className={t.footDept}>
                                    {formatCount(getColumnTotal(colorwayId, col))}
                                </td>
                            ))}
                            <td className={t.footStatus} />
                        </tr>
                    </tfoot>
                </table>
            </div>
        );
    };

    return (
        <PageShell className="w-full pb-32">
            <div className="space-y-8">
                <StyleInformationCard
                    order={order}
                    sizeGroupName={sizeGroupName}
                    stats={{
                        orderQty: order.orderQty || order.totalQty || 0,
                        totalAdjusted: order.adjQty || totalAdjustedQty,
                        cutAllowancePct: order.cuttingAllowance,
                        extraShipmentPct: order.shipmentAllowance,
                    }}
                    onEdit={canWrite ? () => navigate(RoutePath.CREATE_ORDER, { id: order.id }) : undefined}
                />

                <Card title="Colors" subtitle="Colorway summary with flow progress" className="shadow-sm border-slate-200" noPadding>
                    <div className="p-6">
                        <div className={t.wrapper}>
                            <div className={t.scroll}>
                                <table className={t.table}>
                                    <thead className={t.thead}>
                                        <tr>
                                            <th rowSpan={2} className={t.firstHead}>Color</th>
                                            <th rowSpan={2} className={t.numHead}>Order</th>
                                            <th rowSpan={2} className={t.adjHead}>Adj.</th>
                                            {matrixDeptGroups.map((group) => (
                                                <th
                                                    key={`dept-${matrixColumnKey(group.cols[0])}`}
                                                    colSpan={group.cols.length}
                                                    className={`${t.deptHead} text-center border-b border-slate-200/80`}
                                                >
                                                    {group.deptName}
                                                </th>
                                            ))}
                                            <th rowSpan={2} className={t.statusHead}>Status</th>
                                        </tr>
                                        <tr>
                                            {matrixColumns.map((col) => (
                                                <th
                                                    key={`op-${matrixColumnKey(col)}`}
                                                    className={`${t.deptHead} text-[9px] font-semibold normal-case tracking-normal text-slate-500`}
                                                    title={col.activitiesLabel || col.deptName}
                                                >
                                                    {operationHeaderLabel(col)}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {order.colorways.map(cw => {
                                            const adjQty = sumSizeAdjQty(cw.sizes);
                                            const cwFlowMetrics = flowByColor[cw.id] ?? [];
                                            const cwPhase = deriveColorwayProgressPhase(
                                                cwFlowMetrics,
                                                adjQty,
                                                (visitId) => getVisitTotal(cw.id, visitId),
                                            );
                                            const cwStatus = colorwayStatusLabel(cwPhase, colorwayHasAllocations(cw.id));
                                            return (
                                                <tr key={cw.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(RoutePath.STYLE_COLOR_DETAILS, { id: order.id, colorId: cw.id })}>
                                                    <td className={t.firstCell}>
                                                        <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0"></div><span className="font-medium text-[10px] text-slate-700">{cw.name}</span></div>
                                                    </td>
                                                    <td className={t.numCell}>{(cw.orderQty || cw.totalQty || 0).toLocaleString()}</td>
                                                    <td className={t.adjCell}>{adjQty.toLocaleString()}</td>
                                                    {matrixColumns.map((col) => {
                                                        const count = getColumnTotal(cw.id, col);
                                                        return (
                                                            <td key={matrixColumnKey(col)} className={t.deptCell}>
                                                                {renderOperationValue(count, cw.id, col)}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className={`${t.statusCell} ${statusColorClass(cwPhase)}`}>{cwStatus}</td>
                                                </tr>
                                            );
                                        })}
                                        {order.colorways.length === 0 && <tr><td colSpan={3 + matrixColumns.length + 1} className="p-8 text-center text-slate-400 italic">No colors added yet.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card
                    title="Production Matrix"
                    subtitle={flowLabel ? `${flowLabel}` : 'Department flow and size-wise progress'}
                    action={
                        <div className="flex bg-slate-100 p-1 rounded-lg">
                            <button onClick={() => setMatrixView('aggregate')} className={`px-3 py-1 text-[10px] font-medium rounded-md transition-all ${matrixView === 'aggregate' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Aggregate</button>
                            <button onClick={() => setMatrixView('breakdown')} className={`px-3 py-1 text-[10px] font-medium rounded-md transition-all ${matrixView === 'breakdown' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Color-wise</button>
                        </div>
                    }
                    className="shadow-sm border-slate-200"
                    noPadding
                >
                    {visitCells.length === 0 && flowMetrics.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500 italic">
                            Assign a routing template on the Planning board to see production progress.
                        </div>
                    ) : !metricsReady ? (
                        <div className="p-8 text-center text-xs text-slate-400">Loading production metrics…</div>
                    ) : bundleError ? (
                        <div className="p-8 text-center text-xs text-red-600">
                            Could not load production metrics. {bundleError}
                        </div>
                    ) : matrixView === 'aggregate' ? (
                        <div className="p-6 space-y-6">
                            <div>
                                <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Departmental flow</h3>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <DeptFlowTable metrics={flowMetrics} />
                                </div>
                            </div>
                            <div>
                                <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Size-wise breakdown</h3>
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    {renderMatrixTable()}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-8 p-6">
                            {order.colorways.map(cw => (
                                <div key={cw.id} className="animate-in fade-in slide-in-from-bottom-2 w-full space-y-3">
                                    <div className="w-full bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow-sm"></div>
                                            <span className="text-xs font-bold text-slate-800">{cw.name}</span>
                                        </div>
                                    </div>
                                    <div>
                                        <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Departmental flow</h3>
                                        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                                            <DeptFlowTable metrics={flowByColor[cw.id] ?? []} />
                                        </div>
                                    </div>
                                    <div>
                                        <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Size-wise breakdown</h3>
                                        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                                            {renderMatrixTable(cw.name)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                <OrderDepartmentScheduleGantt
                    orderId={order.id}
                    order={order}
                    orderAllocations={pageAllocations}
                    allocationsLoading={allocationsLoading}
                    poNumber={order.poNumber}
                    deliveryDate={order.deliveryDate}
                    fabricActuals={fabricActuals}
                    fabricActualsLoading={fabricLoading}
                />

                <ShipmentPlanReadOnly
                    plan={order.shipmentPlan ?? { lines: [] }}
                    colorways={order.colorways}
                    displaySizes={order.sizeLabels ? order.sizeLabels.split(',').map(s => s.trim()) : undefined}
                />
            </div>
        </PageShell>
    );
};
