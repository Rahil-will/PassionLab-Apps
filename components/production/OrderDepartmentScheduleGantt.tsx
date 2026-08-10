import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, ExternalLink } from 'lucide-react';
import { Card, SelectDropdown } from '../ui';
import {
    GanttAllocTooltip,
    GanttDeptHeaderRow,
    GanttResourceRows,
    GanttScheduleViewBar,
    GanttTimelineHeader,
    GanttTimelineMarkers,
    type GanttAlloc,
} from './GanttResourceRows';
import { groupGanttAllocsByColorway } from '../../lib/ganttSchedule';
import { enrichAllocationsWithActuals, buildDeptNameByLineId } from '../../lib/ganttActuals';
import { buildTimelineDays, formatTimelineRange, GANTT_VIEW_DAYS } from '../../lib/ganttTimeline';
import { allocationColorwayId } from '../../lib/allocationUtils';
import { buildPlanningDetailParams } from '../../lib/planningNavigation';
import type { LineAllocation, StyleOrder } from '../../types';
import { useNavigationStore, useDataStore } from '../../stores';
import { useDepartmentsCatalog } from '../../lib/queries/settingsSlices';
import { useAssignedResources } from '../../hooks/useAssignedResources';
import { useOrderForEdit } from '../../hooks/useOrderForEdit';
import { useProductionSummary } from '../../lib/queries/productionSummary';
import { RoutePath } from '../../types';
import {
    fetchGanttFabricActuals,
    mergeFabricActualsByComponent,
    type GanttFabricActual,
} from '../../lib/ganttFabricActuals';

interface OrderDepartmentScheduleGanttProps {
    orderId: string;
    /** When set, used instead of dataStore lookup (Style Details direct navigation). */
    order?: StyleOrder | null;
    orderAllocations?: LineAllocation[];
    colorwayId?: string;
    poNumber?: string;
    deliveryDate?: string;
    /** When supplied, the component will not run its own fabric actuals fetch. */
    fabricActuals?: GanttFabricActual[];
    fabricActualsLoading?: boolean;
    /** When orderAllocations is passed from parent, set while parent query is loading. */
    allocationsLoading?: boolean;
}

interface VisitRow {
    /** order_routing_steps.visit_id — the grouping key for this row. */
    visitId: string;
    deptName: string;
    deptId?: string;
    operationName: string;
    seq: number;
    /** Primary order_routing_steps.id for the visit — used to match fabric-type actuals. */
    stepId: string;
}

/**
 * Order-scoped Department Schedule Gantt.
 *
 * Unlike `DepartmentScheduleGantt` (which groups bars by assigned resource/line),
 * this component groups rows by `order_routing_steps.visit_id` — each visit in the
 * order's routing becomes its own row. This correctly separates operations that
 * share the same resource but are distinct visits (e.g. two Cutting visits for the
 * same order), and lets cutting rows split into per-fabric-type sub-rows.
 */
export const OrderDepartmentScheduleGantt: React.FC<OrderDepartmentScheduleGanttProps> = ({
    orderId,
    order: orderProp,
    orderAllocations: orderAllocationsProp,
    colorwayId,
    poNumber,
    deliveryDate,
    fabricActuals: propFabricActuals,
    fabricActualsLoading: propFabricActualsLoading,
    allocationsLoading: propAllocationsLoading = false,
}) => {
    const {
        assignedResources,
        allocations = [],
    } = useDataStore();
    const { navigate, factoryId } = useNavigationStore();
    const { departments } = useDepartmentsCatalog(factoryId, 'core');
    const { data: resourceCatalog = [] } = useAssignedResources(factoryId);
    const { data: summaryBundle, isLoading: summaryLoading, isSuccess: summaryReady } = useProductionSummary(factoryId, Boolean(factoryId));
    const productionSummary = summaryBundle?.productionSummary ?? [];
    const orderDeptProgress = summaryBundle?.orderDeptProgress ?? [];
    const lineAllocationActuals = summaryBundle?.lineAllocationActuals ?? [];

    const { order: orderFromEdit } = useOrderForEdit(factoryId, orderProp ? null : orderId);
    const order = orderProp ?? orderFromEdit ?? null;

    const assignedResourcesResolved =
        assignedResources.length > 0 ? assignedResources : resourceCatalog;

    const allocationsSource = orderAllocationsProp ?? allocations.filter((a) => a.orderId === orderId);
    const ordersForEnrich = order ? [order] : [];

    const [hoveredAlloc, setHoveredAlloc] = useState<{
        alloc: GanttAlloc;
        anchorRect: DOMRect;
        mode: 'planned' | 'actual';
    } | null>(null);

    const [viewStartDate, setViewStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 2);
        return d.toISOString().split('T')[0];
    });

    const [filterDepartment, setFilterDepartment] = useState('');
    const [rowView, setRowView] = useState<'both' | 'planned' | 'running'>('both');
    const [internalFabricActuals, setInternalFabricActuals] = useState<GanttFabricActual[]>([]);
    const [internalLoading, setInternalLoading] = useState(
        propFabricActuals === undefined ? Boolean(factoryId && orderId) : false,
    );

    const fabricActuals = propFabricActuals ?? internalFabricActuals;
    const fabricActualsLoading = propFabricActualsLoading ?? internalLoading;

    const orderAllocations = useMemo(
        () =>
            allocationsSource.filter((a) => {
                if (a.orderId !== orderId) return false;
                if (colorwayId && allocationColorwayId(a) !== colorwayId) return false;
                return true;
            }),
        [allocationsSource, orderId, colorwayId],
    );

    const orderLineAllocationIds = useMemo(
        () => new Set(orderAllocations.map((a) => a.id)),
        [orderAllocations],
    );

    const orderLineAllocationActuals = useMemo(
        () =>
            lineAllocationActuals.filter((actual) =>
                orderLineAllocationIds.has(actual.line_allocation_id),
            ),
        [lineAllocationActuals, orderLineAllocationIds],
    );

    const timelineData = useMemo(
        () => buildTimelineDays(new Date(viewStartDate), GANTT_VIEW_DAYS, 0),
        [viewStartDate],
    );

    const handlePrev = () => {
        const d = new Date(viewStartDate);
        d.setDate(d.getDate() - 7);
        setViewStartDate(d.toISOString().split('T')[0]);
    };

    const handleNext = () => {
        const d = new Date(viewStartDate);
        d.setDate(d.getDate() + 7);
        setViewStartDate(d.toISOString().split('T')[0]);
    };

    const getPositionStyle = (startStr: string, endStr: string) => {
        const start = new Date(startStr);
        const end = new Date(endStr);
        const viewStart = timelineData[0].dateObj;
        const totalDays = timelineData.length;
        const oneDay = 24 * 60 * 60 * 1000;

        let startDiff = Math.round((start.getTime() - viewStart.getTime()) / oneDay);
        let duration = Math.round((end.getTime() - start.getTime()) / oneDay) + 1;

        if (startDiff < 0) {
            duration += startDiff;
            startDiff = 0;
        }
        if (startDiff >= totalDays || duration <= 0) return null;

        const leftPct = (startDiff / totalDays) * 100;
        const widthPct = (Math.min(duration, totalDays - startDiff) / totalDays) * 100;

        return { left: `${leftPct}%`, width: `${widthPct}%` };
    };

    const originDepartmentId = useMemo(
        () => departments.find((department) => department.role === 'origin')?.id,
        [departments],
    );

    useEffect(() => {
        if (propFabricActuals !== undefined || !factoryId || !orderId) {
            setInternalLoading(false);
            return;
        }
        let cancelled = false;
        setInternalLoading(true);
        void fetchGanttFabricActuals(factoryId, orderId, colorwayId)
            .then((actuals) => {
                if (!cancelled) setInternalFabricActuals(actuals);
            })
            .catch(() => {
                if (!cancelled) setInternalFabricActuals([]);
            })
            .finally(() => {
                if (!cancelled) setInternalLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [propFabricActuals, factoryId, orderId, colorwayId]);

    const deptNameById = useMemo(
        () => new Map((departments || []).map((d) => [d.id, d.name])),
        [departments],
    );

    const deptNameByLineId = useMemo(
        () => buildDeptNameByLineId(assignedResourcesResolved, deptNameById),
        [assignedResourcesResolved, deptNameById],
    );

    // Build one row per visit from order_routing_steps — the visit_id / order_route_step logic.
    const visitRows = useMemo<VisitRow[]>(() => {
        const steps = order?.routingSteps ?? [];
        const byVisit = new Map<string, typeof steps>();
        for (const s of steps) {
            const key = s.visit_id || s.id;
            const list = byVisit.get(key) ?? [];
            list.push(s);
            byVisit.set(key, list);
        }
        const rows: VisitRow[] = [];
        for (const [visitId, visitSteps] of byVisit) {
            const sorted = [...visitSteps].sort((a, b) => a.seq - b.seq);
            const produceSteps = sorted.filter((s) => s.step_type === 'produce');
            const primary = produceSteps[produceSteps.length - 1] ?? sorted[sorted.length - 1];
            if (!primary) continue;
            rows.push({
                visitId,
                deptName: primary.dept_name || '',
                deptId: primary.dept_id,
                operationName:
                    sorted
                        .map((s) => s.operation_name || s.dept_name || '')
                        .filter(Boolean)
                        .join(' + ') || primary.dept_name || '',
                seq: sorted[0].seq,
                stepId: primary.id,
            });
        }
        return rows.sort((a, b) => a.seq - b.seq);
    }, [order]);

    const departmentsInOrder = useMemo(() => {
        const seen = new Set<string>();
        const list: string[] = [];
        for (const row of visitRows) {
            if (row.deptName && !seen.has(row.deptName)) {
                seen.add(row.deptName);
                list.push(row.deptName);
            }
        }
        return list;
    }, [visitRows]);

    const enrichAllocation = (alloc: (typeof allocations)[0], row: VisitRow) => {
        const allocWithContext = {
            ...alloc,
            operationId: row.stepId,
            visitId: row.visitId,
        };
        const [enriched] = enrichAllocationsWithActuals(
            [allocWithContext],
            productionSummary,
            ordersForEnrich,
            deptNameByLineId,
            orderDeptProgress,
            orderLineAllocationActuals,
        );
        return {
            ...enriched,
            styleRef: order?.styleRef || '',
            dailyTarget: alloc.dailyTarget,
        };
    };

    const groups = useMemo(() => {
        const pool = filterDepartment ? [filterDepartment] : departmentsInOrder;
        return pool
            .map((deptName) => ({
                title: deptName,
                rows: visitRows.filter((r) => r.deptName === deptName),
            }))
            .filter((g) => g.rows.length > 0 || filterDepartment === g.title);
    }, [filterDepartment, departmentsInOrder, visitRows]);

    const subtitleParts = [
        poNumber,
        deliveryDate ? `Delivery ${deliveryDate}` : null,
    ].filter(Boolean);

    const toolbar = (
        <div className="flex items-center gap-2 flex-wrap justify-end">
            <SelectDropdown
                value={rowView}
                onChange={(v) => setRowView(v as 'both' | 'planned' | 'running')}
                options={[
                    { value: 'both', label: 'Planned + Running' },
                    { value: 'planned', label: 'Planned only' },
                    { value: 'running', label: 'Running only' },
                ]}
                className="w-48"
            />

            <SelectDropdown
                value={filterDepartment}
                onChange={setFilterDepartment}
                options={[
                    { value: '', label: 'All Departments' },
                    ...departmentsInOrder.map((d) => ({ value: d, label: d })),
                ]}
                className="w-40"
            />

            <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200 shadow-sm">
                <button type="button" onClick={handlePrev} className="p-1 hover:bg-slate-100 rounded text-slate-500">
                    <ChevronLeft size={16} />
                </button>
                <div className="flex items-center gap-1.5 px-1.5 border-x border-slate-100">
                    <Calendar size={13} className="text-slate-400" />
                    <input
                        type="date"
                        value={viewStartDate}
                        onChange={(e) => setViewStartDate(e.target.value)}
                        className="text-xs border-none focus:ring-0 text-slate-700 font-medium cursor-pointer bg-white w-28"
                    />
                </div>
                <button type="button" onClick={handleNext} className="p-1 hover:bg-slate-100 rounded text-slate-500">
                    <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );

    const isReady = Boolean(
        factoryId
        && order
        && summaryReady
        && !summaryLoading
        && !fabricActualsLoading
        && !propAllocationsLoading,
    );

    const hasScheduleRows = orderAllocations.length > 0;

    return (
        <Card
            title="Order Department Schedule"
            subtitle={subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined}
            action={toolbar}
            className="shadow-sm border-slate-200"
            noPadding
        >
            <GanttScheduleViewBar
                timelineRange={formatTimelineRange(timelineData)}
                deliveryDate={deliveryDate}
                className="mx-6 mt-3"
                trailingAction={
                    <button
                        type="button"
                        onClick={() =>
                            navigate(
                                RoutePath.PLANNING_DETAIL,
                                buildPlanningDetailParams(orderId, ordersForEnrich, colorwayId),
                            )
                        }
                        className="p-1 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-blue-600 transition-colors"
                        title="Open Production Planning"
                    >
                        <ExternalLink size={13} />
                    </button>
                }
            />

            <div className="p-6 pt-3">
                {!isReady ? (
                    <div className="h-32 bg-slate-100 animate-pulse rounded-lg" />
                ) : visitRows.length === 0 ? (
                    <div className="border border-slate-200 rounded-lg px-4 py-10 text-center text-[11px] text-slate-400 italic">
                        No routing steps found for this {colorwayId ? 'colorway' : 'order'}.
                    </div>
                ) : !hasScheduleRows ? (
                    <div className="border border-slate-200 rounded-lg px-4 py-10 text-center text-[11px] text-slate-400 italic">
                        No line allocations planned for this order yet. Open Production Planning to assign resources and dates.
                    </div>
                ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
                    <div className="min-w-max relative">
                        <GanttTimelineHeader timelineData={timelineData} layout="wide" />

                        <GanttTimelineMarkers timelineData={timelineData} deliveryDate={deliveryDate} />

                        {groups.map((group) => (
                            <React.Fragment key={group.title}>
                                <GanttDeptHeaderRow deptName={group.title} />

                                {group.rows.flatMap((row) => {
                                    const rowAllocations = orderAllocations
                                        .filter((a) => a.visitId === row.visitId)
                                        .map((a) => enrichAllocation(a, row));

                                    if (rowAllocations.length === 0) return [];

                                    const colorwayGroups = colorwayId
                                        ? [{ key: colorwayId, resourceSuffix: '', allocations: rowAllocations }]
                                        : groupGanttAllocsByColorway(rowAllocations, ordersForEnrich);

                                    return colorwayGroups.map((cwGroup) => {
                                        const cuttingActuals = row.deptId === originDepartmentId
                                            ? mergeFabricActualsByComponent(
                                                fabricActuals.filter((actual) => {
                                                    const matchesRoute = actual.orderRouteId === row.stepId || actual.orderRouteId === row.visitId;
                                                    const matchesColorway = !colorwayId
                                                        ? actual.colorwayId === cwGroup.key || cwGroup.key === '_'
                                                        : actual.colorwayId === colorwayId;
                                                    return matchesRoute && matchesColorway;
                                                }),
                                            )
                                            : [];
                                        const baseAllocation = cwGroup.allocations[0];
                                        const lineName = assignedResourcesResolved.find((l) => l.id === baseAllocation.lineId)?.resourceName || '';
                                        const rowLabel = cwGroup.resourceSuffix
                                            ? `${row.operationName} · ${cwGroup.resourceSuffix}`
                                            : lineName
                                                ? `${row.operationName} (${lineName})`
                                                : row.operationName;
                                        const displayAllocations = [
                                            ...cwGroup.allocations.map((allocation) =>
                                                cuttingActuals.length > 0
                                                    ? { ...allocation, actualQty: 0, actualStartDate: undefined, actualEndDate: undefined }
                                                    : allocation,
                                            ),
                                            ...cuttingActuals.map((actual, index) => ({
                                                ...baseAllocation,
                                                id: `${baseAllocation.id}-fabric-actual-${index}`,
                                                qty: 0,
                                                actualQty: actual.qty,
                                                actualStartDate: actual.startDate,
                                                actualEndDate: actual.endDate,
                                                fabricType: actual.fabricType,
                                                actualOnly: true,
                                            })),
                                        ];
                                        return (
                                            <div
                                                key={`${row.visitId}-${cwGroup.key}`}
                                                className="relative group"
                                                onMouseLeave={() => setHoveredAlloc(null)}
                                            >
                                                <GanttResourceRows
                                                    deptName={group.title}
                                                    showDept={false}
                                                    resourceName={rowLabel}
                                                    timelineData={timelineData}
                                                    allocations={displayAllocations}
                                                    getPositionStyle={getPositionStyle}
                                                    layout="wide"
                                                    rowMode={rowView}
                                                    onAllocHover={(alloc, rect, mode) =>
                                                        setHoveredAlloc({ alloc, anchorRect: rect, mode })
                                                    }
                                                    onAllocLeave={() => setHoveredAlloc(null)}
                                                />
                                            </div>
                                        );
                                    });
                                })}
                            </React.Fragment>
                        ))}

                        {groups.length === 0 && visitRows.length > 0 && (
                            <div className="p-8 text-center text-slate-400 italic text-xs">
                                No matching departments for the current filter.
                            </div>
                        )}
                    </div>
                </div>
                )}
            </div>

            {hoveredAlloc && (
                <GanttAllocTooltip
                    alloc={hoveredAlloc.alloc}
                    anchorRect={hoveredAlloc.anchorRect}
                    mode={hoveredAlloc.mode}
                />
            )}
        </Card>
    );
};
