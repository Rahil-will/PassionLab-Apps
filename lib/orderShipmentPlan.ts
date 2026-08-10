/** Order-level shipment plan (Create Order). Floor `shipments` table is separate. */

import type { SizeQty } from '../types';
import { sizeAdjQty, sizeOrderQty } from './colorwaySizesUtils';

export interface ShipmentPlanChangeEntry {
  previous_date: string;
  new_date: string;
  reason: string;
  changed_at?: string;
}

export interface ShipmentPlanLine {
  id: string;
  shipmentDate: string;
  shipMode: string;
  shipmentType: string;
  colorwayId: string;
  sizes: Record<string, number>;
  destinationCountry?: string;
  /** 'planned' on first save; 'replanned' after date change on same row; 'rescheduled' = superseded row */
  status?: 'planned' | 'replanned' | 'rescheduled';
  notes?: string;
  changeHistory?: ShipmentPlanChangeEntry[];
  /** transient UI only — hoisted to order-level date_change_reason before RPC call */
  _dateChangeReason?: string;
}

export interface OrderShipmentPlan {
  lines: ShipmentPlanLine[];
}

export const EMPTY_ORDER_SHIPMENT_PLAN: OrderShipmentPlan = {
  lines: [],
};

export function rowTotal(line: ShipmentPlanLine): number {
  return Object.values(line.sizes).reduce((sum, n) => sum + (Number(n) || 0), 0);
}

export function planTotalQty(plan: OrderShipmentPlan): number {
  return plan.lines.filter(isActiveShipmentLine).reduce((sum, line) => sum + rowTotal(line), 0);
}

export function primaryShipmentDate(plan: OrderShipmentPlan | undefined): string {
  if (!plan?.lines?.length) return '';
  const dates = activeShipmentDeliveryDates(plan);
  if (dates.length === 0) return '';
  return dates.at(-1) ?? '';
}

/** Unique sorted delivery dates from active (non-superseded) shipment lines only. */
export function activeShipmentDeliveryDates(
  plan: OrderShipmentPlan | undefined,
  colorwayId?: string,
): string[] {
  if (!plan?.lines?.length) return [];
  let lines = plan.lines.filter(isActiveShipmentLine);
  if (colorwayId) lines = lines.filter((l) => l.colorwayId === colorwayId);
  const dates = lines.map((l) => l.shipmentDate).filter(Boolean);
  return [...new Set(dates)].sort();
}

function parseSizes(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, number>).map(([k, v]) => [k, Number(v) || 0]),
  );
}

export function parseShipmentChangeHistory(raw: unknown): ShipmentPlanChangeEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      const previous_date = typeof e.previous_date === 'string' ? e.previous_date : '';
      const new_date = typeof e.new_date === 'string' ? e.new_date : '';
      const reason = typeof e.reason === 'string' ? e.reason : '';
      if (!previous_date && !new_date) return null;
      return {
        previous_date,
        new_date,
        reason,
        ...(typeof e.changed_at === 'string' ? { changed_at: e.changed_at } : {}),
      } satisfies ShipmentPlanChangeEntry;
    })
    .filter((e): e is ShipmentPlanChangeEntry => e != null);
}

export function isVirtualShipmentLine(id: string): boolean {
  return id.endsWith('__prev');
}

export function isActiveShipmentLine(line: ShipmentPlanLine): boolean {
  return line.status !== 'rescheduled' && !isVirtualShipmentLine(line.id);
}

export function shipmentPlanRescheduleReason(line: ShipmentPlanLine): string {
  return (line._dateChangeReason || line.notes || '').trim();
}

/** Active / planned rows first; rescheduled history rows last (per colorway). */
export function sortShipmentPlanLinesForDisplay(lines: ShipmentPlanLine[]): ShipmentPlanLine[] {
  return [...lines].sort((a, b) => {
    if (a.colorwayId !== b.colorwayId) return a.colorwayId.localeCompare(b.colorwayId);
    const aResched = a.status === 'rescheduled' ? 1 : 0;
    const bResched = b.status === 'rescheduled' ? 1 : 0;
    if (aResched !== bResched) return aResched - bResched;
    return (a.shipmentDate || '').localeCompare(b.shipmentDate || '');
  });
}

/** Expand persisted plan into display rows (rescheduled + current). */
export function expandShipmentPlanLines(lines: ShipmentPlanLine[]): ShipmentPlanLine[] {
  const persisted = lines.filter((l) => !isVirtualShipmentLine(l.id));
  const out: ShipmentPlanLine[] = [];

  for (const line of persisted) {
    if (line.status === 'rescheduled') {
      out.push(line);
      continue;
    }

    const hasExplicitRescheduled = persisted.some(
      (l) =>
        l.status === 'rescheduled' &&
        l.colorwayId === line.colorwayId &&
        l.shipmentDate !== line.shipmentDate &&
        (l.destinationCountry || '') === (line.destinationCountry || ''),
    );

    if (!hasExplicitRescheduled && line.changeHistory?.length) {
      const last = line.changeHistory[line.changeHistory.length - 1];
      if (last.previous_date && last.previous_date !== line.shipmentDate) {
        out.push({
          ...line,
          id: `${line.id}__prev`,
          shipmentDate: last.previous_date,
          status: 'rescheduled',
          _dateChangeReason: last.reason || undefined,
        });
      }
    }

    out.push(line);
  }

  return sortShipmentPlanLinesForDisplay(out);
}

function parseLine(raw: Record<string, unknown>): ShipmentPlanLine {
  const rawStatus = typeof raw.status === 'string' ? raw.status : 'planned';
  const status =
    rawStatus === 'rescheduled'
      ? 'rescheduled'
      : rawStatus === 'replanned'
        ? 'replanned'
        : 'planned';
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    shipmentDate: typeof raw.shipmentDate === 'string' ? raw.shipmentDate : '',
    shipMode: typeof raw.shipMode === 'string' ? raw.shipMode : '',
    shipmentType: typeof raw.shipmentType === 'string' ? raw.shipmentType : '',
    colorwayId: typeof raw.colorwayId === 'string' ? raw.colorwayId : '',
    sizes: parseSizes(raw.sizes),
    destinationCountry: typeof raw.destinationCountry === 'string' ? raw.destinationCountry : undefined,
    status,
    changeHistory: parseShipmentChangeHistory(raw.changeHistory ?? raw.change_history),
    notes: typeof raw.notes === 'string' ? raw.notes : undefined,
    _dateChangeReason: typeof raw._dateChangeReason === 'string' ? raw._dateChangeReason : undefined,
  };
}

/** Flatten legacy `deliveries[]` or single-delivery shape into lines. */
export function parseOrderShipmentPlan(raw: unknown): OrderShipmentPlan {
  if (!raw || typeof raw !== 'object') return { lines: [] };
  const o = raw as Record<string, unknown>;

  if (Array.isArray(o.lines)) {
    return { lines: o.lines.map((l) => parseLine(l as Record<string, unknown>)) };
  }

  if (Array.isArray(o.deliveries)) {
    const lines: ShipmentPlanLine[] = [];
    for (const d of o.deliveries) {
      const del = d as Record<string, unknown>;
      const rows = Array.isArray(del.rows) ? del.rows : [];
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        lines.push({
          id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
          shipmentDate: typeof del.shipmentDate === 'string' ? del.shipmentDate : '',
          shipMode: typeof del.shipMode === 'string' ? del.shipMode : '',
          shipmentType: typeof del.shipmentType === 'string' ? del.shipmentType : '',
          colorwayId: typeof r.colorwayId === 'string' ? r.colorwayId : '',
          sizes: parseSizes(r.sizes),
        });
      }
      if (rows.length === 0) {
        lines.push({
          id: typeof del.id === 'string' ? del.id : crypto.randomUUID(),
          shipmentDate: typeof del.shipmentDate === 'string' ? del.shipmentDate : '',
          shipMode: typeof del.shipMode === 'string' ? del.shipMode : '',
          shipmentType: typeof del.shipmentType === 'string' ? del.shipmentType : '',
          colorwayId: '',
          sizes: {},
        });
      }
    }
    return { lines };
  }

  if (o.shipmentDate || o.rows) {
    const rows = Array.isArray(o.rows) ? o.rows : [];
    if (rows.length === 0) {
      return {
        lines: [{
          id: crypto.randomUUID(),
          shipmentDate: typeof o.shipmentDate === 'string' ? o.shipmentDate : '',
          shipMode: typeof o.shipMode === 'string' ? o.shipMode : '',
          shipmentType: typeof o.shipmentType === 'string' ? o.shipmentType : '',
          colorwayId: '',
          sizes: {},
        }],
      };
    }
    return {
      lines: rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          ...parseLine(r),
          shipmentDate: typeof o.shipmentDate === 'string' ? o.shipmentDate : '',
          shipMode: typeof o.shipMode === 'string' ? o.shipMode : '',
          shipmentType: typeof o.shipmentType === 'string' ? o.shipmentType : '',
        };
      }),
    };
  }

  return { lines: [] };
}

export function emptySizesForLabels(labels: string[]): Record<string, number> {
  return Object.fromEntries(labels.map((s) => [s, 0]));
}

export function newShipmentLine(displaySizes: string[]): ShipmentPlanLine {
  return {
    id: crypto.randomUUID(),
    shipmentDate: '',
    shipMode: '',
    shipmentType: '',
    colorwayId: '',
    sizes: emptySizesForLabels(displaySizes),
    destinationCountry: '',
    status: 'planned',
  };
}

export function pruneShipmentPlan(
  plan: OrderShipmentPlan,
  validColorwayIds: string[],
  displaySizes: string[],
): OrderShipmentPlan {
  const valid = new Set(validColorwayIds);
  return {
    lines: plan.lines
      .filter((line) => !line.colorwayId || valid.has(line.colorwayId))
      .map((line) => {
        const sizes: Record<string, number> = {};
        for (const size of displaySizes) {
          sizes[size] = line.sizes[size] ?? 0;
        }
        return { ...line, sizes };
      }),
  };
}

export interface SizeBalance {
  adj: number;
  planned: number;
  remaining: number;
}

export function balanceBySizeForColor(
  plan: OrderShipmentPlan,
  colorwayId: string,
  colorway: { sizes: Array<{ size: string; order_qty?: number; adj_qty?: number }> },
  displaySizes: string[],
  excludeLineId?: string,
): Record<string, SizeBalance> {
  const result: Record<string, SizeBalance> = {};
  for (const size of displaySizes) {
    const sz = colorway.sizes.find((s) => s.size === size);
    const adj = sz
      ? (sizeAdjQty(sz as SizeQty) || sizeOrderQty(sz as SizeQty))
      : 0;
    let planned = 0;
    for (const line of plan.lines) {
      if (line.colorwayId !== colorwayId) continue;
      if (!isActiveShipmentLine(line)) continue;
      if (excludeLineId && line.id === excludeLineId) continue;
      planned += line.sizes[size] || 0;
    }
    result[size] = { adj, planned, remaining: adj - planned };
  }
  return result;
}

/** Signed adj − planned per size (negative = over-planned). */
export function planQtyDeltaBySize(
  plan: OrderShipmentPlan,
  colorways: Array<{ id: string; sizes?: Array<{ size: string; order_qty?: number; adj_qty?: number }> }>,
  displaySizes: string[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const size of displaySizes) {
    let adj = 0;
    for (const cw of colorways) {
      const sz = cw.sizes?.find((s) => s.size === size);
      if (sz) adj += sizeAdjQty(sz as SizeQty) || sizeOrderQty(sz as SizeQty);
    }
    const planned = plan.lines
      .filter(isActiveShipmentLine)
      .reduce((sum, line) => sum + (line.sizes[size] || 0), 0);
    result[size] = adj - planned;
  }
  return result;
}

export function clampSizeQty(
  qty: number,
  balance: SizeBalance,
  currentQty: number,
): number {
  const maxAllowed = balance.remaining + currentQty;
  return Math.min(Math.max(0, qty), maxAllowed);
}

export function duplicateShipmentLine(
  line: ShipmentPlanLine,
  displaySizes: string[],
): ShipmentPlanLine {
  return {
    id: crypto.randomUUID(),
    shipmentDate: line.shipmentDate,
    shipMode: line.shipMode,
    shipmentType: '',
    colorwayId: line.colorwayId,
    destinationCountry: line.destinationCountry,
    sizes: emptySizesForLabels(displaySizes),
    status: 'planned',
  };
}

export function fillRowFromRemainingBalance(
  line: ShipmentPlanLine,
  plan: OrderShipmentPlan,
  colorway: { sizes: Array<{ size: string; adj_qty?: number }> },
  displaySizes: string[],
): ShipmentPlanLine {
  const balance = balanceBySizeForColor(plan, line.colorwayId, colorway, displaySizes, line.id);
  const sizes: Record<string, number> = {};
  for (const size of displaySizes) {
    sizes[size] = Math.max(0, balance[size]?.remaining ?? 0);
  }
  return { ...line, sizes };
}

export function colorBalanceSummary(
  plan: OrderShipmentPlan,
  colorwayId: string,
  colorway: { sizes: Array<{ size: string; adj_qty?: number }> },
  displaySizes: string[],
  excludeLineId?: string,
): { adjTotal: number; remainingTotal: number } {
  const balance = balanceBySizeForColor(plan, colorwayId, colorway, displaySizes, excludeLineId);
  let adjTotal = 0;
  let remainingTotal = 0;
  for (const size of displaySizes) {
    adjTotal += balance[size]?.adj ?? 0;
    remainingTotal += balance[size]?.remaining ?? 0;
  }
  return { adjTotal, remainingTotal };
}

/** Remaining adjusted qty per size across all colorways (adj − planned). */
export function planBalanceBySize(
  plan: OrderShipmentPlan,
  colorways: Array<{ id: string; sizes?: Array<{ size: string; order_qty?: number; adj_qty?: number }> }>,
  displaySizes: string[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const size of displaySizes) {
    let adj = 0;
    for (const cw of colorways) {
      const sz = cw.sizes?.find((s) => s.size === size);
      if (sz) adj += sizeAdjQty(sz as SizeQty) || sizeOrderQty(sz as SizeQty);
    }
    const planned = plan.lines
      .filter(isActiveShipmentLine)
      .reduce((sum, line) => sum + (line.sizes[size] || 0), 0);
    result[size] = Math.max(0, adj - planned);
  }
  return result;
}

export function planBalanceTotal(
  plan: OrderShipmentPlan,
  colorways: Array<{ id: string; sizes?: Array<{ size: string; order_qty?: number; adj_qty?: number }> }>,
  displaySizes: string[],
): number {
  const bySize = planBalanceBySize(plan, colorways, displaySizes);
  return Object.values(bySize).reduce((sum, n) => sum + n, 0);
}

type ColorwaySizeRow = { size: string; order_qty?: number; adj_qty?: number };

/** True when this line ships all remaining adjusted qty for its colorway. */
export function isFullShipmentLine(
  line: ShipmentPlanLine,
  plan: OrderShipmentPlan,
  colorway: { sizes: Array<ColorwaySizeRow> },
  displaySizes: string[],
): boolean {
  if (!line.colorwayId || rowTotal(line) === 0) return false;
  const balanceAfter = balanceBySizeForColor(plan, line.colorwayId, colorway, displaySizes);
  for (const size of displaySizes) {
    const adj = balanceAfter[size]?.adj ?? 0;
    if (adj <= 0) continue;
    if ((balanceAfter[size]?.remaining ?? 0) > 0) return false;
  }
  return true;
}

/** Pick buyer/catalog label for full vs partial shipment. */
export function resolveAutoShipmentType(shipmentTypes: string[], isFull: boolean): string {
  if (shipmentTypes.length === 0) return isFull ? 'Main' : 'Partial';
  const fullMatch = shipmentTypes.find((t) => /full|^main$/i.test(t.trim()));
  const partialMatch = shipmentTypes.find((t) => /partial/i.test(t.trim()));
  if (isFull) return fullMatch ?? shipmentTypes[0];
  return partialMatch ?? shipmentTypes.find((t) => t !== fullMatch) ?? shipmentTypes[0];
}

export function autoShipmentTypeForLine(
  line: ShipmentPlanLine,
  plan: OrderShipmentPlan,
  colorway: { sizes: Array<ColorwaySizeRow> } | undefined,
  displaySizes: string[],
  shipmentTypes: string[],
): string {
  if (!colorway || !line.colorwayId || rowTotal(line) === 0) return '';
  const isFull = isFullShipmentLine(line, plan, colorway, displaySizes);
  return resolveAutoShipmentType(shipmentTypes, isFull);
}

export function colorwayHasRemainingBalance(
  plan: OrderShipmentPlan,
  colorwayId: string,
  colorway: { sizes: Array<ColorwaySizeRow> },
  displaySizes: string[],
  excludeLineId?: string,
): boolean {
  return colorBalanceSummary(plan, colorwayId, colorway, displaySizes, excludeLineId).remainingTotal > 0;
}

/** Client-side guard before save; returns first error message or null. */
export function validateShipmentPlanQty(
  plan: OrderShipmentPlan,
  colorways: Array<{ id: string; name?: string; sizes?: Array<ColorwaySizeRow> }>,
  displaySizes: string[],
): string | null {
  for (const cw of colorways) {
    const balance = balanceBySizeForColor(plan, cw.id, { sizes: cw.sizes ?? [] }, displaySizes);
    for (const size of displaySizes) {
      const adj = balance[size]?.adj ?? 0;
      const planned = balance[size]?.planned ?? 0;
      if (adj > 0 && planned > adj) {
        const label = cw.name?.trim() || 'color';
        return `Shipment plan for ${label} (${size}): ${planned.toLocaleString()} planned exceeds ${adj.toLocaleString()} adjusted`;
      }
    }
  }
  return null;
}

export function clampLineSizes(
  line: ShipmentPlanLine,
  plan: OrderShipmentPlan,
  colorway: { sizes: Array<ColorwaySizeRow> },
  displaySizes: string[],
): Record<string, number> {
  const balance = balanceBySizeForColor(plan, line.colorwayId, colorway, displaySizes, line.id);
  const sizes: Record<string, number> = {};
  for (const size of displaySizes) {
    const bal = balance[size] ?? { adj: 0, planned: 0, remaining: 0 };
    sizes[size] = clampSizeQty(line.sizes[size] || 0, bal, line.sizes[size] || 0);
  }
  return sizes;
}
