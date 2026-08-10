import { describe, expect, it } from 'vitest';
import { qcSessionDefectiveQty, qcSessionOutputQty } from './qcUtils';

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
