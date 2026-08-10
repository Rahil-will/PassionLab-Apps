import type { Shift } from '../types';

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Main factory Regular shift — excludes OT / overtime rows. */
export function getRegularShift(shifts: Shift[] | undefined | null): Shift | null {
  if (!shifts?.length) return null;
  const regular = shifts.find((s) => (s.type || '').toLowerCase() === 'regular');
  if (regular) return regular;
  const nonOt = shifts.find((s) => {
    const t = (s.type || '').toLowerCase();
    return t !== 'ot' && t !== 'overtime';
  });
  return nonOt ?? shifts[0];
}

/**
 * Gross Regular shift span: start_time → end_time only.
 * break_start / break_end are intentionally ignored for planning math.
 */
export function getRegularShiftMinutes(shifts: Shift[] | undefined | null): number {
  const shift = getRegularShift(shifts);
  if (!shift?.startTime || !shift.endTime) return 8 * 60;
  // Never subtract shift.breakStart / shift.breakEnd — hourly target uses full shift hours.
  const total = parseTimeToMinutes(shift.endTime) - parseTimeToMinutes(shift.startTime);
  return total > 0 ? total : 8 * 60;
}

export function getRegularShiftHours(shifts: Shift[] | undefined | null): number {
  return getRegularShiftMinutes(shifts) / 60;
}

export function hourlyTargetFromDaily(dailyTarget: number, regularShiftHours: number): number {
  if (!dailyTarget || !regularShiftHours) return 0;
  return Math.round((dailyTarget / regularShiftHours) * 10) / 10;
}
