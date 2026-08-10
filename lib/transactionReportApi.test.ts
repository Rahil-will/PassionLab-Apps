import { describe, expect, it } from 'vitest';
import {
  groupHandoverRows,
  hourSlotFromSentAt,
  type HandoverReportRow,
} from './transactionReportApi';

function makeHandoverRow(overrides: Partial<HandoverReportRow> = {}): HandoverReportRow {
  return {
    id: 'h1',
    orderId: 'o1',
    colorwayId: null,
    fromDepartmentId: 'd1',
    toDepartmentId: 'd2',
    sentQty: 100,
    receivedQty: 100,
    qtyBySize: {},
    receivedQtyBySize: {},
    sentAt: '2026-08-05T09:30:00+05:30',
    receivedAt: '2026-08-05T10:00:00+05:30',
    status: 'received',
    challanNumber: null,
    notes: null,
    receivedNotes: null,
    sentBy: null,
    receivedBy: null,
    styleName: 'Polo',
    poNumber: 'PO-1',
    colorwayName: null,
    colorCode: null,
    fromDepartmentName: 'Cutting',
    toDepartmentName: 'Sewing',
    sentByName: null,
    receivedByName: null,
    fromProduceOperationNames: null,
    toProduceOperationNames: null,
    fromResourceName: null,
    toResourceName: null,
    lossClosedBy: null,
    lossClosedByName: null,
    lossClosedAt: null,
    lossRemark: null,
    lossRejectionId: null,
    logDate: '2026-08-05',
    shiftId: 's1',
    shiftName: 'Morning',
    hourSlot: '',
    ...overrides,
  };
}

describe('hourSlotFromSentAt', () => {
  it('returns calendar hour bucket from sent_at', () => {
    expect(hourSlotFromSentAt('2026-08-05T14:15:00+05:30')).toBe('14:00-15:00');
  });

  it('uses fallback for invalid timestamps', () => {
    expect(hourSlotFromSentAt('not-a-date', 'stored-slot')).toBe('stored-slot');
    expect(hourSlotFromSentAt('not-a-date')).toBe('—');
  });
});

describe('groupHandoverRows', () => {
  it('groups by date desc, shift, and hour slot with qty totals', () => {
    const rows = [
      makeHandoverRow({
        id: 'older-day',
        logDate: '2026-08-04',
        sentQty: 30,
        sentAt: '2026-08-04T11:00:00+05:30',
        shiftId: 's1',
        shiftName: 'Morning',
      }),
      makeHandoverRow({
        id: 'later-hour',
        logDate: '2026-08-05',
        sentQty: 40,
        sentAt: '2026-08-05T10:30:00+05:30',
      }),
      makeHandoverRow({
        id: 'earlier-hour',
        logDate: '2026-08-05',
        sentQty: 60,
        sentAt: '2026-08-05T09:15:00+05:30',
      }),
      makeHandoverRow({
        id: 'evening-shift',
        logDate: '2026-08-05',
        sentQty: 25,
        sentAt: '2026-08-05T18:00:00+05:30',
        shiftId: 's2',
        shiftName: 'Evening',
      }),
    ];

    const grouped = groupHandoverRows(rows, ['s1', 's2']);
    expect(grouped.map((g) => g.logDate)).toEqual(['2026-08-05', '2026-08-04']);
    expect(grouped[0].totalQty).toBe(125);

    const morning = grouped[0].shiftGroups.find((g) => g.shiftId === 's1');
    expect(morning?.totalQty).toBe(100);
    expect(morning?.hourSlotGroups.map((h) => h.hourSlot)).toEqual(['09:00-10:00', '10:00-11:00']);
    expect(morning?.hourSlotGroups[0].totalQty).toBe(60);
    expect(morning?.hourSlotGroups[0].rows.map((r) => r.id)).toEqual(['earlier-hour']);
  });

  it('places unallocated shift rows after known shift order', () => {
    const grouped = groupHandoverRows([
      makeHandoverRow({
        shiftId: null,
        shiftName: 'Unallocated',
        sentQty: 10,
        sentAt: '2026-08-05T12:00:00+05:30',
      }),
      makeHandoverRow({
        shiftId: 's1',
        shiftName: 'Morning',
        sentQty: 20,
        sentAt: '2026-08-05T09:00:00+05:30',
      }),
    ], ['s1']);

    expect(grouped[0].shiftGroups.map((g) => g.shiftName)).toEqual(['Morning', 'Unallocated']);
  });
});
