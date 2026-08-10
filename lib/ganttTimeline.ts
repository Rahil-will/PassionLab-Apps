export const GANTT_VIEW_DAYS = 15;

export interface TimelineDay {
  dateObj: Date;
  day: number;
  weekday: string;
  iso: string;
  isWeekend: boolean;
}

export function buildTimelineDays(
  startDate: Date,
  dayCount = GANTT_VIEW_DAYS,
  weekOffset = 0,
): TimelineDay[] {
  const start = new Date(startDate);
  start.setDate(start.getDate() + weekOffset * 7);
  const days: TimelineDay[] = [];
  for (let i = 0; i < dayCount; i++) {
    const curr = new Date(start);
    curr.setDate(start.getDate() + i);
    days.push({
      dateObj: new Date(curr),
      day: curr.getDate(),
      weekday: curr.toLocaleString('default', { weekday: 'short' }),
      iso: curr.toISOString().split('T')[0],
      isWeekend: curr.getDay() === 0 || curr.getDay() === 6,
    });
  }
  return days;
}

export function formatTimelineRange(days: TimelineDay[]): string {
  if (days.length === 0) return '';
  const first = days[0].dateObj.toLocaleDateString('default', { day: 'numeric', month: 'short' });
  const last = days[days.length - 1].dateObj.toLocaleDateString('default', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${first} - ${last}`;
}
