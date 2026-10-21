/**
 * V5 identity helpers. The roll id is the only id (P2) and the receipt id is
 * the only receipt id (P3); the old keys (`stock_unit_id`, `in_challan_id`)
 * are still returned during the backend switch, so read the new key first
 * and fall back to the old one (`a ?? b`). Claude removes the old keys later.
 */

type RollIdSource = {
  roll_id?: string | null;
  id?: string | null;
  /** @deprecated V5 P2 — equals the roll id during the switch, then removed. */
  stock_unit_id?: string | null;
  stock?: { /** @deprecated */ stock_unit_id?: string | null; [key: string]: unknown } | null;
  custody?: { /** @deprecated */ stock_unit_id?: unknown; [key: string]: unknown } | null;
} | null | undefined;

/** Roll id from any roll-shaped row: `roll_id ?? id ?? stock_unit_id` (+ nested stock/custody). */
export function rollIdOf(row: RollIdSource): string | null {
  if (!row) return null;
  if (row.roll_id) return row.roll_id;
  if (row.id) return row.id;
  if (row.stock_unit_id) return row.stock_unit_id;
  if (row.stock?.stock_unit_id) return row.stock.stock_unit_id;
  const fromCustody = row.custody?.stock_unit_id;
  return typeof fromCustody === 'string' && fromCustody ? fromCustody : null;
}

type ReceiptIdSource = {
  receipt_id?: string | null;
  receiptId?: string | null;
  /** @deprecated V5 P3 — alias of receipt_id during the switch, then removed. */
  in_challan_id?: string | null;
  inChallanId?: string | null;
} | null | undefined;

/** Receipt id from any roll/challan-shaped row: `receipt_id ?? in_challan_id`. */
export function receiptIdOf(row: ReceiptIdSource): string | null {
  if (!row) return null;
  return row.receipt_id ?? row.receiptId ?? row.in_challan_id ?? row.inChallanId ?? null;
}

// ── Roll history (mm_roll_history) ──────────────────────────────────────────

export type MmRollHistoryKind =
  | 'received' | 'inspected' | 'tested' | 'moved' | 'sent_process' | 'returned_process'
  | 'rerolled' | 'allocated' | 'unallocated' | 'booked' | 'unbooked' | 'dispatched'
  | 'damaged' | 'adjusted';

export type MmRollHistoryDocKind = 'receipt' | 'process_challan' | 'store_challan' | 'allocation_note';

export interface MmRollHistoryEntry {
  at: string | null;
  kind: MmRollHistoryKind | string;
  label?: string | null;
  qty: number | null;
  uom: string | null;
  from_location: string | null;
  to_location: string | null;
  doc_kind: MmRollHistoryDocKind | string | null;
  doc_id: string | null;
  doc_no: string | null;
  by_name: string | null;
  note: string | null;
}

export const ROLL_HISTORY_KIND_META: Record<string, { label: string; chipClass: string }> = {
  received: { label: 'Received', chipClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  inspected: { label: 'Inspected', chipClass: 'bg-blue-50 text-blue-700 border-blue-200' },
  tested: { label: 'Tested', chipClass: 'bg-blue-50 text-blue-700 border-blue-200' },
  moved: { label: 'Moved', chipClass: 'bg-slate-100 text-slate-600 border-slate-200' },
  sent_process: { label: 'Sent to process', chipClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  returned_process: { label: 'Returned from process', chipClass: 'bg-teal-50 text-teal-700 border-teal-200' },
  rerolled: { label: 'Re-rolled', chipClass: 'bg-violet-50 text-violet-700 border-violet-200' },
  allocated: { label: 'Allocated', chipClass: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  unallocated: { label: 'Unallocated', chipClass: 'bg-slate-100 text-slate-600 border-slate-200' },
  booked: { label: 'Booked', chipClass: 'bg-violet-50 text-violet-700 border-violet-200' },
  unbooked: { label: 'Unbooked', chipClass: 'bg-slate-100 text-slate-600 border-slate-200' },
  dispatched: { label: 'Dispatched', chipClass: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  damaged: { label: 'Damaged', chipClass: 'bg-red-50 text-red-700 border-red-200' },
  adjusted: { label: 'Adjusted', chipClass: 'bg-amber-50 text-amber-800 border-amber-200' },
};

export function rollHistoryKindMeta(kind: string | null | undefined): { label: string; chipClass: string } {
  const key = String(kind ?? '').toLowerCase();
  return ROLL_HISTORY_KIND_META[key] ?? {
    label: key ? key.replace(/_/g, ' ') : 'Event',
    chipClass: 'bg-slate-100 text-slate-600 border-slate-200',
  };
}
