/** Pure helpers for inspection sampling sessions and allocation notes. */

export function canSelectMore(selectedCount: number, sampleSize: number): boolean {
  return selectedCount < sampleSize;
}

export function toggleSampleSelection(
  selected: readonly string[],
  rollId: string,
  sampleSize: number,
): { ok: boolean; next: string[]; reason?: string } {
  if (selected.includes(rollId)) {
    return { ok: true, next: selected.filter((id) => id !== rollId) };
  }
  if (!canSelectMore(selected.length, sampleSize)) {
    return { ok: false, next: [...selected], reason: `Only ${sampleSize} rolls can be sampled` };
  }
  return { ok: true, next: [...selected, rollId] };
}

export type ChipTone = 'success' | 'warning' | 'danger' | 'default';

export function inspSessionStatusLabel(status: string | null | undefined): string {
  switch (String(status ?? '').toLowerCase()) {
    case 'draft': return 'Draft';
    case 'escalated': return 'Escalated – inspect all';
    case 'passed': return 'Passed';
    case 'passed_deviation':
    case 'accepted_deviation':
    case 'accept_deviation': return 'Passed – deviation';
    case 'closed': return 'Closed';
    case 'rejected': return 'Rejected';
    default: return status ? String(status) : '—';
  }
}

export function inspSessionTone(status: string | null | undefined): ChipTone {
  const s = String(status ?? '').toLowerCase();
  if (s === 'passed' || s === 'passed_deviation' || s === 'accepted_deviation') return 'success';
  if (s === 'escalated' || s === 'draft') return 'warning';
  if (s === 'rejected') return 'danger';
  return 'default';
}

export type InspectionChipInput = {
  status?: string | null;
  sampled?: boolean | null;
  not_required?: boolean | null;
  session_id?: string | null;
  session_status?: string | null;
};

export function inspectionChip(input: InspectionChipInput): { label: string; tone: ChipTone } {
  if (input.not_required) return { label: 'Not required', tone: 'default' };
  const session = String(input.session_status ?? '').toLowerCase();
  if (session === 'rejected') return { label: 'Failed', tone: 'danger' };
  const status = String(input.status ?? '').toUpperCase();
  if (status === 'HOLD' || session === 'escalated') return { label: 'On hold – sample failed', tone: 'warning' };
  if (status === 'PASS') return input.sampled ? { label: 'Pass · sampled', tone: 'success' } : { label: 'Pass', tone: 'success' };
  if (status === 'FAILED') return { label: 'Failed', tone: 'danger' };
  if (status === 'NONE' || status === '') return { label: '—', tone: 'default' };
  return { label: status.charAt(0) + status.slice(1).toLowerCase(), tone: status === 'STALE' ? 'warning' : 'default' };
}

/** Chip for a roll row / passport inspection object, tolerant of either shape. */
export function rollInspectionChip(roll: {
  inspection_status?: string | null;
  inspection?: InspectionChipInput | null;
} | null | undefined): { label: string; tone: ChipTone } {
  const insp = roll?.inspection;
  return inspectionChip({
    status: insp?.status ?? roll?.inspection_status,
    sampled: insp?.sampled,
    not_required: insp?.not_required,
    session_id: insp?.session_id,
    session_status: insp?.session_status,
  });
}

export function noteStatusChip(status: string | null | undefined): { label: string; tone: ChipTone } {
  switch (String(status ?? '').toLowerCase()) {
    case 'open': return { label: 'Open', tone: 'success' };
    case 'dispatched': return { label: 'Dispatched', tone: 'default' };
    case 'closed': return { label: 'Closed', tone: 'warning' };
    default: return { label: status ? String(status) : '—', tone: 'default' };
  }
}

export function allocLineStatusChip(status: string | null | undefined): { label: string; tone: ChipTone } {
  switch (String(status ?? '').toLowerCase()) {
    case 'active': return { label: 'Active', tone: 'success' };
    case 'released': return { label: 'Released', tone: 'warning' };
    case 'dispatched': return { label: 'Dispatched', tone: 'default' };
    case 'converted': return { label: 'Converted', tone: 'default' };
    default: return { label: status ? String(status) : '—', tone: 'default' };
  }
}

export function allocKindLabel(kind: string | null | undefined): string {
  return String(kind ?? '').toLowerCase() === 'book' ? 'Book' : 'Allocate';
}

export function allocateToast(mode: 'allocate' | 'book', count: number, noteNo: string | null | undefined): string {
  const verb = mode === 'book' ? 'Booked' : 'Allocated';
  const rolls = `${count} ${count === 1 ? 'roll' : 'rolls'}`;
  return noteNo ? `${verb} ${rolls} on ${noteNo}` : `${verb} ${rolls}`;
}
