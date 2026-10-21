import type { MmProcLoss } from './mmV4Rpc';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Oct 26" */
export function dueLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const raw = iso.trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
}

export function isOverdue(dueOn: string | null | undefined, status: string | null | undefined): boolean {
  if (!dueOn) return false;
  if (String(status ?? '').toLowerCase() === 'returned') return false;
  const raw = dueOn.trim();
  const due = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return due.getTime() < today.getTime();
}

function pct(value: number | null | undefined): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(1).replace(/\.0$/, '')}%`;
}

/** "2.4% / norm 10%", or null when nothing came back yet. */
export function lossText(loss: MmProcLoss | null | undefined): string | null {
  if (!loss) return null;
  const back = Number(loss.back ?? 0);
  const writtenOff = Number(loss.written_off ?? 0);
  if (!(back > 0) && !(writtenOff > 0)) return null;
  const main = pct(loss.loss_pct);
  if (!main) return null;
  const norm = pct(loss.norm_pct);
  return norm ? `${main} / norm ${norm}` : main;
}
