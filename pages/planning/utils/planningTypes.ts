/**
 * Type definitions for Production Planning module
 */

export interface TimelineDay {
    iso: string;
    day: number;
    weekday: string;
    isWeekend: boolean;
}

export interface GanttResource {
    id: string;
    resourceName: string;
    departmentName: string;
    avgWF?: number;
    defaultPcs?: number;
}

export interface GanttGroup {
    deptName: string;
    resources: GanttResource[];
}

export interface AllocationFormData {
    id?: string;
    processName: string;
    lineId: string;
    startDate: string;
    endDate: string;
    qty: number;
    dailyTarget?: number;
    learningCurve?: string;
    completed_is_true?: boolean;
}

export interface DragSelection {
    lineId: string;
    deptName: string;
    startDate: string;
    endDate: string;
}

export interface PlanningTotals {
    targetTotal: number;
    plannedTotal: number;
    remainingTotal: number;
}

export interface DepartmentSummary {
    deptName: string;
    qty: number;
    startDate: string | null;
    endDate: string | null;
    percentage: number;
}

export interface StackedAllocation {
    alloc: any;
    top: number;
    height: number;
    pos: {
        left: string;
        width: string;
    };
}

export interface HoveredAllocation {
    alloc: any;
    x: number;
    y: number;
}

export interface AutoScheduleConfig {
    learningCurveId?: string;
    startDate?: string;
}

export interface AutoScheduleResult {
    allocations: any[];
    hasRisk: boolean;
    riskMessage?: string;
}
