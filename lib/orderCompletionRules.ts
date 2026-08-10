import type { ColorwayCompletionStatus } from '../types';

export interface ColorwayCloseSnapshot {
  cutQty: number;
  readyQty: number;
  shippedQty: number;
  rejectedQty: number;
  balanceToShip: number;
  draftShipTotal?: number;
}

export function isColorwayClosed(status: ColorwayCompletionStatus | undefined): boolean {
  return status === 'complete' || status === 'short_closed';
}

/** Floor output + rejections account for the cut/adj quantity. */
export function isProductionReconciled(s: ColorwayCloseSnapshot): boolean {
  if (s.cutQty <= 0) return false;
  return s.readyQty + s.rejectedQty >= s.cutQty;
}

/** Nothing left to ship from last department (ignoring in-form draft). */
export function isShipmentCleared(s: ColorwayCloseSnapshot): boolean {
  const draft = s.draftShipTotal ?? 0;
  return Math.max(s.balanceToShip - draft, 0) === 0;
}

/** Full close: all cut qty is shipped or rejected, nothing left to ship. */
export function canMarkComplete(s: ColorwayCloseSnapshot): boolean {
  if (s.cutQty <= 0) return false;
  if (!isProductionReconciled(s)) return false;
  if (!isShipmentCleared(s)) return false;
  return s.shippedQty + s.rejectedQty >= s.cutQty;
}

/** Short close: production reconciled, floor cleared, but shipped+rejected may be below cut. */
export function canShortClose(s: ColorwayCloseSnapshot, reason: string): boolean {
  if (!reason.trim()) return false;
  if (!isProductionReconciled(s)) return false;
  if (!isShipmentCleared(s)) return false;
  if (s.shippedQty + s.rejectedQty >= s.cutQty) return false;
  return true;
}

export function completionStatusLabel(status: ColorwayCompletionStatus | undefined): string {
  if (status === 'complete') return 'Complete';
  if (status === 'short_closed') return 'Short closed';
  return 'Ongoing';
}
