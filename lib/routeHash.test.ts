import { describe, expect, it } from 'vitest';
import { RoutePath } from '../types';
import { parseRouteHash } from './routeHash';

describe('parseRouteHash', () => {
  it('resolves warehouse styles list before style detail param', () => {
    const { route, params } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_STYLES);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_STYLES);
    expect(params.orderId).toBeUndefined();
  });

  it('resolves warehouse style detail with order id', () => {
    const hash = '#/material/warehouse/style/ord-abc-123';
    const { route, params } = parseRouteHash(hash);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_STYLE);
    expect(params.orderId).toBe('ord-abc-123');
  });

  it('resolves warehouse dispatch without treating it as store detail', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_DISPATCH);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_DISPATCH);
  });

  it('resolves fabric dispatch summary from dispatch table params', () => {
    const hash = '#/material/warehouse/dispatch/ord-1/col-2/fab-3';
    const { route, params } = parseRouteHash(hash);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE);
    expect(params).toMatchObject({
      orderId: 'ord-1',
      colorwayId: 'col-2',
      fabricLineId: 'fab-3',
    });
  });

  it('resolves dispatch send without treating it as the fabric summary', () => {
    const hash = '#/material/warehouse/dispatch/ord-1/col-2/fab-3/send';
    const { route, params } = parseRouteHash(hash);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_DISPATCH_SEND);
    expect(params).toMatchObject({
      orderId: 'ord-1',
      colorwayId: 'col-2',
      fabricLineId: 'fab-3',
    });
  });

  it('resolves rack move before treating it as the racks list', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE);
  });

  it('resolves racks list exactly', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_RACKS);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_RACKS);
  });

  it('resolves warehouse testing list before testing detail param', () => {
    const { route, params } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_TESTING);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_TESTING);
    expect(params.id).toBeUndefined();
  });

  it('resolves warehouse testing detail with challan id', () => {
    const { route, params } = parseRouteHash('#/material/warehouse/testing/challan-abc-123');
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL);
    expect(params.id).toBe('challan-abc-123');
  });

  it('resolves production cutting inbound detail with id', () => {
    const { route, params } = parseRouteHash('#/production/cutting/inbound/sc-abc');
    expect(route).toBe(RoutePath.PRODUCTION_CUTTING_INBOUND_DETAIL);
    expect(params.id).toBe('sc-abc');
  });

  it('resolves production cutting stock without treating it as inbound', () => {
    const { route } = parseRouteHash(RoutePath.PRODUCTION_CUTTING_STOCK);
    expect(route).toBe(RoutePath.PRODUCTION_CUTTING_STOCK);
  });

  it('resolves legacy store list without treating it as challan detail', () => {
    const { route, params } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_STORE);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_STORE);
    expect(params.id).toBeUndefined();
  });

  it('resolves warehouse dispatch challan with id', () => {
    const { route, params } = parseRouteHash('#/material/warehouse/store/sc-abc-123');
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL);
    expect(params.id).toBe('sc-abc-123');
  });

  it('resolves supplier returns without treating it as warehouse home', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_RETURNS);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_RETURNS);
  });

  it('resolves end-bit returns without treating it as warehouse home', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_END_BITS);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_END_BITS);
  });

  it('resolves a process challan with id', () => {
    const { route, params } = parseRouteHash('#/material/process/proc-abc-123');
    expect(route).toBe(RoutePath.MATERIAL_PROCESS_DETAIL);
    expect(params.id).toBe('proc-abc-123');
  });

  it('resolves the process list before the detail pattern', () => {
    const { route, params } = parseRouteHash(RoutePath.MATERIAL_PROCESS);
    expect(route).toBe(RoutePath.MATERIAL_PROCESS);
    expect(params.id).toBeUndefined();
  });

  it('resolves a supplier return with id', () => {
    const { route, params } = parseRouteHash('#/material/warehouse/returns/ret-abc-123');
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_RETURNS_DETAIL);
    expect(params.id).toBe('ret-abc-123');
  });

  it('resolves warehouse stock before treating it as warehouse home', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_STOCK);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_STOCK);
  });

  it('resolves warehouse movements without treating it as stock', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS);
  });

  it('resolves expected receipts without treating it as warehouse home', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_EXPECTED);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_EXPECTED);
  });

  it('resolves warehouse process send without treating it as warehouse home', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND);
  });

  it('resolves receive unallocated without treating it as warehouse home', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_RECEIVE_UNALLOCATED);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_RECEIVE_UNALLOCATED);
  });

  it('resolves mill unallocated without treating it as mill line', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_MILL_UNALLOCATED);
    expect(route).toBe(RoutePath.MATERIAL_MILL_UNALLOCATED);
  });

  it('resolves mill unallocated dispatch without treating it as mill line', () => {
    expect(parseRouteHash(RoutePath.MATERIAL_MILL_UNALLOCATED_DISPATCH).route).toBe(
      RoutePath.MATERIAL_MILL_UNALLOCATED_DISPATCH,
    );
  });

  it('resolves mill general PO allocate without treating it as a batch', () => {
    expect(parseRouteHash(RoutePath.MATERIAL_MILL_UNALLOCATED_ALLOCATE).route).toBe(
      RoutePath.MATERIAL_MILL_UNALLOCATED_ALLOCATE,
    );
  });

  it('resolves mill general PO fabric details and allocate', () => {
    const line = parseRouteHash('#/material/mill/unallocated/batch-1');
    expect(line.route).toBe(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE);
    expect(line.params).toMatchObject({ batchId: 'batch-1' });
    const alloc = parseRouteHash('#/material/mill/unallocated/batch-1/allocate');
    expect(alloc.route).toBe(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE);
    expect(alloc.params).toMatchObject({ batchId: 'batch-1' });
  });

  it('resolves mill stock without treating it as mill line', () => {
    expect(parseRouteHash(RoutePath.MATERIAL_MILL_STOCK).route).toBe(RoutePath.MATERIAL_MILL_STOCK);
  });

  it('keeps mill stock query mode for testing and inspection', () => {
    const testing = parseRouteHash(`${RoutePath.MATERIAL_MILL_STOCK}?mode=testing`);
    expect(testing.route).toBe(RoutePath.MATERIAL_MILL_STOCK);
    expect(testing.params.mode).toBe('testing');
    const inspection = parseRouteHash(`${RoutePath.MATERIAL_MILL_STOCK}?mode=inspection`);
    expect(inspection.route).toBe(RoutePath.MATERIAL_MILL_STOCK);
    expect(inspection.params.mode).toBe('inspection');
  });

  it('resolves mill styles and history without treating them as mill line', () => {
    expect(parseRouteHash(RoutePath.MATERIAL_MILL_STYLES).route).toBe(RoutePath.MATERIAL_MILL_STYLES);
    expect(parseRouteHash(RoutePath.MATERIAL_MILL_HISTORY).route).toBe(RoutePath.MATERIAL_MILL_HISTORY);
  });

  it('resolves mill challan detail without treating it as mill line or dispatch', () => {
    const hash = '#/material/mill/line/ord-1/col-2/fab-3/challan/ch-99';
    const { route, params } = parseRouteHash(hash);
    expect(route).toBe(RoutePath.MATERIAL_MILL_CHALLAN);
    expect(params).toMatchObject({
      orderId: 'ord-1',
      colorwayId: 'col-2',
      fabricLineId: 'fab-3',
      id: 'ch-99',
    });
  });
});
