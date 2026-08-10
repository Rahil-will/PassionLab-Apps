import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'lib', 'reports');
const backupPath = path.join(root, '..', '..', '.build-opt-backup', 'lib', 'reports', 'dayReport.ts');
const sourcePath = fs.existsSync(backupPath) ? backupPath : path.join(root, 'dayReport.ts');
const lines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/);
const slice = (start, end) => lines.slice(start - 1, end).join('\n');
const dayDir = path.join(root, 'day');

const typesBody = [
  slice(43, 58),
  '',
  slice(125, 208),
  '',
  'export type DayHandoverRowStatus = HandoverDisplayStatus;',
  '',
  slice(213, 271),
  '',
  slice(2505, 2540),
  '',
  slice(2578, 2589),
].join('\n');

const typesTs = [
  "import type { HandoverDisplayStatus } from '../../handoverStatus';",
  '',
  typesBody,
].join('\n');

const handoverBody = slice(272, 415).replace(
  'function mergeHandoverSummaries',
  'export function mergeHandoverSummaries',
);

const handoverTs = [
  "import {",
  '  handoverDbToDisplay,',
  '  handoverDisplayLabel,',
  '  handoverQtyGap,',
  "} from '../../handoverStatus';",
  "import { fetchHandoverReport } from '../../transactionReportApi';",
  "import type { ColorwayLabel, ReportMeta } from '../reportMeta';",
  'import type {',
  '  DayDeptReceivedRow,',
  '  DayDeptSentRow,',
  '  DayHandoverSummary,',
  "} from './types';",
  '',
  'export { handoverDisplayLabel as dayHandoverStatusLabel, handoverDbToDisplay };',
  '',
  handoverBody,
].join('\n');

let deptMetricsBody = [
  slice(417, 548),
  slice(693, 857),
  slice(2541, 2576),
].join('\n\n');

deptMetricsBody = deptMetricsBody
  .replace(/^interface AllocPlanRow \{[\s\S]*?\}\n\n/m, '')
  .replace(/^function listDatesInRange/m, 'export function listDatesInRange')
  .replace(/^function buildResourceWorkforceDetails/m, 'export function buildResourceWorkforceDetails')
  .replace(/^function allocRowKey/m, 'export function allocRowKey')
  .replace(/^function applyAllocationPlanToDayRows/m, 'export function applyAllocationPlanToDayRows')
  .replace(/^function enrichDayResourceRows/m, 'export function enrichDayResourceRows')
  .replace(/^function aggregateDeptDayKpi/m, 'export function aggregateDeptDayKpi');

const deptMetricsTs = [
  "import eachDayOfInterval from 'date-fns/eachDayOfInterval';",
  "import format from 'date-fns/format';",
  "import parseISO from 'date-fns/parseISO';",
  "import { hourlyTargetFromDaily } from '../../shiftHours';",
  "import type { DailyKpiRpcRow } from '../kpiAndProgress';",
  'import type {',
  '  DayResourceHourReport,',
  '  DayResourceHourRow,',
  '  DeptResourceStyleRow,',
  '  DeptStyleSummaryRow,',
  '  WorkforceCategoryCount,',
  "} from './types';",
  '',
  'export interface AllocPlanRow {',
  '  id: string;',
  '  order_id: string;',
  '  colorway_id: string | null;',
  '  line_id: string;',
  '  department_id: string | null;',
  '  daily_target: number;',
  '  hourly_target: number | null;',
  '  qty: number;',
  '  start_date: string | null;',
  '  end_date: string | null;',
  '  sam: number | null;',
  '  kpi_inputs: { sam?: number } | null;',
  '}',
  '',
  deptMetricsBody,
].join('\n');

const hourBody = [
  slice(61, 123),
  slice(550, 596),
  slice(597, 692),
  slice(857, 2504),
].join('\n\n');

const hourReportTs = [
  "import format from 'date-fns/format';",
  "import { supabase } from '../../supabase';",
  "import { allocationSamValue } from '../../allocationUtils';",
  "import { isQcDept } from '../../reportDeptUtils';",
  "import { resolvePlanningMode } from '../../departmentFilters';",
  "import { getRegularShiftHours } from '../../shiftHours';",
  'import {',
  '  allActiveHourSlots,',
  '  activeHourSlotsForShift,',
  '  isOtShift,',
  '  regularShiftProductiveMins,',
  "} from '../../shiftSlots';",
  "import type { Shift } from '../../../types';",
  "import { qcSessionOutputQty } from '../shared/qcUtils';",
  "import { isMissingRelationError, isMissingColumnError } from '../shared/rpcUtils';",
  "import { colorwayDisplayLabel, type ColorwayLabel, type ReportMeta } from '../reportMeta';",
  "import { fetchDepartmentKpis, type DailyKpiRpcRow } from '../kpiAndProgress';",
  "import { mapShiftRow } from '../shared/shiftLogUtils';",
  'import {',
  '  aggregateDeptDayKpi,',
  '  applyAllocationPlanToDayRows,',
  '  allocRowKey,',
  '  buildResourceWorkforceDetails,',
  '  computeDayDeptMetricsFromRows,',
  '  enrichDayResourceRows,',
  '  listDatesInRange,',
  '  type AllocPlanRow,',
  "} from './deptMetrics.pure';",
  "import { fetchDayDeptHandoverSummary, mergeHandoverSummaries } from './handover';",
  'import type {',
  '  DayNativeEntry,',
  '  DayOperationHourSection,',
  '  DayResourceHourReport,',
  '  DayResourceHourRow,',
  '  DayShiftHourSection,',
  '  DayStyleColorHourReport,',
  '  DayStyleColorHourRow,',
  '  WorkforceCategoryCount,',
  "} from './types';",
  '',
  hourBody,
].join('\n');

const periodReportTs = [
  "import { supabase } from '../../supabase';",
  "import { fetchDepartmentKpis } from '../kpiAndProgress';",
  "import type { ReportMeta } from '../reportMeta';",
  "import { flattenDeptResourceStyleRows } from './deptMetrics.pure';",
  'import type {',
  '  DeptDailyTrendRow,',
  '  DeptPeriodReport,',
  '  DeptStyleSummaryRow,',
  "} from './types';",
  '',
  'export { flattenDeptResourceStyleRows };',
  '',
  slice(2591, 2773),
].join('\n');

const indexTs = [
  "export * from './types';",
  'export {',
  '  dayHandoverStatusLabel,',
  '  handoverDbToDisplay,',
  '  fetchDayDeptHandoverSummary,',
  '  mergeHandoverSummaries,',
  "} from './handover';",
  "export * from './deptMetrics.pure';",
  "export * from './hourReport';",
  "export * from './periodReport';",
  '',
].join('\n');

fs.writeFileSync(path.join(dayDir, 'types.ts'), typesTs);
fs.writeFileSync(path.join(dayDir, 'handover.ts'), handoverTs);
fs.writeFileSync(path.join(dayDir, 'deptMetrics.pure.ts'), deptMetricsTs);
fs.writeFileSync(path.join(dayDir, 'hourReport.ts'), hourReportTs);
fs.writeFileSync(path.join(dayDir, 'periodReport.ts'), periodReportTs);
fs.writeFileSync(path.join(dayDir, 'index.ts'), indexTs);
fs.writeFileSync(path.join(root, 'dayReport.ts'), "export * from './day/index';\n");

const files = [
  ['day/types.ts', path.join(dayDir, 'types.ts')],
  ['day/handover.ts', path.join(dayDir, 'handover.ts')],
  ['day/deptMetrics.pure.ts', path.join(dayDir, 'deptMetrics.pure.ts')],
  ['day/hourReport.ts', path.join(dayDir, 'hourReport.ts')],
  ['day/periodReport.ts', path.join(dayDir, 'periodReport.ts')],
  ['day/index.ts', path.join(dayDir, 'index.ts')],
  ['dayReport.ts', path.join(root, 'dayReport.ts')],
];
for (const [label, p] of files) {
  const count = fs.readFileSync(p, 'utf8').split(/\r?\n/).length;
  console.log(label + ': ' + count + ' lines');
}
