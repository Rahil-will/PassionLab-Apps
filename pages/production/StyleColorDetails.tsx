import React, { useState, useEffect, useMemo } from 'react';
import { useNavigationStore, useDataStore } from '../../stores';
import { useDepartmentsCatalog, useShiftsCatalog } from '../../lib/queries/settingsSlices';
import { useAssignedResources } from '../../hooks/useAssignedResources';
import { RoutePath } from '../../types';
import { Factory, ExternalLink, FileText, Eye, Calendar, BarChart3, TrendingUp, Scissors, Package } from 'lucide-react';
import { flowTableClasses as t } from '../../lib/productionFlowTable';
import { sizeAdjQty, sizeOrderQty } from '../../lib/colorwaySizesUtils';
import { Card } from '../../components/ui';
import { PageShell } from '../../components/layout/PageShell';
import { useDesktopWriteRole } from '../../components/DesktopWriteGate';
import { StyleInformationCard } from '../../components/production/StyleInformationCard';
import { ColorwayMaterialsPanel } from '../../components/production/ColorwayMaterialsPanel';
import { ShipmentPlanReadOnly } from '../../components/production/ShipmentPlanReadOnly';
import { OrderDepartmentScheduleGantt } from '../../components/production/OrderDepartmentScheduleGantt';
import { DeptFlowTable } from '../../components/production/DeptFlowTable';
import { FabricOutputBreakdownPopover } from '../../components/production/FabricOutputBreakdownPopover';
import { StyleDetailsPageSkeleton } from '../../components/production/StyleDetailsPageSkeleton';
import { useOrderCutFabricByRoute } from '../../hooks/useOrderCutFabricByRoute';
import { useCuttingComponentProgress } from '../../hooks/useCuttingComponentProgress';
import { useOrderForEdit } from '../../hooks/useOrderForEdit';
import { useModuleEnabled } from '../../core/modules/useModuleEnabled';
import { useOrderAllocations } from '../../hooks/useOrderAllocations';
import { allocationsForColorway } from '../../lib/allocationUtils';
import { useOrderDetailMetrics } from '../../hooks/useOrderDetailMetrics';
import {
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
import { SummaryModal } from '../planning/components/SummaryModal';
import { buildColorwayPlansForSummary } from '../planning/utils/planningSummary';
import { getRegularShiftHours } from '../../lib/shiftHours';
import { buildPlanningDetailParams } from '../../lib/planningNavigation';
function formatCount(count: number): React.ReactNode {
    if (count > 0) return count.toLocaleString();
    return <span className="text-slate-200">—</span>;
}

export const StyleColorDetails: React.FC = () => {
    const { navigate, routeParams, factoryId } = useNavigationStore();
    const canWrite = useDesktopWriteRole();
    const { setWipOrder } = useDataStore();
    const { shifts, loading: shiftsLoading } = useShiftsCatalog(factoryId, 'core');
    const { departments, loading: deptLoading } = useDepartmentsCatalog(factoryId, 'core');
    const settingsLoading = shiftsLoading || deptLoading;
    const { data: assignedResources = [] } = useAssignedResources(factoryId);

    const [activeTab, setActiveTab] = useState<'production' | 'materials' | 'reports'>('production');
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const materialOn = useModuleEnabled('material');

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    useEffect(() => {
        if (!materialOn && activeTab === 'materials') setActiveTab('production');
    }, [materialOn, activeTab]);

    const orderId = routeParams?.id;
    const colorId = routeParams?.colorId;
    const { order, loading: orderLoading } = useOrderForEdit(factoryId, orderId ?? null);
    const { data: pageAllocations = [], isLoading: allocationsLoading } = useOrderAllocations(
        factoryId,
        orderId,
        Boolean(factoryId && orderId),
    );
    const colorway = order?.colorways.find(c => c.id === colorId);

    const visitCells = useMemo(
        () => visitPipelineCellsFromRouting(order?.routingSteps ?? [], departments),
        [order?.routingSteps, departments],
    );

    const flowLabel = visitCells.length > 0 ? `${visitCells.length} visits` : null;

    const flowStepObjects = useMemo(
        () => (order?.routingSteps ?? []).map((r) => ({
            flow_step: r.seq,
            dept_id: r.dept_id || '',
            dept_name: r.dept_name,
            step_label: r.operation_name || r.dept_name,
            step_type: r.step_type,
            capture_app: r.capture_app,
        })),
        [order?.routingSteps],
    );

    const styleAllocations = useMemo(
        () => (colorway ? allocationsForColorway(pageAllocations, colorway.id) : []),
        [pageAllocations, colorway],
    );

    const regularShiftHours = useMemo(() => getRegularShiftHours(shifts), [shifts]);

    const colorwayPlansForSummary = useMemo(() => {
        if (!order || !colorway) return [];
        return buildColorwayPlansForSummary(order, pageAllocations, assignedResources, colorway.id);
    }, [order, colorway, pageAllocations, assignedResources]);

    const totalOrderQty = colorway
        ? (colorway.orderQty || colorway.sizes.reduce((a, s) => a + sizeOrderQty(s), 0))
        : 0;
    const totalPlannedQty = colorway
        ? colorway.sizes.reduce((a, s) => a + sizeAdjQty(s), 0)
        : 0;

    const storeReady = !orderLoading && !settingsLoading && !!order && !!colorway;
    const selectedColorwayIds = useMemo(
        () => (colorway ? [colorway.id] : []),
        [colorway?.id],
    );

    const {
        flowByColor,
        sizeProgress,
        metricsReady,
        flowLoading,
        bundleError,
    } = useOrderDetailMetrics({
        factoryId,
        orderId,
        colorwayIds: selectedColorwayIds,
        routingSteps: order?.routingSteps ?? [],
        departments,
        enabled: storeReady,
    });

    const { fabricActuals, loading: fabricLoading } = useOrderCutFabricByRoute(
        factoryId,
        orderId,
    );

    const { componentsFor } = useCuttingComponentProgress(factoryId, orderId);

    const flowMetrics = colorway ? (flowByColor[colorway.id] ?? []) : [];

    React.useEffect(() => {
        if (!import.meta.env.DEV || !orderId || !colorId) return;
        console.info('[StyleColorDetails] state', {
            orderId,
            colorId,
            storeReady,
            metricsReady,
            flowLoading,
            bundleError,
            visitCells: visitCells.length,
            flowMetrics: flowMetrics.length,
        });
    }, [orderId, colorId, storeReady, metricsReady, flowLoading, bundleError, visitCells.length, flowMetrics.length]);

    const pageReady = storeReady;

    const getVisitTotal = (visitId: string): number => {
        if (!colorway) return 0;
        return sizeProgress.getVisitTotal?.(colorway.id, visitId) ?? 0;
    };

    const getVisitSizeCount = (visitId: string, size: string): number => {
        if (!colorway) return 0;
        return sizeProgress.getVisitSizeCount?.(colorway.id, visitId, size) ?? 0;
    };

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

    const getColumnSizeCount = (col: ProductionMatrixVisitCol, size: string): number => {
        if (!colorway) return 0;
        return sumMatrixColumnSize(
            col,
            size,
            matrixColumns,
            order?.routingSteps ?? [],
            [colorway.id],
            sizeProgress,
        );
    };

    const getColumnTotal = (col: ProductionMatrixVisitCol): number => {
        if (!colorway) return 0;
        const sizeKeys = colorway.sizes.map((s) => s.size);
        return sumMatrixColumnTotal(
            col,
            matrixColumns,
            order?.routingSteps ?? [],
            [colorway.id],
            sizeKeys,
            sizeProgress,
        );
    };

    const matrixDeptGroups = useMemo(
        () => buildMatrixDeptHeaderGroups(matrixColumns),
        [matrixColumns],
    );

    const originDepartmentId = useMemo(
        () => departments.find((department) => department.role === 'origin')?.id,
        [departments],
    );

    const renderOperationValue = (value: number, column: ProductionMatrixVisitCol, size?: string) => {
        if (column.deptId !== originDepartmentId) return formatCount(value);
        const components = componentsFor(column.stepId, colorId ?? undefined, size);
        if (value <= 0 && components.length === 0) return formatCount(value);
        return <FabricOutputBreakdownPopover value={value} components={components} size={size} />;
    };

    const colorwayPhase = useMemo(
        () => deriveColorwayProgressPhase(flowMetrics, totalPlannedQty, getVisitTotal),
        [flowMetrics, totalPlannedQty, sizeProgress, colorway?.id],
    );

    const matrixTotals = useMemo(() => {
        const totals = { orderQty: 0, adjQty: 0 };
        if (!colorway) return totals;
        colorway.sizes.forEach(s => {
            totals.orderQty += sizeOrderQty(s);
            totals.adjQty += sizeAdjQty(s);
        });
        return totals;
    }, [colorway]);

    const planDeptSummary = useMemo(() => {
        const byDept = new Map<string, number>();
        for (const alloc of styleAllocations) {
            const resource = assignedResources.find((r) => r.id === alloc.lineId);
            const deptName = resource?.departmentName ?? 'Unassigned';
            byDept.set(deptName, (byDept.get(deptName) ?? 0) + alloc.qty);
        }
        return [...byDept.entries()]
            .map(([dept, qty]) => `${dept}: ${qty.toLocaleString()}`)
            .join(', ');
    }, [styleAllocations, assignedResources]);

    const sizeGroupName = order?.sizeGroupName || 'Standard';

    const planStartDate = styleAllocations.reduce<string | null>((earliest, a) => {
        if (!a.startDate) return earliest;
        if (!earliest || a.startDate < earliest) return a.startDate;
        return earliest;
    }, null);

    const reportRows = useMemo(() => {
        if (!order || !colorway) return [];
        const reportScope = { order: order.id, colorway: colorway.id };
        const rows: Array<{
            key: string;
            label: string;
            icon: typeof Calendar;
            tone: string;
            date: string;
            details: string;
            status: string;
            onView?: () => void;
            onOpen?: () => void;
        }> = [];

        if (styleAllocations.length > 0) {
            rows.push({
                key: 'plan',
                label: 'Production Plan',
                icon: Calendar,
                tone: 'emerald',
                date: planStartDate || '—',
                details: `${styleAllocations.length} allocations${planDeptSummary ? ` · (${planDeptSummary})` : ''}`,
                status: 'Saved',
                onView: canWrite ? () => setShowSummaryModal(true) : undefined,
                onOpen: () =>
                    navigate(
                        RoutePath.PLANNING_DETAIL,
                        buildPlanningDetailParams(order.id, order ? [order] : [], colorway.id),
                    ),
            });
        }

        rows.push(
            {
                key: 'style',
                label: 'Style Report',
                icon: BarChart3,
                tone: 'blue',
                date: 'Live',
                details: `Output, target, efficiency for ${order.styleName}`,
                status: 'Actuals',
                onView: () => navigate(RoutePath.REPORTS_STYLE, reportScope),
            },
            {
                key: 'day',
                label: 'Day Report',
                icon: TrendingUp,
                tone: 'violet',
                date: 'Live',
                details: `Hourly output for ${colorway.name}`,
                status: 'Actuals',
                onView: () => navigate(RoutePath.REPORTS_DAY, reportScope),
            },
            {
                key: 'order-completion',
                label: 'Order Completion',
                icon: Scissors,
                tone: 'rose',
                date: 'Live',
                details: `Balance, rejections, and shipment for ${colorway.name}`,
                status: 'Actuals',
                onView: () => navigate(RoutePath.ORDER_COMPLETION, reportScope),
            },
        );

        return rows;
    }, [order, colorway, styleAllocations, planDeptSummary, planStartDate, navigate, canWrite]);

    React.useEffect(() => {
        if (orderLoading || settingsLoading) return;
        if (!orderId || !colorId || !order || !colorway) navigate(RoutePath.LINE_ASSIGNMENT);
    }, [orderLoading, settingsLoading, orderId, colorId, order, colorway, navigate]);

    if (!pageReady) {
        return (
            <PageShell className="w-full">
                <StyleDetailsPageSkeleton />
            </PageShell>
        );
    }

    if (!order || !colorway) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] text-slate-400">
                <p>Redirecting...</p>
            </div>
        );
    }

    const toneClasses: Record<string, { bg: string; icon: string; badge: string }> = {
        emerald: { bg: 'bg-emerald-100', icon: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
        blue: { bg: 'bg-blue-100', icon: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
        violet: { bg: 'bg-violet-100', icon: 'text-violet-600', badge: 'bg-violet-100 text-violet-700' },
        amber: { bg: 'bg-amber-100', icon: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' },
        rose: { bg: 'bg-rose-100', icon: 'text-rose-600', badge: 'bg-rose-100 text-rose-700' },
    };

    return (
        <>
        <PageShell className="w-full pb-32">
            <div className="space-y-8">
                <StyleInformationCard
                    order={order}
                    sizeGroupName={sizeGroupName}
                    colorwayName={colorway.name}
                    stats={{
                        orderQty: totalOrderQty,
                        totalAdjusted: totalPlannedQty,
                        cutAllowancePct: order.cuttingAllowance,
                        extraShipmentPct: order.shipmentAllowance,
                    }}
                    onEdit={
                        canWrite
                            ? () => {
                                  setWipOrder(JSON.parse(JSON.stringify(order)));
                                  navigate(RoutePath.CREATE_ORDER, { id: order.id });
                              }
                            : undefined
                    }
                />

                <div className="flex items-center gap-1 border-b border-slate-200 bg-transparent pt-2">
                    <button
                        onClick={() => setActiveTab('production')}
                        className={`px-6 py-3 text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'production' ? 'border-blue-500 text-blue-600 bg-white shadow-sm rounded-t-lg' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-t-lg'}`}
                    >
                        <Factory size={16} /> Production
                    </button>
                    {materialOn ? (
                        <button
                            onClick={() => setActiveTab('materials')}
                            className={`px-6 py-3 text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'materials' ? 'border-blue-500 text-blue-600 bg-white shadow-sm rounded-t-lg' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-t-lg'}`}
                        >
                            <Package size={16} /> Material Requirements
                        </button>
                    ) : null}
                    <button
                        onClick={() => setActiveTab('reports')}
                        className={`px-6 py-3 text-xs font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'reports' ? 'border-blue-500 text-blue-600 bg-white shadow-sm rounded-t-lg' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-t-lg'}`}
                    >
                        <FileText size={16} /> Reports
                    </button>
                </div>

                <div className="animate-in fade-in duration-300">
                    {activeTab === 'production' && (
                        <div className="space-y-8">
                            <Card title="Departmental flow" subtitle="Received, produced, and sent by visit for this colorway" className="shadow-sm border-slate-200" noPadding>
                                <div className="p-6">
                                    {!metricsReady ? (
                                        <p className="text-center text-xs text-slate-400 py-4">Loading production metrics…</p>
                                    ) : bundleError ? (
                                        <p className="text-center text-xs text-red-600 py-4">
                                            Could not load production metrics. {bundleError}
                                        </p>
                                    ) : (
                                        <DeptFlowTable metrics={flowMetrics} />
                                    )}
                                </div>
                            </Card>
                            {matrixColumns.length === 0 ? (
                                <Card title="Production Matrix" subtitle="No routing assigned" className="shadow-sm border-slate-200">
                                    <p className="p-6 text-center text-xs text-slate-500 italic">
                                        Assign a routing template on the Planning board to see size-wise production progress.
                                    </p>
                                </Card>
                            ) : (
                            <Card title="Production Matrix" subtitle={flowLabel || '—'} className="shadow-sm border-slate-200" noPadding>
                                {!metricsReady ? (
                                    <p className="p-8 text-center text-xs text-slate-400">Loading production metrics…</p>
                                ) : (
                                <div className="p-6">
                                <div className={t.wrapper}>
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
                                            {colorway.sizes.length === 0 ? (
                                                <tr><td colSpan={4 + matrixColumns.length} className="p-6 text-center text-slate-400 italic">No size data.</td></tr>
                                            ) : colorway.sizes.map(s => {
                                                const phase = deriveSizeProgressPhase(
                                                    flowMetrics,
                                                    sizeAdjQty(s),
                                                    (visitId) => getVisitSizeCount(visitId, s.size),
                                                );
                                                return (
                                                <tr key={s.size} className="hover:bg-slate-50">
                                                    <td className={`${t.firstCell} font-bold text-slate-700`}>{s.size}</td>
                                                    <td className={t.numCell}>{sizeOrderQty(s) > 0 ? sizeOrderQty(s).toLocaleString() : <span className="text-slate-300">—</span>}</td>
                                                    <td className={t.adjCell}>{sizeAdjQty(s) > 0 ? sizeAdjQty(s).toLocaleString() : <span className="text-slate-300">—</span>}</td>
                                                    {matrixColumns.map((col) => (
                                                        <td key={matrixColumnKey(col)} className={t.deptCell}>
                                                            {renderOperationValue(getColumnSizeCount(col, s.size), col, s.size)}
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
                                                <td className={t.footNum}>{matrixTotals.orderQty.toLocaleString()}</td>
                                                <td className={t.footAdj}>{matrixTotals.adjQty.toLocaleString()}</td>
                                                {matrixColumns.map((col) => (
                                                    <td key={matrixColumnKey(col)} className={t.footDept}>
                                                        {renderOperationValue(getColumnTotal(col), col)}
                                                    </td>
                                                ))}
                                                <td className={`${t.footStatus} ${statusColorClass(colorwayPhase)}`}>
                                                    {formatProductionStatus(colorwayPhase)}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                                </div>
                                </div>
                                )}
                            </Card>
                            )}

                            <OrderDepartmentScheduleGantt
                                orderId={order.id}
                                order={order}
                                orderAllocations={pageAllocations}
                                allocationsLoading={allocationsLoading}
                                colorwayId={colorway.id}
                                poNumber={order.poNumber}
                                deliveryDate={order.deliveryDate}
                                fabricActuals={fabricActuals}
                                fabricActualsLoading={fabricLoading}
                            />

                            <ShipmentPlanReadOnly
                                plan={order.shipmentPlan ?? { lines: [] }}
                                colorways={order.colorways}
                                colorwayId={colorway.id}
                                displaySizes={order.sizeLabels ? order.sizeLabels.split(',').map(s => s.trim()) : undefined}
                            />
                        </div>
                    )}

                    {activeTab === 'materials' && materialOn && (
                        <Card
                            title="Material requirements"
                            subtitle="Fabric categories from Work Centres. Extra fabric columns load after fabric type. Trim total qty is qty per piece × this color's adjusted qty."
                            className="shadow-sm border-slate-200"
                            noPadding
                        >
                            <ColorwayMaterialsPanel
                                colorway={colorway}
                                adjustedQty={totalPlannedQty}
                                showCaption={false}
                                readOnly
                            />
                        </Card>
                    )}

                    {activeTab === 'reports' && (
                        <div className="space-y-6">
                            <Card title="Reports" subtitle="Planning summary and live production actuals" className="shadow-sm border-slate-200" noPadding>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-gradient-to-r from-slate-50 to-slate-100 text-slate-600 font-semibold border-b border-slate-200 text-[11px] uppercase tracking-wide">
                                            <tr>
                                                <th className="px-6 py-4 text-left">Report Type</th>
                                                <th className="px-4 py-4 text-left">Date</th>
                                                <th className="px-4 py-4 text-left">Details</th>
                                                <th className="px-4 py-4 text-center">Status</th>
                                                <th className="px-6 py-4 text-center">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {reportRows.map((row) => {
                                                const tone = toneClasses[row.tone];
                                                const Icon = row.icon;
                                                return (
                                                    <tr key={row.key} className="hover:bg-slate-50/50 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-8 h-8 rounded-lg ${tone.bg} flex items-center justify-center`}>
                                                                    <Icon size={16} className={tone.icon} />
                                                                </div>
                                                                <span className="font-semibold text-slate-800">{row.label}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4 text-xs text-slate-600">{row.date}</td>
                                                        <td className="px-4 py-4 text-[10px] text-slate-600">{row.details}</td>
                                                        <td className="px-4 py-4 text-center">
                                                            <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full ${tone.badge}`}>
                                                                {row.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                {row.onView ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={row.onView}
                                                                        className={`p-2 rounded-lg transition-colors ${row.key === 'plan' ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600' : 'bg-blue-50 hover:bg-blue-100 text-blue-600'}`}
                                                                        title={row.key === 'plan' ? 'View planning summary' : 'Open report'}
                                                                    >
                                                                        <Eye size={16} />
                                                                    </button>
                                                                ) : null}
                                                                {row.onOpen ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={row.onOpen}
                                                                        className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
                                                                        title="Go to Planning Board"
                                                                    >
                                                                        <ExternalLink size={16} />
                                                                    </button>
                                                                ) : null}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        </div>
                    )}
                </div>
            </div>
        </PageShell>

        <SummaryModal
            isOpen={showSummaryModal}
            onClose={() => setShowSummaryModal(false)}
            flowSteps={flowStepObjects}
            selectedOrder={order}
            colorwayPlans={colorwayPlansForSummary}
            assignedResources={assignedResources}
            regularShiftHours={regularShiftHours}
            orderId={order.id}
        />
        </>
    );
};
