import { describe, expect, it } from 'vitest';
import {
  PLANNING_STATUS_RANK,
  buildPlanningColorwayRows,
  computeColorwayPlanningStatus,
  sortPlanningRows,
  type PlanningColorwayRow,
} from './planningOrderStatus';
import type { StyleOrder } from '../types';

describe('computeColorwayPlanningStatus', () => {
  it('returns Planning Pending when routing is missing and nothing planned', () => {
    expect(computeColorwayPlanningStatus(false, false, 0, 100, [], false)).toBe('Planning Pending');
  });

  it('returns Unplanned when routing exists but nothing planned', () => {
    expect(computeColorwayPlanningStatus(true, false, 0, 100, [{ visitId: 'v1' }], false)).toBe(
      'Unplanned',
    );
  });

  it('returns Partial when planned qty is below requirement', () => {
    expect(computeColorwayPlanningStatus(true, true, 50, 100, [{ visitId: 'v1' }], false)).toBe(
      'Partial',
    );
  });
});

describe('sortPlanningRows', () => {
  const row = (status: PlanningColorwayRow['status'], delivery: string): PlanningColorwayRow => ({
    id: `${status}-${delivery}`,
    orderId: 'o1',
    styleName: 'Style',
    priority: 'normal',
    styleRef: '',
    poNumber: 'PO',
    buyer: 'Buyer',
    deliveryDates: delivery ? [delivery] : [],
    colorway: 'Red',
    routingSet: true,
    totalQty: 100,
    plannedQty: 0,
    hasAllocations: false,
    allocationCount: 0,
    status,
  });

  it('ranks unplanned and partial above planned', () => {
    const sorted = sortPlanningRows([
      row('Planned', '2026-01-01'),
      row('Partial', '2026-06-01'),
      row('Unplanned', '2026-12-01'),
      row('Planning Pending', '2026-03-01'),
    ]);

    expect(sorted.map((r) => r.status)).toEqual([
      'Unplanned',
      'Partial',
      'Planning Pending',
      'Planned',
    ]);
  });

  it('sorts by delivery within the same status rank', () => {
    const sorted = sortPlanningRows([
      row('Unplanned', '2026-06-01'),
      row('Unplanned', '2026-02-01'),
    ]);
    expect(sorted[0].deliveryDates[0]).toBe('2026-02-01');
  });
});

describe('PLANNING_STATUS_RANK', () => {
  it('places unplanned and partial before planned', () => {
    expect(PLANNING_STATUS_RANK.Unplanned).toBeLessThan(PLANNING_STATUS_RANK.Planned);
    expect(PLANNING_STATUS_RANK.Partial).toBeLessThan(PLANNING_STATUS_RANK.Planned);
  });
});

describe('buildPlanningColorwayRows', () => {
  it('returns one row per colorway', () => {
    const order = {
      id: 'o1',
      styleName: 'Test',
      poNumber: 'PO-1',
      styleRef: 'REF',
      buyer: 'Buyer',
      priority: 'normal',
      routingSteps: [],
      colorways: [
        { id: 'cw1', name: 'Red', sizes: [{ size: 'M', order_qty: 100, adj_qty: 100 }] },
        { id: 'cw2', name: 'Blue', sizes: [{ size: 'M', order_qty: 50, adj_qty: 50 }] },
      ],
      shipmentPlan: [],
    } as unknown as StyleOrder;

    const rows = buildPlanningColorwayRows([order], [], []);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'Planning Pending')).toBe(true);
  });
});
