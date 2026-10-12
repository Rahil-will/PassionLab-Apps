export type { FabricCutQtyComponentRow } from '../../fabricCutQtyDisplay';
export type {
  FulfillmentAuditRow,
  FulfillmentRejectionRow,
  FulfillmentShipmentRow,
  SizeQtyMap,
} from '../../fulfillmentData';

/** QC output from inspection_sessions — `passed` is total pass (includes rework pass). */
export function qcSessionOutputQty(raw: { passed?: unknown }): number {
  return Number(raw.passed) || 0;
}

/** Defective pieces — `failed` only (`rework` column removed; use `rework_passed` for rework passes). */
export function qcSessionDefectiveQty(raw: { failed?: unknown }): number {
  return Number(raw.failed) || 0;
}

/**
 * Defective % for a QC day: stored %, else failed/inspected, else (inspected − first-time pass).
 * Floor apps often leave `failed` at 0 while first-time pass is filled.
 */
export function qualityDayDefectivePct(args: {
  inspected: number;
  failed?: number;
  firstTimePass?: number;
  defectivePct?: number | null;
}): number | null {
  const inspected = args.inspected;
  if (inspected <= 0) return null;
  if (args.defectivePct != null && Number.isFinite(args.defectivePct)) {
    return args.defectivePct;
  }
  const failed = Number(args.failed) || 0;
  const firstTimePass = Number(args.firstTimePass) || 0;
  const defectivePieces = failed > 0 ? failed : Math.max(0, inspected - firstTimePass);
  return (defectivePieces / inspected) * 100;
}
