import type { Shift, ShiftHourBlock } from '../types';

export function hourStartLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function activeHourSlotsForShift(shift: Shift | null | undefined): string[] {
  if (!shift?.hours?.length) return [];
  return shift.hours
    .filter((h) => h.type === 'active' && h.start)
    .map((h) => h.start);
}

export function allActiveHourSlots(shifts: Shift[]): string[] {
  const slots = new Set<string>();
  for (const shift of shifts) {
    for (const slot of activeHourSlotsForShift(shift)) {
      slots.add(slot);
    }
  }
  return [...slots].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function isOtShift(shift: Shift | null | undefined): boolean {
  const t = (shift?.type || '').toLowerCase();
  return t === 'ot' || t === 'overtime';
}

function slotMinutes(block: ShiftHourBlock): number {
  if (block.type !== 'active' || !block.start || !block.end) return 0;
  const [sh, sm] = block.start.split(':').map(Number);
  const [eh, em] = block.end.split(':').map(Number);
  let mins = eh * 60 + (em || 0) - (sh * 60 + (sm || 0));
  if (mins < 0) mins += 24 * 60;
  return mins;
}

/** Sum of active slot durations from shifts.hours (matches DB shift_productive_mins_from_hours). */
export function productiveMinsFromHours(hours: ShiftHourBlock[] | null | undefined): number {
  if (!hours?.length) return 0;
  return hours.reduce((sum, block) => sum + slotMinutes(block), 0);
}

export function regularShiftProductiveMins(shifts: Shift[]): number {
  const regular = shifts.filter((s) => !isOtShift(s));
  const pool = regular.length > 0 ? regular : shifts;
  return pool.reduce((sum, s) => sum + productiveMinsFromHours(s.hours), 0);
}
