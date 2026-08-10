import { describe, expect, it } from 'vitest';
import { mapFulfillmentShipmentFromDb } from './fulfillmentData';

describe('mapFulfillmentShipmentFromDb', () => {
  it('maps shipment table row with size breakdown and metadata', () => {
    const row = mapFulfillmentShipmentFromDb(
      {
        id: 'ship-1',
        colorway_id: 'cw-blue',
        shipment_date: '2026-07-30',
        shipped_qty: 110,
        shipped_qty_by_size: { XS: 22, S: 22, M: 22, L: 22, XL: 22 },
        invoice_number: 'INV-001',
        awb_number: 'AWB-9',
        destination: 'India',
        shipment_type: 'main',
        notes: 'First lot',
      },
      new Map([['cw-blue', 'Blue']]),
    );

    expect(row.colorwayName).toBe('Blue');
    expect(row.shipmentType).toBe('main');
    expect(row.destination).toBe('India');
    expect(row.qtyBySize?.M).toBe(22);
    expect(row.invoiceNumber).toBe('INV-001');
  });
});
