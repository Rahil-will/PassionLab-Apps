import { describe, expect, it } from 'vitest';
import {
  allocRowKey,
  applyAllocationPlanToDayRows,
  aggregateDeptDayKpi,
  averageDailyHeadcountFromLogs,
  buildResourceWorkforceDetails,
  computeDayDeptMetricsFromRows,
  enrichDayResourceRows,
  flattenDeptResourceStyleRows,
  listDatesInRange,
  type AllocPlanRow,
} from './deptMetrics.pure';
import type { DayResourceHourRow, DeptStyleSummaryRow } from './types';
import type { DailyKpiRpcRow } from '../kpiAndProgress';

function makeDayRow(overrides: Partial<DayResourceHourRow> = {}): DayResourceHourRow {
  return {
    resourceId: 'r1',
    resourceName: 'Line 1',
    orderId: 'o1',
    styleName: 'Style A',
    styleRef: '',
    buyerName: 'Buyer',
    poNumber: 'PO-1',
    colorwayId: 'cw1',
    colorName: 'Red',
    hours: {},
    hourTargets: {},
    hourlyTarget: 0,
    total: 0,
    workforce: null,
    workforceBreakdown: [],
    producedMins: 0,
    resourceAvailableMins: 0,
    daysRunning: null,
    plannedEndDate: null,
    efficiencyPct: null,
    productivity: null,
    ...overrides,
  };
}

function makeAlloc(overrides: Partial<AllocPlanRow> = {}): AllocPlanRow {
  return {
    id: 'alloc-1',
    order_id: 'o1',
    colorway_id: 'cw1',
    line_id: 'r1',
    department_id: 'd1',
    daily_target: 0,
    hourly_target: null,
    qty: 500,
    start_date: '2026-08-04',
    end_date: '2026-08-08',
    sam: 12,
    kpi_inputs: null,
    ...overrides,
  };
}

describe('listDatesInRange', () => {
  it('returns inclusive date strings', () => {
    const dates = listDatesInRange('2026-08-01', '2026-08-03');
    expect(dates).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('swaps inverted range', () => {
    const dates = listDatesInRange('2026-08-05', '2026-08-03');
    expect(dates[0]).toBe('2026-08-03');
    expect(dates.at(-1)).toBe('2026-08-05');
  });
});

describe('allocRowKey', () => {
  it('joins order, colorway, resource', () => {
    expect(allocRowKey('o1', 'c1', 'r1')).toBe('o1|c1|r1');
    expect(allocRowKey('o1', null, 'r1')).toBe('o1||r1');
  });
});

describe('buildResourceWorkforceDetails', () => {
  it('aggregates headcount by resource', () => {
    const map = buildResourceWorkforceDetails([
      {
        resource_id: 'r1',
        headcount_by_category: { operator: 5, helper: 2 },
      },
      {
        resource_id: 'r1',
        headcount_by_category: { operator: 3 },
      },
    ]);
    expect(map.get('r1')?.total).toBe(10);
    expect(map.get('r1')?.breakdown[0]).toEqual({ category: 'operator', count: 8 });
  });

  it('skips rows without resource_id or zero headcount', () => {
    const map = buildResourceWorkforceDetails([
      { resource_id: null, headcount_by_category: { operator: 5 } },
      { resource_id: 'r2', headcount_by_category: { operator: 0, helper: -1 } },
    ]);
    expect(map.size).toBe(0);
  });
});

describe('averageDailyHeadcountFromLogs', () => {
  it('returns 0 when no days have workforce logs', () => {
    expect(averageDailyHeadcountFromLogs(new Map())).toBe(0);
  });

  it('sums every resource once per day, then averages across the days present', () => {
    const workforceByDate = new Map<string, Map<string, { total: number }>>([
      [
        '2026-08-01',
        new Map([
          ['r1', { total: 5 }],
          ['r2', { total: 3 }],
        ]),
      ],
      ['2026-08-02', new Map([['r1', { total: 4 }]])],
    ]);
    // Day totals: 8 (2026-08-01) + 4 (2026-08-02) averaged over 2 days = 6.
    expect(averageDailyHeadcountFromLogs(workforceByDate)).toBe(6);
  });
});

describe('applyAllocationPlanToDayRows', () => {
  it('applies stored hourly target and days running from best-matching allocation', () => {
    const rows = [makeDayRow({ total: 40 })];
    applyAllocationPlanToDayRows(
      rows,
      [makeAlloc({ hourly_target: 55, daily_target: 440 })],
      '2026-08-05',
      ['09:00-10:00', '10:00-11:00'],
      8,
      'd1',
    );
    expect(rows[0].hourlyTarget).toBe(55);
    expect(rows[0].hourTargets['09:00-10:00']).toBe(55);
    expect(rows[0].daysRunning).toBe(2);
    expect(rows[0].plannedEndDate).toBe('2026-08-08');
    expect(rows[0].allocationId).toBe('alloc-1');
  });

  it('derives hourly target from implied daily target when hourly_target is missing', () => {
    const rows = [makeDayRow()];
    applyAllocationPlanToDayRows(
      rows,
      [makeAlloc({ hourly_target: null, daily_target: 80 })],
      '2026-08-05',
      ['09:00-10:00'],
      8,
      'd1',
    );
    expect(rows[0].hourlyTarget).toBe(10);
  });

  it('prefers allocation matching resource, colorway, and plan window', () => {
    const rows = [makeDayRow({ orderId: 'o1', colorwayId: 'cw1', resourceId: 'r1' })];
    applyAllocationPlanToDayRows(
      rows,
      [
        makeAlloc({ id: 'weak', line_id: 'r-other', hourly_target: 10 }),
        makeAlloc({ id: 'strong', line_id: 'r1', colorway_id: 'cw1', hourly_target: 90 }),
      ],
      '2026-08-05',
      ['09:00-10:00'],
      8,
      'd1',
    );
    expect(rows[0].allocationId).toBe('strong');
    expect(rows[0].hourlyTarget).toBe(90);
  });
});

describe('enrichDayResourceRows', () => {
  it('computes produced minutes, resource efficiency, and productivity', () => {
    const rows = [
      makeDayRow({ resourceId: 'r1', total: 100 }),
      makeDayRow({ resourceId: 'r1', orderId: 'o2', total: 50 }),
    ];
    const samByAllocKey = new Map([['o1|cw1|r1', 12]]);
    const sewingSamByOrder = new Map([['o2', 10]]);
    const workforce = new Map([
      ['r1', { total: 10, breakdown: [{ category: 'operator', count: 10 }] }],
    ]);

    enrichDayResourceRows(rows, samByAllocKey, sewingSamByOrder, workforce, 480);

    expect(rows[0].producedMins).toBe(1200);
    expect(rows[0].sam).toBe(12);
    expect(rows[1].producedMins).toBe(500);
    expect(rows[1].sam).toBe(10);
    expect(rows[0].workforce).toBe(10);
    expect(rows[0].resourceAvailableMins).toBe(4800);
    expect(rows[0].efficiencyPct).toBeCloseTo(35.416, 2);
    expect(rows[0].productivity).toBe(15);
  });

  it('leaves efficiency null when workforce is missing', () => {
    const rows = [makeDayRow({ total: 80 })];
    enrichDayResourceRows(rows, new Map(), new Map(), new Map(), 480);
    expect(rows[0].efficiencyPct).toBeNull();
    expect(rows[0].productivity).toBeNull();
  });

  it('excludes loading rows from SAM/efficiency/productivity and from a resource\'s produced-minutes aggregate', () => {
    // Same resource logs a "Line Loading" count (200) and a "Sewing Output"
    // count (100) the same day. Loading has no SAM and must not inflate the
    // resource's produced minutes / output used for its produce-row metrics.
    const rows = [
      makeDayRow({ resourceId: 'r1', total: 200, stepType: 'loading' }),
      makeDayRow({ resourceId: 'r1', total: 100, stepType: 'produce' }),
    ];
    const sewingSamByOrder = new Map([['o1', 10]]);
    const workforce = new Map([
      ['r1', { total: 5, breakdown: [{ category: 'operator', count: 5 }] }],
    ]);

    enrichDayResourceRows(rows, new Map(), sewingSamByOrder, workforce, 480);

    const loadingRow = rows[0];
    const produceRow = rows[1];
    expect(loadingRow.sam).toBeNull();
    expect(loadingRow.producedMins).toBe(0);
    expect(loadingRow.efficiencyPct).toBeNull();
    expect(loadingRow.productivity).toBeNull();
    expect(loadingRow.resourceAvailableMins).toBe(0);
    // Workforce is still recorded on the loading row for display purposes.
    expect(loadingRow.workforce).toBe(5);

    // The produce row's own output/producedMins-based metrics must reflect
    // only the produce row, not 300 (200 loaded + 100 produced).
    expect(produceRow.sam).toBe(10);
    expect(produceRow.producedMins).toBe(1000);
    expect(produceRow.productivity).toBe(20); // 100 / 5 workers, not 300 / 5
  });
});

describe('computeDayDeptMetricsFromRows', () => {
  it('sums output and deduplicates workforce per resource', () => {
    const rows = [
      makeDayRow({
        resourceId: 'r1',
        total: 100,
        producedMins: 600,
        workforce: 8,
        resourceAvailableMins: 3840,
      }),
      makeDayRow({
        resourceId: 'r1',
        orderId: 'o2',
        total: 50,
        producedMins: 300,
        workforce: 8,
        resourceAvailableMins: 3840,
      }),
      makeDayRow({
        resourceId: 'r2',
        total: 40,
        producedMins: 200,
        workforce: 5,
        resourceAvailableMins: 2400,
      }),
    ];

    const metrics = computeDayDeptMetricsFromRows(rows);
    expect(metrics.output).toBe(190);
    expect(metrics.workforce).toBe(13);
    expect(metrics.efficiency).toBeCloseTo(17.628, 2);
    expect(metrics.productivity).toBeCloseTo(14.615, 2);
  });

  it('averages workforce per day across the period instead of summing every resource-day', () => {
    const rows = [
      makeDayRow({
        logDate: '2026-07-22',
        total: 200,
        producedMins: 0,
        workforce: null,
        resourceAvailableMins: 0,
      }),
      makeDayRow({
        logDate: '2026-07-28',
        total: 50,
        producedMins: 600,
        workforce: 8,
        resourceAvailableMins: 3840,
      }),
    ];

    const metrics = computeDayDeptMetricsFromRows(rows);
    expect(metrics.output).toBe(250);
    // Day totals: 0 (2026-07-22) + 8 (2026-07-28) averaged over 2 days = 4.
    expect(metrics.workforce).toBe(4);
    expect(metrics.efficiency).toBeCloseTo(15.625, 2);
    // Productivity stays a ratio of sums (output ÷ total person-days = 250 / 8),
    // NOT output ÷ the averaged workforce — otherwise it would inflate with day count.
    expect(metrics.productivity).toBeCloseTo(31.25, 2);
  });

  it('keeps productivity a stable per-worker rate across a multi-day range with steady headcount', () => {
    const rows = [
      makeDayRow({ logDate: '2026-08-01', resourceId: 'r1', total: 50, workforce: 5 }),
      makeDayRow({ logDate: '2026-08-02', resourceId: 'r1', total: 50, workforce: 5 }),
      makeDayRow({ logDate: '2026-08-03', resourceId: 'r1', total: 50, workforce: 5 }),
    ];
    // Single day: 50 output / 5 workers = 10/worker. A 3-day range with the
    // same steady headcount every day must report the same rate, not 3x it.
    const singleDay = computeDayDeptMetricsFromRows([rows[0]]);
    const threeDays = computeDayDeptMetricsFromRows(rows);
    expect(singleDay.productivity).toBe(10);
    expect(threeDays.productivity).toBe(10);
    expect(threeDays.workforce).toBe(5);
  });

  it('sums same-day styles per resource once, then averages across multiple days', () => {
    const rows = [
      // Day 1: two resources, each running two styles — workforce should count once per resource.
      makeDayRow({ logDate: '2026-08-01', resourceId: 'r1', orderId: 'o1', total: 60, workforce: 6 }),
      makeDayRow({ logDate: '2026-08-01', resourceId: 'r1', orderId: 'o2', total: 40, workforce: 6 }),
      makeDayRow({ logDate: '2026-08-01', resourceId: 'r2', orderId: 'o3', total: 30, workforce: 4 }),
      // Day 2: one resource, one style.
      makeDayRow({ logDate: '2026-08-02', resourceId: 'r1', orderId: 'o1', total: 50, workforce: 10 }),
    ];

    const metrics = computeDayDeptMetricsFromRows(rows);
    // Day totals: 10 (6+4 on 2026-08-01) + 10 (2026-08-02) averaged over 2 days = 10.
    expect(metrics.workforce).toBe(10);
  });

  it('returns null efficiency and productivity for empty output', () => {
    const metrics = computeDayDeptMetricsFromRows([makeDayRow()]);
    expect(metrics.output).toBe(0);
    expect(metrics.efficiency).toBeNull();
    expect(metrics.productivity).toBeNull();
  });
});

describe('aggregateDeptDayKpi', () => {
  it('sums target and wip with output-weighted dhu', () => {
    const rows: DailyKpiRpcRow[] = [
      {
        factory_id: 'f1',
        order_id: 'o1',
        department_id: 'd1',
        log_date: '2026-08-05',
        daily_target: 100,
        daily_output: 80,
        daily_available_mins: 0,
        daily_produced_mins: 0,
        daily_efficiency_pct: null,
        day_completeness: 'full',
        dhu: 4,
        defective_pct: null,
        wip_qty: 30,
      },
      {
        factory_id: 'f1',
        order_id: 'o2',
        department_id: 'd1',
        log_date: '2026-08-05',
        daily_target: 50,
        daily_output: 0,
        daily_available_mins: 0,
        daily_produced_mins: 0,
        daily_efficiency_pct: null,
        day_completeness: 'partial',
        dhu: 10,
        defective_pct: null,
        wip_qty: 20,
      },
    ];

    expect(aggregateDeptDayKpi(rows)).toEqual({ target: 150, wip: 50, dhu: 4 });
  });

  it('uses latest-day WIP per order instead of summing the range', () => {
    const rows: DailyKpiRpcRow[] = [
      {
        factory_id: 'f1',
        order_id: 'o1',
        department_id: 'd1',
        log_date: '2026-08-04',
        daily_target: 100,
        daily_output: 80,
        daily_available_mins: 0,
        daily_produced_mins: 0,
        daily_efficiency_pct: null,
        day_completeness: 'full',
        dhu: null,
        defective_pct: null,
        wip_qty: 40,
      },
      {
        factory_id: 'f1',
        order_id: 'o1',
        department_id: 'd1',
        log_date: '2026-08-05',
        daily_target: 100,
        daily_output: 50,
        daily_available_mins: 0,
        daily_produced_mins: 0,
        daily_efficiency_pct: null,
        day_completeness: 'full',
        dhu: null,
        defective_pct: null,
        wip_qty: 12,
      },
    ];

    expect(aggregateDeptDayKpi(rows)).toEqual({ target: 200, wip: 12, dhu: null });
  });

  it('returns null dhu when no rows carry dhu', () => {
    const rows: DailyKpiRpcRow[] = [
      {
        factory_id: 'f1',
        order_id: 'o1',
        department_id: 'd1',
        log_date: '2026-08-05',
        daily_target: 10,
        daily_output: 5,
        daily_available_mins: 0,
        daily_produced_mins: 0,
        daily_efficiency_pct: null,
        day_completeness: 'full',
        dhu: null,
        defective_pct: null,
        wip_qty: 0,
      },
    ];
    expect(aggregateDeptDayKpi(rows).dhu).toBeNull();
  });
});

describe('flattenDeptResourceStyleRows', () => {
  it('emits placeholder row when style has no resource breakdown', () => {
    const styleRows: DeptStyleSummaryRow[] = [
      {
        orderId: 'o1',
        styleName: 'Polo',
        poNumber: 'PO-9',
        totalOutput: 120,
        totalTarget: 200,
        avgEfficiency: 72,
        avgDhu: 3,
        currentWip: 40,
        daysActive: 2,
        resourceBreakdown: [],
      },
    ];
    expect(flattenDeptResourceStyleRows(styleRows)).toEqual([
      {
        resourceId: '',
        resourceName: '—',
        orderId: 'o1',
        styleName: 'Polo',
        poNumber: 'PO-9',
        output: 120,
        styleEfficiency: 72,
      },
    ]);
  });

  it('sorts flattened rows by output descending', () => {
    const styleRows: DeptStyleSummaryRow[] = [
      {
        orderId: 'o1',
        styleName: 'A',
        poNumber: 'PO-1',
        totalOutput: 100,
        totalTarget: 100,
        avgEfficiency: null,
        avgDhu: null,
        currentWip: 0,
        daysActive: 1,
        resourceBreakdown: [
          { resourceId: 'r1', resourceName: 'Line 1', output: 30, efficiency: null },
          { resourceId: 'r2', resourceName: 'Line 2', output: 70, efficiency: null },
        ],
      },
    ];
    const flat = flattenDeptResourceStyleRows(styleRows);
    expect(flat.map((r) => r.output)).toEqual([70, 30]);
  });
});
