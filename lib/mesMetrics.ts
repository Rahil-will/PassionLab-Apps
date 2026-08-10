/** MES KPI helpers — hourly output, efficiency, DHU, WIP */

export interface PlanTarget {
  styleName: string;
  departmentId: string;
  dailyTarget: number;
  startDate?: string;
  endDate?: string;
}

export function shiftHourCount(startHour: number, endHour: number): number {
  if (endHour > startHour) return endHour - startHour;
  return 24 - startHour + endHour;
}

export function hourlyTarget(dailyTarget: number, shiftHours: number): number {
  if (shiftHours <= 0 || dailyTarget <= 0) return 0;
  return Math.round(dailyTarget / shiftHours);
}

export function efficiencyPct(actual: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.round((actual / target) * 100);
}

export function variance(actual: number, target: number): number {
  return actual - target;
}

export function calcDhu(failCount: number, inspectedCount: number): number | null {
  if (inspectedCount <= 0) return null;
  return Math.round((failCount / inspectedCount) * 100);
}

export function calcWip(produced: number, sentQty: number): number {
  return Math.max(0, produced - sentQty);
}

export function dailyTargetForStyle(
  allocations: PlanTarget[],
  styleName: string,
  departmentId: string,
  date: string,
): number {
  return allocations
    .filter(
      (a) =>
        a.styleName === styleName &&
        a.departmentId === departmentId &&
        (!a.startDate || a.startDate <= date) &&
        (!a.endDate || a.endDate >= date),
    )
    .reduce((sum, a) => sum + a.dailyTarget, 0);
}

export function formatEffPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}%`;
}

export function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${value}%`;
}

export function formatPct2(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}%`;
}

export function formatDhu(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

export function formatVar(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
