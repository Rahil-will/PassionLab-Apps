import { describe, expect, it } from 'vitest';
import type { MmStyleWarehouseRoll, MmTestField } from './mmRpc';
import {
  groupStyleRollsByKeys,
  inboundChallanInspected,
  matchAttrField,
  numericRangeLabel,
  type GroupStep,
} from './mmStyleRollGroups';

const FIELDS: MmTestField[] = [
  { id: '1', key: 'width', label: 'Width', data_type: 'decimal', options: null },
  { id: '2', key: 'shrinkage-w', label: 'Shrinkage W%', data_type: 'decimal', options: null },
  { id: '3', key: 'shrinkage-l', label: 'Shrinkage L%', data_type: 'decimal', options: null },
  { id: '4', key: 'gsm', label: 'GSM', data_type: 'number', options: null },
];

function roll(partial: Partial<MmStyleWarehouseRoll> & Pick<MmStyleWarehouseRoll, 'id' | 'unit_code'>): MmStyleWarehouseRoll {
  return {
    length_m: 10,
    shade: 'A',
    lot_no: 'L1',
    source: 'mill',
    status: 'in_stock',
    qc_result: 'pass',
    in_challan_id: 'ch-1',
    store_challan_id: null,
    color_name: 'Green',
    fabric_name: 'Cotton 80',
    fabric_type: 'Knit',
    location_code: 'R1',
    location_name: 'Rack 1',
    bucket: 'racked',
    attributes: { width: '58.4', 'shrinkage-w': '1.4', 'shrinkage-l': '2.1', gsm: '160' },
    mill_snapshot: null,
    fabric_type_id: 'ft-1',
    ...partial,
  };
}

const steps = (keys: GroupStep['key'][], range = 1): GroupStep[] =>
  keys.map((key) => ({ key, rangeStep: range }));

describe('numericRangeLabel', () => {
  it('groups shrinkage into 1 to 2 bands', () => {
    expect(numericRangeLabel('1.4', 1)).toBe('1 to 2');
    expect(numericRangeLabel('2.0', 1)).toBe('2 to 3');
    expect(numericRangeLabel('0.2', 1)).toBe('0 to 1');
  });

  it('uses half-step bands', () => {
    expect(numericRangeLabel('1.4', 0.5)).toBe('1 to 1.5');
  });

  it('keeps blank values as a dash', () => {
    expect(numericRangeLabel('', 1)).toBe('—');
  });
});

describe('matchAttrField', () => {
  it('finds width without matching shrinkage width', () => {
    expect(matchAttrField(FIELDS, 'width')?.key).toBe('width');
    expect(matchAttrField(FIELDS, 'shrinkW')?.key).toBe('shrinkage-w');
    expect(matchAttrField(FIELDS, 'shrinkL')?.key).toBe('shrinkage-l');
  });
});

describe('groupStyleRollsByKeys', () => {
  const fieldsFor = () => FIELDS;

  it('groups color / fabric / shade / width', () => {
    const tree = groupStyleRollsByKeys(
      [
        roll({ id: '1', unit_code: 'R2', shade: 'B', attributes: { width: '59.1', 'shrinkage-w': '1.1' } }),
        roll({ id: '2', unit_code: 'R1', shade: 'A', attributes: { width: '58.4', 'shrinkage-w': '1.1' } }),
        roll({ id: '3', unit_code: 'R3', shade: 'A', attributes: { width: '58.9', 'shrinkage-w': '1.1' } }),
      ],
      steps(['color', 'fabric', 'shade', 'width']),
      fieldsFor,
    );
    expect(tree.map((node) => node.label)).toEqual(['Green']);
    const fabric = tree[0].children?.[0];
    expect(fabric?.label).toBe('Cotton 80');
    expect(fabric?.children?.map((node) => node.label)).toEqual(['A', 'B']);
    const shadeA = fabric?.children?.[0];
    expect(shadeA?.children?.map((node) => node.label)).toEqual(['58 to 59']);
    expect(shadeA?.children?.[0].rolls.map((row) => row.unit_code)).toEqual(['R1', 'R3']);
  });

  it('uses the range on that grouping step only', () => {
    const tree = groupStyleRollsByKeys(
      [
        roll({ id: '1', unit_code: 'R1', attributes: { 'shrinkage-w': '1.2' } }),
        roll({ id: '2', unit_code: 'R2', attributes: { 'shrinkage-w': '1.9' } }),
        roll({ id: '3', unit_code: 'R3', attributes: { 'shrinkage-w': '2.4' } }),
      ],
      [{ key: 'color' }, { key: 'fabric' }, { key: 'shrinkW', rangeStep: 1 }],
      fieldsFor,
    );
    const bands = tree[0].children?.[0].children ?? [];
    expect(bands.map((node) => node.label)).toEqual(['1 to 2', '2 to 3']);
    expect(bands[0].rolls.map((row) => row.unit_code)).toEqual(['R1', 'R2']);
  });

  it('respects a custom grouping order', () => {
    const tree = groupStyleRollsByKeys(
      [
        roll({ id: '1', unit_code: 'R1', shade: 'A', attributes: { gsm: '160' } }),
        roll({ id: '2', unit_code: 'R2', shade: 'B', attributes: { gsm: '160' } }),
      ],
      [{ key: 'gsm', rangeStep: 10 }, { key: 'shade' }],
      fieldsFor,
    );
    expect(tree.map((node) => node.label)).toEqual(['160 to 170']);
    expect(tree[0].children?.map((node) => node.label)).toEqual(['A', 'B']);
  });
});

describe('inboundChallanInspected', () => {
  it('is true when every received roll on the challan has pass or fail', () => {
    expect(
      inboundChallanInspected('ch-1', [
        roll({ id: '1', unit_code: 'R1', qc_result: 'pass' }),
        roll({ id: '2', unit_code: 'R2', qc_result: 'fail' }),
      ]),
    ).toBe(true);
  });

  it('is false when any roll is still pending inspection', () => {
    expect(
      inboundChallanInspected('ch-1', [
        roll({ id: '1', unit_code: 'R1', qc_result: 'pass' }),
        roll({ id: '2', unit_code: 'R2', qc_result: null }),
      ]),
    ).toBe(false);
  });
});
