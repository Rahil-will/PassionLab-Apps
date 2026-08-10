export function actualDateRange(alloc: {
  startDate: string;
  endDate: string;
  actualQty?: number;
  actualStartDate?: string;
  actualEndDate?: string;
}): { start: string; end: string } | null {
  const start = alloc.actualStartDate?.slice(0, 10);
  const end = alloc.actualEndDate?.slice(0, 10);
  if (start && end) return { start, end };
  if (start) return { start, end: end || start };

  if ((alloc.actualQty ?? 0) > 0 && alloc.startDate && alloc.endDate) {
    const today = new Date().toISOString().split('T')[0];
    const runEnd = today < alloc.endDate ? today : alloc.endDate;
    return { start: alloc.startDate, end: runEnd };
  }

  return null;
}
