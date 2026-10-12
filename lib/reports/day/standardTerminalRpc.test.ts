import { describe, expect, it } from 'vitest';
import { dayReportRoleKind } from '../../departmentFilters';
import { mapStandardRpcToBatchEntry, mapTerminalRpcToNativeEntry } from './standardTerminalRpc';

describe('dayReportRoleKind', () => {
  it('maps origin / standard / terminal roles', () => {
    expect(dayReportRoleKind({ role: 'origin', planning_mode: 'native_cutting' })).toBe('origin');
    expect(dayReportRoleKind({ role: 'standard', planning_mode: 'production' })).toBe('standard');
    expect(dayReportRoleKind({ role: 'terminal', planning_mode: 'native_shipment' })).toBe('terminal');
  });

  it('keeps outsource on its own path even when role is standard', () => {
    expect(dayReportRoleKind({ role: 'standard', planning_mode: 'outsource' })).toBe('outsource');
  });
});

describe('standard/terminal RPC mappers', () => {
  it('maps batch rows from the standard RPC', () => {
    const entry = mapStandardRpcToBatchEntry({
      source: 'batch',
      id: 'b1',
      log_date: '2026-07-16',
      hour_slot: null,
      shift_id: null,
      order_id: 'o1',
      colorway_id: 'cw1',
      resource_id: 'r1',
      order_route_id: 'op1',
      qty: 40,
      inspected_qty: 0,
      started_at: '2026-07-16T09:00:00Z',
      ended_at: null,
      activity_no: 'A1',
      ref_no: null,
      comment: null,
      headcount_by_category: { Operators: 3 },
      style_name: 'Tee',
      style_ref: '',
      buyer_name: 'Vindoff',
      po_number: 'PO-1',
      color_name: 'Navy',
      resource_name: 'Line 1',
      operation_name: 'Sewing',
      operation_def_id: null,
    });
    expect(entry.kind).toBe('batch');
    expect(entry.colorName).toBe('Navy');
    expect(entry.outputQty).toBe(40);
  });

  it('maps shipment rows from the terminal RPC', () => {
    const entry = mapTerminalRpcToNativeEntry({
      id: 'sh1',
      log_date: '2026-07-16',
      started_at: '2026-07-16T12:00:00Z',
      order_id: 'o1',
      colorway_id: 'cw1',
      order_route_id: null,
      output_qty: 100,
      style_name: 'Tee',
      style_ref: '',
      buyer_name: 'Vindoff',
      po_number: 'PO-1',
      color_name: 'Brown Bear',
      operation_name: 'Dispatch',
      shipment_type: 'air',
      destination: 'UAE',
      invoice_number: null,
      awb_number: null,
      notes: null,
    });
    expect(entry.kind).toBe('shipment');
    expect(entry.colorName).toBe('Brown Bear');
    expect(entry.outputQty).toBe(100);
  });
});
