import { describe, expect, it } from 'vitest';
import { colorwayDisplayLabel, fetchColorwayLabels, type ColorwayLabel } from './reportMeta';

describe('colorwayDisplayLabel', () => {
  const map = new Map<string, ColorwayLabel>([
    ['cw-1', { id: 'cw-1', orderId: 'o-1', name: 'Navy', colorCode: 'NVY' }],
    ['cw-2', { id: 'cw-2', orderId: 'o-1', name: 'White', colorCode: null }],
  ]);

  it('returns legacy label for null colorway id', () => {
    expect(colorwayDisplayLabel(null, map)).toBe('Order (legacy)');
    expect(colorwayDisplayLabel(undefined, map)).toBe('Order (legacy)');
  });

  it('formats name with color code when present', () => {
    expect(colorwayDisplayLabel('cw-1', map)).toBe('Navy (NVY)');
  });

  it('returns name only when color code is absent', () => {
    expect(colorwayDisplayLabel('cw-2', map)).toBe('White');
  });

  it('falls back to truncated id when label is missing', () => {
    expect(colorwayDisplayLabel('abcdefgh-xyz', map)).toBe('abcdefgh');
  });
});

describe('fetchColorwayLabels', () => {
  it('returns empty array when no scope is provided', async () => {
    await expect(fetchColorwayLabels('factory-1')).resolves.toEqual([]);
  });

  it('returns empty array for empty orderIds', async () => {
    await expect(fetchColorwayLabels('factory-1', { orderIds: [] })).resolves.toEqual([]);
  });
});
