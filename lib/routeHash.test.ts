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

  it('sends old mill process history to the warehouse', () => {
    expect(parseRouteHash('#/material/mill/process').route).toBe(RoutePath.MATERIAL_WAREHOUSE_PROCESS);
    expect(parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_PROCESS).route).toBe(RoutePath.MATERIAL_WAREHOUSE_PROCESS);
    const mill = parseRouteHash('#/material/mill/process/proc-abc-123');
    expect(mill.route).toBe(RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL);
    expect(mill.params.id).toBe('proc-abc-123');
    expect(mill.params.side).toBeUndefined();
    const warehouse = parseRouteHash('#/material/warehouse/process/proc-abc-123');
    expect(warehouse.route).toBe(RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL);
    expect(warehouse.params.id).toBe('proc-abc-123');
    expect(warehouse.params.side).toBeUndefined();
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

  it('sends the old stock page to the fabric view', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_STOCK);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_FABRICS);
  });

  it('resolves warehouse movements without treating it as stock', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS);
  });

  it('resolves expected, and splits internal and external receipts', () => {
    expect(parseRouteHash('#/material/warehouse/expected').route).toBe(RoutePath.MATERIAL_WAREHOUSE_EXPECTED);
    expect(parseRouteHash('#/material/warehouse/receipts').route).toBe(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL);
    expect(parseRouteHash('#/material/warehouse/receipts/external').route).toBe(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL);
    expect(parseRouteHash('#/material/warehouse/external').route).toBe(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL);
    expect(parseRouteHash('#/material/warehouse/receipts/internal').route).toBe(RoutePath.MATERIAL_WAREHOUSE_INTERNAL);
    expect(parseRouteHash('#/material/warehouse/receipts/process-returns').route).toBe(RoutePath.MATERIAL_WAREHOUSE_PROCESS_RETURNS);
    expect(parseRouteHash('#/material/warehouse/internal').route).toBe(RoutePath.MATERIAL_WAREHOUSE_INTERNAL);
    const detail = parseRouteHash('#/material/warehouse/receipts/rcpt-1');
    expect(detail.route).toBe(RoutePath.MATERIAL_WAREHOUSE_RECEIPT);
    expect(detail.params.id).toBe('rcpt-1');
  });

  it('sends style fabrics to expected', () => {
    expect(parseRouteHash('#/material/warehouse/style-fabrics').route).toBe(RoutePath.MATERIAL_WAREHOUSE_EXPECTED);
    const line = parseRouteHash('#/material/warehouse/style-fabrics/line-9');
    expect(line.route).toBe(RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC);
    expect(line.params.lineId).toBe('line-9');
    const alloc = parseRouteHash('#/material/warehouse/style-fabrics/line-9/allocate');
    expect(alloc.route).toBe(RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC_ALLOCATE);
    expect(alloc.params.lineId).toBe('line-9');
  });

  it('resolves warehouse process send without treating it as warehouse home', () => {
    const { route } = parseRouteHash(RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND);
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND);
  });

  it('sends old receive-unallocated to receive fabric', () => {
    const { route } = parseRouteHash('#/material/warehouse/receive-unallocated');
    expect(route).toBe(RoutePath.MATERIAL_WAREHOUSE_RECEIVE);
  });

  it('sends old mill hashes into the warehouse', () => {
    expect(parseRouteHash('#/material/mill').route).toBe(RoutePath.MATERIAL_WAREHOUSE);
    expect(parseRouteHash('#/material/mill/batches').route).toBe(RoutePath.MATERIAL_WAREHOUSE_EXTERNAL);
    expect(parseRouteHash('#/material/mill/stock').route).toBe(RoutePath.MATERIAL_WAREHOUSE_FABRICS);
    expect(parseRouteHash('#/material/mill/qc').route).toBe(RoutePath.MATERIAL_WAREHOUSE_QC);
    expect(parseRouteHash('#/material/mill/styles').route).toBe(RoutePath.MATERIAL_WAREHOUSE_EXPECTED);
    const line = parseRouteHash('#/material/mill/line/ord-1/col-2/fab-3');
    expect(line.route).toBe(RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC);
    expect(line.params.lineId).toBe('fab-3');
    const alloc = parseRouteHash('#/material/mill/line/ord-1/col-2/fab-3/allocate');
    expect(alloc.route).toBe(RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC_ALLOCATE);
    expect(alloc.params.lineId).toBe('fab-3');
  });
});
