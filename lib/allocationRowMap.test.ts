import { describe, expect, it } from 'vitest';
import { mapAllocationRow } from './allocationRowMap';

describe('mapAllocationRow', () => {
  it('maps core db columns to LineAllocation', () => {
    const row = {
      id: 'alloc-1',
      line_id: 'line-1',
      order_id: 'order-1',
      colorway_id: 'cw-1',
      visit_id: 'visit-1',
      department_id: 'dept-1',
      order_route_id: 'route-1',
      loading_route_id: 'load-1',
      qty: 120,
      daily_target: 40,
      hourly_target: 5,
      start_date: '2026-01-01',
      end_date: '2026-01-10',
      status: 'active',
      completed_is_true: true,
      sam: 12.5,
      kpi_inputs: { sam: 10 },
      actual_qty: 80,
    };

    expect(mapAllocationRow(row)).toEqual({
      id: 'alloc-1',
      lineId: 'line-1',
      orderId: 'order-1',
      colorwayId: 'cw-1',
      visitId: 'visit-1',
      departmentId: 'dept-1',
      operationId: 'route-1',
      loadingRouteId: 'load-1',
      qty: 120,
      dailyTarget: 40,
      hourlyTarget: 5,
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      status: 'active',
      progress: 0,
      completed_is_true: true,
      sam: 12.5,
      kpiInputs: { sam: 10 },
      actualQty: 80,
    });
  });

  it('falls back to planned_qty when qty is missing', () => {
    const mapped = mapAllocationRow({
      id: 'a1',
      order_id: 'o1',
      planned_qty: 55,
    });
    expect(mapped.qty).toBe(55);
  });

  it('prefers order_route_id over operation_id', () => {
    const mapped = mapAllocationRow({
      id: 'a1',
      order_id: 'o1',
      order_route_id: 'route',
      operation_id: 'op',
    });
    expect(mapped.operationId).toBe('route');
  });

  it('uses operation_id when order_route_id is absent', () => {
    const mapped = mapAllocationRow({
      id: 'a1',
      order_id: 'o1',
      operation_id: 'op',
    });
    expect(mapped.operationId).toBe('op');
  });

  it('reads sam from kpi_inputs when direct sam is missing or zero', () => {
    expect(
      mapAllocationRow({ id: 'a1', order_id: 'o1', kpi_inputs: { sam: 8 } }).sam,
    ).toBe(8);
    expect(
      mapAllocationRow({ id: 'a1', order_id: 'o1', sam: 0, kpi_inputs: { sam: 6 } }).sam,
    ).toBe(6);
    expect(mapAllocationRow({ id: 'a1', order_id: 'o1', sam: 0 }).sam).toBeNull();
  });

  it('applies defaults for optional fields', () => {
    const mapped = mapAllocationRow({ id: 'a1', order_id: 'o1' });
    expect(mapped.status).toBe('planned');
    expect(mapped.lineId).toBe('');
    expect(mapped.colorwayId).toBeUndefined();
    expect(mapped.hourlyTarget).toBeNull();
  });
});
