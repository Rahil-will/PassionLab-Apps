import { describe, expect, it } from 'vitest';
import {
  challanPrintColumns,
  challanPrintFileName,
  challanPrintHasBatch,
  challanPrintRollCell,
  challanPrintTotals,
  inboundChallanPrintDoc,
  millChallanPrintDoc,
  storeChallanPrintDoc,
} from './mmChallanPrint';

const fields = [
  { id: 'q', key: 'length_m', label: 'Qty', data_type: 'decimal', options: null },
  { id: 'w', key: 'weight_kg', label: 'Weight', data_type: 'decimal', options: null },
  { id: 's', key: 'shade', label: 'Shade', data_type: 'text', options: null },
  { id: 'l', key: 'lot_no', label: 'Lot', data_type: 'text', options: null },
  { id: 'g', key: 'gsm', label: 'GSM', data_type: 'decimal', options: null },
];

const rolls = [
  {
    id: 'r1',
    unit_code: 'R-1',
    length_m: 42,
    weight_kg: 8,
    shade: 'A',
    lot_no: 'L1',
    batch_no: 'B-01',
    attributes: { gsm: '180' },
  },
  {
    id: 'r2',
    unit_code: 'R-2',
    length_m: 18,
    weight_kg: null,
    shade: null,
    lot_no: null,
    mill_snapshot: { batch_no: 'B-02', length_m: 18, attributes: { gsm: '175' } },
  },
];

describe('millChallanPrintDoc', () => {
  it('builds a mill-to-warehouse paper challan with factory name and all field columns', () => {
    const doc = millChallanPrintDoc({
      factory: { name: 'North Plant', code: 'NP' },
      challanNo: 'MILL-26-000012',
      referenceNo: 'DC-9',
      sentAt: '2026-09-18',
      remarks: 'Handle with care',
      styleName: 'Oxford Shirt',
      buyerName: 'Acme',
      poNumber: 'PO-1',
      colorName: 'Navy',
      fabricName: 'Poplin',
      fabricCategory: 'Shell',
      uom: 'm',
      fields,
      rolls,
    });
    expect(doc.title).toBe('Delivery challan');
    expect(doc.movement).toBe('Mill to warehouse');
    expect(doc.factoryName).toBe('North Plant');
    expect(doc.fromLocation).toBe('In-house mill');
    expect(doc.toLocation).toBe('Warehouse');
    expect(doc.rolls[1].batch_no).toBe('B-02');
    expect(challanPrintTotals(doc)).toEqual({ rolls: 2, qty: '60 m' });
    expect(challanPrintHasBatch(doc)).toBe(true);
    expect(challanPrintFileName(doc)).toBe('MILL-26-000012');
    expect(challanPrintColumns(doc).map((field) => field.label)).toEqual([
      'Qty',
      'Shade',
      'Weight',
      'Lot',
      'GSM',
    ]);
    expect(challanPrintRollCell(doc.rolls[0], fields[4])).toBe('180');
    expect(challanPrintRollCell(doc.rolls[1], fields[4])).toBe('175');
  });
});

describe('storeChallanPrintDoc', () => {
  it('builds a warehouse-to-cutting store challan', () => {
    const doc = storeChallanPrintDoc({
      factoryName: 'North Plant',
      challanNo: 'SC-26-000003',
      styleName: 'Oxford Shirt',
      colorName: 'Navy',
      fabricName: 'Poplin',
      uom: 'm',
      rolls,
    });
    expect(doc.title).toBe('Store challan');
    expect(doc.fromLocation).toBe('Fabric warehouse');
    expect(doc.toLocation).toBe('Cutting store');
    expect(doc.factoryName).toBe('North Plant');
  });
});

describe('inboundChallanPrintDoc', () => {
  it('uses GRN wording for vendor inbound', () => {
    const doc = inboundChallanPrintDoc({
      source: 'vendor',
      supplierName: 'Textile Co',
      challanNo: 'GRN-26-000001',
      styleName: 'Oxford Shirt',
      colorName: 'Navy',
      fabricName: 'Poplin',
      rolls,
    });
    expect(doc.kind).toBe('vendor');
    expect(doc.title).toBe('Goods received note');
    expect(doc.fromLocation).toBe('Textile Co');
  });
});
