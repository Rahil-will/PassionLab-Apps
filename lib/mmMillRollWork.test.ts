import { describe, expect, it } from 'vitest';
import {
  millRollWorkStatus,
  millRollWorkStatusLabel,
  millFieldSeedText,
  seedWarehouseFieldValues,
  growMillBatchRolls,
  sortMillAssignDrafts,
  type MmDraftRoll,
} from '../modules/material/lib/mmRollDraft';

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

describe('seedWarehouseFieldValues', () => {
  const gsm = { id: 'g', key: 'gsm', label: 'GSM', data_type: 'decimal', options: null };
  const width = { id: 'w', key: 'width', label: 'Width', data_type: 'decimal', options: null };

  it('fills catalog cells from mill declared attributes', () => {
    expect(
      seedWarehouseFieldValues(
        { length_m: 42, mill_snapshot: { attributes: { gsm: '160' } } },
        {},
        [gsm, width],
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

  it('does not seed an em dash into the warehouse cell', () => {
    expect(millFieldSeedText({ length_m: 1, attributes: {} }, gsm)).toBe('');
  });
});
