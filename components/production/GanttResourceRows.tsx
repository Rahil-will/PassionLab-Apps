import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { computePopoverPosition } from '../../lib/popoverPosition';
import { actualDateRange } from '../../lib/ganttDateUtils';
import type { TimelineDay } from '../../lib/ganttTimeline';

export interface GanttAlloc {
    id: string;
    startDate: string;
    endDate: string;
    qty?: number;
    actualQty?: number;
    actualStartDate?: string;
    actualEndDate?: string;
    colorway?: string;
    styleName?: string;
    poNumber?: string;
    styleRef?: string;
    status?: string;
    dailyTarget?: number;
    operationName?: string;
    operationNames?: string[];
    lineId?: string;
    fabricType?: string;
    actualOnly?: boolean;
}

interface GanttResourceRowsProps {
    deptName: string;
    showDept: boolean;
    resourceName: string;
    timelineData: TimelineDay[];
    allocations: GanttAlloc[];
    getPositionStyle: (start: string, end: string) => { left: string; width: string } | null;
    layout?: 'split' | 'wide';
    rowMode?: 'both' | 'planned' | 'running';
    /** Maximum total sub-row segments to allocate across planned + running. Extra bars are packed into the available rows. */
    maxStackRows?: number;
    onAllocHover?: (alloc: GanttAlloc, rect: DOMRect, mode: 'planned' | 'actual') => void;
    onAllocLeave?: () => void;
}

const labelClass = 'font-semibold text-[9px] text-slate-600';
const resourceNameClass = 'text-[10px] font-medium text-slate-600 truncate';
const wideResourceNameClass = 'text-[10px] font-semibold text-slate-700 truncate';

export const GANTT_WIDE_RESOURCE_CLASS = 'w-36';
export const GANTT_WIDE_TYPE_CLASS = 'w-24';
export const GANTT_WIDE_TYPE_STICKY = 'left-36';
/** Combined sticky width for wide layout (resource + type columns). */
export const GANTT_WIDE_STICKY_WIDTH = '15rem';

const SUB_ROW_HEIGHT = 34;
const BAR_HEIGHT = SUB_ROW_HEIGHT - 6;

function barColorClass(mode: 'planned' | 'actual'): string {
    if (mode === 'actual') return 'border-emerald-400 bg-emerald-100 text-emerald-900';
    return 'border-blue-400 bg-blue-100 text-blue-900';
}

function effectiveBarMode(alloc: GanttAlloc, mode: 'planned' | 'actual' | 'combined'): 'planned' | 'actual' {
    if (mode === 'combined') return alloc.actualOnly ? 'actual' : 'planned';
    return mode;
}

const GanttBarContent: React.FC<{ alloc: GanttAlloc; mode: 'planned' | 'actual' | 'combined' }> = ({ alloc, mode }) => {
    const effective = effectiveBarMode(alloc, mode);
    const qty = effective === 'actual' ? (alloc.actualQty || 0) : (alloc.qty || 0);
    const style = alloc.styleName?.trim() || 'Style';
    const ref = alloc.styleRef?.trim();
    const po = alloc.poNumber?.trim() || '—';
    const color = alloc.colorway?.trim() || '—';
    const op = (alloc.operationName || alloc.operationNames?.join(' + ') || '').trim();
    const fabric = (alloc.fabricType || '').trim();
    const line1 = ref ? `${style} · ${ref}` : style;
    const metaParts = [po, color, op, fabric].filter(Boolean);
    const line2 = `${metaParts.join(' · ')} · ${qty.toLocaleString()}`;

    return (
        <div className="flex flex-col justify-center leading-tight gap-px w-full min-w-0 overflow-hidden">
            <div className="text-[8px] font-bold truncate">{line1}</div>
            <div className="text-[7px] font-medium truncate opacity-90">{line2}</div>
        </div>
    );
};

const TimelineGrid: React.FC<{ timelineData: TimelineDay[] }> = ({ timelineData }) => (
    <div className="absolute inset-0 flex pointer-events-none">
        {timelineData.map((d, i) => (
            <div
                key={i}
                className={`flex-1 min-w-[48px] h-full border-r border-slate-50 ${d.isWeekend ? 'bg-red-50/10' : ''} ${d.iso === new Date().toISOString().split('T')[0] ? 'bg-blue-50/20' : ''}`}
            />
        ))}
    </div>
);

const AllocationBars: React.FC<{
    allocations: GanttAlloc[];
    mode: 'planned' | 'actual' | 'combined';
    segments?: number;
    getPositionStyle: GanttResourceRowsProps['getPositionStyle'];
    onAllocHover?: GanttResourceRowsProps['onAllocHover'];
    onAllocLeave?: GanttResourceRowsProps['onAllocLeave'];
}> = ({ allocations, mode, segments = 1, getPositionStyle, onAllocHover, onAllocLeave }) => {
    const positioned = allocations
        .map((alloc) => {
            const effective = effectiveBarMode(alloc, mode);
            if (mode === 'planned' && alloc.actualOnly) return null;
            if (mode === 'actual' && !(alloc.actualQty && alloc.actualQty > 0)) return null;
            if (effective === 'actual' && !(alloc.actualQty && alloc.actualQty > 0)) return null;
            const range =
                effective === 'actual'
                    ? actualDateRange(alloc) ?? null
                    : { start: alloc.startDate, end: alloc.endDate };
            if (!range) return null;
            const pos = getPositionStyle(range.start, range.end);
            if (!pos) return null;
            return { alloc, start: range.start, end: range.end, pos, effective };
        })
        .filter(Boolean) as { alloc: GanttAlloc; start: string; end: string; pos: { left: string; width: string }; effective: 'planned' | 'actual' }[];
    if (positioned.length === 0) return null;

    const segmentCount = Math.max(1, segments);
    const occupied: { start: string; end: string }[][] = Array.from({ length: segmentCount }, () => []);
    const ordered = [...positioned].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : 1));
    const assigned = ordered.map((item) => {
        let s = 0;
        for (; s < segmentCount; s++) {
            const overlaps = occupied[s].some((o) => item.start <= o.end && item.end >= o.start);
            if (!overlaps) break;
        }
        const segmentIndex = Math.min(s, segmentCount - 1);
        occupied[segmentIndex].push({ start: item.start, end: item.end });
        return segmentIndex;
    });

    return (
        <div className="absolute inset-0 py-0 px-0.5">
            {ordered.map((item, index) => {
                const cls = barColorClass(item.effective);
                const top = assigned[index] * SUB_ROW_HEIGHT + (SUB_ROW_HEIGHT - BAR_HEIGHT) / 2;
                return (
                    <div
                        key={`${item.alloc.id}-${item.effective}-${index}`}
                        style={{ ...item.pos, height: BAR_HEIGHT, top: `${top}px`, transform: 'none' }}
                        className={`absolute border rounded-md flex items-center px-1 overflow-hidden cursor-pointer hover:brightness-95 shadow-sm ${cls}`}
                        onMouseEnter={onAllocHover ? (e) => onAllocHover(item.alloc, e.currentTarget.getBoundingClientRect(), item.effective) : undefined}
                        onMouseLeave={onAllocLeave}
                    >
                        <GanttBarContent alloc={item.alloc} mode={mode} />
                    </div>
                );
            })}
        </div>
    );
};

const TOOLTIP_WIDTH = 256;
const TOOLTIP_HEIGHT_EST = 168;

export const GanttAllocTooltip: React.FC<{
    alloc: GanttAlloc;
    anchorRect: DOMRect;
    mode: 'planned' | 'actual';
}> = ({ alloc, anchorRect, mode }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const initialPos = useMemo(
        () => computePopoverPosition(anchorRect, TOOLTIP_WIDTH, TOOLTIP_HEIGHT_EST),
        [anchorRect],
    );

    useLayoutEffect(() => {
        if (!panelRef.current) return;
        const w = panelRef.current.offsetWidth;
        const h = panelRef.current.offsetHeight;
        const next = computePopoverPosition(anchorRect, w, h);
        panelRef.current.style.left = `${next.left}px`;
        panelRef.current.style.top = `${next.top}px`;
    }, [anchorRect, alloc.id, mode]);

    const actualRange = actualDateRange(alloc);
    const isPlanned = mode === 'planned';

    return (
        <div
            ref={panelRef}
            className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 p-4 w-64 pointer-events-none"
            style={{ left: initialPos.left, top: initialPos.top }}
        >
            <div className="text-xs font-bold text-slate-800 mb-2">{alloc.styleName}</div>
            <div className="space-y-1.5 text-[11px]">
                {(() => {
                    const ops = alloc.operationNames?.length
                        ? alloc.operationNames
                        : alloc.operationName
                            ? [alloc.operationName]
                            : [];
                    if (ops.length === 0) return null;
                    return (
                        <div className="flex justify-between gap-2">
                            <span className="text-slate-500 shrink-0">Operation{ops.length > 1 ? 's' : ''}</span>
                            <span className="font-semibold text-blue-700 text-right">{ops.join(' + ')}</span>
                        </div>
                    );
                })()}
                <div className="flex justify-between"><span className="text-slate-500">Ref</span><span className="font-medium text-slate-700">{alloc.styleRef || '—'}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">PO Number</span><span className="font-medium text-slate-700">{alloc.poNumber}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Colorway</span><span className="font-medium text-slate-700">{alloc.colorway}</span></div>
                {mode === 'actual' && alloc.fabricType && (
                    <div className="flex justify-between"><span className="text-slate-500">Fabric type</span><span className="font-semibold text-emerald-700">{alloc.fabricType}</span></div>
                )}
                {isPlanned ? (
                    <>
                        <div className="flex justify-between"><span className="text-slate-500">Planned Qty</span><span className="font-bold text-blue-700">{(alloc.qty || 0).toLocaleString()} pcs</span></div>
                        {alloc.dailyTarget != null && alloc.dailyTarget > 0 && (
                            <div className="flex justify-between"><span className="text-slate-500">Daily Target</span><span className="font-medium text-slate-700">{alloc.dailyTarget}/day</span></div>
                        )}
                        <div className="flex justify-between"><span className="text-slate-500">Planned Dates</span><span className="font-medium text-slate-700">{alloc.startDate} to {alloc.endDate}</span></div>
                    </>
                ) : (
                    <>
                        <div className="flex justify-between"><span className="text-slate-500">Actual Qty</span><span className="font-bold text-emerald-700">{(alloc.actualQty || 0).toLocaleString()} pcs</span></div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">Actual Dates</span>
                            <span className="font-medium text-slate-700">
                                {actualRange ? `${actualRange.start} to ${actualRange.end}` : '—'}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export const GanttResourceRows: React.FC<GanttResourceRowsProps> = ({
    deptName,
    showDept,
    resourceName,
    timelineData,
    allocations,
    getPositionStyle,
    layout = 'split',
    rowMode = 'both',
    maxStackRows,
    onAllocHover,
    onAllocLeave,
}) => {
    const showPlanned = rowMode === 'both' || rowMode === 'planned';
    const showRunning = rowMode === 'both' || rowMode === 'running';
    const singleRow = rowMode !== 'both';

    const plannedAllocations = allocations.filter((a) => !a.actualOnly);
    const actualAllocations = allocations.filter((a) => a.actualQty && a.actualQty > 0);

    let plannedMaxPerDay = 0;
    for (const day of timelineData) {
        const count = plannedAllocations.filter(
            (a) => a.startDate && a.endDate && day.iso >= a.startDate && day.iso <= a.endDate,
        ).length;
        if (count > plannedMaxPerDay) plannedMaxPerDay = count;
    }

    let actualMaxPerDay = 0;
    for (const day of timelineData) {
        const count = actualAllocations.filter((a) => {
            const range = actualDateRange(a);
            return range && day.iso >= range.start && day.iso <= range.end;
        }).length;
        if (count > actualMaxPerDay) actualMaxPerDay = count;
    }

    const rawCap = maxStackRows ?? Number.POSITIVE_INFINITY;
    const plannedSegments = showPlanned
        ? Math.max(1, Math.min(plannedMaxPerDay, rawCap))
        : 0;
    const actualSegments = showRunning
        ? Math.max(1, Math.min(actualMaxPerDay, rawCap))
        : 0;

    const plannedHeight = SUB_ROW_HEIGHT * plannedSegments;
    const runningHeight = SUB_ROW_HEIGHT * actualSegments;

    if (layout === 'wide') {
        return (
            <>
                {showPlanned && (
                    <div className="flex border-b border-slate-100" style={{ height: plannedHeight }}>
                        <div className={`${GANTT_WIDE_RESOURCE_CLASS} border-r border-slate-200 bg-white sticky left-0 z-10 flex items-center px-1.5 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)] flex-shrink-0`}>
                            <div className={wideResourceNameClass} title={resourceName}>{resourceName}</div>
                        </div>
                        <div className={`${GANTT_WIDE_TYPE_CLASS} border-r border-slate-200 bg-white sticky ${GANTT_WIDE_TYPE_STICKY} z-10 flex items-center px-1.5 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)] flex-shrink-0 ${labelClass}`}>
                            Planned
                        </div>
                        <div className="flex-1 relative min-w-0">
                            <TimelineGrid timelineData={timelineData} />
                            <AllocationBars allocations={allocations} mode="planned" segments={plannedSegments} getPositionStyle={getPositionStyle} onAllocHover={onAllocHover} onAllocLeave={onAllocLeave} />
                        </div>
                    </div>
                )}
                {showRunning && (
                    <div className={`flex border-b border-slate-200 ${singleRow ? 'border-slate-100' : ''}`} style={{ height: runningHeight }}>
                        <div className={`${GANTT_WIDE_RESOURCE_CLASS} border-r border-slate-200 bg-white sticky left-0 z-10 flex items-center px-1.5 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)] flex-shrink-0`}>
                            {singleRow ? (
                                <div className={wideResourceNameClass} title={resourceName}>{resourceName}</div>
                            ) : null}
                        </div>
                        <div className={`${GANTT_WIDE_TYPE_CLASS} border-r border-slate-200 bg-white sticky ${GANTT_WIDE_TYPE_STICKY} z-10 flex items-center px-1.5 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)] flex-shrink-0 ${labelClass}`}>
                            Running
                        </div>
                        <div className="flex-1 relative min-w-0">
                            <TimelineGrid timelineData={timelineData} />
                            <AllocationBars allocations={allocations} mode="actual" segments={actualSegments} getPositionStyle={getPositionStyle} onAllocHover={onAllocHover} onAllocLeave={onAllocLeave} />
                        </div>
                    </div>
                )}
            </>
        );
    }

    return (
        <>
            {showPlanned && (
                <div className="flex border-b border-slate-50" style={{ height: plannedHeight }}>
                    {showDept ? (
                        <div className={`w-36 border-r border-slate-200 px-2 bg-slate-50 sticky left-0 z-10 text-[9px] font-semibold text-slate-600 uppercase tracking-wide flex items-center truncate`} title={deptName}>{deptName}</div>
                    ) : (
                        <div className="w-36 border-r border-slate-200 bg-slate-50/50 sticky left-0 z-10" />
                    )}
                    <div className="w-32 border-r border-slate-200 px-2 bg-white sticky left-36 z-10 flex items-center">
                        <div className={resourceNameClass} title={resourceName}>{resourceName}</div>
                    </div>
                    <div className={`w-32 border-r border-slate-200 px-2 bg-white sticky left-[17rem] z-10 flex items-center ${labelClass}`}>
                        Planned
                    </div>
                    <div className="flex-1 relative min-w-0">
                        <TimelineGrid timelineData={timelineData} />
                        <AllocationBars allocations={allocations} mode="planned" segments={plannedSegments} getPositionStyle={getPositionStyle} onAllocHover={onAllocHover} onAllocLeave={onAllocLeave} />
                    </div>
                </div>
            )}
            {showRunning && (
                <div className="flex border-b border-slate-100" style={{ height: runningHeight }}>
                    <div className="w-36 border-r border-slate-200 bg-slate-50/50 sticky left-0 z-10" />
                    <div className="w-32 border-r border-slate-200 px-2 bg-white sticky left-36 z-10 flex items-center">
                        {singleRow ? (
                            <div className={resourceNameClass} title={resourceName}>{resourceName}</div>
                        ) : null}
                    </div>
                    <div className={`w-32 border-r border-slate-200 px-2 bg-white sticky left-[17rem] z-10 flex items-center ${labelClass}`}>
                        Running
                    </div>
                    <div className="flex-1 relative min-w-0">
                        <TimelineGrid timelineData={timelineData} />
                        <AllocationBars allocations={allocations} mode="actual" segments={actualSegments} getPositionStyle={getPositionStyle} onAllocHover={onAllocHover} onAllocLeave={onAllocLeave} />
                    </div>
                </div>
            )}
        </>
    );
};

export const GanttTimelineHeader: React.FC<{
    timelineData: TimelineDay[];
    layout?: 'split' | 'wide';
}> = ({ timelineData, layout = 'split' }) => (
    <div className="flex border-b border-slate-200 h-9 sticky top-0 z-20 bg-slate-50 min-w-max">
        {layout === 'wide' ? (
            <>
                <div className={`${GANTT_WIDE_RESOURCE_CLASS} border-r border-slate-200 px-1.5 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center flex-shrink-0 sticky top-0 left-0 z-30 bg-slate-50 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]`}>
                    Resource
                </div>
                <div className={`${GANTT_WIDE_TYPE_CLASS} border-r border-slate-200 px-1.5 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center flex-shrink-0 sticky top-0 ${GANTT_WIDE_TYPE_STICKY} z-30 bg-slate-50 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]`}>
                    Type
                </div>
            </>
        ) : (
            <>
                <div className="w-36 border-r border-slate-200 px-2 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-wider flex items-center flex-shrink-0 sticky top-0 left-0 z-30 bg-slate-50">Dept</div>
                <div className="w-32 border-r border-slate-200 px-2 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-wider flex items-center flex-shrink-0 sticky top-0 left-36 z-30 bg-slate-50">Resource</div>
                <div className="w-32 border-r border-slate-200 px-2 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-wider flex items-center flex-shrink-0 sticky top-0 left-[17rem] z-30 bg-slate-50">Type</div>
            </>
        )}
        <div className="flex-1 flex min-w-0 bg-slate-50">
            {timelineData.map((d, i) => (
                <div
                    key={i}
                    className={`flex-1 min-w-[48px] border-r border-slate-100 flex flex-col items-center justify-center bg-slate-50 ${d.isWeekend ? 'bg-red-50/30' : ''} ${d.iso === new Date().toISOString().split('T')[0] ? 'bg-blue-50/40' : ''}`}
                >
                    <span className={`text-[8px] ${d.isWeekend ? 'text-red-400' : 'text-slate-400'}`}>{d.weekday}</span>
                    <span className={`text-[10px] font-bold ${d.isWeekend ? 'text-red-600' : 'text-slate-600'}`}>{d.day}</span>
                </div>
            ))}
        </div>
    </div>
);

function dayIndexInTimeline(iso: string, timelineData: TimelineDay[]): number {
    const viewStart = timelineData[0]?.dateObj;
    if (!viewStart) return -1;
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round((new Date(iso).getTime() - viewStart.getTime()) / oneDay);
}

export const GanttTimelineMarkers: React.FC<{
    timelineData: TimelineDay[];
    deliveryDate?: string;
}> = ({ timelineData, deliveryDate }) => {
    const totalDays = timelineData.length;
    if (totalDays === 0) return null;

    const todayIso = new Date().toISOString().split('T')[0];
    const todayIdx = dayIndexInTimeline(todayIso, timelineData);
    const deliveryIdx = deliveryDate ? dayIndexInTimeline(deliveryDate, timelineData) : -1;

    const markerLeft = (idx: number) => `${((idx + 0.5) / totalDays) * 100}%`;

    return (
        <div
            className="absolute inset-0 pointer-events-none z-30"
            style={{ left: GANTT_WIDE_STICKY_WIDTH }}
        >
            {todayIdx >= 0 && todayIdx < totalDays && (
                <div
                    className="absolute top-0 bottom-0 w-0.5 bg-blue-500 opacity-70"
                    style={{ left: markerLeft(todayIdx) }}
                >
                    <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[7px] font-bold text-blue-600 bg-blue-50 rounded px-0.5 whitespace-nowrap">
                        Today
                    </div>
                </div>
            )}
            {deliveryIdx >= 0 && deliveryIdx < totalDays && (
                <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-70"
                    style={{ left: markerLeft(deliveryIdx) }}
                >
                    <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[7px] font-bold text-red-600 bg-red-50 rounded px-0.5 whitespace-nowrap">
                        Due
                    </div>
                </div>
            )}
        </div>
    );
};

export const GanttScheduleLegend: React.FC<{
    deliveryDate?: string;
    showDelivery?: boolean;
}> = ({ deliveryDate, showDelivery = true }) => (
    <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            Planned
        </div>
        <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Running
        </div>
        <div className="flex items-center gap-1">
            <div className="w-0.5 h-3 bg-blue-500 rounded-full" />
            Today
        </div>
        {showDelivery && (
            <div className="flex items-center gap-1">
                <div className="w-0.5 h-3 bg-red-500 rounded-full" />
                Delivery{deliveryDate ? ` (${deliveryDate})` : ''}
            </div>
        )}
    </div>
);

export const GanttScheduleViewBar: React.FC<{
    timelineRange: string;
    deliveryDate?: string;
    showDelivery?: boolean;
    className?: string;
    trailingAction?: React.ReactNode;
}> = ({ timelineRange, deliveryDate, showDelivery = true, className = '', trailingAction }) => (
    <div
        className={`px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg flex flex-wrap justify-between items-center gap-3 flex-shrink-0 ${className}`}
    >
        <h3 className="font-semibold text-slate-700 text-[11px] flex items-center gap-2 min-w-0">
            <Calendar size={14} className="text-slate-400 flex-shrink-0" />
            <span>Schedule View</span>
            <span className="font-normal text-slate-500">({timelineRange})</span>
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
            <GanttScheduleLegend deliveryDate={deliveryDate} showDelivery={showDelivery} />
            {trailingAction}
        </div>
    </div>
);

export const GanttDeptHeaderRow: React.FC<{ deptName: string }> = ({ deptName }) => (
    <div className="flex h-6 bg-slate-100 border-b border-slate-200 sticky left-0 z-10 w-full min-w-max">
        <div
            className={`sticky left-0 bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)] z-10 ${GANTT_WIDE_RESOURCE_CLASS} border-r border-slate-200 flex-shrink-0`}
        >
            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full flex-shrink-0" />
            <span className="truncate" title={deptName}>{deptName}</span>
        </div>
        <div className="flex-1 bg-slate-100" />
    </div>
);
