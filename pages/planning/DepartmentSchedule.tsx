import React, { useState, useMemo } from 'react';

import { useNavigationStore } from '../../stores';
import { RoutePath } from '../../types';

import { Card, SelectDropdown } from '../../components/ui';
import { PageShell } from '../../components/layout/PageShell';

import { ChevronRight, ChevronLeft, Search, ExternalLink } from 'lucide-react';

import { GanttAllocTooltip, GanttDeptHeaderRow, GanttResourceRows, GanttScheduleViewBar, GanttTimelineHeader, GanttTimelineMarkers, type GanttAlloc } from '../../components/production/GanttResourceRows';
import { SingleDatePicker } from '../../components/SingleDatePicker';
import { sortResourcesBySequence } from '../../lib/ganttSchedule';



import { enrichAllocationsWithActuals, buildDeptNameByLineId } from '../../lib/ganttActuals';
import { buildTimelineDays, formatTimelineRange, GANTT_VIEW_DAYS } from '../../lib/ganttTimeline';
import { isProductionDepartment, compareDepartmentsForDisplay } from '../../lib/departmentFilters';
import { allocationColorwayName, allocationDepartmentId, allocationPoNumber, allocationStyleName } from '../../lib/allocationUtils';
import {
    mergeFabricActualsByDateAndComponent,
    type GanttFabricActual,
} from '../../lib/ganttFabricActuals';
import { useGanttFabricActualsForOrders } from '../../hooks/useGanttFabricActuals';
import { useDepartmentsCatalog } from '../../lib/queries/settingsSlices';
import { useGanttScheduleWindow } from '../../lib/queries/ganttScheduleWindow';
import { useProductionSummary } from '../../lib/queries/productionSummary';



export const DepartmentSchedule: React.FC = () => {

    const { navigate, factoryId } = useNavigationStore();

    const [viewStartDate, setViewStartDate] = useState(() => {

        const d = new Date();

        d.setDate(d.getDate() - 2);

        return d.toISOString().split('T')[0];

    });

    const timelineData = useMemo(
        () => buildTimelineDays(new Date(viewStartDate), GANTT_VIEW_DAYS, 0),
        [viewStartDate],
    );
    const viewEnd = timelineData[timelineData.length - 1]?.iso ?? viewStartDate;
    const includeCompleted = useMemo(() => {
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - 30);
        return new Date(viewStartDate) < threshold;
    }, [viewStartDate]);

    const { data: scheduleBundle, isLoading: scheduleLoading } = useGanttScheduleWindow(
        factoryId,
        viewStartDate,
        viewEnd,
        includeCompleted,
        Boolean(factoryId),
    );
    const orders = scheduleBundle?.orders ?? [];
    const assignedResources = scheduleBundle?.assignedResources ?? [];
    const allocations = scheduleBundle?.allocations ?? [];
    const { departments } = useDepartmentsCatalog(factoryId, 'core');
    const { data: summaryBundle, isLoading: summaryLoading } = useProductionSummary(factoryId, Boolean(factoryId));
    const productionSummary = summaryBundle?.productionSummary ?? [];
    const orderDeptProgress = summaryBundle?.orderDeptProgress ?? [];
    const lineAllocationActuals = summaryBundle?.lineAllocationActuals ?? [];
    const loading = scheduleLoading || summaryLoading;

    const [hoveredAlloc, setHoveredAlloc] = useState<{ alloc: GanttAlloc; anchorRect: DOMRect; mode: 'planned' | 'actual' } | null>(null);



    const [filterDepartment, setFilterDepartment] = useState<string>('');

    const [searchQuery, setSearchQuery] = useState('');

    const [rowView, setRowView] = useState<'both' | 'planned' | 'running'>('both');

    const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);
    const { data: fabricActuals = [] } = useGanttFabricActualsForOrders(factoryId, orderIds);

    // Settings and production data are loaded once by App.tsx on login.



    const scheduleDepartments = useMemo(() => {

        const fromSettings = (departments || [])

            .filter((d) => isProductionDepartment(d))
            .sort(compareDepartmentsForDisplay)
            .map((d) => d.name);

        if (fromSettings.length > 0) return fromSettings;

        const fromResources = [...new Set(assignedResources.map((r) => r.departmentName).filter(Boolean))];

        return fromResources.sort();

    }, [departments, assignedResources]);



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



        if (startDiff < 0) { duration += startDiff; startDiff = 0; }

        if (startDiff >= totalDays || duration <= 0) return null;



        const leftPct = (startDiff / totalDays) * 100;

        const widthPct = (Math.min(duration, totalDays - startDiff) / totalDays) * 100;



        return { left: `${leftPct}%`, width: `${widthPct}%` };

    };



    const deptIdByName = useMemo(() => {

        const map = new Map<string, string>();

        for (const d of departments || []) map.set(d.name, d.id);

        return map;

    }, [departments]);

    const orderById = useMemo(
        () => new Map(orders.map((o) => [o.id, o])),
        [orders],
    );

    const originDepartmentId = useMemo(
        () => departments.find((department) => department.role === 'origin')?.id,
        [departments],
    );

    const deptNameById = useMemo(
        () => new Map((departments || []).map((d) => [d.id, d.name])),
        [departments],
    );

    const deptNameByLineId = useMemo(
        () => buildDeptNameByLineId(assignedResources, deptNameById),
        [assignedResources, deptNameById],
    );

    const enrichAllocation = (alloc: (typeof allocations)[0]) => {
        const order = orderById.get(alloc.orderId);
        const [enriched] = enrichAllocationsWithActuals(
            [alloc],
            productionSummary,
            orders,
            deptNameByLineId,
            orderDeptProgress,
            lineAllocationActuals,
        );
        return {
            ...enriched,
            styleRef: order?.styleRef || '',
            dailyTarget: alloc.dailyTarget,
        };
    };

    const allocationMatchesSearch = (alloc: (typeof allocations)[0], q: string) => {
        const order = orderById.get(alloc.orderId);
        return (
            allocationStyleName(alloc, orders).toLowerCase().includes(q) ||
            allocationPoNumber(alloc, orders).toLowerCase().includes(q) ||
            (order?.styleRef || '').toLowerCase().includes(q) ||
            allocationColorwayName(alloc, orders).toLowerCase().includes(q) ||
            order?.styleName?.toLowerCase().includes(q)
        );
    };

    const groups = useMemo(() => {

        const selectedDepts = filterDepartment ? [filterDepartment] : scheduleDepartments;

        const q = searchQuery.trim().toLowerCase();

        return scheduleDepartments

            .filter((dept) => selectedDepts.includes(dept))

            .map((dept) => {

                const deptId = deptIdByName.get(dept);

                const lines = sortResourcesBySequence(
                    assignedResources.filter((line) => {

                    if (line.departmentName !== dept) return false;

                    if (!q) return true;

                    if (
                        line.resourceName?.toLowerCase().includes(q) ||
                        dept.toLowerCase().includes(q)
                    ) {
                        return true;
                    }

                    const lineAllocs = allocations.filter(
                        (a) =>
                            a.lineId === line.id ||
                            (!!deptId && allocationDepartmentId(a, orders) === deptId && !a.lineId),
                    );

                    return lineAllocs.some((a) => allocationMatchesSearch(a, q));

                }),
                );

                return { title: dept, deptId, lines };

            })

            .filter((g) => g.lines.length > 0 || !filterDepartment);

    }, [assignedResources, allocations, filterDepartment, searchQuery, scheduleDepartments, deptIdByName, orderById]);



    return (

        <PageShell
            loading={loading}
            skeleton="table"
            className="h-[calc(100dvh-8rem)] flex flex-col overflow-hidden bg-slate-50 max-w-[1920px] mx-auto w-full"
        >



            <Card noPadding className="flex-1 flex flex-col min-h-0">

                <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 gap-3 flex-shrink-0">

                    <div className="flex items-center gap-2 flex-1 max-w-sm">

                        <Search size={14} className="text-slate-400" />

                        <input

                            className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1"

                            placeholder="Search style, department..."

                            value={searchQuery}

                            onChange={(e) => setSearchQuery(e.target.value)}

                        />

                    </div>



                    <div className="flex items-center gap-3">

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

                                ...scheduleDepartments.map((d) => ({ value: d, label: d }))

                            ]}

                            className="w-40"

                        />



                        <div className="flex items-center gap-1 bg-white px-1.5 py-1 rounded-xl border border-slate-200 shadow-sm">

                            <button type="button" onClick={handlePrev} className="p-1 hover:bg-slate-100 rounded-md text-slate-500"><ChevronLeft size={14}/></button>

                            <SingleDatePicker
                                value={viewStartDate}
                                onChange={setViewStartDate}
                            />

                            <button type="button" onClick={handleNext} className="p-1 hover:bg-slate-100 rounded-md text-slate-500"><ChevronRight size={14}/></button>

                        </div>

                    </div>

                </div>



                <GanttScheduleViewBar
                    timelineRange={formatTimelineRange(timelineData)}
                    showDelivery={false}
                    className="mx-3 mt-2 mb-3 flex-shrink-0"
                    trailingAction={
                        <button
                            type="button"
                            onClick={() => navigate(RoutePath.LINE_ASSIGNMENT)}
                            className="p-1 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-blue-600 transition-colors"
                            title="Open Planning Board"
                        >
                            <ExternalLink size={13} />
                        </button>
                    }
                />



                {allocations.length === 0 && (

                    <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-800">

                        No plans saved yet. Create allocations in Production Planning, then return here.

                    </div>

                )}



                <div className="flex-1 min-h-0 overflow-auto">

                    <div className="min-w-max relative">

                        <GanttTimelineHeader timelineData={timelineData} layout="wide" />

                        <GanttTimelineMarkers timelineData={timelineData} />

                        {groups.map((group, grpIdx) => (

                            <React.Fragment key={grpIdx}>

                                <GanttDeptHeaderRow deptName={group.title} />

                                {group.lines.length === 0 ? (

                                    <div className="flex h-7 border-b border-slate-100 items-center px-3 text-[11px] text-slate-400 italic">

                                        No resources configured for {group.title}. Add one in Settings → Departments.

                                    </div>

                                ) : (

                                    group.lines.flatMap((line) => {

                                        const q = searchQuery.trim().toLowerCase();

                                        const lineAllocations = allocations

                                            .filter(

                                                (a) =>

                                                    a.lineId === line.id ||

                                                    (!!group.deptId && allocationDepartmentId(a, orders) === group.deptId && !a.lineId),

                                            )

                                            .filter((a) => !q || allocationMatchesSearch(a, q))

                                            .map(enrichAllocation);

                                        const resourceCuttingActuals = group.deptId === originDepartmentId
                                            ? mergeFabricActualsByDateAndComponent(
                                                fabricActuals.filter((actual) => actual.resourceId === line.id),
                                            )
                                            : [];

                                        const baseForActual = (actual: GanttFabricActual) => {
                                            const o = orderById.get(actual.orderId);
                                            return {
                                                id: `fabric-base-${actual.orderId}-${actual.colorwayId || ''}`,
                                                startDate: actual.startDate,
                                                endDate: actual.endDate,
                                                styleName: o?.styleName || '',
                                                poNumber: o?.poNumber || '',
                                                styleRef: o?.styleRef || '',
                                                colorway: actual.colorwayId
                                                    ? allocationColorwayName({ orderId: actual.orderId, colorwayId: actual.colorwayId } as unknown as Parameters<typeof allocationColorwayName>[0], orders)
                                                    : '',
                                                dailyTarget: 0,
                                                operationName: '',
                                                operationNames: [],
                                            } as GanttAlloc;
                                        };

                                        const actualOnlyAllocations = resourceCuttingActuals.map((actual, index) => {
                                            const matchingAlloc = allocations.find(
                                                (a) =>
                                                    a.lineId === line.id &&
                                                    a.orderId === actual.orderId &&
                                                    (a.colorwayId || null) === (actual.colorwayId || null),
                                            );
                                            const matchingBase = matchingAlloc ? enrichAllocation(matchingAlloc) : baseForActual(actual);
                                            return {
                                                ...matchingBase,
                                                id: `${matchingBase.id}-fabric-actual-${index}`,
                                                qty: 0,
                                                actualQty: actual.qty,
                                                actualStartDate: actual.startDate,
                                                actualEndDate: actual.endDate,
                                                fabricType: actual.fabricType,
                                                actualOnly: true,
                                            };
                                        });

                                        const displayAllocations = [
                                            ...lineAllocations.map((allocation) =>
                                                actualOnlyAllocations.length > 0
                                                    ? { ...allocation, actualQty: 0, actualStartDate: undefined, actualEndDate: undefined }
                                                    : allocation,
                                            ),
                                            ...actualOnlyAllocations,
                                        ];

                                        return (
                                            <div
                                                key={line.id}
                                                className="relative group"
                                                onMouseLeave={() => setHoveredAlloc(null)}
                                            >
                                                <GanttResourceRows
                                                    deptName={group.title}
                                                    showDept={false}
                                                    resourceName={line.resourceName || ''}
                                                    timelineData={timelineData}
                                                    allocations={displayAllocations}
                                                    getPositionStyle={getPositionStyle}
                                                    layout="wide"
                                                    rowMode={rowView}
                                                    onAllocHover={(alloc, rect, mode) => setHoveredAlloc({ alloc, anchorRect: rect, mode })}
                                                    onAllocLeave={() => setHoveredAlloc(null)}
                                                />
                                            </div>
                                        );

                                    })

                                )}

                            </React.Fragment>

                        ))}

                        {groups.length === 0 && (

                            <div className="p-12 text-center text-slate-400 italic">

                                No departments found. Configure departments and resources in Settings.

                            </div>

                        )}

                    </div>

                </div>

            </Card>



            {hoveredAlloc && (
                <GanttAllocTooltip alloc={hoveredAlloc.alloc} anchorRect={hoveredAlloc.anchorRect} mode={hoveredAlloc.mode} />
            )}

        </PageShell>

    );

};


