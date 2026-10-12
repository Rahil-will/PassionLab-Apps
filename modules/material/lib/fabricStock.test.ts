import { describe, expect, it } from 'vitest';
import { bucketLabel, fabricMismatchMessage, fmtQty } from './fabricStock';
import type { MmStockTotals } from './mmFabricRpc';

const totals = {
  on_hand: 1293,
  on_hand_kg: 1293,
  on_hand_m: 2293.5,
} as Pick<MmStockTotals, 'on_hand' | 'on_hand_kg' | 'on_hand_m'>;

describe('fmtQty', () => {
  it('uses on_hand for a single UOM', () => {
    expect(fmtQty(totals, 'kg')).toBe('1,293 kg');
    expect(fmtQty({ ...totals, on_hand: 40 }, 'm')).toBe('40 m');
  });

  it('prints both measures for mixed stock', () => {
    expect(fmtQty(totals, 'mixed')).toBe('1,293 kg · 2,293.5 m');
  });
});

describe('bucketLabel', () => {
  it('names every stock bucket', () => {
    expect(bucketLabel('at_mill')).toBe('At mill');
    expect(bucketLabel('at_processing')).toBe('At processing');
    expect(bucketLabel('qc_pending')).toBe('QC pending');
    expect(bucketLabel('on_hold')).toBe('On hold');
    expect(bucketLabel('rejected')).toBe('Rejected');
    expect(bucketLabel('in_stock')).toBe('In stock');
    expect(bucketLabel('issued')).toBe('Issued');
  });
});

describe('fabricMismatchMessage', () => {
  it('strips the prefix when the code or the message says so', () => {
    expect(fabricMismatchMessage({
      ok: false,
      code: 'FABRIC_MISMATCH',
      message: 'This style line uses FAB-0002, not FAB-0001',
    })).toBe('This style line uses FAB-0002, not FAB-0001');
    expect(fabricMismatchMessage({
      ok: false,
      code: 'ERROR',
      message: 'FABRIC_MISMATCH: roll R-00012 is FAB-0001 but this style line uses FAB-0002',
    })).toBe('roll R-00012 is FAB-0001 but this style line uses FAB-0002');
  });

  it('returns null for other errors and successes', () => {
    expect(fabricMismatchMessage({ ok: false, code: 'INVALID', message: 'Unknown bucket' })).toBeNull();
    expect(fabricMismatchMessage({ ok: true, message: 'FABRIC_MISMATCH: ignored' })).toBeNull();
    expect(fabricMismatchMessage(null)).toBeNull();
  });
});
