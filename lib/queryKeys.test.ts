import { describe, expect, it } from 'vitest';
import { queryKeys } from './queryKeys';

describe('queryKeys', () => {
  it('builds stable factory-scoped keys', () => {
    expect(queryKeys.factory('f1')).toEqual(['factory', 'f1']);
    expect(queryKeys.productionSummary('f1')).toEqual(['productionSummary', 'f1']);
    expect(queryKeys.orderDetail('f1', 'o1')).toEqual(['orders', 'f1', 'detail', 'o1']);
  });

  it('includes filters in ordersList key', () => {
    const key = queryKeys.ordersList('f1', 2, { search: 'polo', pageSize: 20 });
    expect(key[0]).toBe('orders');
    expect(key[1]).toBe('f1');
    expect(key[2]).toBe('list');
    expect(key[3]).toBe(2);
    expect(key[4]).toMatchObject({ search: 'polo', pageSize: 20 });
  });

  it('scopes settings slices under settings prefix', () => {
    expect(queryKeys.buyers('f1')).toEqual(['settings', 'f1', 'buyers']);
    expect(queryKeys.departments('f1')).toEqual(['settings', 'f1', 'departments']);
  });
});
