import type { Shift, ShiftHourBlock } from '../../../types';

export function mapShiftRow(raw: Record<string, unknown>): Shift {
  return {
    id: raw.id as string,
    factory_id: raw.factory_id as string,
    name: (raw.name as string) || '',
    type: (raw.type as string) || 'Regular',
    startTime: (raw.start_time as string) || null,
    endTime: (raw.end_time as string) || null,
    breakStart: (raw.break_start as string) || null,
    breakEnd: (raw.break_end as string) || null,
    hours: ((raw.hours as ShiftHourBlock[]) || []) as ShiftHourBlock[],
  };
}

export function workforceHeadcountFromLog(raw: Record<string, unknown>): number {
  const extra = raw.headcount_by_category as Record<string, number> | null;
  if (!extra || typeof extra !== 'object') return 0;
  return Object.values(extra).reduce((sum, n) => sum + (Number(n) || 0), 0);
}
