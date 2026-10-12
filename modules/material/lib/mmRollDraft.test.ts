import { describe, expect, it } from 'vitest';
import {
  fieldsForType,
  measureOutOfSpec,
  withLengthField,
  fieldRole,
  millRollFieldText,
  millFieldSeedText,
  seedWarehouseFieldValues,
  warehouseMeasuredFieldValues,
  warehouseTestFields,
  millRollWorkStatus,
  millRollWorkStatusLabel,
  growMillBatchRolls,
  sortMillAssignDrafts,
  type MmDraftRoll,
} from './mmRollDraft';

describe('withLengthField', () => {
  it('still adds qty when the field list is missing', () => {
    const cols = withLengthField(undefined as unknown as never);
    expect(cols.some((field) => fieldRole(field) === 'length')).toBe(true);
    expect(cols.some((field) => fieldRole(field) === 'shade')).toBe(true);
  });

  it('always injects a dedicated shade column and drops a catalog shade metric', () => {
    const cols = withLengthField([
      { id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal', options: null },
      { id: 's', key: 'shade', label: 'Shade', data_type: 'select', options: ['A'] },
      { id: 'g', key: 'gsm', label: 'GSM', data_type: 'number', options: null },
    ]);
    expect(cols.map((field) => field.key)).toEqual(['length_m', 'shade', 'gsm']);
  });

  it('keeps a catalog shade column when shade is not injected', () => {
    const cols = withLengthField([
      { id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal', options: null },
      { id: 's', key: 'shade', label: 'Shade', data_type: 'select', options: ['A'] },
    ], undefined, { injectShade: false });
    expect(cols.map((field) => field.key)).toEqual(['length_m', 'shade']);
  });
});

describe('measureOutOfSpec', () => {
  it('flags a width outside ±2.5% and ignores an empty actual', () => {
    expect(measureOutOfSpec('60', '62', '2.5')).toBe(true);
    expect(measureOutOfSpec('60', '61', '2.5')).toBe(false);
    expect(measureOutOfSpec('60', '', '2.5')).toBe(false);
  });
});

describe('fieldsForType', () => {
  it('returns an array even when the pack fields value is not an array', () => {
    const cols = fieldsForType(
      [{ type_id: 't1', fields: { key: 'gsm' } as unknown as never }],
      't1',
    );
    expect(Array.isArray(cols)).toBe(true);
    expect(cols).toEqual([]);
  });
});

describe('fieldRole', () => {
  it('does not throw when key or label is null', () => {
    expect(
      fieldRole({
        id: '1',
        key: null as unknown as string,
        label: null as unknown as string,
        data_type: 'decimal',
        options: null,
      }),
    ).toBe('attr');
  });
});

describe('millRollFieldText', () => {
  const qtyField = { id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal', options: null };

  it('prefers mill_snapshot over live warehouse columns', () => {
    expect(
      millRollFieldText(
        {
          length_m: 12,
          mill_snapshot: { length_m: 10, shade: 'A1' },
          shade: 'WH',
          lot_no: null,
          attributes: null,
        },
        qtyField,
      ),
    ).toBe('10');
  });

  it('falls back to live columns when mill_snapshot is null', () => {
    expect(
      millRollFieldText(
        {
          length_m: 12,
          mill_snapshot: null,
          shade: null,
          lot_no: null,
          attributes: null,
        },
        qtyField,
      ),
    ).toBe('12');
  });

  it('reads mill identity shade from mill_snapshot.shade before catalog attributes', () => {
    const shadeField = { id: 's', key: 'shade', label: 'Shade', data_type: 'select', options: null };
    expect(
      millRollFieldText(
        {
          length_m: 12,
          shade: 'COLUMN',
          mill_snapshot: { shade: 'SNAP', attributes: { shade: 'JSON' } },
          attributes: { shade: 'LIVE' },
        },
        shadeField,
      ),
    ).toBe('SNAP');
  });
});

describe('warehouseTestFields', () => {
  const knitFields = [
    { id: '1', key: 'gsm', label: 'GSM', data_type: 'number' as const, options: null },
    { id: '2', key: 'shrinkage-l', label: 'Shrinkage L%', data_type: 'decimal' as const, options: null },
    { id: '3', key: 'shrinkage-w', label: 'Shrinkage W%', data_type: 'decimal' as const, options: null },
    { id: '4', key: 'width', label: 'Width', data_type: 'decimal' as const, options: null },
    { id: '5', key: 'shade', label: 'Shade', data_type: 'select' as const, options: ['A', 'B', 'C'] },
    { id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal' as const, options: null },
  ];

  it('drops stock qty and shade, keeping other mill type test fields', () => {
    expect(warehouseTestFields(knitFields).map((field) => field.key)).toEqual([
      'gsm',
      'shrinkage-l',
      'shrinkage-w',
      'width',
    ]);
  });

  it('does not take columns from mill attributes', () => {
    const catalog = [
      { id: '1', key: 'gsm', label: 'GSM', data_type: 'number' as const, options: null },
      { id: '2', key: 'width', label: 'Width', data_type: 'decimal' as const, options: null },
    ];
    expect(warehouseTestFields(catalog).map((field) => field.key)).toEqual(['gsm', 'width']);
  });
});

describe('seedWarehouseFieldValues', () => {
  const gsm = { id: 'g', key: 'gsm', label: 'GSM', data_type: 'decimal', options: null };
  const shade = { id: 's', key: 'shade', label: 'Shade', data_type: 'select', options: ['A', 'B'] };
  const width = { id: 'w', key: 'width', label: 'Width', data_type: 'decimal', options: null };

  it('fills catalog cells from mill declared attributes', () => {
    expect(
      seedWarehouseFieldValues(
        { length_m: 42, mill_snapshot: { attributes: { gsm: '160', shade: 'A' } } },
        {},
        [gsm, shade, width],
      ),
    ).toEqual({ gsm: '160', width: '' });
  });

  it('keeps a warehouse value that was already recorded', () => {
    expect(
      seedWarehouseFieldValues(
        { length_m: 42, mill_snapshot: { attributes: { gsm: '160' } } },
        { gsm: '158' },
        [gsm, width],
      ),
    ).toEqual({ gsm: '158', width: '' });
  });

  it('shows a catalog column as blank when mill missed that attribute', () => {
    expect(
      seedWarehouseFieldValues(
        { length_m: 42, mill_snapshot: { attributes: { gsm: '160' } } },
        {},
        [gsm, shade, width],
      ),
    ).toEqual({ gsm: '160', width: '' });
  });

  it('does not seed an em dash into the warehouse cell', () => {
    expect(millFieldSeedText({ length_m: 1, attributes: {} }, gsm)).toBe('');
  });
});

describe('warehouseMeasuredFieldValues', () => {
  const gsm = { id: 'g', key: 'gsm', label: 'GSM', data_type: 'decimal', options: null };
  const shade = { id: 's', key: 'shade', label: 'Shade', data_type: 'select', options: null };
  const width = { id: 'w', key: 'width', label: 'Width', data_type: 'decimal', options: null };

  it('writes only warehouse edits, not mill copies or blanks', () => {
    expect(
      warehouseMeasuredFieldValues(
        { gsm: '160', shade: 'A', width: '' },
        { gsm: '160', shade: 'B', width: '  ' },
        [gsm, shade, width],
      ),
    ).toEqual({});
  });
});

describe('millRollWorkStatus', () => {
  it('marks unsaved extra rolls as new / not yet sent', () => {
    expect(millRollWorkStatus({})).toBe('new');
    expect(millRollWorkStatusLabel('new')).toBe('New');
  });

  it('marks mill drafts as not sent', () => {
    expect(millRollWorkStatus({ id: 'r1', at_mill: true })).toBe('not_sent');
    expect(millRollWorkStatusLabel('not_sent')).toBe('Not sent');
  });

  it('marks dispatched rolls as sent until the warehouse receives them', () => {
    expect(millRollWorkStatus({
      id: 'r1',
      at_mill: false,
      in_challan_id: 'c1',
      challan_status: 'pending',
      status: 'in_transit',
    })).toBe('sent');
    expect(millRollWorkStatus({
      id: 'r1',
      at_mill: false,
      in_challan_id: 'c1',
      challan_status: 'received',
      status: 'pending_qc',
    })).toBe('received');
  });
});

describe('growMillBatchRolls', () => {
  const fields = [{ id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal', options: null }];

  function row(partial: Partial<MmDraftRoll>): MmDraftRoll {
    return {
      localId: partial.localId ?? 'x',
      roll_no: partial.roll_no ?? '1',
      length_m: partial.length_m ?? '10',
      weight_kg: '',
      shade: '',
      lot_no: '',
      attributes: {},
      ...partial,
    };
  }

  it('numbers a new batch ROL-001 onward', () => {
    const next = growMillBatchRolls([], 3, fields);
    expect(next.map((item) => item.roll_no)).toEqual(['ROL-001', 'ROL-002', 'ROL-003']);
  });

  it('keeps sent rolls at the bottom and inserts extra rolls as new', () => {
    const rows = [
      row({ localId: 'sent', id: 'sent', locked: true, millWorkStatus: 'sent', roll_no: '1' }),
      row({ localId: 'open', id: 'open', locked: false, millWorkStatus: 'not_sent', roll_no: '2' }),
    ];
    const next = growMillBatchRolls(rows, 3, fields);
    expect(next.map((item) => item.millWorkStatus)).toEqual(['not_sent', 'new', 'sent']);
    expect(next.at(-1)?.locked).toBe(true);
  });

  it('does not drop locked sent rolls when shrinking', () => {
    const rows = [
      row({ localId: 'open', id: 'open', locked: false, millWorkStatus: 'not_sent', roll_no: '2' }),
      row({ localId: 'sent', id: 'sent', locked: true, millWorkStatus: 'sent', roll_no: '1' }),
    ];
    const next = growMillBatchRolls(rows, 1, fields);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('sent');
  });

  it('sorts assign drafts with not-sent first', () => {
    const sorted = sortMillAssignDrafts([
      row({ localId: 'sent', locked: true }),
      row({ localId: 'open', locked: false }),
    ]);
    expect(sorted.map((item) => item.localId)).toEqual(['open', 'sent']);
  });
});
