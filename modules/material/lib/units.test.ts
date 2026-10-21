import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatStoredQty,
  formatStoredWidth,
  parseUnitCodeList,
  qtyFromStored,
  qtyLabel,
  qtyToStored,
  setUnitCatalog,
  widthFromStored,
  widthLabel,
  widthToStored,
  type MmUnit,
} from './units';

const UNITS: MmUnit[] = [
  { code: 'kg', kind: 'qty', label: 'KG', base: 'kg', factor: 1, aliases: ['kgs'] },
  { code: 'lb', kind: 'qty', label: 'LBS', base: 'kg', factor: 0.45359237, aliases: ['lbs'] },
  { code: 'm', kind: 'qty', label: 'MTR', base: 'm', factor: 1, aliases: ['mtr'] },
  { code: 'yd', kind: 'qty', label: 'YD', base: 'm', factor: 0.9144, aliases: ['yds', 'yard', 'yards'] },
  { code: 'in', kind: 'width', label: 'Inches', base: 'in', factor: 1, aliases: ['inch', 'inches'] },
  { code: 'cm', kind: 'width', label: 'CM', base: 'in', factor: 0.3937007874, aliases: ['cms'] },
];

describe('fabric units', () => {
  beforeEach(() => setUnitCatalog(UNITS));

  it('stores 150 cm as inches using the unit factor and shows CM or Inches', () => {
    const stored = widthToStored(150, 'cm');
    expect(stored).toBeCloseTo(150 * 0.3937007874, 8);
    expect(widthFromStored(stored, 'cm')).toBeCloseTo(150, 6);
    expect(widthFromStored(59.055, 'in')).toBe(59.055);
    expect(formatStoredWidth(59.055, 'in')).toBe('59.1 Inches');
    expect(formatStoredWidth(stored, 'cm')).toBe('150 CM');
    expect(widthToStored(60, 'in')).toBe(60);
    expect(widthFromStored(null, 'cm')).toBeNull();
    expect(widthToStored(null, 'in')).toBeNull();
    expect(widthLabel('cm')).toBe('CM');
    expect(widthLabel('in')).toBe('Inches');
  });

  it('stores 100 yd as 91.44 m and 1 lb as its kg factor', () => {
    expect(qtyToStored(100, 'yd')).toBeCloseTo(91.44, 8);
    expect(qtyFromStored(91.44, 'yd')).toBeCloseTo(100, 6);
    expect(qtyToStored(1, 'lb')).toBeCloseTo(0.45359237, 8);
    expect(qtyToStored(12, 'kg')).toBe(12);
    expect(qtyFromStored(12, 'm')).toBe(12);
    expect(qtyFromStored(null, 'yd')).toBeNull();
    expect(formatStoredQty(91.44, 'yd')).toBe('100 YD');
    expect(qtyLabel('kg')).toBe('KG');
    expect(qtyLabel('m')).toBe('MTR');
    expect(qtyLabel('yd')).toBe('YD');
    expect(qtyLabel('lb')).toBe('LBS');
  });

  it('uses factor 1 and the raw code when the unit is unknown', () => {
    expect(qtyToStored(12, 'foo')).toBe(12);
    expect(qtyFromStored(12, 'foo')).toBe(12);
    expect(qtyLabel('foo')).toBe('foo');
    expect(widthLabel('foo')).toBe('foo');
  });

  it('reads a jsonb array or a single code string', () => {
    expect(parseUnitCodeList(['m', 'yd'])).toEqual(['m', 'yd']);
    expect(parseUnitCodeList('yd')).toEqual(['yd']);
    expect(parseUnitCodeList('["m","YD"]')).toEqual(['m', 'yd']);
  });
});
