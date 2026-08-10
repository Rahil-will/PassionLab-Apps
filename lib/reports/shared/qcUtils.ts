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
