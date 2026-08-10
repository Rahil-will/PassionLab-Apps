import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  filterOrdersByPipelineStatus,
  orderMatchesPipelineStatusFilter,
} from './orderPipelineFilter';
import type { StyleOrder } from '../types';
import type { VisitPipelineCell } from './orderRoutingFlow';

const baseOrder = {
  id: 'o1',
  styleName: 'Test',
  poNumber: 'PO-1',
  styleRef: '',
  buyer: 'Buyer',
  orderQty: 100,
  adjQty: 100,
  orderDate: '2026-01-01',
  colorways: [
    {
      id: 'cw1',
      name: 'Red',
      sizes: [{ size: 'M', order_qty: 100, adj_qty: 100 }],
    },
  ],
  shipmentPlan: [],
  routingSteps: [],
  sizeGroupName: 'Standard',
  priority: 'normal',
  currentDept: '',
  status: 'active',
} as unknown as StyleOrder;

const visit = {
  visitId: 'v1',
  stepType: 'dept',
  deptName: 'Sewing',
  deptId: 'd1',
  seq: 1,
  activitiesLabel: 'Sew',
  label: 'Sewing',
  routeIds: ['r1'],
} as VisitPipelineCell;

describe('orderMatchesPipelineStatusFilter', () => {
  it('returns true when filter is empty', () => {
    expect(orderMatchesPipelineStatusFilter(baseOrder, '', [], {})).toBe(true);
  });

  it('marks completed when terminal visit meets adjusted qty', () => {
    expect(
      orderMatchesPipelineStatusFilter(baseOrder, 'Completed', [visit], { v1: 100 }),
    ).toBe(true);
  });

  it('marks active when any visit has output and not complete', () => {
    expect(
      orderMatchesPipelineStatusFilter(baseOrder, 'Active', [visit], { v1: 10 }),
    ).toBe(true);
  });

  it('excludes completed orders from active filter', () => {
    expect(
      orderMatchesPipelineStatusFilter(baseOrder, 'Active', [visit], { v1: 100 }),
    ).toBe(false);
  });

  it('marks delayed when shipment date is past and order is incomplete', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));
    const overdueOrder = {
      ...baseOrder,
      shipmentPlan: {
        lines: [
          {
            id: 'ship-1',
            shipmentDate: '2026-08-01',
            shipMode: 'sea',
            shipmentType: 'main',
            colorwayId: 'cw1',
            sizes: { M: 100 },
            status: 'planned',
          },
        ],
      },
    } as unknown as StyleOrder;

    expect(
      orderMatchesPipelineStatusFilter(overdueOrder, 'Delayed', [visit], { v1: 10 }),
    ).toBe(true);
    expect(
      orderMatchesPipelineStatusFilter(overdueOrder, 'Delayed', [visit], { v1: 100 }),
    ).toBe(false);
    vi.useRealTimers();
  });
});

describe('filterOrdersByPipelineStatus', () => {
  const secondOrder = {
    ...baseOrder,
    id: 'o2',
    styleName: 'Denim Jacket',
    poNumber: 'PO-2',
    buyer: 'Other Buyer',
    colorways: [
      {
        id: 'cw2',
        name: 'Blue',
        sizes: [{ size: 'L', order_qty: 50, adj_qty: 50 }],
      },
    ],
  } as unknown as StyleOrder;

  const orders = [baseOrder, secondOrder];
  const visitsByOrder = new Map<string, VisitPipelineCell[]>([
    ['o1', [visit]],
    ['o2', [visit]],
  ]);
  const counts = { o1: { v1: 10 }, o2: { v1: 0 } };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies search, buyer, and status filters together', () => {
    const filtered = filterOrdersByPipelineStatus(
      orders,
      'Active',
      visitsByOrder,
      counts,
      'test',
      'Buyer',
    );
    expect(filtered.map((o) => o.id)).toEqual(['o1']);
  });

  it('returns all orders when filters are empty', () => {
    const filtered = filterOrdersByPipelineStatus(
      orders,
      '',
      visitsByOrder,
      counts,
      '',
      '',
    );
    expect(filtered).toHaveLength(2);
  });

  it('supports page-style slicing after filter without changing match logic', () => {
    const filtered = filterOrdersByPipelineStatus(
      orders,
      '',
      visitsByOrder,
      counts,
      '',
      '',
    );
    const pageSize = 1;
    const page1 = filtered.slice(0, pageSize);
    const page2 = filtered.slice(pageSize, pageSize * 2);
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    expect([...page1, ...page2].map((o) => o.id).sort()).toEqual(['o1', 'o2']);
  });
});
