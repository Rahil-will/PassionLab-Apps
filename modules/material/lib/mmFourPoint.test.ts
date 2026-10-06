import { describe, expect, it } from 'vitest';
import {
  fourPointScore,
  fourPointVerdict,
  fourPointValues,
  toFourPointDraft,
} from './mmFourPoint';

describe('toFourPointDraft', () => {
  it('locks a roll that already has a 4-point result', () => {
    const row = toFourPointDraft({
      id: 'r1',
      unit_code: 'R01',
      length_m: 42,
      shade: 'A',
      qc_result: 'pass',
    });
    expect(row.inspected).toBe(true);
    expect(row.result).toBe('pass');
  });
});

describe('fourPointScore', () => {
  it('scores points per 100 sq yd', () => {
    const row = toFourPointDraft({ id: 'r1', unit_code: 'R01', length_m: 50 });
    row.inspectedLength = '91.44';
    row.actualWidth = '36';
    row.pts4 = '1';
    expect(fourPointScore(row, 'm')).toBe(4);
    expect(fourPointVerdict(2)).toBe('pass');
  });
});

describe('fourPointValues', () => {
  it('stores measured length and width for the save payload', () => {
    const row = toFourPointDraft({ id: 'r1', unit_code: 'R01' });
    row.inspectedLength = '40';
    row.actualWidth = '60';
    row.cuttableWidth = '58';
    row.result = 'pass';
    expect(fourPointValues(row)).toMatchObject({
      inspected_length: '40',
      actual_width: '60',
      cuttable_width: '58',
      inspected_width_in: '60',
      width_uom: 'in',
    });
  });
});
