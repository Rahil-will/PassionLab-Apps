import { describe, expect, it } from 'vitest';
import {
  applyFill,
  applyPaste,
  normalizePassFail,
  parseTsv,
  serializeTsv,
} from '../modules/material/lib/mmSheetGrid';

describe('tsv clipboard', () => {
  it('round-trips a rectangular block', () => {
    const grid = [
      ['pass', '4.2'],
      ['fail', ''],
    ];
    expect(parseTsv(serializeTsv(grid))).toEqual(grid);
  });

  it('parses Excel-style tabs and newlines', () => {
    expect(parseTsv('pass\t12\r\nfail\t8')).toEqual([
      ['pass', '12'],
      ['fail', '8'],
    ]);
  });
});

describe('applyPaste', () => {
  it('writes from the origin and clips to the grid', () => {
    const writes = applyPaste(
      [
        ['a', 'b', 'drop'],
        ['c', 'd', 'drop'],
      ],
      { row: 1, col: 1 },
      3,
      3,
    );
    expect(writes).toEqual([
      { row: 1, col: 1, value: 'a' },
      { row: 1, col: 2, value: 'b' },
      { row: 2, col: 1, value: 'c' },
      { row: 2, col: 2, value: 'd' },
    ]);
  });
});

describe('applyFill', () => {
  it('copies one cell down the drag', () => {
    expect(applyFill([['pass']], { r0: 0, c0: 2, r1: 0, c1: 2 }, 3, 2)).toEqual([
      { row: 0, col: 2, value: 'pass' },
      { row: 1, col: 2, value: 'pass' },
      { row: 2, col: 2, value: 'pass' },
      { row: 3, col: 2, value: 'pass' },
    ]);
  });
});

describe('normalizePassFail', () => {
  it('accepts short excel values', () => {
    expect(normalizePassFail('P')).toBe('pass');
    expect(normalizePassFail('Fail')).toBe('fail');
    expect(normalizePassFail('maybe')).toBe('');
  });
});
