import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LineAllocation, StyleOrder } from '../../../types';
import type { DepartmentEntity, ProcessFlowStep } from '../../../types/settings';
import { planningProfileForStep } from '../../../lib/planningStepProfile';
import { isStoragePlanningDepartment } from '../../../lib/departmentFilters';

interface DepartmentGanttChartProps {
    flowSteps: any[];
    departments?: DepartmentEntity[];
    assignedResources: any[];
    allAllocations: LineAllocation[];
    selectedColorData: any;
    selectedOrder?: StyleOrder | null;
    orders?: Array<{ id: string; styleName?: string; colorways?: Array<{ id: string; name: string }> }>;
    timelineData: any[];
    cellWidth: number;
    deliveryDate?: string;
    deliveryDates?: string[];
    onBarClick: (allocation: LineAllocation) => void;
    onBarDragStart: (allocation: LineAllocation, edge: 'left' | 'right' | 'center') => void;
    onBarHover?: (allocation: LineAllocation | null, anchorRect?: DOMRect) => void;
    onTimelineClick?: (resourceId: string, date: string) => void;
}

export const DepartmentGanttChart: React.FC<DepartmentGanttChartProps> = ({
    flowSteps,
    departments = [],
    assignedResources,
    allAllocations,
    selectedColorData,
    selectedOrder,
    orders = [],
    timelineData,
    deliveryDate,
    deliveryDates = [],
    onBarDragStart,
    onBarHover,
}) => {
    const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
    const [hoveredBar, setHoveredBar] = useState<string | null>(null);

    const deptById = useMemo(
        () => new Map(departments.map((d) => [d.id, d])),
        [departments],
    );

    const operationLabelById = useMemo(() => {
        const map = new Map<string, string>();
        for (const step of flowSteps) {
            const op = step as ProcessFlowStep;
            if (op.id) map.set(op.id, op.operation_name || op.step_label || op.dept_name || '');
        }
        return map;
    }, [flowSteps]);

    const deliveryDatePosition = useMemo(() => {
        if (!deliveryDate || timelineData.length === 0) return null;
        const idx = timelineData.findIndex(d => d.iso === deliveryDate);
        if (idx === -1) return null;
        return (idx / timelineData.length) * 100;
    }, [deliveryDate, timelineData]);

    const deliveryDatePositions = useMemo(() => {
        if (!deliveryDates || deliveryDates.length === 0 || timelineData.length === 0) return [];
        return deliveryDates
            .map(date => {
                const idx = timelineData.findIndex(d => d.iso === date);
                if (idx === -1) return null;
                return { date, pct: (idx / timelineData.length) * 100 };
            })
            .filter((x): x is { date: string; pct: number } => x !== null);
    }, [deliveryDates, timelineData]);

    const todayPosition = useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        const idx = timelineData.findIndex(d => d.iso === today);
        if (idx === -1) return null;
        return (idx / timelineData.length) * 100;
    }, [timelineData]);

    const departmentGroups = useMemo(() => {
        const seen = new Set<string>();
        const groups: { name: string; id: string; resources: typeof assignedResources; color: string }[] = [];

        for (const step of flowSteps) {
            const op = step as ProcessFlowStep;
            const deptId = op.dept_id || '';
            const deptName = op.dept_name || '';
            const key = deptId || deptName;
            if (!key || seen.has(key)) continue;

            const dept = deptId ? deptById.get(deptId) : undefined;
            const profile = planningProfileForStep(op, dept);
            if (profile === 'terminal') continue;
            if (isStoragePlanningDepartment(dept)) continue;

            seen.add(key);
            let deptResources = assignedResources.filter(r =>
                r.departmentId === deptId || r.departmentName === deptName,
            );
            if (deptResources.length === 0) {
                deptResources = [{
                    id: `__timeline__${key}`,
                    resourceName: '—',
                    departmentId: deptId,
                    departmentName: deptName,
                }];
            }

            groups.push({
                name: deptName,
                id: deptId,
                resources: deptResources,
                color: getDeptColor(deptName),
            });
        }
        return groups;
    }, [flowSteps, assignedResources, deptById]);

    const toggleDept = (deptName: string) => {
        setCollapsedDepts(prev => {
            const next = new Set(prev);
            if (next.has(deptName)) next.delete(deptName);
            else next.add(deptName);
            return next;
        });
    };

    const calculateBarRows = (bars: LineAllocation[]): Map<string, number> => {
        const rowMap = new Map<string, number>();
        const sorted = [...bars].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        const rows: { end: Date }[] = [];

        for (const bar of sorted) {
            const start = new Date(bar.startDate);
            const end = new Date(bar.endDate);
            let placed = false;
            for (let i = 0; i < rows.length; i++) {
                if (start > rows[i].end) {
                    rows[i].end = end;
                    rowMap.set(bar.id, i);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                rowMap.set(bar.id, rows.length);
                rows.push({ end });
            }
        }
        return rowMap;
    };

    const getResourceBars = (resourceId: string) =>
        allAllocations.filter(a => a.lineId === resourceId);

    const calculateBarStyle = (alloc: LineAllocation) => {
        if (timelineData.length === 0) return null;
        const firstDate = timelineData[0].iso;
        const lastDate = timelineData[timelineData.length - 1].iso;
        if (alloc.endDate < firstDate || alloc.startDate > lastDate) return null;

        const clampedStart = alloc.startDate < firstDate ? firstDate : alloc.startDate;
        const clampedEnd = alloc.endDate > lastDate ? lastDate : alloc.endDate;
        const startIdx = timelineData.findIndex(d => d.iso === clampedStart);
        const endIdx = timelineData.findIndex(d => d.iso === clampedEnd);
        if (startIdx === -1 || endIdx === -1) return null;

        const left = (startIdx / timelineData.length) * 100;
        const width = ((endIdx - startIdx + 1) / timelineData.length) * 100;
        const isClippedLeft = alloc.startDate < firstDate;
        const isClippedRight = alloc.endDate > lastDate;
        return { left, width, isClippedLeft, isClippedRight };
    };

    const enrichAllocForHover = (bar: LineAllocation): LineAllocation => {
        const visitId = bar.visitId;
        let operationNames: string[] = [];
        if (visitId) {
            operationNames = flowSteps
                .filter((s) => (s as ProcessFlowStep).visit_id === visitId)
                .map((s) => (s as ProcessFlowStep).operation_name || (s as ProcessFlowStep).dept_name || '')
                .filter(Boolean);
        }
        const opName =
            bar.operationName ||
            (bar.operationId ? operationLabelById.get(bar.operationId) : undefined) ||
            '';
        if (operationNames.length === 0 && opName) operationNames = [opName];
        const combined = operationNames.length > 1 ? operationNames.join(' + ') : operationNames[0] || opName;
        return combined ? { ...bar, operationName: combined, visitId } : bar;
    };

    const barDisplayLabel = (bar: LineAllocation): string => {
        if (bar.orderId === selectedOrder?.id) {
            return (
                selectedOrder?.colorways?.find((cw) => cw.id === bar.colorwayId)?.name ??
                (bar as LineAllocation & { colorway?: string }).colorway ??
                selectedOrder?.styleName ??
                ''
            );
        }
        const order = orders.find((o) => o.id === bar.orderId);
        const cwName =
            order?.colorways?.find((c) => c.id === bar.colorwayId)?.name ??
            (bar as LineAllocation & { colorway?: string }).colorway;
        if (order?.styleName && cwName) return `${order.styleName} · ${cwName}`;
        return order?.styleName ?? cwName ?? (bar as LineAllocation & { styleName?: string }).styleName ?? '';
    };

    return (
        <div className="flex-1 overflow-x-hidden relative">
            <div className="flex border-b border-slate-200 bg-slate-50 h-10 sticky top-0 z-30 shadow-sm">
                <div className="w-[140px] flex-shrink-0 p-2 border-r border-slate-200 font-bold text-slate-500 text-[10px] uppercase tracking-wider flex items-center pl-4 bg-slate-50">
                    Resource
                </div>
                <div className="flex-1 flex relative">
                    {timelineData.map((d, i) => (
                        <div
                            key={i}
                            className={`border-r border-slate-100 flex flex-col items-center justify-center flex-1 min-w-0 ${d.isWeekend ? 'bg-red-50/50' : ''} ${d.iso === deliveryDate ? 'bg-red-100' : ''}`}
                        >
                            <span className={`text-[9px] font-bold ${d.isWeekend || d.iso === deliveryDate ? 'text-red-600' : 'text-slate-600'}`}>
                                {d.weekday[0]}
                            </span>
                            <span className={`text-[10px] ${d.isWeekend || d.iso === deliveryDate ? 'text-red-800' : 'text-slate-400'}`}>
                                {d.day}
                            </span>
                        </div>
                    ))}

                    {deliveryDatePositions.map(({ date, pct }, i) => (
                        <div
                            key={date}
                            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-50 pointer-events-none"
                            style={{ left: `calc(${pct}% + ${100 / timelineData.length / 2}%)` }}
                        >
                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[8px] px-1 py-0.5 rounded whitespace-nowrap font-bold">
                                {deliveryDatePositions.length > 1 ? `SHIP ${i + 1}` : 'DELIVERY'}
                            </div>
                        </div>
                    ))}
                    {deliveryDatePositions.length === 0 && deliveryDatePosition !== null && (
                        <div
                            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-50 pointer-events-none"
                            style={{ left: `calc(${deliveryDatePosition}% + ${100 / timelineData.length / 2}%)` }}
                        >
                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[8px] px-1 py-0.5 rounded whitespace-nowrap font-bold">
                                DELIVERY
                            </div>
                        </div>
                    )}

                    {todayPosition !== null && (
                        <div
                            className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-40 pointer-events-none"
                            style={{ left: `calc(${todayPosition}% + ${100 / timelineData.length / 2}%)` }}
                        >
                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[8px] px-1 py-0.5 rounded whitespace-nowrap font-bold">
                                TODAY
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {departmentGroups.map((dept) => {
                const isCollapsed = collapsedDepts.has(dept.name);

                return (
                    <div key={dept.id || dept.name}>
                        <div
                            className="flex items-center bg-slate-100 border-b border-slate-200 cursor-pointer hover:bg-slate-150"
                            onClick={() => toggleDept(dept.name)}
                        >
                            <div className="w-[140px] flex-shrink-0 px-3 py-2 flex items-center gap-2 border-r border-slate-200 bg-slate-100">
                                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                <span className="font-bold text-xs text-slate-700">{dept.name}</span>
                                <span className="ml-auto px-1.5 py-0.5 bg-slate-200 text-slate-600 text-[10px] rounded-full font-bold">
                                    {dept.resources.length}
                                </span>
                            </div>
                            <div className="flex-1" />
                        </div>

                        {!isCollapsed && dept.resources.map((resource) => {
                            const bars = getResourceBars(resource.id);
                            const barRows = calculateBarRows(bars);
                            const maxRows = Math.max(1, ...Array.from(barRows.values()).map(v => v + 1));

                            return (
                                <div
                                    key={resource.id}
                                    className="flex border-b border-slate-100 hover:bg-slate-50/50 relative"
                                    style={{ minHeight: `${Math.max(40, maxRows * 36 + 8)}px` }}
                                >
                                    <div className="w-[140px] flex-shrink-0 px-3 py-2 border-r border-slate-200 flex items-center bg-white">
                                        <span className="text-xs text-slate-700 truncate">{resource.resourceName}</span>
                                    </div>

                                    <div className="flex-1 relative min-w-0">
                                        <div className="absolute inset-0 flex pointer-events-none">
                                            {timelineData.map((d, i) => (
                                                <div
                                                    key={i}
                                                    className={`border-r border-slate-100 flex-1 min-w-0 ${d.isWeekend ? 'bg-red-50/30' : ''}`}
                                                />
                                            ))}
                                        </div>

                                        {deliveryDatePositions.map(({ date, pct }) => (
                                            <div
                                                key={date}
                                                className="absolute top-0 bottom-0 w-0.5 bg-red-500/40 z-10 pointer-events-none"
                                                style={{ left: `calc(${pct}% + ${100 / timelineData.length / 2}%)` }}
                                            />
                                        ))}

                                        {todayPosition !== null && (
                                            <div
                                                className="absolute top-0 bottom-0 w-0.5 bg-blue-500/30 z-10 pointer-events-none"
                                                style={{ left: `calc(${todayPosition}% + ${100 / timelineData.length / 2}%)` }}
                                            />
                                        )}

                                        {bars.map(bar => {
                                            const barStyle = calculateBarStyle(bar);
                                            if (!barStyle) return null;

                                            const enriched = enrichAllocForHover(bar);
                                            const isHovered = hoveredBar === bar.id;
                                            const isSelectedColorway = Boolean(
                                                selectedColorData && bar.colorwayId === selectedColorData.id,
                                            );
                                            const isSelected = isSelectedColorway;

                                            const isSaved = Boolean(bar.id && !String(bar.id).startsWith('temp-'));

                                            return (
                                                <div
                                                    key={bar.id || `pending-${bar.lineId}-${bar.startDate}`}
                                                    className={`absolute h-[32px] pointer-events-auto ${
                                                        barStyle.isClippedLeft ? 'rounded-r' : barStyle.isClippedRight ? 'rounded-l' : 'rounded'
                                                    } ${
                                                        isSelected
                                                            ? isSaved
                                                                ? 'bg-emerald-100 border-2 border-emerald-500'
                                                                : 'bg-amber-100 border-2 border-amber-400'
                                                            : 'bg-slate-200 border border-slate-300'
                                                    } ${isHovered ? 'ring-2 ring-blue-400 shadow-lg z-30' : 'z-20'}`}
                                                    style={{
                                                        left: `${barStyle.left}%`,
                                                        width: `${barStyle.width}%`,
                                                        top: `${4 + (barRows.get(bar.id) || 0) * 36}px`,
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        setHoveredBar(bar.id || null);
                                                        onBarHover?.(enriched, e.currentTarget.getBoundingClientRect());
                                                    }}
                                                    onMouseLeave={() => {
                                                        setHoveredBar(null);
                                                        onBarHover?.(null);
                                                    }}
                                                >
                                                    {bar.completed_is_true && (
                                                        <div className="absolute inset-0 bg-black/15 rounded pointer-events-none" />
                                                    )}

                                                    <div
                                                        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-black/10 rounded-l"
                                                        onMouseDown={(e) => { e.stopPropagation(); onBarDragStart(bar, 'left'); }}
                                                    />
                                                    <div
                                                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-black/10 rounded-r"
                                                        onMouseDown={(e) => { e.stopPropagation(); onBarDragStart(bar, 'right'); }}
                                                    />

                                                    <div className="px-1.5 py-0.5 flex items-center gap-1 h-full text-[8px] font-medium overflow-hidden leading-none min-w-0">
                                                        <span className={`truncate font-semibold shrink min-w-0 ${
                                                            isSelected ? 'text-amber-700' : 'text-slate-600'
                                                        }`}>
                                                            {barDisplayLabel(bar)}
                                                        </span>
                                                        {enriched.operationName && barStyle.width > 14 && (
                                                            <span className={`truncate text-[7px] shrink min-w-0 ${
                                                                isSelected ? 'text-amber-600' : 'text-slate-400'
                                                            }`}>
                                                                · {enriched.operationName}
                                                            </span>
                                                        )}
                                                        <span className={`ml-auto font-bold shrink-0 text-[8px] ${
                                                            isSelected ? 'text-amber-700' : 'text-slate-500'
                                                        }`}>
                                                            {bar.qty}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
            <div className="h-8" />
        </div>
    );
};

function getDeptColor(deptName: string): string {
    const colors: Record<string, string> = {
        Cutting: '#3b82f6',
        Sewing: '#8b5cf6',
        Embroidery: '#f59e0b',
        Print: '#f59e0b',
        Finishing: '#10b981',
        Packing: '#6366f1',
    };
    for (const [key, color] of Object.entries(colors)) {
        if (deptName.toLowerCase().includes(key.toLowerCase())) return color;
    }
    return '#64748b';
}
