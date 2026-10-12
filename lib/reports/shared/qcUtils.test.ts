import { describe, expect, it } from 'vitest';
import { qcSessionDefectiveQty, qcSessionOutputQty, qualityDayDefectivePct } from './qcUtils';

describe('qcSessionOutputQty', () => {
  it('returns passed count as number', () => {
    expect(qcSessionOutputQty({ passed: 42 })).toBe(42);
  });

  it('treats missing or invalid passed as zero', () => {
    expect(qcSessionOutputQty({})).toBe(0);
    expect(qcSessionOutputQty({ passed: 'x' })).toBe(0);
  });
});

describe('qcSessionDefectiveQty', () => {
  it('returns failed count as number', () => {
    expect(qcSessionDefectiveQty({ failed: 3 })).toBe(3);
  });

  it('treats missing or invalid failed as zero', () => {
    expect(qcSessionDefectiveQty({})).toBe(0);
    expect(qcSessionDefectiveQty({ failed: null })).toBe(0);
  });
});

describe('qualityDayDefectivePct', () => {
  it('uses stored defective_pct when present', () => {
    expect(
      qualityDayDefectivePct({ inspected: 265, failed: 0, firstTimePass: 262, defectivePct: 1.13 }),
    ).toBe(1.13);
  });

  it('falls back to inspected minus first-time pass when failed is zero', () => {
    const pct = qualityDayDefectivePct({ inspected: 265, failed: 0, firstTimePass: 262 });
    expect(pct).toBeCloseTo(1.132, 2);
  });

  it('returns null when nothing was inspected', () => {
    expect(qualityDayDefectivePct({ inspected: 0, failed: 3 })).toBeNull();
  });
});
