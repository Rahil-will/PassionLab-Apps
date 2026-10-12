import { describe, expect, it } from 'vitest';
import { isShipmentFlowDept, shipmentFlowDisplayQty } from './orderFlowMetrics';

describe('shipmentFlowDisplayQty', () => {
  it('moves produced into sent for shipment and reduces WIP', () => {
    const qty = shipmentFlowDisplayQty({
      deptName: 'Shipment',
      activitiesLabel: 'Dispatch',
      produced: 258,
      sent: 0,
      received: 262,
      wip: 262,
    });
    expect(qty).toEqual({ produced: 0, sent: 258, wip: 4, isShipment: true });
  });

  it('leaves non-shipment rows unchanged', () => {
    const qty = shipmentFlowDisplayQty({
      deptName: 'Packing',
      activitiesLabel: 'Packing out',
      produced: 262,
      sent: 262,
      received: 262,
      wip: 0,
    });
    expect(qty).toEqual({ produced: 262, sent: 262, wip: 0, isShipment: false });
  });

  it('treats terminal role as shipment', () => {
    expect(isShipmentFlowDept({ deptName: 'QA Gate', deptRole: 'terminal' })).toBe(true);
  });
});
