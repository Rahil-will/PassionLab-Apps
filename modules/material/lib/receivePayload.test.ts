import { describe, expect, it } from 'vitest';
import type { MmDraftRoll } from './mmRollDraft';
import {
  buildProcessReturnPayload,
  buildReceivePayload,
  fillReceiptColumn,
  type ReceiveValueField,
} from './receivePayload';

function roll(partial: Partial<MmDraftRoll> & { roll_no: string }): MmDraftRoll {
  return {
    localId: partial.roll_no,
    roll_no: partial.roll_no,
    length_m: partial.length_m ?? '',
    weight_kg: partial.weight_kg ?? '',
    shade: partial.shade ?? '',
    lot_no: partial.lot_no ?? '',
    attributes: partial.attributes ?? {},
  };
}

const receiptFields: ReceiveValueField[] = [
  { key: 'truck_no', data_type: 'text', tier: 'custom' },
  { key: 'sealed', data_type: 'checkbox', tier: 'custom' },
];

const rollFields: ReceiveValueField[] = [
  { key: 'color', data_type: 'text', tier: 'system' },
  { key: 'shade', data_type: 'text', tier: 'system' },
  { key: 'dye_lot', data_type: 'text', tier: 'system' },
  { key: 'weight_kg', data_type: 'decimal', tier: 'custom' },
  { key: 'finish', data_type: 'select', tier: 'custom' },
  { key: 'checked', data_type: 'checkbox', tier: 'custom' },
];

describe('buildReceivePayload', () => {
  it('maps core receipt fields and roll values, and leaves QC and actuals off', () => {
    const payload = buildReceivePayload({
      source: 'external',
      fromId: 'vendor-1',
      challanInvoice: ' CH-1 ',
      referenceNo: ' REF-9 ',
      receivedOn: '2026-10-16',
      remarks: ' note ',
      fabricId: 'fab-1',
      stageCode: 'DYED',
      uom: 'm',
      purpose: 'style',
      styleMaterialId: 'sm-1',
      customerName: 'Ignored',
      poRef: 'PO-1',
      widthForm: 'open',
      receiptValues: { truck_no: 'TN-4', sealed: 'true', blank: '  ' },
      receiptFields,
      rollFields,
      rolls: [
        roll({
          roll_no: 'TST-1',
          length_m: '12.5',
          shade: 'A',
          attributes: {
            color: 'Navy',
            shade: 'A',
            dye_lot: 'D1',
            weight_kg: '3.2',
            finish: 'Soft',
            checked: 'false',
            actual_gsm: '200',
            actual_width_in: '60',
            qc_status: 'hold',
          },
        }),
      ],
    });

    expect(payload.purpose).toBe('style');
    expect(payload.style_material_id).toBe('sm-1');
    expect(payload.customer_name).toBeNull();
    expect(payload.po_ref).toBeNull();
    expect(payload.source).toBe('external');
    expect(payload.from_facility_id).toBe('vendor-1');
    expect(payload.party_challan_no).toBe('CH-1');
    expect(payload.po_no).toBe('REF-9');
    expect(payload.received_at).toBe('2026-10-16');
    expect(payload.remarks).toBe('note');
    expect(payload.field_values).toEqual({ truck_no: 'TN-4', sealed: true });
    expect(payload.rolls).toEqual([
      {
        roll_no: 'TST-1',
        length_m: 12.5,
        weight_kg: null,
        values: {
          color: 'Navy',
          shade: 'A',
          dye_lot: 'D1',
          weight_kg: 3.2,
          finish: 'Soft',
          checked: false,
        },
      },
    ]);
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('qc_status');
    expect(raw).not.toContain('actual_gsm');
    expect(raw).not.toContain('actual_width');
    expect(raw).not.toContain('width_in');
    expect(raw).not.toContain('invoice_ref');
    expect(raw).not.toContain('lr_no');
    expect(raw).not.toContain('container_no');
  });

  it('puts kilogram quantity on weight_kg and keeps a custom weight in values', () => {
    const payload = buildReceivePayload({
      source: 'internal',
      fromId: 'inhouse-1',
      challanInvoice: '',
      referenceNo: '',
      receivedOn: '2026-10-16',
      remarks: '',
      fabricId: 'fab-1',
      stageCode: 'GREIGE',
      uom: 'kg',
      purpose: 'open_po',
      styleMaterialId: null,
      customerName: ' Acme ',
      poRef: ' PO-2 ',
      widthForm: null,
      receiptValues: {},
      receiptFields,
      rollFields,
      rolls: [
        roll({
          roll_no: 'R1',
          weight_kg: '10',
          length_m: '10',
          attributes: { color: 'Navy', weight_kg: '2.5', length_m: '10' },
        }),
      ],
    });

    expect(payload.customer_name).toBe('Acme');
    expect(payload.po_ref).toBe('PO-2');
    expect(payload.style_material_id).toBeNull();
    expect(payload.party_challan_no).toBeNull();
    expect(payload.rolls[0]).toEqual({
      roll_no: 'R1',
      length_m: null,
      weight_kg: 10,
      values: { color: 'Navy', weight_kg: 2.5 },
    });
  });
});

describe('buildReceivePayload vendor test', () => {
  it('puts vendor test values on the roll and keeps them out of receipt values', () => {
    const payload = buildReceivePayload({
      source: 'external',
      fromId: 'vendor-1',
      challanInvoice: 'CH-1',
      referenceNo: '',
      receivedOn: '2026-10-16',
      remarks: '',
      fabricId: 'fab-1',
      stageCode: 'DYED',
      uom: 'm',
      purpose: 'stock',
      styleMaterialId: null,
      customerName: '',
      poRef: '',
      widthForm: null,
      receiptValues: {},
      receiptFields,
      rollFields,
      vendorTestFields: [{ key: 'gsm', data_type: 'decimal' }],
      rolls: [
        roll({
          roll_no: 'TST-1',
          length_m: '10',
          attributes: {
            color: 'Navy',
            gsm: '210',
            vendor_result: 'pass',
            qc_status: 'hold',
            actual_gsm: '200',
          },
        }),
      ],
    });

    expect(payload.rolls[0]).toEqual({
      roll_no: 'TST-1',
      length_m: 10,
      weight_kg: null,
      values: { color: 'Navy' },
      test: { result: 'pass', values: { gsm: 210 } },
    });
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('qc_status');
    expect(raw).not.toContain('actual_gsm');
  });
});

describe('buildProcessReturnPayload', () => {
  it('sends qty back and roll values, and leaves a blank row on the challan', () => {
    const payload = buildProcessReturnPayload({
      processChallanId: 'ch-1',
      challanInvoice: ' RET-1 ',
      referenceNo: ' REF ',
      receivedOn: '2026-10-16',
      remarks: ' back ',
      receiptValues: { truck_no: 'TN-4' },
      receiptFields,
      rollFields,
      rolls: [
        roll({
          roll_no: 'R1',
          length_m: '8',
          attributes: { out_line_id: 'line-1', color: 'Navy', shade: 'A', qc_status: 'pass' },
        }),
        roll({
          roll_no: 'R2',
          length_m: '',
          attributes: { out_line_id: 'line-2', color: 'Navy' },
        }),
      ],
    });

    expect(payload).toEqual({
      source: 'process_return',
      process_challan_id: 'ch-1',
      party_challan_no: 'RET-1',
      po_no: 'REF',
      received_at: '2026-10-16',
      remarks: 'back',
      field_values: { truck_no: 'TN-4' },
      rolls: [
        { out_line_id: 'line-1', qty: 8, values: { color: 'Navy', shade: 'A' } },
      ],
    });
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('qc_status');
    expect(raw).not.toContain('actual_');
    expect(raw).not.toContain('line-2');
  });
});

describe('fillReceiptColumn', () => {
  const rows = [
    roll({ roll_no: 'R1', length_m: '5', attributes: { color: 'Red' } }),
    roll({ roll_no: 'R2', length_m: '', attributes: { color: '' } }),
  ];

  it('fills every row', () => {
    const next = fillReceiptColumn(rows, 'color', 'Navy', 'all', 'm');
    expect(next.map((row) => row.attributes.color)).toEqual(['Navy', 'Navy']);
    expect(next[0].length_m).toBe('5');
  });

  it('fills empty cells only', () => {
    const next = fillReceiptColumn(rows, 'color', 'Navy', 'empty', 'm');
    expect(next.map((row) => row.attributes.color)).toEqual(['Red', 'Navy']);
  });

  it('fills quantity, including rows that already have one when asked to fill all', () => {
    const all = fillReceiptColumn(rows, 'length_m', '8', 'all', 'm');
    expect(all.map((row) => row.length_m)).toEqual(['8', '8']);
    const empty = fillReceiptColumn(rows, 'length_m', '8', 'empty', 'm');
    expect(empty.map((row) => row.length_m)).toEqual(['5', '8']);
  });

  it('fills a vendor result on every row or only the empty ones', () => {
    const seeded = [
      roll({ roll_no: 'R1', attributes: { vendor_result: 'hold' } }),
      roll({ roll_no: 'R2', attributes: {} }),
    ];
    const all = fillReceiptColumn(seeded, 'vendor_result', 'pass', 'all', 'm');
    expect(all.map((row) => row.attributes.vendor_result)).toEqual(['pass', 'pass']);
    const empty = fillReceiptColumn(seeded, 'vendor_result', 'pass', 'empty', 'm');
    expect(empty.map((row) => row.attributes.vendor_result)).toEqual(['hold', 'pass']);
  });

  it('writes kilogram quantity onto weight_kg', () => {
    const next = fillReceiptColumn(
      [roll({ roll_no: 'R1', weight_kg: '', attributes: {} })],
      'length_m',
      '4',
      'all',
      'kg',
    );
    expect(next[0].weight_kg).toBe('4');
    expect(next[0].length_m).toBe('');
    expect(next[0].attributes.length_m).toBeUndefined();
  });

  it('does not keep a typed kilogram quantity as a metre length', () => {
    const next = fillReceiptColumn(
      [roll({ roll_no: 'R1', length_m: '9', attributes: { length_m: '9', color: 'Navy' } })],
      'qty',
      '4',
      'all',
      'kg',
    );
    expect(next[0].weight_kg).toBe('4');
    expect(next[0].length_m).toBe('');
    expect(next[0].attributes.length_m).toBeUndefined();
    expect(next[0].attributes.color).toBe('Navy');
  });
});
