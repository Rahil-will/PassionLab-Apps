import { describe, expect, it } from 'vitest';
import {
  auditSessionLogDate,
  computeDayAuditKpis,
  filterDayAuditRows,
  isAuditLotPass,
  type DayAuditRow,
} from './auditReport';

function row(partial: Partial<DayAuditRow>): DayAuditRow {
  return {
    id: '1',
    logDate: '2026-07-28',
    orderId: 'ord-1',
    colorwayId: 'cw-1',
    styleName: 'Hoodie',
    styleRef: 'HD-1',
    buyerName: 'Acme',
    poNumber: 'PO-9',
    colorName: 'Navy',
    resourceName: 'Line 1',
    operationName: 'AQL',
    aqlLevel: '2.5',
    lotSize: 100,
    sampleSize: 20,
    passed: 19,
    failed: 1,
    majorFailed: 1,
    minorFailed: 0,
    result: 'fail',
    ...partial,
  };
}

describe('auditSessionLogDate', () => {
  it('prefers completed_at date', () => {
    expect(auditSessionLogDate('2026-07-29T08:00:00Z', '2026-07-28T18:00:00Z')).toBe('2026-07-29');
  });
});

describe('isAuditLotPass', () => {
  it('uses explicit result when present', () => {
    expect(isAuditLotPass('pass', 3)).toBe(true);
    expect(isAuditLotPass('fail', 0)).toBe(false);
  });
});

describe('computeDayAuditKpis', () => {
  it('rolls up lots and defective %', () => {
    const kpis = computeDayAuditKpis([
      row({ result: 'pass', failed: 0, sampleSize: 20, passed: 20 }),
      row({ id: '2', result: 'fail', failed: 2, sampleSize: 20, passed: 18 }),
    ]);
    expect(kpis.lots).toBe(2);
    expect(kpis.lotsPassed).toBe(1);
    expect(kpis.lotsFailed).toBe(1);
    expect(kpis.passPct).toBe(50);
    expect(kpis.defectivePct).toBe(5);
  });
});

describe('filterDayAuditRows', () => {
  it('filters by search and linked order', () => {
    const rows = [
      row({ styleName: 'Hoodie', orderId: 'a' }),
      row({ id: '2', styleName: 'Tee', orderId: 'b', poNumber: 'ZZ' }),
    ];
    expect(filterDayAuditRows(rows, 'tee', '', '')).toHaveLength(1);
    expect(filterDayAuditRows(rows, '', 'a', '')).toHaveLength(1);
    expect(
      filterDayAuditRows(
        [row({ operationName: 'Shipment audit', auditType: 'shipment' })],
        'shipment',
        '',
        '',
      ),
    ).toHaveLength(1);
  });
});
