import React, { useMemo } from 'react';
import { Plus, Trash2, ChevronLeft, ChevronRight, Crosshair, AlertCircle } from 'lucide-react';
import { DepartmentGanttChart } from './DepartmentGanttChart';
import { Button } from '../../../components/ui';
import { SingleDatePicker } from '../../../components/SingleDatePicker';
import { sizeAdjQty } from '../../../lib/colorwaySizesUtils';
import type { PlanningRow } from '../types';
import type { LineAllocation } from '../../../types';
import { hourlyTargetFromDaily } from '../../../lib/shiftHours';
import { referenceSewingSam } from '../../../lib/orderPriority';
import type { ProcessFlowStep, DepartmentEntity } from '../../../types/settings';
import {
  isTablePlanStep,
  planningProfileForStep,
  profileUsesKpis,
  profileUsesPlannedQty,
  type PlanningStepProfile,
} from '../../../lib/planningStepProfile';
import { OPERATION_STEP_TYPE_LABELS } from '../../../lib/operationsDb';
import { isStoragePlanningDepartment } from '../../../lib/departmentFilters';
import { buildPlanningVisitGroups, rowsForVisit, type PlanningVisitGroup } from '../../../lib/visitPlanning';

export type { PlanningRow };

const DATA_COL_COUNT = 12;

/** Column width budget — primary inputs get more space; KPI columns stay compact. */
const PLANNING_COL_WIDTHS = [
    '11%',
    '12%',
    '10%',
    '11%',
    '11%',
    '5%',
    '5%',
    '7%',
    '6%',
    '5%',
    '5%',
    '5%',
    '3%',
] as const;

const ROW_H = 'h-11';

function mapPlanningRowsToTimelineAllocations(
    rows: PlanningRow[],
    colorway: { id: string; name: string },
    order: { id: string; styleName?: string; poNumber?: string },
    flowSteps: ProcessFlowStep[],
    assignedResources: Array<{ id: string; departmentId?: string }>,
): LineAllocation[] {
    return rows
        .filter((row) => row.resourceId && row.startDate && row.endDate && row.plannedQty > 0)
        .map((row) => {
            return {
                id: row.id,
                lineId: row.resourceId!,
                orderId: order.id,
                colorwayId: colorway.id,
                operationId: row.operationId,
                visitId: row.visitId,
                startDate: row.startDate!,
                endDate: row.endDate!,
                qty: row.plannedQty,
                dailyTarget: row.dailyTarget,
                learningCurve: null,
                completed_is_true: false,
                styleName: order.styleName || '',
                colorway: colorway.name,
                departmentId: assignedResources.find((r) => r.id === row.resourceId)?.departmentId,
                poNumber: order.poNumber || '',
                status: 'pending',
                progress: 0,
                plannedMetrics: { workers: 0, hours: 0, efficiency: 0 },
            } as LineAllocation;
        });
}

interface RowFieldErrors {
    resource?: string;
    plannedQty?: string;
    startDate?: string;
    endDate?: string;
    workforce?: string;
    sam?: string;
    overplanned?: string;
}

interface PlanningTableProps {
    flowSteps: any[];
    departments?: DepartmentEntity[];
    assignedResources: any[];
    selectedColorData: any;
    selectedOrder: any;
    planningRows: PlanningRow[];
    onRowsChange: (rows: PlanningRow[]) => void;
    allAllocations?: any[];
    timelineData?: any[];
    cellWidth?: number;
    deliveryDate?: string;
    deliveryDates?: string[];
    viewStartDate?: string;
    onPrev?: () => void;
    onNext?: () => void;
    onViewStartDateChange?: (date: string) => void;
    onBarClick?: (alloc: any) => void;
    onBarDragStart?: (alloc: any, edge: 'left' | 'right' | 'center') => void;
    onBarHover?: (allocation: any | null, anchorRect?: DOMRect) => void;
    onTimelineClick?: (resourceId: string, date: string) => void;
    dailyShiftHours?: number;
    /** Unsaved planning rows per colorway — timeline shows all dirty colorways on the order */
    planningBuffer?: Record<string, PlanningRow[]>;
    dirtyColorIds?: Set<string>;
    /** All orders — bar labels for other styles on the timeline */
    orders?: Array<{ id: string; styleName?: string; colorways?: Array<{ id: string; name: string }> }>;
}

const thCls =
    'px-2 py-2.5 text-[10px] font-semibold text-slate-600 uppercase border border-slate-200 bg-slate-50 whitespace-nowrap';
const thPrimaryCls = `${thCls} text-slate-700`;
const thKpiCls = `${thCls} text-slate-500 font-medium`;
const thKpiCalcCls = `${thCls} text-blue-700 font-semibold bg-blue-50/80`;

const cellInputBase =
    `w-full ${ROW_H} min-h-[2.75rem] px-2 text-[11px] bg-transparent border-0 rounded-none outline-none tabular-nums ` +
    'focus:bg-blue-50/50 focus:ring-1 focus:ring-inset focus:ring-blue-400 transition-colors placeholder:text-slate-300';
const cellInputError = 'bg-red-50/70 focus:ring-red-400';
const cellInputCenter = `${cellInputBase} text-center`;
const cellSelectCls =
    `w-full ${ROW_H} min-h-[2.75rem] px-2 pr-7 text-[11px] bg-transparent border-0 rounded-none outline-none ` +
    'focus:bg-blue-50/50 focus:ring-1 focus:ring-inset focus:ring-blue-400 transition-colors appearance-none ' +
    "bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2394a3b8%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] " +
    'bg-[length:8px] bg-no-repeat bg-[right_0.5rem_center]';
const kpiCellCls =
    `px-2 ${ROW_H} text-center text-[10px] font-medium tabular-nums text-slate-600 border border-slate-200 align-middle`;
const kpiCalcCellCls =
    `px-2 ${ROW_H} text-center text-[10px] font-semibold tabular-nums text-blue-800 bg-blue-50/70 border border-blue-100 align-middle`;
const dataCellCls = `p-0 border border-slate-200 align-middle ${ROW_H}`;
const deptCellCls =
    'px-3 py-2.5 text-[11px] font-semibold text-slate-700 border border-slate-200 bg-slate-50/80 align-top min-w-[7rem]';

function calculateWorkingDays(startDate: string, endDate: string): number {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    let workingDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0) workingDays++;
    }
    return workingDays;
}

function calculateDailyTarget(qty: number, startDate: string, endDate: string): number {
    const workingDays = calculateWorkingDays(startDate, endDate);
    return workingDays > 0 ? Math.ceil(qty / workingDays) : 0;
}

function rowWorkforce(row: PlanningRow, resource: { avgWF?: number } | undefined): number {
    return row.workforce ?? resource?.avgWF ?? 1;
}

function rowSam(row: PlanningRow, selectedOrder: { sewingSam?: number; sam?: number } | null): number {
    return row.sam ?? referenceSewingSam(selectedOrder) ?? 15;
}

function rowKpis(
    row: PlanningRow,
    resource: { avgWF?: number } | undefined,
    selectedOrder: PlanningTableProps['selectedOrder'],
    dailyShiftHours: number,
) {
    const wf = rowWorkforce(row, resource);
    const sam = rowSam(row, selectedOrder);
    const workingDays = calculateWorkingDays(row.startDate, row.endDate);
    const totalMins = wf * dailyShiftHours * workingDays * 60;
    const efficiency =
        totalMins > 0 && row.plannedQty > 0 ? ((row.plannedQty * sam) / totalMins) * 100 : 0;
    const productivityDay = wf > 0 && workingDays > 0 ? row.plannedQty / (wf * workingDays) : 0;
    const productivityHour = dailyShiftHours > 0 ? productivityDay / dailyShiftHours : 0;
    return { wf, sam, workingDays, efficiency, productivityDay, productivityHour };
}

function getRowFieldErrors(
    row: PlanningRow,
    maxAllowed: number,
    kpis: ReturnType<typeof rowKpis>,
    profile: PlanningStepProfile,
): RowFieldErrors {
    const errors: RowFieldErrors = {};
    if (profile === 'window') {
        const hasDates = Boolean(row.startDate) || Boolean(row.endDate);
        const hasPlanning = row.plannedQty > 0 || hasDates;
        if (hasPlanning && !row.resourceId) errors.resource = 'Select a resource';
        if (row.resourceId && row.plannedQty <= 0) errors.plannedQty = 'Enter quantity';
        if (row.plannedQty > maxAllowed) errors.plannedQty = `Max ${maxAllowed.toLocaleString()} for this row`;
        if (hasDates && !row.startDate) errors.startDate = 'Required';
        if (hasDates && !row.endDate) errors.endDate = 'Required';
        if (row.startDate && row.endDate && new Date(row.endDate) < new Date(row.startDate)) {
            errors.endDate = 'End must be on or after start';
        }
        return errors;
    }

    if (profile === 'loading') {
        const hasPlanning = row.plannedQty > 0 || Boolean(row.startDate) || Boolean(row.endDate);
        if (!row.resourceId && hasPlanning) errors.resource = 'Select a resource';
        if (row.resourceId && row.plannedQty <= 0) errors.plannedQty = 'Enter quantity';
        if (row.plannedQty > maxAllowed) errors.plannedQty = `Max ${maxAllowed.toLocaleString()} for this row`;
        if (row.plannedQty > 0 && !row.startDate) errors.startDate = 'Required';
        if (row.plannedQty > 0 && !row.endDate) errors.endDate = 'Required';
        if (row.startDate && row.endDate && new Date(row.endDate) < new Date(row.startDate)) {
            errors.endDate = 'End must be on or after start';
        }
        return errors;
    }

    const hasPlanning = row.plannedQty > 0 || Boolean(row.startDate) || Boolean(row.endDate);

    if (!row.resourceId && hasPlanning) {
        errors.resource = 'Select a resource';
    }
    if (row.resourceId && row.plannedQty <= 0) {
        errors.plannedQty = 'Enter quantity';
    }
    if (row.plannedQty > maxAllowed) {
        errors.plannedQty = `Max ${maxAllowed.toLocaleString()} for this row`;
    }
    if (row.plannedQty > 0 && !row.startDate) {
        errors.startDate = 'Required';
    }
    if (row.plannedQty > 0 && !row.endDate) {
        errors.endDate = 'Required';
    }
    if (row.startDate && row.endDate && new Date(row.endDate) < new Date(row.startDate)) {
        errors.endDate = 'End must be on or after start';
    }
    if (kpis.wf < 1) {
        errors.workforce = 'Min 1';
    }
    if (kpis.sam <= 0) {
        errors.sam = 'SAM required';
    }
    if (kpis.efficiency > 95 && row.plannedQty > 0 && row.startDate && row.endDate) {
        errors.overplanned = `Efficiency ${kpis.efficiency.toFixed(0)}% — may be overplanned`;
    }
    return errors;
}

function stepTypeBracket(stepType?: string): string {
    const key = (stepType || 'produce') as keyof typeof OPERATION_STEP_TYPE_LABELS;
    return (OPERATION_STEP_TYPE_LABELS[key] || stepType || 'produce').toUpperCase();
}

function VisitDeptCell({
    visit,
    remaining,
    maxQty,
}: {
    visit: PlanningVisitGroup;
    remaining: number;
    maxQty: number;
}) {
    return (
        <>
            <div className="font-semibold text-slate-800">{visit.deptName}</div>
            <div className="text-[10px] font-normal text-slate-500 mt-1 space-y-0.5">
                {visit.steps.map((s) => (
                    <div key={s.id || `${s.operation_name || s.step_label}-${s.flow_step}`}>
                        {s.operation_name || s.step_label || s.dept_name}
                        <span className="text-slate-400"> ({stepTypeBracket(s.step_type)})</span>
                    </div>
                ))}
            </div>
            <div className="text-[10px] font-normal text-slate-500 mt-2 space-y-0.5 border-t border-slate-100 pt-1.5">
                <div>
                    Max{' '}
                    <span className="text-blue-600 font-semibold tabular-nums">
                        {maxQty.toLocaleString()}
                    </span>
                </div>
                <div>
                    Rem{' '}
                    <span className="text-emerald-600 font-semibold tabular-nums">
                        {remaining.toLocaleString()}
                    </span>
                </div>
            </div>
        </>
    );
}

export const PlanningTable: React.FC<PlanningTableProps> = ({
    flowSteps,
    departments = [],
    assignedResources,
    selectedColorData,
    selectedOrder,
    planningRows,
    onRowsChange,
    allAllocations = [],
    timelineData = [],
    cellWidth = 32,
    deliveryDate,
    deliveryDates,
    viewStartDate,
    onPrev,
    onNext,
    onViewStartDateChange,
    onBarClick = () => {},
    onBarDragStart = () => {},
    onBarHover,
    onTimelineClick,
    dailyShiftHours: dailyShiftHoursProp,
    planningBuffer = {},
    dirtyColorIds = new Set<string>(),
    orders = [],
}) => {
    const baseSam = referenceSewingSam(selectedOrder) || 15;
    const dailyShiftHours = dailyShiftHoursProp ?? 8;

    const deptById = useMemo(
        () => new Map(departments.map((d) => [d.id, d])),
        [departments],
    );

    const planningVisits = useMemo(() => {
        return buildPlanningVisitGroups(flowSteps as ProcessFlowStep[], deptById).filter(
            (v) => isTablePlanStep(v.profile),
        );
    }, [flowSteps, deptById]);

    const timelineFlowSteps = useMemo(() => {
        return (flowSteps as ProcessFlowStep[]).filter((step) => {
            const dept = step.dept_id ? deptById.get(step.dept_id) : undefined;
            if (isStoragePlanningDepartment(dept)) return false;
            return planningProfileForStep(step, dept) !== 'terminal';
        });
    }, [flowSteps, deptById]);

    const workingDayBefore = (iso: string): string => {
        const d = new Date(iso);
        d.setDate(d.getDate() - 1);
        while (d.getDay() === 0) d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    };

    const planningAllocations = useMemo(() => {
        if (!selectedColorData || !selectedOrder) return [];
        return mapPlanningRowsToTimelineAllocations(
            planningRows,
            selectedColorData,
            selectedOrder,
            flowSteps as ProcessFlowStep[],
            assignedResources,
        );
    }, [planningRows, selectedColorData, selectedOrder, assignedResources, flowSteps]);

    const orderColorPlanningOverlays = useMemo(() => {
        if (!selectedOrder?.colorways?.length) return [];
        const mergedBuffer = {
            ...planningBuffer,
            ...(selectedColorData ? { [selectedColorData.id]: planningRows } : {}),
        };
        const overlays: LineAllocation[] = [];
        for (const cw of selectedOrder.colorways) {
            if (!dirtyColorIds.has(cw.id)) continue;
            const rows = mergedBuffer[cw.id];
            if (!rows?.length) continue;
            overlays.push(
                ...mapPlanningRowsToTimelineAllocations(
                    rows,
                    cw,
                    selectedOrder,
                    flowSteps as ProcessFlowStep[],
                    assignedResources,
                ),
            );
        }
        return overlays;
    }, [
        selectedOrder,
        selectedColorData,
        planningRows,
        planningBuffer,
        dirtyColorIds,
        flowSteps,
        assignedResources,
    ]);

    const combinedAllocations = useMemo(() => {
        const orderId = selectedOrder?.id;
        const dirtyOnOrder = new Set(
            selectedOrder?.colorways
                ?.filter((cw) => dirtyColorIds.has(cw.id))
                .map((cw) => cw.id) ?? [],
        );

        // Timeline: all factory allocations; replace saved rows for dirty colorways on this order
        const saved = allAllocations.filter((a: LineAllocation) => {
            if (!orderId || a.orderId !== orderId) return true;
            if (a.colorwayId && dirtyOnOrder.has(a.colorwayId)) return false;
            return true;
        });

        const overlays =
            orderColorPlanningOverlays.length > 0
                ? orderColorPlanningOverlays
                : planningAllocations;

        const savedIds = new Set(saved.map((a) => a.id).filter(Boolean));
        const uniqueOverlays = overlays.filter(
            (p) => !p.id || p.id.startsWith('temp-') || !savedIds.has(p.id),
        );

        return [...saved, ...uniqueOverlays];
    }, [
        allAllocations,
        planningAllocations,
        orderColorPlanningOverlays,
        selectedOrder?.id,
        selectedOrder?.colorways,
        dirtyColorIds,
    ]);

    const totalAdjQty = useMemo(() => {
        if (!selectedColorData?.sizes) return 0;
        return selectedColorData.sizes.reduce((sum: number, s: any) => sum + sizeAdjQty(s), 0);
    }, [selectedColorData]);

    const opLabel = (step: ProcessFlowStep) => step.operation_name || step.dept_name || '';

    const getVisitMaxQty = (visitIndex: number): number => {
        if (visitIndex <= 0) return totalAdjQty;
        const prevVisit = planningVisits[visitIndex - 1];
        const prevTotal = rowsForVisit(planningRows, prevVisit).reduce(
            (sum, r) => sum + (r.plannedQty || 0),
            0,
        );
        return Math.min(prevTotal, totalAdjQty);
    };

    const getVisitRemainingQty = (visit: PlanningVisitGroup, visitIndex: number): number => {
        const maxQty = getVisitMaxQty(visitIndex);
        const planned = rowsForVisit(planningRows, visit).reduce(
            (sum, r) => sum + (r.plannedQty || 0),
            0,
        );
        return Math.max(0, maxQty - planned);
    };

    const getOpResources = (step: ProcessFlowStep) => {
        const deptId = step.dept_id;
        const deptName = step.dept_name;
        return assignedResources.filter(
            (r) => r.departmentId === deptId || r.departmentName === deptName,
        );
    };

    const addRow = (visit: PlanningVisitGroup) => {
        const planStep = visit.planRouteStep;
        const loadingStep = visit.loadingStep;
        const newRow: PlanningRow = {
            id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            department: visit.label,
            visitId: visit.visitId,
            operationId: planStep.id,
            loadingRouteId: loadingStep?.id,
            flowStep: planStep.flow_step,
            resourceId: '',
            resourceName: '',
            plannedQty: 0,
            startDate: '',
            endDate: '',
            dailyTarget: 0,
            dailyTargetOverridden: false,
            sam: baseSam,
        };
        onRowsChange([...planningRows, newRow]);
    };

    const autoFillMax = (id: string, visit: PlanningVisitGroup, visitIndex: number) => {
        updateRow(id, { plannedQty: getVisitRemainingQty(visit, visitIndex) });
    };

    const updateRow = (id: string, updates: Partial<PlanningRow>) => {
        const updated = planningRows.map((row) => {
            if (row.id !== id) return row;

            const newRow = { ...row, ...updates };

            if (updates.plannedQty !== undefined) {
                const visitIdx = planningVisits.findIndex((v) => rowsForVisit([row], v).length > 0);
                const otherRowsQty = planningRows
                    .filter(
                        (r) =>
                            r.id !== id &&
                            (r.visitId === row.visitId || r.department === row.department),
                    )
                    .reduce((sum, r) => sum + (r.plannedQty || 0), 0);
                const maxAllowed =
                    (visitIdx >= 0 ? getVisitMaxQty(visitIdx) : totalAdjQty) - otherRowsQty;
                newRow.plannedQty = Math.min(updates.plannedQty, maxAllowed);
            }

            if (updates.endDate && newRow.startDate) {
                if (new Date(updates.endDate) < new Date(newRow.startDate)) return row;
            }
            if (updates.startDate && newRow.endDate) {
                if (new Date(newRow.endDate) < new Date(updates.startDate)) {
                    newRow.endDate = updates.startDate;
                }
            }

            if (updates.resourceId !== undefined) {
                const step = flowSteps.find(
                    (s) =>
                        (s as ProcessFlowStep).id === row.operationId ||
                        opLabel(s as ProcessFlowStep) === row.department,
                ) as ProcessFlowStep | undefined;
                const resources = step ? getOpResources(step) : [];
                const resource = resources.find((r: { id: string }) => r.id === updates.resourceId);
                if (resource && newRow.workforce == null) {
                    newRow.workforce = resource.avgWF ?? undefined;
                }
            }

            if (updates.dailyTarget !== undefined) {
                newRow.dailyTargetOverridden = true;
            } else if (
                !newRow.dailyTargetOverridden &&
                (updates.plannedQty !== undefined ||
                    updates.startDate !== undefined ||
                    updates.endDate !== undefined)
            ) {
                newRow.dailyTarget = calculateDailyTarget(
                    newRow.plannedQty,
                    newRow.startDate,
                    newRow.endDate,
                );
            }

            return newRow;
        });
        onRowsChange(updated);
    };

    const deleteRow = (id: string) => {
        onRowsChange(planningRows.filter((row) => row.id !== id));
    };

    // Effective delivery date: color-specific shipment dates, then order-level plan, then legacy deliveryDate
    const effectiveDeliveryDate = (deliveryDates && deliveryDates.length > 0)
        ? deliveryDates.slice().sort()[0]
        : (selectedOrder?.deliveryDate ?? '');

    const runAutoSchedule = () => {
        if (!selectedColorData || !effectiveDeliveryDate) return;

        const deliveryDateStr = effectiveDeliveryDate;
        const totalQty = selectedColorData.sizes.reduce(
            (sum: number, s: any) => sum + sizeAdjQty(s),
            0,
        );

        const newRows: PlanningRow[] = [];
        let currentEndDate = workingDayBefore(deliveryDateStr);

        const schedulableVisits = planningVisits.filter(
            (v) => v.profile === 'produce' || v.profile === 'window' || v.profile === 'loading',
        );

        const subtractWorkingDays = (endIso: string, count: number): string => {
            const d = new Date(endIso);
            let remaining = Math.max(1, count);
            while (remaining > 0) {
                d.setDate(d.getDate() - 1);
                if (d.getDay() !== 0) remaining--;
            }
            return d.toISOString().split('T')[0];
        };

        for (const visit of [...schedulableVisits].reverse()) {
            const planStep = visit.planRouteStep;
            const deptResources = getOpResources(planStep);
            if (deptResources.length === 0) continue;

            const resource = deptResources[0];
            const visitIndex = planningVisits.findIndex((v) => v.visitId === visit.visitId);
            const mergedForCap = [
                ...planningRows.filter(
                    (r) => !newRows.some((nr) => nr.visitId && nr.visitId === r.visitId),
                ),
                ...newRows,
            ];
            let visitQty = totalQty;
            if (visitIndex > 0) {
                const prevVisit = planningVisits[visitIndex - 1];
                const prevTotal = rowsForVisit(mergedForCap, prevVisit).reduce(
                    (sum, r) => sum + (r.plannedQty || 0),
                    0,
                );
                visitQty = Math.min(visitQty, prevTotal > 0 ? prevTotal : totalQty);
            }
            for (let j = visitIndex + 1; j < planningVisits.length; j++) {
                const downstream = planningVisits[j];
                const downTotal = rowsForVisit(newRows, downstream).reduce(
                    (sum, r) => sum + (r.plannedQty || 0),
                    0,
                );
                if (downTotal > 0) visitQty = Math.min(visitQty, downTotal);
            }
            if (visitQty <= 0) continue;

            let endDate = currentEndDate;
            if (endDate > deliveryDateStr) endDate = workingDayBefore(deliveryDateStr);

            if (visit.profile === 'window' || visit.profile === 'loading') {
                const windowDays = visit.profile === 'loading' ? 1 : 3;
                const startDate = subtractWorkingDays(endDate, windowDays);
                newRows.push({
                    id: `temp-${Date.now()}-${visit.label}`,
                    department: visit.label,
                    visitId: visit.visitId,
                    operationId: planStep.id,
                    loadingRouteId: visit.loadingStep?.id,
                    flowStep: planStep.flow_step,
                    resourceId: resource.id,
                    resourceName: resource.resourceName,
                    plannedQty: visitQty,
                    startDate,
                    endDate,
                    dailyTarget: 0,
                    dailyTargetOverridden: false,
                });
                currentEndDate = workingDayBefore(startDate);
                continue;
            }

            const avgWF = resource.avgWF || 10;
            const rowSam = referenceSewingSam(selectedOrder) || 15;
            const dailyCapacity = Math.max(1, Math.floor((avgWF * 480) / rowSam));
            const daysNeeded = Math.ceil(visitQty / dailyCapacity);

            const startDate = subtractWorkingDays(endDate, daysNeeded);
            const actualWorkingDays = Math.max(calculateWorkingDays(startDate, endDate), 1);
            const dailyTarget = Math.min(Math.ceil(visitQty / actualWorkingDays), visitQty);

            newRows.push({
                id: `temp-${Date.now()}-${visit.label}`,
                department: visit.label,
                visitId: visit.visitId,
                operationId: planStep.id,
                loadingRouteId: visit.loadingStep?.id,
                flowStep: planStep.flow_step,
                resourceId: resource.id,
                resourceName: resource.resourceName,
                plannedQty: visitQty,
                startDate,
                endDate,
                dailyTarget,
                dailyTargetOverridden: false,
                workforce: avgWF,
                sam: rowSam,
            });

            currentEndDate = workingDayBefore(startDate);
        }

        const scheduledVisitIds = new Set(
            newRows.map((r) => r.visitId).filter((id): id is string => Boolean(id)),
        );
        const preserved = planningRows.filter((r) => !r.visitId || !scheduledVisitIds.has(r.visitId));
        onRowsChange([...preserved, ...[...newRows].reverse()]);
    };

    return (
        <>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
                <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center gap-4">
                    <div>
                        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                            Departmental Planning
                        </h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            Allocate resources, quantities, and dates for each department in the process flow
                        </p>
                    </div>
                    <Button
                        size="sm"
                        onClick={runAutoSchedule}
                        disabled={!effectiveDeliveryDate}
                        title={
                            effectiveDeliveryDate
                                ? `Back-schedule from ${effectiveDeliveryDate} using reference SAM and workforce`
                                : 'Add a shipment date to use auto schedule'
                        }
                    >
                        Auto Schedule
                    </Button>
                </div>

                <div className="overflow-x-auto no-scrollbar">
                    <table className="w-full border-collapse table-fixed min-w-[60rem]">
                        <colgroup>
                            {PLANNING_COL_WIDTHS.map((width, i) => (
                                <col key={i} style={{ width }} />
                            ))}
                        </colgroup>
                        <thead>
                            <tr>
                                <th className={`${thCls} text-left`}>Department</th>
                                <th className={`${thPrimaryCls} text-left`}>Resource</th>
                                <th className={`${thPrimaryCls} text-center`}>Planned Qty</th>
                                <th className={`${thPrimaryCls} text-center`}>Start</th>
                                <th className={`${thPrimaryCls} text-center`}>End</th>
                                <th className={`${thKpiCls} text-center`}>WF</th>
                                <th className={`${thPrimaryCls} text-center`}>SAM</th>
                                <th className={`${thKpiCls} text-center`}>Daily Tgt</th>
                                <th className={`${thKpiCalcCls} text-center`}>Hrly Tgt</th>
                                <th className={`${thKpiCalcCls} text-center`}>Eff %</th>
                                <th className={`${thKpiCalcCls} text-center`}>Prod/D</th>
                                <th className={`${thKpiCalcCls} text-center`}>Prod/H</th>
                                <th className={`${thKpiCls} text-center`} aria-label="Actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {planningVisits.map((visit, visitIdx) => {
                                const op = visit.planRouteStep;
                                const profile = visit.profile;
                                const usesKpis = visit.usesKpis;
                                const usesQty = visit.usesQty;
                                const rows = rowsForVisit(planningRows, visit);
                                const resources = getOpResources(op);
                                const remaining = getVisitRemainingQty(visit, visitIdx);
                                const resourceOptions = [
                                    { value: '', label: 'Select resource' },
                                    ...resources.map((r: any) => ({
                                        value: r.id,
                                        label: r.resourceName,
                                    })),
                                ];

                                const rowMax = getVisitMaxQty(visitIdx);

                                if (rows.length === 0) {
                                    return (
                                        <tr key={visit.visitId || op.id} className="bg-slate-50/30">
                                            <td className={deptCellCls}>
                                                <VisitDeptCell
                                                    visit={visit}
                                                    remaining={remaining}
                                                    maxQty={rowMax}
                                                />
                                            </td>
                                            <td colSpan={DATA_COL_COUNT} className="px-3 py-2 border border-slate-200">
                                                <button
                                                    type="button"
                                                    onClick={() => addRow(visit)}
                                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                                                >
                                                    <Plus size={12} />
                                                    Add planning row
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                }

                                const deptRowSpan = rows.length + 1;

                                return (
                                    <React.Fragment key={visit.visitId || op.id}>
                                        {rows.map((row, rowIdx) => {
                                            const resource = resources.find((r: any) => r.id === row.resourceId);
                                            const kpis = rowKpis(row, resource, selectedOrder, dailyShiftHours);
                                            const fieldErrors = getRowFieldErrors(row, rowMax, kpis, profile);
                                            const hourlyTarget =
                                                row.dailyTarget > 0
                                                    ? hourlyTargetFromDaily(row.dailyTarget, dailyShiftHours)
                                                    : 0;

                                            return (
                                                <tr key={row.id} className="group hover:bg-slate-50/40">
                                                    {rowIdx === 0 && (
                                                        <td className={deptCellCls} rowSpan={deptRowSpan}>
                                                            <VisitDeptCell
                                                                visit={visit}
                                                                remaining={remaining}
                                                                maxQty={rowMax}
                                                            />
                                                        </td>
                                                    )}
                                        <td className={dataCellCls}>
                                            <select
                                                value={row.resourceId}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    const res = resources.find((r: any) => r.id === v);
                                                    updateRow(row.id, {
                                                        resourceId: v,
                                                        resourceName: res?.resourceName || '',
                                                    });
                                                }}
                                                className={`${cellSelectCls} ${
                                                    fieldErrors.resource ? cellInputError : ''
                                                } ${!row.resourceId ? 'text-slate-400' : 'text-slate-800'}`}
                                                title={fieldErrors.resource}
                                                aria-invalid={Boolean(fieldErrors.resource)}
                                            >
                                                {resourceOptions.map((opt) => (
                                                    <option key={opt.value || '__empty__'} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className={`${dataCellCls} relative`}>
                                            {!usesQty ? (
                                                <span className={`block px-2 text-center text-[10px] text-slate-400 ${ROW_H}`}>—</span>
                                            ) : (
                                                <>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={row.plannedQty || ''}
                                                        onChange={(e) =>
                                                            updateRow(row.id, {
                                                                plannedQty: parseInt(e.target.value, 10) || 0,
                                                            })
                                                        }
                                                        max={rowMax}
                                                        className={`${cellInputCenter} font-medium text-slate-800 pr-8 ${
                                                            fieldErrors.plannedQty ? cellInputError : ''
                                                        }`}
                                                        placeholder="0"
                                                        title={fieldErrors.plannedQty}
                                                        aria-invalid={Boolean(fieldErrors.plannedQty)}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => autoFillMax(row.id, visit, visitIdx)}
                                                        className="absolute right-0 top-0 bottom-0 w-7 text-[9px] font-bold text-blue-600 bg-blue-50/80 hover:bg-blue-100 border-l border-slate-200 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                                        title="Fill remaining quantity"
                                                    >
                                                        MX
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                        <td className={dataCellCls}>
                                            <input
                                                type="date"
                                                value={row.startDate}
                                                onChange={(e) => updateRow(row.id, { startDate: e.target.value })}
                                                className={`${cellInputBase} text-center ${
                                                    fieldErrors.startDate ? cellInputError : ''
                                                }`}
                                                title={fieldErrors.startDate}
                                                aria-invalid={Boolean(fieldErrors.startDate)}
                                            />
                                        </td>
                                        <td className={dataCellCls}>
                                            <input
                                                type="date"
                                                value={row.endDate}
                                                min={row.startDate || undefined}
                                                onChange={(e) => updateRow(row.id, { endDate: e.target.value })}
                                                className={`${cellInputBase} text-center ${
                                                    fieldErrors.endDate ? cellInputError : ''
                                                }`}
                                                title={fieldErrors.endDate}
                                                aria-invalid={Boolean(fieldErrors.endDate)}
                                            />
                                        </td>
                                        <td className={dataCellCls}>
                                            {!usesKpis ? (
                                                <span className={`block px-2 text-center text-[10px] text-slate-400 ${ROW_H}`}>—</span>
                                            ) : (
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={kpis.wf}
                                                    onChange={(e) =>
                                                        updateRow(row.id, {
                                                            workforce: parseInt(e.target.value, 10) || 1,
                                                        })
                                                    }
                                                    className={`${cellInputCenter} ${
                                                        fieldErrors.workforce ? cellInputError : ''
                                                    }`}
                                                    title={fieldErrors.workforce || 'Workforce'}
                                                    aria-invalid={Boolean(fieldErrors.workforce)}
                                                />
                                            )}
                                        </td>
                                        <td className={dataCellCls}>
                                            {!usesKpis ? (
                                                <span className={`block px-2 text-center text-[10px] text-slate-400 ${ROW_H}`}>—</span>
                                            ) : (
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step={0.1}
                                                    value={kpis.sam}
                                                    onChange={(e) =>
                                                        updateRow(row.id, {
                                                            sam: parseFloat(e.target.value) || 0,
                                                        })
                                                    }
                                                    className={`${cellInputCenter} ${
                                                        fieldErrors.sam ? cellInputError : ''
                                                    }`}
                                                    title={fieldErrors.sam || 'SAM (minutes)'}
                                                    aria-invalid={Boolean(fieldErrors.sam)}
                                                />
                                            )}
                                        </td>
                                        <td className={dataCellCls}>
                                            {!usesKpis ? (
                                                <span className={`block px-2 text-center text-[10px] text-slate-400 ${ROW_H}`}>—</span>
                                            ) : (
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={row.dailyTarget || ''}
                                                    onChange={(e) =>
                                                        updateRow(row.id, {
                                                            dailyTarget: parseInt(e.target.value, 10) || 0,
                                                        })
                                                    }
                                                    className={`${cellInputCenter} font-semibold ${
                                                        row.dailyTargetOverridden
                                                            ? 'text-slate-900'
                                                            : 'text-blue-600'
                                                    }`}
                                                    title={
                                                        row.dailyTargetOverridden
                                                            ? 'Manual override'
                                                            : 'Auto from qty ÷ working days'
                                                    }
                                                />
                                            )}
                                        </td>
                                        <td className={kpiCalcCellCls}>
                                            {!usesKpis ? '—' : hourlyTarget > 0
                                                ? hourlyTarget.toLocaleString(undefined, { maximumFractionDigits: 1 })
                                                : '—'}
                                        </td>
                                        <td
                                            className={`${kpiCalcCellCls} ${
                                                !usesKpis && fieldErrors.overplanned
                                                    ? 'text-amber-800 bg-amber-50/80'
                                                    : ''
                                            }`}
                                            title={fieldErrors.overplanned}
                                        >
                                            {!usesKpis ? '—' : (
                                                <span className="inline-flex items-center justify-center gap-0.5">
                                                    {fieldErrors.overplanned && (
                                                        <AlertCircle size={11} className="shrink-0" />
                                                    )}
                                                    {kpis.efficiency > 0 ? `${kpis.efficiency.toFixed(1)}%` : '—'}
                                                </span>
                                            )}
                                        </td>
                                        <td className={kpiCalcCellCls}>
                                            {!usesKpis ? '—' : kpis.productivityDay > 0
                                                ? kpis.productivityDay.toFixed(1)
                                                : '—'}
                                        </td>
                                        <td className={kpiCalcCellCls}>
                                            {!usesKpis ? '—' : kpis.productivityHour > 0
                                                ? kpis.productivityHour.toFixed(1)
                                                : '—'}
                                        </td>
                                        <td className={`${dataCellCls} text-center`}>
                                            <button
                                                type="button"
                                                onClick={() => deleteRow(row.id)}
                                                className="w-full h-full min-h-[2.75rem] inline-flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50/80 transition-colors"
                                                title="Clear planning row"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                            );
                                        })}
                                        <tr className="bg-slate-50/20">
                                            <td colSpan={DATA_COL_COUNT} className="px-3 py-1.5 border border-slate-200">
                                                <button
                                                    type="button"
                                                    onClick={() => addRow(visit)}
                                                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                                                >
                                                    <Plus size={11} />
                                                    Add resource
                                                </button>
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mt-4">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                            Resource Timeline
                        </h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            View-only · All colorways on this order and other styles on each line
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-3 text-[10px]">
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 bg-amber-100 border-2 border-amber-400 rounded" />
                                <span className="text-slate-600">Unsaved</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 bg-emerald-100 border-2 border-emerald-500 rounded" />
                                <span className="text-slate-600">Saved</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 bg-slate-200 border border-slate-300 rounded" />
                                <span className="text-slate-600">Other Styles</span>
                            </div>
                        </div>
                        {onPrev && onNext && onViewStartDateChange && (
                            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
                                <button
                                    type="button"
                                    onClick={onPrev}
                                    className="p-1 hover:bg-slate-50 rounded text-slate-500"
                                    title="Previous"
                                >
                                    <ChevronLeft size={14} />
                                </button>
                                <SingleDatePicker
                                    value={viewStartDate || ''}
                                    onChange={onViewStartDateChange}
                                />
                                <button
                                    type="button"
                                    onClick={onNext}
                                    className="p-1 hover:bg-slate-50 rounded text-slate-500"
                                    title="Next"
                                >
                                    <ChevronRight size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const today = new Date();
                                        const offset = Math.floor((timelineData.length || 30) / 2);
                                        const centered = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
                                        const iso = `${centered.getFullYear()}-${String(centered.getMonth() + 1).padStart(2, '0')}-${String(centered.getDate()).padStart(2, '0')}`;
                                        onViewStartDateChange?.(iso);
                                    }}
                                    className="p-1 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 ml-1"
                                    title="Jump to today"
                                >
                                    <Crosshair size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="overflow-hidden flex min-w-0">
                    <DepartmentGanttChart
                        flowSteps={timelineFlowSteps}
                        departments={departments}
                        assignedResources={assignedResources}
                        allAllocations={combinedAllocations}
                        selectedColorData={selectedColorData}
                        selectedOrder={selectedOrder}
                        orders={orders}
                        timelineData={timelineData}
                        cellWidth={cellWidth}
                        deliveryDate={deliveryDate}
                        deliveryDates={deliveryDates}
                        onBarClick={() => {}}
                        onBarDragStart={() => {}}
                        onBarHover={onBarHover}
                        onTimelineClick={undefined}
                    />
                </div>
            </div>
        </>
    );
};
