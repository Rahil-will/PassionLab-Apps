import { describe, expect, it } from 'vitest';
import {
  buildDayReportFromRpc,
  buildDepartmentShiftReportFromRpc,
  buildStyleReportFromRpc,
  cuttingComponentsForOperation,
  listShiftsFromKpiRows,
  type CuttingComponentProgressRow,
  type DailyKpiRpcRow,
  type ShiftKpiRpcRow,
} from './kpiAndProgress';
import type { ReportMeta } from './reportMeta';

const meta: ReportMeta = {
  departments: [
    { id: 'd-cut', name: 'Cutting', apps: null, role: 'origin', planning_mode: undefined, productionPath: 'native_cutting', created_at: '' },
    { id: 'd-sew', name: 'Sewing', apps: null, role: 'standard', planning_mode: undefined, productionPath: 'hourly', created_at: '' },
  ],
  buyers: [],
  resources: [],
  orders: [
    { id: 'o1', styleName: 'Polo', styleRef: 'REF-100', poNumber: 'PO-100', buyerName: 'Zara', createdAt: '2026-01-01' },
    { id: 'o2', styleName: 'Tee', styleRef: 'REF-200', poNumber: 'PO-200', buyerName: 'H&M', createdAt: '2026-01-02' },
  ],
};

function dailyRow(overrides: Partial<DailyKpiRpcRow> = {}): DailyKpiRpcRow {
  return {
    factory_id: 'f1',
    order_id: 'o1',
    department_id: 'd-sew',
    log_date: '2026-08-05',
    daily_target: 100,
    daily_output: 80,
    daily_available_mins: 4800,
    daily_produced_mins: 3840,
    daily_efficiency_pct: 80,
    day_completeness: 'full',
    dhu: 4,
    defective_pct: null,
    wip_qty: 25,
    ...overrides,
  };
}

describe('buildDayReportFromRpc', () => {
  it('aggregates department KPIs within date range and uses latest-day wip', () => {
    const rows = [
      dailyRow({ log_date: '2026-08-04', wip_qty: 40, daily_output: 50, daily_target: 60 }),
      dailyRow({ log_date: '2026-08-05', wip_qty: 25, daily_output: 80, daily_target: 100, dhu: 6 }),
      dailyRow({
        order_id: 'o2',
        department_id: 'd-cut',
        log_date: '2026-08-05',
        daily_output: 0,
        daily_target: 0,
        wip_qty: 10,
        daily_available_mins: 0,
        daily_produced_mins: 0,
        dhu: null,
      }),
      dailyRow({ log_date: '2026-08-10', wip_qty: 999, daily_output: 1, daily_target: 1 }),
    ];

    const report = buildDayReportFromRpc(rows, meta.departments, '2026-08-04', '2026-08-05');
    const sewing = report.find((r) => r.departmentId === 'd-sew');
    expect(sewing).toMatchObject({
      departmentName: 'Sewing',
      output: 130,
      target: 160,
      wip: 25,
      dhu: 5,
    });
    expect(sewing?.efficiency).toBeCloseTo(80, 5);
    expect(report.some((r) => r.departmentId === 'd-cut')).toBe(false);
  });

  it('falls back to output-over-target efficiency when available minutes are zero', () => {
    const report = buildDayReportFromRpc(
      [dailyRow({ daily_available_mins: 0, daily_produced_mins: 0, daily_output: 60, daily_target: 120 })],
      meta.departments,
      '2026-08-05',
      '2026-08-05',
    );
    expect(report[0].efficiency).toBe(50);
  });
});

describe('buildStyleReportFromRpc', () => {
  it('aggregates per order+department and merges shift breakdown hourly slots', () => {
    const rows = [
      dailyRow({
        shift_breakdown: [{ shift_name: 'Morning', shift_output: 30 }],
      }),
      dailyRow({
        log_date: '2026-08-06',
        daily_output: 20,
        daily_target: 40,
        wip_qty: 12,
        shift_breakdown: [{ shift_name: 'Morning', shift_output: 20 }],
      }),
      dailyRow({
        order_id: 'o2',
        department_id: 'd-cut',
        daily_output: 45,
        daily_target: 50,
        wip_qty: 8,
        daily_available_mins: 0,
        daily_produced_mins: 0,
        dhu: 2,
      }),
    ];

    const report = buildStyleReportFromRpc(rows, meta, '2026-08-05', '2026-08-06');
    const sewing = report.find((r) => r.orderId === 'o1' && r.departmentId === 'd-sew');
    expect(sewing).toMatchObject({
      styleName: 'Polo',
      output: 100,
      target: 140,
      wip: 12,
    });
    expect(sewing?.hourly).toEqual([
      { hourSlot: 'Morning', actual: 50, target: 0, variance: 50 },
    ]);

    const cutting = report.find((r) => r.departmentId === 'd-cut');
    expect(cutting?.efficiency).toBe(90);
  });

  it('filters to a single order when orderId is provided', () => {
    const report = buildStyleReportFromRpc(
      [
        dailyRow(),
        dailyRow({ order_id: 'o2', department_id: 'd-cut' }),
      ],
      meta,
      '2026-08-05',
      '2026-08-05',
      'o1',
    );
    expect(report.every((r) => r.orderId === 'o1')).toBe(true);
  });
});

describe('buildDepartmentShiftReportFromRpc', () => {
  it('averages shift efficiency and filters zero-output rows', () => {
    const rows: ShiftKpiRpcRow[] = [
      {
        factory_id: 'f1',
        order_id: 'o1',
        department_id: 'd-sew',
        log_date: '2026-08-05',
        shift_id: 's1',
        shift_name: 'Morning',
        shift_output: 100,
        shift_headcount: 20,
        shift_available_mins: 9600,
        shift_efficiency_pct: 80,
        shift_productivity: 5,
        dhu: 4,
        defective_pct: null,
      },
      {
        factory_id: 'f1',
        order_id: 'o1',
        department_id: 'd-sew',
        log_date: '2026-08-06',
        shift_id: 's1',
        shift_name: 'Morning',
        shift_output: 0,
        shift_headcount: 20,
        shift_available_mins: 9600,
        shift_efficiency_pct: 60,
        shift_productivity: 0,
        dhu: null,
        defective_pct: null,
      },
      {
        factory_id: 'f1',
        order_id: 'o2',
        department_id: 'd-sew',
        log_date: '2026-08-05',
        shift_id: 's2',
        shift_name: 'Evening',
        shift_output: 40,
        shift_headcount: 10,
        shift_available_mins: 4800,
        shift_efficiency_pct: 70,
        shift_productivity: 4,
        dhu: 6,
        defective_pct: null,
      },
    ];

    const report = buildDepartmentShiftReportFromRpc(
      rows,
      meta,
      '2026-08-05',
      '2026-08-06',
      'd-sew',
      's1',
    );
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      orderId: 'o1',
      shiftName: 'Morning',
      output: 100,
      efficiency: 70,
      dhu: 4,
    });
  });
});

describe('listShiftsFromKpiRows', () => {
  it('deduplicates shifts and sorts by name', () => {
    const shifts = listShiftsFromKpiRows([
      {
        factory_id: 'f1',
        order_id: 'o1',
        department_id: 'd-sew',
        log_date: '2026-08-05',
        shift_id: 's2',
        shift_name: 'Evening',
        shift_output: 10,
        shift_headcount: 5,
        shift_available_mins: 2400,
        shift_efficiency_pct: null,
        shift_productivity: null,
        dhu: null,
        defective_pct: null,
      },
      {
        factory_id: 'f1',
        order_id: 'o2',
        department_id: 'd-sew',
        log_date: '2026-08-05',
        shift_id: 's1',
        shift_name: 'Morning',
        shift_output: 20,
        shift_headcount: 8,
        shift_available_mins: 3840,
        shift_efficiency_pct: null,
        shift_productivity: null,
        dhu: null,
        defective_pct: null,
      },
      {
        factory_id: 'f1',
        order_id: 'o3',
        department_id: 'd-sew',
        log_date: '2026-08-06',
        shift_id: 's1',
        shift_name: 'Morning',
        shift_output: 15,
        shift_headcount: 8,
        shift_available_mins: 3840,
        shift_efficiency_pct: null,
        shift_productivity: null,
        dhu: null,
        defective_pct: null,
      },
    ]);
    expect(shifts).toEqual([
      { id: 's2', name: 'Evening' },
      { id: 's1', name: 'Morning' },
    ]);
  });
});

describe('cuttingComponentsForOperation', () => {
  const rows: CuttingComponentProgressRow[] = [
    {
      factory_id: 'f1',
      order_id: 'o1',
      colorway_id: 'cw1',
      operation_id: 'op-cut',
      visit_id: 'v1',
      fabric_component_id: 'fc-shell',
      fabric_code: 'SHELL-1',
      fabric_type: 'shell',
      is_primary: true,
      qty: 100,
      qty_by_size: { S: 40, M: 60 },
    },
    {
      factory_id: 'f1',
      order_id: 'o1',
      colorway_id: 'cw2',
      operation_id: 'op-cut',
      visit_id: 'v1',
      fabric_component_id: 'fc-lining',
      fabric_code: 'LIN-1',
      fabric_type: 'lining',
      is_primary: false,
      qty: 50,
      qty_by_size: { S: 20, M: 30 },
    },
    {
      factory_id: 'f1',
      order_id: 'o1',
      colorway_id: 'cw1',
      operation_id: 'op-other',
      visit_id: 'v2',
      fabric_component_id: 'fc-shell',
      fabric_code: 'SHELL-1',
      fabric_type: 'shell',
      is_primary: true,
      qty: 10,
      qty_by_size: { S: 10 },
    },
  ];

  it('filters by operation and colorway, optionally narrowing to one size', () => {
    const allSizes = cuttingComponentsForOperation(rows, 'op-cut', 'cw1');
    expect(allSizes).toHaveLength(1);
    expect(allSizes[0].remarks).toBe('SHELL-1');
    expect(allSizes[0].by_size).toEqual({ S: 40, M: 60 });

    const oneSize = cuttingComponentsForOperation(rows, 'op-cut', 'cw1', 'M');
    expect(oneSize[0].by_size).toEqual({ M: 60 });
  });

  it('returns empty array when operation has no matching components', () => {
    expect(cuttingComponentsForOperation(rows, 'missing-op')).toEqual([]);
  });
});
