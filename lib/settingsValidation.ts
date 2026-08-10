type NamedItem = { id: string; name?: string | null; category?: string | null };

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Returns an error message if the name collides with another item in the list. */
export function duplicateNameError(
  items: NamedItem[],
  candidateName: string,
  currentId: string,
  label = 'Name',
): string | null {
  const key = norm(candidateName);
  if (!key) return `${label} is required`;
  const clash = items.find(
    (item) => item.id !== currentId && norm(item.name ?? item.category) === key,
  );
  if (clash) {
    const shown = clash.name ?? clash.category ?? 'another item';
    return `${label} "${candidateName.trim()}" already exists (${shown})`;
  }
  return null;
}

export function duplicateNamesInList(
  items: Array<{ id?: string; name?: string; resourceName?: string }>,
  label = 'Name',
): string | null {
  const seen = new Map<string, string>();
  for (const item of items) {
    const display = item.name ?? item.resourceName;
    const key = norm(display);
    if (!key) continue;
    if (seen.has(key)) {
      return `Duplicate ${label.toLowerCase()} "${display?.trim()}" in this list`;
    }
    seen.set(key, item.id ?? key);
  }
  return null;
}

export interface ShiftHourBlockInput {
  start: string;
  end: string;
}

function shiftTimeToMin(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Returns an error message when hour blocks have gaps, overlaps, or invalid ranges. */
export function validateShiftHourBlocks(hours: ShiftHourBlockInput[]): string | null {
  if (!hours.length) return 'Add at least one hour block';
  for (let i = 1; i < hours.length; i++) {
    if (hours[i].start !== hours[i - 1].end) {
      return `Gap or overlap between hour block ${i} and ${i + 1}`;
    }
  }
  for (const h of hours) {
    if (shiftTimeToMin(h.start) === shiftTimeToMin(h.end)) {
      return 'One or more hour blocks have invalid start/end times';
    }
  }
  return null;
}

function shiftInterval(start: string, end: string) {
  const s = shiftTimeToMin(start);
  const e = shiftTimeToMin(end);
  const duration = e > s ? e - s : e + 1440 - s;
  if (duration <= 0) return null;
  return { start: s, end: s + duration };
}

export function validateShiftTimeOverlap(
  shiftId: string,
  shiftName: string,
  hours: ShiftHourBlockInput[],
  peers: Array<{ id: string; name: string; hours?: ShiftHourBlockInput[] }>,
): string | null {
  if (!hours.length) return null;
  const my = shiftInterval(hours[0].start, hours[hours.length - 1].end);
  if (!my) return null;
  for (const peer of peers) {
    if (peer.id === shiftId) continue;
    const peerHours = peer.hours || [];
    if (!peerHours.length) continue;
    const other = shiftInterval(peerHours[0].start, peerHours[peerHours.length - 1].end);
    if (!other) continue;
    const k = Math.round((my.start - other.start) / 1440) * 1440;
    const otherStart = other.start + k;
    const otherEnd = other.end + k;
    if (my.start < otherEnd && otherStart < my.end) {
      return `Shift time overlaps with "${peer.name}"`;
    }
  }
  if (!shiftName.trim()) return 'Shift name is required';
  return null;
}
