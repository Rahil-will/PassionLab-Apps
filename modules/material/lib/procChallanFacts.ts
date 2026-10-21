import { supabase } from '../../../lib/supabase';
import { formatQtyM, dateLabel } from './mmRollDraft';
import { unitFormCountText } from './mmUnitForm';

export type ProcChallanFacts = {
  fabric: string;
  sentQty: string;
  sentCount: string;
  receivedAt: string;
  receivedQty: string;
  receivedCount: string;
};

export function emptyProcChallanFacts(): ProcChallanFacts {
  return {
    fabric: '—',
    sentQty: '—',
    sentCount: '—',
    receivedAt: '—',
    receivedQty: '—',
    receivedCount: '—',
  };
}

export function procChallanStatus(value: string | null | undefined): { label: string; dot: string; text: string } {
  const status = String(value ?? '').toLowerCase();
  if (status === 'open' || status === 'pending') return { label: 'Still out', dot: 'bg-amber-500', text: 'text-amber-800' };
  if (status === 'partial') return { label: 'Part back', dot: 'bg-blue-500', text: 'text-blue-700' };
  if (status === 'returned') return { label: 'Came back', dot: 'bg-emerald-500', text: 'text-emerald-700' };
  if (status === 'void') return { label: 'Void', dot: 'bg-slate-300', text: 'text-slate-500' };
  return { label: status ? status.replace(/_/g, ' ') : '—', dot: 'bg-slate-300', text: 'text-slate-500' };
}

export function processorLabel(row: {
  place?: string | null;
  unit?: { name?: string; ownership?: string } | null;
  machine?: { code?: string; name?: string } | null;
}): string {
  const place = String(row.place ?? '').toLowerCase();
  const inhouse = place === 'inhouse' || (place !== 'external' && row.unit?.ownership != null && row.unit.ownership !== 'external');
  if (inhouse) {
    const machine = row.machine?.code || row.machine?.name || '';
    return machine ? `In-house · ${machine}` : 'In-house';
  }
  return row.unit?.name || '—';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? row as Record<string, unknown> : null;
}

function textAt(row: Record<string, unknown> | null, key: string): string {
  if (!row) return '';
  const value = row[key];
  return typeof value === 'string' ? value.trim() : '';
}

function nameAt(row: Record<string, unknown> | null, key: string): string {
  return textAt(asRecord(row?.[key]), 'name');
}

function lineFabric(line: Record<string, unknown>): string {
  const roll = asRecord(line.roll);
  return nameAt(roll, 'fabric') || nameAt(roll, 'fabric_type');
}

function lineForm(line: Record<string, unknown>): string {
  const form = (textAt(asRecord(line.roll), 'unit_form') || 'roll').toLowerCase();
  return form || 'roll';
}

function qtyText(rows: Array<{ qty: number; uom: string }>): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!(row.qty > 0)) continue;
    totals.set(row.uom, (totals.get(row.uom) ?? 0) + row.qty);
  }
  const parts = [...totals.entries()].map(([uom, qty]) => formatQtyM(qty, uom || null));
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function countText(forms: string[]): string {
  const counts: Record<string, number> = {};
  for (const form of forms) counts[form] = (counts[form] ?? 0) + 1;
  return unitFormCountText(counts);
}

export async function loadProcChallanFacts(ids: string[]): Promise<Map<string, ProcChallanFacts>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, ProcChallanFacts>();
  if (unique.length === 0) return map;

  const [outRes, returnRes, lineRes] = await Promise.all([
    supabase
      .from('mm_process_out_lines')
      .select(`
        challan_id, qty, uom, qty_kg, line_status,
        roll:mm_rolls!mm_process_out_lines_roll_id_fkey (
          unit_form,
          fabric:mm_fabrics!mm_rolls_fabric_id_fkey (name),
          fabric_type:mm_fabric_types!mm_rolls_fabric_type_id_fkey (name)
        )
      `)
      .in('challan_id', unique),
    supabase.from('mm_process_returns').select('challan_id, returned_at').in('challan_id', unique),
    supabase.from('mm_process_return_lines').select('challan_id, qty, uom, qty_kg, unit_form').in('challan_id', unique),
  ]);

  const failed = outRes.error ?? returnRes.error ?? lineRes.error;
  if (failed) throw new Error(failed.message);

  const fabrics = new Map<string, Set<string>>();
  const sentQty = new Map<string, Array<{ qty: number; uom: string }>>();
  const sentForms = new Map<string, string[]>();
  for (const raw of (outRes.data ?? []) as Record<string, unknown>[]) {
    if (String(raw.line_status ?? '').toLowerCase() === 'void') continue;
    const id = String(raw.challan_id ?? '');
    if (!id) continue;
    const fabric = lineFabric(raw);
    if (fabric) {
      const names = fabrics.get(id) ?? new Set<string>();
      names.add(fabric);
      fabrics.set(id, names);
    }
    const qty = Number(raw.qty);
    const kg = Number(raw.qty_kg);
    const uom = String(raw.uom ?? '').trim().toLowerCase();
    const amount = Number.isFinite(qty) && qty > 0 ? qty : (Number.isFinite(kg) && kg > 0 ? kg : 0);
    const unit = uom || (amount > 0 && kg > 0 && !(qty > 0) ? 'kg' : '');
    const bucket = sentQty.get(id) ?? [];
    bucket.push({ qty: amount, uom: unit });
    sentQty.set(id, bucket);
    const forms = sentForms.get(id) ?? [];
    forms.push(lineForm(raw));
    sentForms.set(id, forms);
  }

  const receivedAt = new Map<string, string>();
  for (const row of returnRes.data ?? []) {
    const id = String(row.challan_id);
    const at = String(row.returned_at ?? '');
    if (!at) continue;
    const prev = receivedAt.get(id);
    if (!prev || at > prev) receivedAt.set(id, at);
  }

  const receivedQty = new Map<string, Array<{ qty: number; uom: string }>>();
  const receivedForms = new Map<string, string[]>();
  for (const row of lineRes.data ?? []) {
    const id = String(row.challan_id);
    const qty = Number(row.qty);
    const kg = Number(row.qty_kg);
    const uom = String(row.uom ?? '').trim().toLowerCase();
    const amount = Number.isFinite(qty) && qty > 0 ? qty : (Number.isFinite(kg) && kg > 0 ? kg : 0);
    const bucket = receivedQty.get(id) ?? [];
    bucket.push({ qty: amount, uom: uom || 'kg' });
    receivedQty.set(id, bucket);
    const forms = receivedForms.get(id) ?? [];
    forms.push(String(row.unit_form || 'roll'));
    receivedForms.set(id, forms);
  }

  for (const id of unique) {
    const names = [...(fabrics.get(id) ?? [])];
    map.set(id, {
      fabric: names.length > 0 ? names.join(', ') : '—',
      sentQty: qtyText(sentQty.get(id) ?? []),
      sentCount: (sentForms.get(id) ?? []).length > 0 ? countText(sentForms.get(id) ?? []) : '—',
      receivedAt: dateLabel(receivedAt.get(id)),
      receivedQty: qtyText(receivedQty.get(id) ?? []),
      receivedCount: (receivedForms.get(id) ?? []).length > 0 ? countText(receivedForms.get(id) ?? []) : '—',
    });
  }
  return map;
}
