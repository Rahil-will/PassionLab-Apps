import differenceInCalendarDays from 'date-fns/differenceInCalendarDays';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';

/** Format ISO date (yyyy-mm-dd) for display as dd-mm-yyyy */
export function formatDateDDMMYYYY(iso: string | undefined | null): string {
  if (!iso) return '—';
  const parsed = parseISO(iso.split('T')[0]);
  if (Number.isNaN(parsed.getTime())) return iso;
  return format(parsed, 'dd-MM-yyyy');
}

export function daysBetween(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const start = parseISO(startIso.split('T')[0]);
  const end = parseISO(endIso.split('T')[0]);
  const diff = differenceInCalendarDays(end, start);
  return diff > 0 ? diff : 0;
}

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
