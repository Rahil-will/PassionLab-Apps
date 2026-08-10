/** Shared report row shapes (formerly in lib/mesReports.ts). */
export interface DayDeptRow {
  departmentId: string;
  departmentName: string;
  output: number;
  target: number;
  efficiency: number | null;
  dhu: number | null;
  wip: number;
}

export interface StyleReportRow {
  orderId: string;
  styleName: string;
  poNumber: string;
  departmentId: string;
  departmentName: string;
  output: number;
  target: number;
  efficiency: number | null;
  dhu: number | null;
  wip: number;
  hourly: Array<{ hourSlot: string; actual: number; target: number; variance: number }>;
  shiftId?: string;
  shiftName?: string;
}
