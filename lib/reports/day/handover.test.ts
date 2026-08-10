import { describe, expect, it } from 'vitest';
import { mergeHandoverSummaries } from './handover';
import type { DayHandoverSummary } from './types';

describe('mergeHandoverSummaries', () => {
  it('merges received rows with the same grouping key and sums quantities', () => {
    const a: DayHandoverSummary = {
      received: [
        {
          fromDepartmentName: 'Cutting',
          styleName: 'Polo',
          buyerName: 'Zara',
          poNumber: 'PO-1',
          operationName: 'Cut',
          colorName: 'Navy',
          sentQty: 100,
          receivedQty: 90,
          missingInTransit: 10,
          status: 'in_transit',
        },
      ],
      sent: [],
    };
    const b: DayHandoverSummary = {
      received: [
        {
          fromDepartmentName: 'Cutting',
          styleName: 'Polo',
          buyerName: 'Zara',
          poNumber: 'PO-1',
          operationName: 'Cut',
          colorName: 'Navy',
          sentQty: 50,
          receivedQty: 50,
          missingInTransit: null,
          status: 'in_transit',
        },
      ],
      sent: [],
    };

    const merged = mergeHandoverSummaries([a, b]);
    expect(merged.received).toHaveLength(1);
    expect(merged.received[0].sentQty).toBe(150);
    expect(merged.received[0].receivedQty).toBe(140);
    expect(merged.received[0].missingInTransit).toBe(10);
  });

  it('keeps distinct sent rows when status differs', () => {
    const summary: DayHandoverSummary = {
      received: [],
      sent: [
        {
          toDepartmentName: 'Sewing',
          styleName: 'Tee',
          buyerName: 'H&M',
          poNumber: 'PO-2',
          operationName: 'Sew',
          colorName: 'White',
          sentQty: 80,
          receivedQty: 80,
          missingInTransit: 0,
          status: 'received',
        },
        {
          toDepartmentName: 'Sewing',
          styleName: 'Tee',
          buyerName: 'H&M',
          poNumber: 'PO-2',
          operationName: 'Sew',
          colorName: 'White',
          sentQty: 20,
          receivedQty: 10,
          missingInTransit: 10,
          status: 'disputed',
        },
      ],
    };

    const merged = mergeHandoverSummaries([summary]);
    expect(merged.sent).toHaveLength(2);
    expect(merged.sent.map((r) => r.status).sort()).toEqual(['disputed', 'received']);
  });

  it('sorts received by source department then style', () => {
    const merged = mergeHandoverSummaries([
      {
        received: [
          {
            fromDepartmentName: 'Sewing',
            styleName: 'B',
            buyerName: 'X',
            poNumber: 'PO-3',
            operationName: 'Sew',
            colorName: 'Red',
            sentQty: 10,
            receivedQty: 10,
            missingInTransit: 0,
            status: 'received',
          },
          {
            fromDepartmentName: 'Cutting',
            styleName: 'A',
            buyerName: 'X',
            poNumber: 'PO-4',
            operationName: 'Cut',
            colorName: 'Blue',
            sentQty: 5,
            receivedQty: 5,
            missingInTransit: 0,
            status: 'received',
          },
        ],
        sent: [],
      },
    ]);

    expect(merged.received.map((r) => r.fromDepartmentName)).toEqual(['Cutting', 'Sewing']);
  });
});
