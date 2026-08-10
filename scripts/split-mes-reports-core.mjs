/**
 * Split mesReportsCore.ts into kpiAndProgress, dayReport, styleReport.
 * Run: node scripts/split-mes-reports-core.mjs
 */
import fs from 'fs';

const SRC = 'lib/reports/mesReportsCore.ts';
const lines = fs.readFileSync(SRC, 'utf8').split('\n');

const importBlock = lines.slice(0, 39).join('\n');

function body(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function write(file, start, end) {
  const content = `${importBlock}\n\n${body(start, end)}\n`;
  fs.writeFileSync(`lib/reports/${file}`, content, 'utf8');
  console.log(`wrote ${file} (${end - start + 1} lines)`);
}

write('kpiAndProgress.ts', 60, 813);
write('dayReport.ts', 815, 3431);
write('styleReport.ts', 3433, 5375);

fs.writeFileSync(
  'lib/reports/mesReportsCore.ts',
  `/** Re-exports split report modules (legacy name kept for index.ts). */
export {
  qcSessionOutputQty,
  qcSessionDefectiveQty,
  inDateRange,
  isPostgrestRpcMissing,
  fetchReportMeta,
  fetchColorwayLabels,
  colorwayDisplayLabel,
  type ReportMeta,
  type ColorwayLabel,
} from './reportMeta';
export { qcSessionOutputQty, qcSessionDefectiveQty } from './shared/qcUtils';
export { inDateRange, isPostgrestRpcMissing, isMissingRelationError, isMissingColumnError } from './shared/rpcUtils';
export type { FabricCutQtyComponentRow } from '../fabricCutQtyDisplay';
export type {
  FulfillmentAuditRow,
  FulfillmentRejectionRow,
  FulfillmentShipmentRow,
  SizeQtyMap,
} from '../fulfillmentData';
export * from './kpiAndProgress';
export * from './dayReport';
export * from './styleReport';
export { formatPct, formatPct2, formatEffPct, formatDhu } from '../mesMetrics';
`,
  'utf8',
);

console.log('mesReportsCore.ts replaced with barrel');
