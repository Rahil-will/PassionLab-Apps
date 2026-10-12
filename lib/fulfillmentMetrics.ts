import type { CutToShipRow } from './mesReportsApi';
import type { ColorwayCompletionStatus } from '../types';

export interface FulfillmentSnapshot {
  orderQty: number;
  cutQty: number;
  shippedQty: number;
  orderToCutPct: number | null;
  orderToShipPct: number | null;
  cutToShipPct: number | null;
  onTime: boolean | null;
  inFull: boolean | null;
  onTimeInFull: boolean | null;
}

export interface FulfillmentAggregateKpis {
  orderQty: number;
  cutQty: number;
  shippedQty: number;
  orderToCutPct: number | null;
  orderToShipPct: number | null;
  cutToShipPct: number | null;
  closedCount: number;
  onTimeCount: number;
  inFullCount: number;
  onTimeInFullCount: number;
  onTimePct: number | null;
  inFullPct: number | null;
  onTimeInFullPct: number | null;
}

function toYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function pctOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function formatFulfillmentPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

export function formatFulfillmentBool(value: boolean | null | undefined): string {
  if (value == null) return '—';
  return value ? 'Yes' : 'No';
}

export function fulfillmentBoolTone(value: string): 'yes' | 'no' | 'neutral' {
  if (value === 'Yes') return 'yes';
  if (value === 'No') return 'no';
  return 'neutral';
}

export function buildFulfillmentSnapshot(
  row: CutToShipRow,
  deliveryDate: string | null | undefined,
  _completionStatus: ColorwayCompletionStatus,
  options?: {
    /** Buyer order qty — denominator for Order → Ship and in-full checks. */
    orderQty?: number;
    /** Adjusted / planned qty — denominator for Order → Cut (matches cut-to-ship recon). */
    adjQty?: number;
    /** Captured qty from the first origin-department operation in route order. */
    originCutQty?: number;
    /** Produced qty at the first operation in route order. */
    firstOperationProduced?: number;
    /** Produced qty at the last operation in route order. */
    lastOperationProduced?: number;
  },
): FulfillmentSnapshot {
  const orderQty =
    options?.orderQty != null && options.orderQty > 0 ? options.orderQty : row.order_qty || 0;
  const adjQty =
    options?.adjQty != null && options.adjQty > 0 ? options.adjQty : row.order_qty || 0;
  const originCutQty = options?.originCutQty ?? 0;
  const reconCut = row.cut_qty || 0;
  // Prefer the scoped first-origin-department / primary-fabric qty (excludes lining and any
  // duplicate cutting visits); only fall back to the raw reconciliation total when unresolved.
  const cutQty = originCutQty > 0 ? originCutQty : reconCut;
  const shippedQty = row.shipped_qty || 0;

  const firstOpQty = options?.firstOperationProduced ?? 0;
  const lastOpQty = options?.lastOperationProduced ?? 0;

  const orderToCutPct = firstOpQty > 0 ? pctOf(firstOpQty, orderQty) : pctOf(cutQty, adjQty);
  const orderToShipPct = lastOpQty > 0 ? pctOf(lastOpQty, orderQty) : pctOf(shippedQty, orderQty);
  const cutToShipPct =
    firstOpQty > 0 && lastOpQty > 0
      ? pctOf(lastOpQty, firstOpQty)
      : pctOf(shippedQty, cutQty);

  const delivery = toYmd(deliveryDate);
  const lastShip = toYmd(row.last_shipment_date);
  const inFull = orderQty > 0 ? shippedQty >= orderQty : false;
  const onTime =
    delivery && lastShip ? lastShip <= delivery : delivery ? false : null;
  const onTimeInFull = onTime == null ? null : onTime && inFull;

  return {
    orderQty,
    cutQty,
    shippedQty,
    orderToCutPct,
    orderToShipPct,
    cutToShipPct,
    onTime,
    inFull,
    onTimeInFull,
  };
}

export function aggregateFulfillmentKpis(snapshots: FulfillmentSnapshot[]): FulfillmentAggregateKpis {
  let orderQty = 0;
  let cutQty = 0;
  let shippedQty = 0;
  let onTimeEvaluable = 0;
  let inFullEvaluable = 0;
  let onTimeCount = 0;
  let inFullCount = 0;
  let onTimeInFullCount = 0;

  for (const s of snapshots) {
    orderQty += s.orderQty;
    cutQty += s.cutQty;
    shippedQty += s.shippedQty;
    inFullEvaluable++;
    if (s.inFull) inFullCount++;
    if (s.onTime != null) {
      onTimeEvaluable++;
      if (s.onTime) onTimeCount++;
      if (s.onTimeInFull) onTimeInFullCount++;
    }
  }

  return {
    orderQty,
    cutQty,
    shippedQty,
    orderToCutPct: pctOf(cutQty, orderQty),
    orderToShipPct: pctOf(shippedQty, orderQty),
    cutToShipPct: pctOf(shippedQty, cutQty),
    closedCount: onTimeEvaluable,
    onTimeCount,
    inFullCount,
    onTimeInFullCount,
    onTimePct: onTimeEvaluable > 0 ? pctOf(onTimeCount, onTimeEvaluable) : null,
    inFullPct: inFullEvaluable > 0 ? pctOf(inFullCount, inFullEvaluable) : null,
    onTimeInFullPct: onTimeEvaluable > 0 ? pctOf(onTimeInFullCount, onTimeEvaluable) : null,
  };
}

/** Delivery date within [from, to] inclusive (YYYY-MM-DD). */
export function deliveryInRange(
  deliveryDate: string | null | undefined,
  dateFrom: string,
  dateTo: string,
): boolean {
  const d = toYmd(deliveryDate);
  if (!d) return true;
  return d >= dateFrom && d <= dateTo;
}
