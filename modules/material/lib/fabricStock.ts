import type { MmStockBucket, MmStockTotals } from './mmFabricRpc';

const QTY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export function fmtNum(value: number | null | undefined): string {
  return QTY.format(Number(value) || 0);
}

/** On-hand text. kg/m use `on_hand`; mixed prints both measures. */
export function fmtQty(
  totals: Pick<MmStockTotals, 'on_hand' | 'on_hand_kg' | 'on_hand_m'>,
  uom: 'kg' | 'm' | 'mixed',
): string {
  if (uom === 'mixed') return `${fmtNum(totals.on_hand_kg)} kg · ${fmtNum(totals.on_hand_m)} m`;
  return `${fmtNum(totals.on_hand)} ${uom}`;
}

export function fmtUomQty(value: number | null | undefined, uom: 'kg' | 'm' | 'mixed'): string {
  if (uom === 'mixed') return fmtNum(value);
  return `${fmtNum(value)} ${uom}`;
}

const BUCKET_LABELS: Record<MmStockBucket, string> = {
  at_mill: 'At mill',
  at_processing: 'At processing',
  qc_pending: 'QC pending',
  on_hold: 'On hold',
  rejected: 'Rejected',
  in_stock: 'In stock',
  issued: 'Issued',
  on_hand: 'On hand',
};

export function bucketLabel(bucket: MmStockBucket): string {
  return BUCKET_LABELS[bucket];
}

/** Strip the v4 `FABRIC_MISMATCH:` prefix. Returns null when this is not a fabric mismatch. */
export function fabricMismatchMessage(
  res: { ok?: boolean; code?: string; message?: string } | null | undefined,
): string | null {
  if (!res || res.ok) return null;
  const message = res.message ?? '';
  if (res.code === 'FABRIC_MISMATCH' || message.startsWith('FABRIC_MISMATCH:')) {
    return message.replace(/^FABRIC_MISMATCH:\s*/, '').trim();
  }
  return null;
}

export function mismatchHitsRoll(message: string, rollCode: string | null | undefined): boolean {
  const code = (rollCode ?? '').trim();
  if (!code) return false;
  return message.toLowerCase().includes(code.toLowerCase());
}

export function differentFabric(
  lineFabricId: string | null | undefined,
  rollFabricId: string | null | undefined,
): boolean {
  if (!lineFabricId || !rollFabricId) return false;
  return lineFabricId !== rollFabricId;
}
