import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { REJECTION_AUDIT_DB_VALUE } from './supportDropdownCatalog';
import type { FulfillmentRejectionRow } from './fulfillmentData';

const REJECTION_STAGE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(REJECTION_AUDIT_DB_VALUE).map(([label, value]) => [value, label]),
);

export function formatRejectionStageLabel(stage: string): string {
  const trimmed = stage.trim();
  if (!trimmed) return '—';
  return REJECTION_STAGE_LABEL[trimmed] ?? trimmed.replace(/_/g, ' ');
}

export function formatRejectionDisplayDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso.split('T')[0]), 'dd MMM yyyy');
  } catch {
    return iso;
  }
}

export interface RejectionReportFlatRow {
  reason: string;
  stageLabel: string;
  stageKey: string;
  date: string;
  dateLabel: string;
  sizes: string;
  qty: number;
}

function groupRejectionRows(rows: FulfillmentRejectionRow[]): RejectionReportFlatRow[] {
  const byCell = new Map<
    string,
    { reason: string; stage: string; date: string; sizeMap: Map<string, number> }
  >();

  for (const row of rows) {
    const reason = row.reasonCode?.trim() || '—';
    const stage = row.stage?.trim() || '—';
    const date = row.date.split('T')[0];
    const cellKey = `${reason}\0${stage}\0${date}`;
    const cell = byCell.get(cellKey) ?? {
      reason,
      stage,
      date,
      sizeMap: new Map<string, number>(),
    };
    const size = row.size?.trim() || '—';
    cell.sizeMap.set(size, (cell.sizeMap.get(size) ?? 0) + row.qty);
    byCell.set(cellKey, cell);
  }

  const flat: RejectionReportFlatRow[] = [];
  for (const cell of byCell.values()) {
    const sizeEntries = [...cell.sizeMap.entries()].filter(([size]) => size !== '—');
    const sizes =
      sizeEntries.length > 0
        ? sizeEntries.map(([size, qty]) => `${size}:${qty}`).join(' · ')
        : '—';
    const qty = [...cell.sizeMap.values()].reduce((s, n) => s + n, 0);
    flat.push({
      reason: cell.reason,
      stageKey: cell.stage,
      stageLabel: formatRejectionStageLabel(cell.stage),
      date: cell.date,
      dateLabel: formatRejectionDisplayDate(cell.date),
      sizes,
      qty,
    });
  }

  return flat.sort(
    (a, b) =>
      a.reason.localeCompare(b.reason) ||
      a.stageLabel.localeCompare(b.stageLabel) ||
      b.date.localeCompare(a.date),
  );
}

/** Group by reason → stage → date; one row per date with sizes column. */
export function flattenRejectionReportRows(rows: FulfillmentRejectionRow[]): RejectionReportFlatRow[] {
  return groupRejectionRows(rows);
}

export function bundleRowsToFulfillmentRejections(
  rows: Array<Record<string, unknown>>,
): FulfillmentRejectionRow[] {
  return rows.map((r) => ({
    date: String(r.rejected_date ?? ''),
    qty: Number(r.qty) || 0,
    size: (r.size as string)?.trim() || null,
    stage: String(r.stage ?? ''),
    reasonCode: String(r.reason_code ?? ''),
    reasonDetail: String(r.reason_detail ?? r.notes ?? '') || null,
  }));
}

/** First non-empty note on matching rejection rows (template restore). */
export function rejectionCommentsForCell(
  rows: Array<Record<string, unknown>>,
  reason: string,
  stage: string,
  date: string,
): string {
  const dateKey = date.split('T')[0];
  for (const r of rows) {
    const rReason = String(r.reason_code ?? '').trim() || '—';
    const rStage = String(r.stage ?? '').trim() || '—';
    const rDate = String(r.rejected_date ?? '').split('T')[0];
    if (rReason !== reason || rStage !== stage || rDate !== dateKey) continue;
    const note = String(r.notes ?? r.reason_detail ?? '').trim();
    if (note) return note;
  }
  return '';
}

/** Build size map for one reason + stage + date (template restore). */
export function rejectionQtyBySizeForCell(
  rows: Array<Record<string, unknown>>,
  reason: string,
  stage: string,
  date: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  const dateKey = date.split('T')[0];
  for (const r of rows) {
    const rReason = String(r.reason_code ?? '').trim() || '—';
    const rStage = String(r.stage ?? '').trim() || '—';
    const rDate = String(r.rejected_date ?? '').split('T')[0];
    if (rReason !== reason || rStage !== stage || rDate !== dateKey) continue;
    const size = String(r.size ?? '').trim();
    if (!size) continue;
    out[size] = (out[size] ?? 0) + (Number(r.qty) || 0);
  }
  return out;
}
