import { describe, expect, it } from 'vitest';
import {
  fieldsForType,
  measureOutOfSpec,
  withLengthField,
  fieldRole,
  rollFieldText,
  fieldSeedText,
  seedWarehouseFieldValues,
  warehouseMeasuredFieldValues,
  warehouseTestFields,
  rollWorkStatus,
  rollWorkStatusLabel,
  growReceiptRolls,
  sortAssignDrafts,
  autoFillDraftRolls,
  ROLL_MEASURES,
  LOT_TYPE_OPTIONS,
  rollOutOfSpec,
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
  it('keeps a Length data point separate from Qty', () => {
    const length = { id: 'l', key: 'length', label: 'Length', data_type: 'decimal', options: null };
    const qty = { id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal', options: null };
    expect(fieldRole(length)).toBe('attr');
    expect(fieldRole(qty)).toBe('length');
    const cols = withLengthField([length]);
    expect(cols.map((field) => field.key)).toEqual(['length_m', 'shade', 'length']);
  });

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

describe('rollFieldText', () => {
  const qtyField = { id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal', options: null };

  it('reads live quantity', () => {
    expect(
      rollFieldText(
        {
          length_m: 12,
          shade: null,
          lot_no: null,
          attributes: null,
        },
        qtyField,
      ),
    ).toBe('12');
  });

  it('reads shade from the roll before catalog attributes', () => {
    const shadeField = { id: 's', key: 'shade', label: 'Shade', data_type: 'select', options: null };
    expect(
      rollFieldText(
        {
          length_m: 12,
          shade: 'COLUMN',
          attributes: { shade: 'LIVE' },
        },
        shadeField,
      ),
    ).toBe('COLUMN');
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
        { length_m: 42, attributes: { gsm: '160', shade: 'A' } },
        {},
        [gsm, shade, width],
      ),
    ).toEqual({ gsm: '160', width: '' });
  });

  it('keeps a warehouse value that was already recorded', () => {
    expect(
      seedWarehouseFieldValues(
        { length_m: 42, attributes: { gsm: '160' } },
        { gsm: '158' },
        [gsm, width],
      ),
    ).toEqual({ gsm: '158', width: '' });
  });

  it('shows a catalog column as blank when mill missed that attribute', () => {
    expect(
      seedWarehouseFieldValues(
        { length_m: 42, attributes: { gsm: '160' } },
        {},
        [gsm, shade, width],
      ),
    ).toEqual({ gsm: '160', width: '' });
  });

  it('does not seed an em dash into the warehouse cell', () => {
    expect(fieldSeedText({ length_m: 1, attributes: {} }, gsm)).toBe('');
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

describe('rollWorkStatus', () => {
  it('marks unsaved extra rolls as new', () => {
    expect(rollWorkStatus({})).toBe('new');
    expect(rollWorkStatusLabel('new')).toBe('New');
  });

  it('marks a draft without a challan as not sent', () => {
    expect(rollWorkStatus({ id: 'r1', status: 'draft' })).toBe('not_sent');
    expect(rollWorkStatusLabel('not_sent')).toBe('Not sent');
  });

  it('marks dispatched rolls as sent until the warehouse receives them', () => {
    expect(rollWorkStatus({
      id: 'r1',
      in_challan_id: 'c1',
      challan_status: 'pending',
      status: 'in_transit',
    })).toBe('sent');
    expect(rollWorkStatus({
      id: 'r1',
      in_challan_id: 'c1',
      challan_status: 'received',
      status: 'pending_qc',
    })).toBe('received');
  });
});

describe('growReceiptRolls', () => {
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
    const next = growReceiptRolls([], 3, fields);
    expect(next.map((item) => item.roll_no)).toEqual(['ROL-001', 'ROL-002', 'ROL-003']);
  });

  it('keeps sent rolls at the bottom and inserts extra rolls as new', () => {
    const rows = [
      row({ localId: 'sent', id: 'sent', locked: true, rollWorkStatus: 'sent', roll_no: '1' }),
      row({ localId: 'open', id: 'open', locked: false, rollWorkStatus: 'not_sent', roll_no: '2' }),
    ];
    const next = growReceiptRolls(rows, 3, fields);
    expect(next.map((item) => item.rollWorkStatus)).toEqual(['not_sent', 'new', 'sent']);
    expect(next.at(-1)?.locked).toBe(true);
  });

  it('does not drop locked sent rolls when shrinking', () => {
    const rows = [
      row({ localId: 'open', id: 'open', locked: false, rollWorkStatus: 'not_sent', roll_no: '2' }),
      row({ localId: 'sent', id: 'sent', locked: true, rollWorkStatus: 'sent', roll_no: '1' }),
    ];
    const next = growReceiptRolls(rows, 1, fields);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('sent');
  });
});

describe('autoFillDraftRolls', () => {
  const fields = [
    { id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal' as const, options: null },
    { id: 'sl', key: 'shrinkage-l', label: 'Shrinkage L%', data_type: 'decimal' as const, options: null },
    { id: 'sw', key: 'shrinkage-w', label: 'Shrinkage W%', data_type: 'decimal' as const, options: null },
  ];

  function blank(): MmDraftRoll {
    return {
      localId: 'r1',
      roll_no: 'ROL-001',
      length_m: '',
      weight_kg: '',
      shade: '',
      lot_no: '',
      attributes: {
        target_width_in: '54',
        width_tol_pct: '2.5',
        target_gsm: '210',
        gsm_tol_pct: '2.5',
      },
    };
  }

  it('fills empty cells inside the width and GSM tolerance and leaves targets alone', () => {
    const next = autoFillDraftRolls([blank()], fields, { measures: ROLL_MEASURES, fillLotType: true })[0];
    expect(next.attributes.target_width_in).toBe('54');
    expect(next.attributes.width_tol_pct).toBe('2.5');
    expect(next.attributes.target_gsm).toBe('210');
    expect(next.attributes.gsm_tol_pct).toBe('2.5');
    expect(next.length_m.trim()).not.toBe('');
    expect(LOT_TYPE_OPTIONS).toContain(next.lot_no);
    expect(Number(next.attributes['shrinkage-l'])).toBeGreaterThan(0);
    expect(rollOutOfSpec(next)).toBe(false);
    expect(next.attributes.qc_status).toBe('pass');
  });

  it('does not replace a value already entered or a locked roll', () => {
    const kept = blank();
    kept.length_m = '18.5';
    kept.attributes.length_m = '18.5';
    kept.attributes.actual_width_in = '54';
    const locked = blank();
    locked.localId = 'locked';
    locked.locked = true;
    const [open, sent] = autoFillDraftRolls([kept, locked], fields, { measures: ROLL_MEASURES, fillLotType: true });
    expect(open.length_m).toBe('18.5');
    expect(open.attributes.actual_width_in).toBe('54');
    expect(sent.attributes.actual_width_in ?? '').toBe('');
    expect(sent.lot_no).toBe('');
  });
});

describe('growReceiptRolls sort', () => {
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

  it('sorts assign drafts with not-sent first', () => {
    const sorted = sortAssignDrafts([
      row({ localId: 'sent', locked: true }),
      row({ localId: 'open', locked: false }),
    ]);
    expect(sorted.map((item) => item.localId)).toEqual(['open', 'sent']);
  });
});
