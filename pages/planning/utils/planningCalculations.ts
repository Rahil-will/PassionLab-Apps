/**
 * Planning Calculation Utilities
 * Reusable functions for production planning calculations
 */

import { allocationColorwayId } from '../../../lib/allocationUtils';
import { sumSizeAdjQty, sumSizeOrderQty } from '../../../lib/colorwaySizesUtils';
import type { SizeQty } from '../../../types';
export {
  allocationMatchesVisit,
  plannedQtyForColorwayVisit,
} from '../../../lib/planningVisitAllocations';

/**
 * Calculate the number of working days between two dates (excluding Sundays)
 */
export const calculateWorkingDays = (startDate: string | Date, endDate: string | Date): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    
    let days = 0;
    const current = new Date(start);
    
    while (current <= end) {
        if (current.getDay() !== 0) { // Exclude Sundays
            days++;
        }
        current.setDate(current.getDate() + 1);
    }
    
    return days;
};

/**
 * Calculate daily average production
 */
export const calculateDailyAverage = (totalQty: number, workingDays: number): number => {
    if (workingDays === 0) return 0;
    return Math.ceil(totalQty / workingDays);
};

/**
 * Calculate target quantity from size breakdown
 */
export const calculateTargetQty = (sizes: SizeQty[]): number => {
    const adj = sumSizeAdjQty(sizes);
    return adj > 0 ? adj : sumSizeOrderQty(sizes);
};

/**
 * Calculate total planned quantity for a specific order/colorway
 */
export const calculatePlannedQty = (allocations: any[], colorwayId: string): number => {
    return allocations
        .filter(a => allocationColorwayId(a) === colorwayId)
        .reduce((acc, a) => acc + a.qty, 0);
};

/**
 * Calculate department-wise planned quantities
 */
export const calculateDepartmentQty = (
    allocations: any[],
    orderId: string,
    deptName: string,
    flowSteps: any[],
    assignedResources: any[]
): number => {
    const deptAllocs = allocations.filter(a => {
        if (allocationColorwayId(a) !== orderId) return false;
        const step = a.operationId ? flowSteps.find((s: any) => s.id === a.operationId) : undefined;
        if (step) {
            return step.dept_name === deptName;
        }
        const line = assignedResources.find(l => l.id === a.lineId);
        return line && line.departmentName === deptName;
    });

    return deptAllocs.reduce((acc, a) => acc + a.qty, 0);
};

/**
 * Get earliest start date from allocations
 */
export const getEarliestStartDate = (allocations: any[]): string | null => {
    if (allocations.length === 0) return null;
    return allocations.reduce((min, a) => 
        a.startDate < min ? a.startDate : min, 
        allocations[0].startDate
    );
};

/**
 * Get latest end date from allocations
 */
export const getLatestEndDate = (allocations: any[]): string | null => {
    if (allocations.length === 0) return null;
    return allocations.reduce((max, a) => 
        a.endDate > max ? a.endDate : max, 
        allocations[0].endDate
    );
};

/**
 * Format date for display
 */
export const formatDisplayDate = (date: string | Date, format: 'short' | 'long' = 'short'): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    
    if (format === 'short') {
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    }
    
    return d.toLocaleDateString('en-GB', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
    });
};

/**
 * Generate timeline data for Gantt chart
 */
export const generateTimelineData = (startDate: string, days: number = 60) => {
    const timeline = [];
    const start = new Date(startDate);
    
    for (let i = 0; i < days; i++) {
        const current = new Date(start);
        current.setDate(start.getDate() + i);
        
        const iso = current.toISOString().split('T')[0];
        const day = current.getDate();
        const weekday = current.toLocaleDateString('en-US', { weekday: 'short' });
        const isWeekend = current.getDay() === 0 || current.getDay() === 6;
        
        timeline.push({ iso, day, weekday, isWeekend });
    }
    
    return timeline;
};

/**
 * Calculate bar position for Gantt chart
 */
export const calculateBarPosition = (
    startDate: string,
    endDate: string,
    timelineStart: string,
    cellWidth: number
): { left: string; width: string } | null => {
    const allocStart = new Date(startDate);
    const allocEnd = new Date(endDate);
    const viewStart = new Date(timelineStart);
    
    if (isNaN(allocStart.getTime()) || isNaN(allocEnd.getTime())) return null;
    
    const daysDiff = Math.floor((allocStart.getTime() - viewStart.getTime()) / (1000 * 60 * 60 * 24));
    const duration = Math.floor((allocEnd.getTime() - allocStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    if (daysDiff + duration < 0) return null; // Before view
    if (daysDiff > 60) return null; // After view
    
    const left = Math.max(0, daysDiff) * cellWidth;
    const width = duration * cellWidth;
    
    return {
        left: `${left}px`,
        width: `${width}px`
    };
};

/**
 * Stack overlapping allocations to avoid visual overlap
 */
export const stackAllocations = (
    allocations: any[],
    getPosition: (alloc: any) => { left: string; width: string } | null,
    maxLevels: number = 3,
    barHeight: number = 18,
    barGap: number = 2
): Array<{ alloc: any; top: number; height: number; pos: any }> => {
    const stacked: Array<{ alloc: any; top: number; height: number; pos: any }> = [];
    
    allocations.forEach((alloc) => {
        const pos = getPosition(alloc);
        if (!pos) return;
        
        let stackLevel = 0;
        let foundPosition = false;
        
        while (!foundPosition && stackLevel < maxLevels) {
            const topPos = 4 + (stackLevel * (barHeight + barGap));
            
            // Check if this position overlaps with existing bars
            const overlaps = stacked.some(existing => {
                if (existing.top !== topPos) return false;
                
                // Check horizontal overlap
                const existingLeft = parseInt(existing.pos.left);
                const existingRight = existingLeft + parseInt(existing.pos.width);
                const newLeft = parseInt(pos.left);
                const newRight = newLeft + parseInt(pos.width);
                
                return !(newRight <= existingLeft || newLeft >= existingRight);
            });
            
            if (!overlaps) {
                stacked.push({ alloc, top: topPos, height: barHeight, pos });
                foundPosition = true;
            } else {
                stackLevel++;
            }
        }
        
        // If no position found after max levels, stack on top anyway
        if (!foundPosition) {
            stacked.push({ 
                alloc, 
                top: 4 + ((maxLevels - 1) * (barHeight + barGap)), 
                height: barHeight, 
                pos 
            });
        }
    });
    
    return stacked;
};

/**
 * Calculate completion percentage
 */
export const calculateCompletionPercentage = (planned: number, target: number): number => {
    if (target === 0) return 0;
    return Math.round((planned / target) * 100);
};

/**
 * Check if allocation is complete
 */
export const isAllocationComplete = (planned: number, target: number): boolean => {
    return planned >= target;
};
