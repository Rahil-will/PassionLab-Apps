import type { HandoverDisplayStatus } from '../../handoverStatus';

export interface DayStyleColorHourRow {
  orderId: string;
  colorwayId: string | null;
  resourceId: string | null;
  styleName: string;
  poNumber: string;
  colorName: string;
  resourceName: string;
  hours: Record<string, number>;
  total: number;
}

export interface DayStyleColorHourReport {
  hourColumns: string[];
  rows: DayStyleColorHourRow[];
}

export interface WorkforceCategoryCount {
  category: string;
  count: number;
}

export interface DayResourceHourRow {
  logDate?: string;
  shiftId?: string;
  resourceId: string;
  resourceName: string;
  orderId: string;
  styleName: string;
  styleRef: string;
  buyerName: string;
  poNumber: string;
  colorwayId: string | null;
  colorName: string;
  hours: Record<string, number>;
  hourTargets: Record<string, number>;
  /** Per-hour plan target from line_allocations.hourly_target or daily ÷ shift hours. */
  hourlyTarget: number;
  total: number;
  workforce: number | null;
  workforceBreakdown: WorkforceCategoryCount[];
  producedMins: number;
  resourceAvailableMins: number;
  daysRunning: number | null;
  plannedEndDate: string | null;
  allocationId?: string | null;
  efficiencyPct: number | null;
  productivity: number | null;
  /** Planned SAM minutes per piece for this resource × order (standard hourly). */
  sam?: number | null;
  /** Origin cutting — routing operation for this row. */
  operationId?: string | null;
  /** Group key for splitting hourly cards (operation_def / name). */
  operationGroupId?: string | null;
  operationLabel?: string;
  /** Shell vs lining fabric aspect (native cutting). */
  fabricAspect?: 'shell' | 'lining' | null;
  layNo?: string | null;
  /**
   * Which capture mode produced this row — a department's operation can move
   * between QC (piece-wise inspection) and hourly output over time, so rows
   * from the two modes are kept separate and rendered as separate tables
   * rather than merged. Defaults to 'hourly' when absent (older report shapes).
   */
  captureKind?: 'hourly' | 'qc';
  /** QC rows only — total pieces inspected in this bucket. */
  inspectedQty?: number | null;
  /** QC rows only — inspectedQty minus passed (row.total). */
  defectiveQty?: number | null;
  /** QC rows only — defectiveQty ÷ inspectedQty × 100. */
  defectivePct?: number | null;
  /** QC rows only — defects per hundred units (same formula as defectivePct; no distinct per-defect count is captured). */
  dhu?: number | null;
  /**
   * Routing step type for this row's operation (`loading` | `produce` | ...).
   * `loading` rows are a receiving/WIP-start acknowledgement, not measured
   * production — they're excluded from SAM/efficiency/productivity and from
   * the department's headline output KPI, but still shown in their own card.
   */
  stepType?: string | null;
}

export interface DayOperationHourSection {
  operationId: string;
  operationLabel: string;
  fabricAspect?: 'shell' | 'lining' | null;
  hourColumns: string[];
  rows: DayResourceHourRow[];
  captureKind?: 'hourly' | 'qc';
  /**
   * Routing step type for this operation (`loading` | `produce` | ...). Drives
   * which card template renders it — `loading` gets a simpler table with no
   * SAM/Eff%/Productivity columns, since those never apply to it.
   */
  stepType?: string | null;
}

export interface DayShiftHourSection {
  shiftId: string;
  shiftName: string;
  hourColumns: string[];
  rows: DayResourceHourRow[];
  captureKind?: 'hourly' | 'qc';
}

export interface DayResourceHourReport {
  isQcDept: boolean;
  isNativeCutting?: boolean;
  isNativeShipment?: boolean;
  isOutsource?: boolean;
  isBatch?: boolean;
  hourColumns: string[];
  rows: DayResourceHourRow[];
  shiftSections: DayShiftHourSection[];
  /**
   * QC-captured rows for this department, kept in their own shift sections so
   * they render as a separate "QC output" table (with Inspected/Defective %/DHU
   * columns) instead of being merged into the hourly-output table.
   */
  qcShiftSections?: DayShiftHourSection[];
  operationSections?: DayOperationHourSection[];
  nativeEntries?: DayNativeEntry[];
  outsourceEntries?: DayNativeEntry[];
  batchEntries?: DayNativeEntry[];
  productiveMinsPerWorker: number;
  kpi: {
    output: number;
    target: number;
    efficiency: number | null;
    productivity: number | null;
    dhu: number | null;
    inspected?: number;
    passed?: number;
    passPct?: number | null;
    /** QC depts only — 100 − passPct, i.e. (inspected − passed) ÷ inspected × 100. */
    defectivePct?: number | null;
    wip?: number;
    /** Average daily headcount over the report period (see computeDayDeptMetricsFromRows). */
    workforce?: number;
  };
  handover?: DayHandoverSummary;
  handoverByDay?: Array<{ date: string; handover: DayHandoverSummary }>;
}

export type DayHandoverRowStatus = HandoverDisplayStatus;

export interface DayDeptReceivedRow {
  fromDepartmentName: string;
  styleName: string;
  buyerName: string;
  poNumber: string;
  operationName: string;
  colorName: string;
  sentQty: number;
  receivedQty: number;
  missingInTransit: number | null;
  status: DayHandoverRowStatus;
}

export interface DayDeptSentRow {
  toDepartmentName: string;
  styleName: string;
  buyerName: string;
  poNumber: string;
  operationName: string;
  colorName: string;
  sentQty: number;
  receivedQty: number;
  missingInTransit: number | null;
  status: DayHandoverRowStatus;
}

export type DayNativeEntry = {
  id: string;
  kind: 'cutting_session' | 'shipment' | 'outsource' | 'batch';
  logDate: string;
  operationName: string;
  styleName: string;
  styleRef: string;
  buyerName: string;
  poNumber: string;
  colorName: string;
  resourceName?: string;
  fabricType?: string;
  fabricReference?: string;
  fabricCode?: string;
  sessionNo?: string;
  refNo?: string;
  layNo?: string;
  activityNo?: string;
  startedAt?: string;
  endedAt?: string;
  workerCategories?: WorkforceCategoryCount[];
  outputQty: number;
  sentQty?: number;
  receivedQty?: number;
  shipmentType?: string;
  destination?: string;
  invoiceNumber?: string;
  awbNumber?: string;
  notes?: string;
  comment?: string;
};

export interface DayHandoverSummary {
  received: DayDeptReceivedRow[];
  sent: DayDeptSentRow[];
}


export interface DeptDailyTrendRow {
  date: string;
  output: number;
  target: number;
  efficiency: number | null;
  dhu: number | null;
}

export interface DeptStyleSummaryRow {
  orderId: string;
  styleName: string;
  poNumber: string;
  totalOutput: number;
  totalTarget: number;
  avgEfficiency: number | null;
  avgDhu: number | null;
  currentWip: number;
  daysActive: number;
  resourceBreakdown: Array<{
    resourceId: string;
    resourceName: string;
    output: number;
    efficiency: number | null;
  }>;
}

export interface DeptResourceStyleRow {
  resourceId: string;
  resourceName: string;
  orderId: string;
  styleName: string;
  poNumber: string;
  output: number;
  styleEfficiency: number | null;
}


export interface DeptPeriodReport {
  dailyTrend: DeptDailyTrendRow[];
  styleRows: DeptStyleSummaryRow[];
  kpiSummary: {
    totalOutput: number;
    avgDailyOutput: number;
    avgEfficiency: number | null;
    avgDhu: number | null;
    currentWip: number;
  };
}
