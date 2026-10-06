import { describe, expect, it } from 'vitest';
import type { MmInChallanHeader } from '../modules/material/lib/mmRpc';
import {
  inboundDocKind,
  inboundOpsStatus,
  inboundOpsStatusFilterOptions,
  inboundOpsStatusLabel,
  inboundPassedRolls,
  inboundTestingPending,
  storeDispatchStatusLabel,
} from '../modules/material/lib/inboundDisplay';

function row(partial: Partial<MmInChallanHeader>): MmInChallanHeader {
  return {
    id: 'c1',
    challan_no: 'MILL-1',
    source: 'mill',
    status: 'received',
    supplier_name: null,
    sent_at: null,
    received_at: '2026-09-18',
    row_version: 1,
    style_material_id: 'sm1',
    order_id: 'o1',
    colorway_id: 'cw1',
    style_name: 'POLO',
    color_name: 'Navy',
    fabric_type: 'Cotton',
    fabric_name: 'Cotton 60s',
    roll_count: 4,
    qty: 100,
    tested_count: 0,
    failed_count: 0,
    pending_qc_count: 0,
    passed_qty: 0,
    ...partial,
  };
}

describe('inboundTestingPending', () => {
  it('is false while the challan is still in transit', () => {
    expect(inboundTestingPending(row({ status: 'pending', pending_qc_count: 0 }))).toBe(false);
  });

  it('is true when rolls are waiting 4-point', () => {
    expect(inboundTestingPending(row({ pending_qc_count: 2, tested_count: 0 }))).toBe(true);
  });

  it('is true when received rolls have no qc_result yet', () => {
    expect(inboundTestingPending(row({ pending_qc_count: 0, tested_count: 0, roll_count: 4 }))).toBe(true);
  });

  it('is false only after every roll has a qc result', () => {
    expect(inboundTestingPending(row({ pending_qc_count: 0, tested_count: 4, roll_count: 4 }))).toBe(false);
  });
});

describe('inboundOpsStatus', () => {
  it('stays in transit until warehouse receive', () => {
    expect(inboundOpsStatus(row({ status: 'pending' }))).toBe('in_transit');
    expect(inboundOpsStatusLabel('in_transit')).toBe('In transit');
  });

  it('does not show passed for untested received rolls', () => {
    expect(inboundOpsStatus(row({ pending_qc_count: 0, tested_count: 0, roll_count: 3 }))).toBe('pending_test');
    expect(inboundOpsStatusLabel('pending_test')).toBe('Pending test');
  });

  it('shows passed only when every roll passed', () => {
    expect(
      inboundOpsStatus(row({ pending_qc_count: 0, tested_count: 3, failed_count: 0, roll_count: 3, passed_qty: 80 })),
    ).toBe('passed');
  });

  it('shows failed when every tested roll failed', () => {
    expect(
      inboundOpsStatus(row({ pending_qc_count: 0, tested_count: 2, failed_count: 2, roll_count: 2 })),
    ).toBe('failed');
  });

  it('shows mixed when some rolls passed and some failed', () => {
    expect(
      inboundOpsStatus(row({ pending_qc_count: 0, tested_count: 4, failed_count: 1, roll_count: 4 })),
    ).toBe('mixed');
  });
});

describe('inboundPassedRolls', () => {
  it('counts only qc pass, not received stock', () => {
    expect(inboundPassedRolls(row({ tested_count: 0, failed_count: 0, passed_count: 0, roll_count: 8 }))).toBe(0);
    expect(inboundPassedRolls(row({ tested_count: 5, failed_count: 1, passed_count: 4 }))).toBe(4);
  });
});

describe('inboundDocKind', () => {
  it('labels mill documents as challan and vendor as GRN', () => {
    expect(inboundDocKind(row({ source: 'mill' }))).toBe('Challan');
    expect(inboundDocKind(row({ source: 'vendor' }))).toBe('GRN');
  });
});

describe('inboundOpsStatusFilterOptions', () => {
  it('includes in transit only for mill inbound', () => {
    const mill = inboundOpsStatusFilterOptions(true).map((opt) => opt.value);
    const testing = inboundOpsStatusFilterOptions(false).map((opt) => opt.value);
    expect(mill).toEqual(['', 'in_transit', 'pending_test', 'passed', 'failed', 'mixed']);
    expect(testing).toEqual(['', 'pending_test', 'passed', 'failed', 'mixed']);
  });
});

describe('storeDispatchStatusLabel', () => {
  it('labels warehouse to cutting challans without mill wording', () => {
    expect(storeDispatchStatusLabel('pending')).toBe('Pending receive');
    expect(storeDispatchStatusLabel('in_transit')).toBe('Pending receive');
    expect(storeDispatchStatusLabel('received')).toBe('Received');
  });
});
