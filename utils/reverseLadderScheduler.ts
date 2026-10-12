/**
 * Reverse Ladder Scheduling Algorithm
 * 
 * Philosophy:
 * - Anchor: Schedule is anchored to Delivery Date and calculated backwards
 * - Dependency: Processes linked via Start-to-Start Lag (not End-to-Start)
 * - Concept: Sewing doesn't wait for Cutting to finish - Sewing starts X days after Cutting starts
 * - Result: Creates a 'staircase' schedule where Cutting, Sewing, Finishing run in parallel
 */

export interface DepartmentSchedule {
    departmentId: string;
    departmentName: string;
    resourceId: string;
    resourceName: string;
    startDate: Date;
    endDate: Date;
    duration: number; // in days
    qty: number;
    dailyCapacity: number;
    isConflict: boolean;
    conflictShiftDays: number;
}

export interface ScheduleResult {
    schedules: DepartmentSchedule[];
    deliveryDate: Date;
    hasDeliveryRisk: boolean;
    riskDays: number;
    alerts: ScheduleAlert[];
}

export interface ScheduleAlert {
    type: 'critical' | 'warning' | 'info';
    message: string;
    departmentId?: string;
}

export interface ResourceAvailability {
    resourceId: string;
    resourceName: string;
    departmentId: string;
    bookedDates: { start: Date; end: Date; orderId: string }[];
    dailyCapacity: number;
}

export interface ScheduleConfig {
    lagDays: number; // 1 for standard, 3 for complex styles
    processFlow: string[]; // e.g., ['Cutting', 'Sewing', 'Finishing']
}

/**
 * Add working days to a date (excludes Sundays)
 */
export function addWorkingDays(date: Date, days: number): Date {
    const result = new Date(date);
    let added = 0;
    const direction = days >= 0 ? 1 : -1;
    const absDays = Math.abs(days);
    
    while (added < absDays) {
        result.setDate(result.getDate() + direction);
        // Skip Sundays (0 = Sunday)
        if (result.getDay() !== 0) {
            added++;
        }
    }
    return result;
}

/**
 * Subtract working days from a date (excludes Sundays)
 */
export function subtractWorkingDays(date: Date, days: number): Date {
    return addWorkingDays(date, -days);
}

/**
 * Calculate working days between two dates
 */
export function getWorkingDaysBetween(startDate: Date, endDate: Date): number {
    let count = 0;
    const current = new Date(startDate);
    
    while (current < endDate) {
        if (current.getDay() !== 0) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }
    return count;
}

/**
 * Calculate duration in working days based on quantity and daily capacity
 */
export function calculateDuration(qty: number, dailyCapacity: number): number {
    if (dailyCapacity <= 0) return 1;
    return Math.ceil(qty / dailyCapacity);
}

/**
 * Check if a date range conflicts with existing bookings
 */
export function checkConflict(
    startDate: Date,
    endDate: Date,
    resourceId: string,
    resources: ResourceAvailability[],
    excludeOrderId?: string
): { hasConflict: boolean; conflictingOrders: string[] } {
    const resource = resources.find(r => r.resourceId === resourceId);
    if (!resource) return { hasConflict: false, conflictingOrders: [] };
    
    const conflictingOrders: string[] = [];
    
    for (const booking of resource.bookedDates) {
        if (excludeOrderId && booking.orderId === excludeOrderId) continue;
        
        // Check overlap
        const bookingStart = new Date(booking.start);
        const bookingEnd = new Date(booking.end);
        
        if (startDate <= bookingEnd && endDate >= bookingStart) {
            conflictingOrders.push(booking.orderId);
        }
    }
    
    return {
        hasConflict: conflictingOrders.length > 0,
        conflictingOrders
    };
}

/**
 * Find the first available slot for a resource after a given date
 */
export function findFirstAvailableSlot(
    afterDate: Date,
    durationDays: number,
    resourceId: string,
    resources: ResourceAvailability[],
    excludeOrderId?: string
): Date {
    const resource = resources.find(r => r.resourceId === resourceId);
    if (!resource || resource.bookedDates.length === 0) {
        return afterDate;
    }
    
    let candidateStart = new Date(afterDate);
    let attempts = 0;
    const maxAttempts = 365; // Prevent infinite loop
    
    while (attempts < maxAttempts) {
        const candidateEnd = addWorkingDays(candidateStart, durationDays);
        const { hasConflict } = checkConflict(candidateStart, candidateEnd, resourceId, resources, excludeOrderId);
        
        if (!hasConflict) {
            return candidateStart;
        }
        
        // Move to next working day
        candidateStart = addWorkingDays(candidateStart, 1);
        attempts++;
    }
    
    return candidateStart;
}

/**
 * MAIN ALGORITHM: Reverse Ladder Scheduling
 * 
 * Step A (Anchor): Set Finishing End Date = Delivery Date
 * Step B (Reverse Walk): Calculate Ideal Start Dates using Lag Time
 * Step C (Duration Fill): Calculate End Dates forward based on capacity
 * Step D (Conflict Resolution): Shift forward and apply Ripple Effect
 */
export function calculateReverseLadderSchedule(
    deliveryDate: Date,
    qty: number,
    config: ScheduleConfig,
    selectedResources: { departmentId: string; departmentName: string; resourceId: string; resourceName: string; dailyCapacity: number }[],
    allResources: ResourceAvailability[],
    excludeOrderId?: string
): ScheduleResult {
    const { lagDays, processFlow } = config;
    const alerts: ScheduleAlert[] = [];
    const schedules: DepartmentSchedule[] = [];
    
    // Sort resources by process flow order (reverse for backward calculation)
    const sortedDepts = [...selectedResources].sort((a, b) => {
        const aIdx = processFlow.indexOf(a.departmentName);
        const bIdx = processFlow.indexOf(b.departmentName);
        return bIdx - aIdx; // Reverse order for backward calculation
    });
    
    if (sortedDepts.length === 0) {
        return {
            schedules: [],
            deliveryDate,
            hasDeliveryRisk: false,
            riskDays: 0,
            alerts: [{ type: 'warning', message: 'No departments selected' }]
        };
    }
    
    // STEP A: Anchor - Last department ends at delivery date
    const lastDept = sortedDepts[0];
    const lastDeptDuration = calculateDuration(qty, lastDept.dailyCapacity);
    let lastDeptEndDate = new Date(deliveryDate);
    let lastDeptStartDate = subtractWorkingDays(lastDeptEndDate, lastDeptDuration);
    
    // STEP B & C: Reverse Walk with Duration Fill
    const idealSchedules: DepartmentSchedule[] = [];
    
    for (let i = 0; i < sortedDepts.length; i++) {
        const dept = sortedDepts[i];
        const duration = calculateDuration(qty, dept.dailyCapacity);
        
        let startDate: Date;
        let endDate: Date;
        
        if (i === 0) {
            // Last department (e.g., Finishing) - anchored to delivery
            endDate = new Date(deliveryDate);
            startDate = subtractWorkingDays(endDate, duration);
        } else {
            // Previous departments - use Start-to-Start Lag
            const nextDeptStart = idealSchedules[i - 1].startDate;
            startDate = subtractWorkingDays(nextDeptStart, lagDays);
            endDate = addWorkingDays(startDate, duration);
        }
        
        idealSchedules.push({
            departmentId: dept.departmentId,
            departmentName: dept.departmentName,
            resourceId: dept.resourceId,
            resourceName: dept.resourceName,
            startDate,
            endDate,
            duration,
            qty,
            dailyCapacity: dept.dailyCapacity,
            isConflict: false,
            conflictShiftDays: 0
        });
    }
    
    // Reverse to get chronological order
    idealSchedules.reverse();
    
    // STEP D: Conflict Resolution with Ripple Effect
    let totalRipple = 0;
    
    for (let i = 0; i < idealSchedules.length; i++) {
        const schedule = idealSchedules[i];
        
        // Apply any accumulated ripple from previous departments
        if (totalRipple > 0) {
            schedule.startDate = addWorkingDays(schedule.startDate, totalRipple);
            schedule.endDate = addWorkingDays(schedule.endDate, totalRipple);
        }
        
        // Check for conflicts
        const { hasConflict, conflictingOrders } = checkConflict(
            schedule.startDate,
            schedule.endDate,
            schedule.resourceId,
            allResources,
            excludeOrderId
        );
        
        if (hasConflict) {
            // Find first available slot
            const availableStart = findFirstAvailableSlot(
                schedule.startDate,
                schedule.duration,
                schedule.resourceId,
                allResources,
                excludeOrderId
            );
            
            const shiftDays = getWorkingDaysBetween(schedule.startDate, availableStart);
            
            schedule.isConflict = true;
            schedule.conflictShiftDays = shiftDays;
            schedule.startDate = availableStart;
            schedule.endDate = addWorkingDays(availableStart, schedule.duration);
            
            // Add ripple for subsequent departments
            totalRipple += shiftDays;
            
            alerts.push({
                type: 'warning',
                message: `${schedule.departmentName}: Resource conflict with ${conflictingOrders.join(', ')}. Shifted forward by ${shiftDays} days.`,
                departmentId: schedule.departmentId
            });
        }
        
        schedules.push(schedule);
    }
    
    // Check delivery risk
    const finalEndDate = schedules[schedules.length - 1]?.endDate || deliveryDate;
    const hasDeliveryRisk = finalEndDate > deliveryDate;
    const riskDays = hasDeliveryRisk ? getWorkingDaysBetween(deliveryDate, finalEndDate) : 0;
    
    if (hasDeliveryRisk) {
        alerts.unshift({
            type: 'critical',
            message: `DELIVERY RISK: Schedule ends ${riskDays} working days after delivery date!`
        });
    }
    
    return {
        schedules,
        deliveryDate,
        hasDeliveryRisk,
        riskDays,
        alerts
    };
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}

/**
 * Parse YYYY-MM-DD string to Date
 */
export function parseDate(dateStr: string): Date {
    return new Date(dateStr + 'T00:00:00');
}
