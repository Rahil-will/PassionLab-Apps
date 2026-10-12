import type { MmInChallanHeader } from './mmRpc';

/** Catalog category for inbound rows (not fabric type name). */
export function inboundFabricCategory(row: { fabric_category?: string | null }): string {
  const raw = (row.fabric_category ?? '').trim();
  if (raw && raw.toLowerCase() !== 'fabric' && raw.toLowerCase() !== 'trim') {
    return raw;
  }
  return '—';
}

export function inboundWhen(row: MmInChallanHeader): string | null {
  if (row.source === 'vendor') return row.received_at;
  if (row.status === 'received') return row.received_at ?? row.sent_at;
  return row.sent_at ?? row.received_at;
}

/** Mill for internal inbound; vendor name for external GRNs. */
export function inboundSourceLabel(row: MmInChallanHeader): string {
  if (row.source === 'vendor') {
    const name = (row.supplier_name ?? '').trim();
    return name || 'Vendor';
  }
  return 'Mill';
}

export function inboundStatusDot(status: string): string {
  if (status === 'passed' || status === 'received' || status === 'in_stock' || status === 'done') return 'bg-emerald-500';
  if (
    status === 'pending' ||
    status === 'pending_qc' ||
    status === 'pending_test' ||
    status === 'in_transit' ||
    status === 'mixed'
  ) {
    return 'bg-amber-500';
  }
  if (status === 'rejected' || status === 'failed') return 'bg-red-500';
  return 'bg-slate-300';
}

export function storeDispatchStatusLabel(status: string | null | undefined): string {
  if (status === 'received') return 'Received';
  if (status === 'partial') return 'Partial';
  if (status === 'pending' || status === 'in_transit') return 'Pending receive';
  if (!status) return '—';
  return status.replace(/_/g, ' ');
}

export function storeDispatchStatusClass(status: string | null | undefined): string {
  const label = storeDispatchStatusLabel(status);
  if (label === 'Received') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (label === 'Partial') return 'bg-orange-50 text-orange-800 border-orange-200';
  if (label === 'Pending receive') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function inboundStatusText(status: string): string {
  if (status === 'passed' || status === 'received' || status === 'in_stock' || status === 'done') return 'text-emerald-600';
  if (
    status === 'pending' ||
    status === 'pending_qc' ||
    status === 'pending_test' ||
    status === 'in_transit' ||
    status === 'mixed'
  ) {
    return 'text-amber-600';
  }
  if (status === 'rejected' || status === 'failed') return 'text-red-600';
  return 'text-slate-400';
}

export function isInboundPhysicallyIn(row: MmInChallanHeader): boolean {
  return row.status === 'received' || row.status === 'partial' || row.status === 'short_closed';
}

/** Mill/vendor challan dispatched to warehouse, not received yet. */
export function isInboundAwaitingReceive(row: MmInChallanHeader): boolean {
  return row.status === 'pending' || row.status === 'in_transit';
}

export function inboundDocKind(row: Pick<MmInChallanHeader, 'source'>): 'GRN' | 'Challan' {
  return row.source === 'vendor' ? 'GRN' : 'Challan';
}

export function inboundPassedRolls(row: MmInChallanHeader): number {
  const derived = Math.max(0, Number(row.tested_count || 0) - Number(row.failed_count || 0));
  if (typeof row.passed_count === 'number' && row.passed_count > derived) return row.passed_count;
  return derived;
}

/** True when received fabric still has untested rolls. */
export function inboundTestingPending(row: MmInChallanHeader): boolean {
  if (row.status === 'pending' || row.status === 'in_transit') return false;
  const rolls = Number(row.roll_count || 0);
  const tested = Number(row.tested_count || 0);
  if ((row.pending_qc_count ?? 0) > 0) return true;
  return rolls > 0 && tested < rolls;
}

export type InboundOpsStatus = 'in_transit' | 'pending_test' | 'passed' | 'failed' | 'mixed' | 'received';

export function inboundOpsStatus(row: MmInChallanHeader): InboundOpsStatus {
  if (row.status === 'pending' || row.status === 'in_transit') return 'in_transit';
  const rolls = Number(row.roll_count || 0);
  const tested = Number(row.tested_count || 0);
  const failed = Number(row.failed_count || 0);
  const passed = inboundPassedRolls(row);
  if (inboundTestingPending(row)) return 'pending_test';
  if (rolls === 0) return 'received';
  if (failed > 0 && passed > 0) return 'mixed';
  if (failed > 0 && passed === 0) return 'failed';
  if (tested > 0 && failed === 0) return 'passed';
  return 'pending_test';
}

export function inboundOpsStatusClass(status: InboundOpsStatus | string): string {
  if (status === 'passed' || status === 'received') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'in_transit' || status === 'pending_test' || status === 'mixed') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'failed') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function inboundOpsStatusLabel(status: InboundOpsStatus | string): string {
  if (status === 'in_transit') return 'In transit';
  if (status === 'pending_test') return 'Pending test';
  if (status === 'passed') return 'Passed';
  if (status === 'failed') return 'Failed';
  if (status === 'mixed') return 'Mixed';
  if (status === 'received') return 'Received';
  return status.replace(/_/g, ' ');
}

export function inboundOpsStatusFilterOptions(includeInTransit: boolean): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [{ value: '', label: 'All statuses' }];
  if (includeInTransit) options.push({ value: 'in_transit', label: inboundOpsStatusLabel('in_transit') });
  options.push(
    { value: 'pending_test', label: inboundOpsStatusLabel('pending_test') },
    { value: 'passed', label: inboundOpsStatusLabel('passed') },
    { value: 'failed', label: inboundOpsStatusLabel('failed') },
    { value: 'mixed', label: inboundOpsStatusLabel('mixed') },
  );
  return options;
}

export function inboundHasPendingTests(row: MmInChallanHeader): boolean {
  return inboundTestingPending(row);
}

export function inboundIsStyleBound(row: Pick<MmInChallanHeader, 'style_material_id'>): boolean {
  return Boolean(row.style_material_id);
}

export function inboundStyleKindLabel(
  row: Pick<MmInChallanHeader, 'style_material_id'>,
): 'Style' | 'General PO' {
  return inboundIsStyleBound(row) ? 'Style' : 'General PO';
}

export function inboundStyleDisplayName(
  row: Pick<MmInChallanHeader, 'style_name' | 'style_material_id'>,
): string {
  if (!row.style_material_id) return 'General PO';
  return (row.style_name || '').trim() || '—';
}

/** Read-only invoice-level inspection summary derived from challan roll results. */
export function inboundInvoiceInspection(row: MmInChallanHeader): {
  samplePct: number | null;
  checked: number;
  rolls: number;
  verdict: 'pass' | 'fail' | 'pending' | 'none';
  label: string;
} {
  const rolls = Number(row.roll_count || 0);
  const checked = Number(row.tested_count || 0);
  const failed = Number(row.failed_count || 0);
  const pending = Number(row.pending_qc_count || 0);
  const samplePct = rolls > 0 && checked > 0 ? Math.round((checked / rolls) * 100) : null;
  if (rolls === 0 || (checked === 0 && pending === 0)) {
    return { samplePct: null, checked, rolls, verdict: 'none', label: 'Not recorded' };
  }
  if (failed > 0) {
    return { samplePct, checked, rolls, verdict: 'fail', label: 'Fail' };
  }
  if (pending > 0 || (rolls > 0 && checked < rolls)) {
    return { samplePct, checked, rolls, verdict: 'pending', label: 'Pending' };
  }
  return { samplePct, checked, rolls, verdict: 'pass', label: 'Pass' };
}
