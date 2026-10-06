import type { SizeMap } from './mesSizeDisplay';
import { sumSizeMap } from './mesSizeDisplay';

export interface FabricCutQtyComponentRow {
  component_id: string;
  /** @deprecated internal code; prefer fabric_type + remarks */
  code?: string;
  /** Display name from fabric_components.fabric_type */
  fabric_type: string;
  remarks?: string | null;
  /** @deprecated legacy RPC field */
  label?: string;
  is_primary?: boolean;
  by_size?: SizeMap;
  total: number;
}

export function parseFabricCutQtyComponents(raw: unknown): FabricCutQtyComponentRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FabricCutQtyComponentRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const fabricType = String(row.fabric_type ?? row.label ?? '').trim();
    if (!fabricType) continue;
    const bySizeRaw = row.by_size;
    const by_size: SizeMap = {};
    if (bySizeRaw && typeof bySizeRaw === 'object' && !Array.isArray(bySizeRaw)) {
      for (const [k, v] of Object.entries(bySizeRaw as Record<string, unknown>)) {
        const qty = Number(v);
        if (k && Number.isFinite(qty) && qty > 0) by_size[k] = qty;
      }
    }
    out.push({
      component_id: String(row.component_id ?? ''),
      code: row.code != null ? String(row.code) : undefined,
      fabric_type: fabricType,
      remarks: row.remarks != null ? String(row.remarks) : null,
      label: fabricType,
      is_primary: row.is_primary === true,
      by_size,
      total: Number(row.total) || 0,
    });
  }
  return out;
}

function scaleSizeMap(map: SizeMap, ratio: number): SizeMap {
  if (ratio <= 0) return {};
  if (ratio === 1) return { ...map };
  const out: SizeMap = {};
  for (const [size, qty] of Object.entries(map)) {
    const scaled = Math.round((Number(qty) || 0) * ratio);
    if (scaled > 0) out[size] = scaled;
  }
  return out;
}

function visitPrimaryBySize(
  visitId: string,
  colorwayIds: string[],
  sizeKeys: string[],
  sizeProgress?: {
    getVisitSizeCount?: (colorwayId: string | undefined, visitId: string, size: string) => number;
  },
): SizeMap {
  const out: SizeMap = {};
  for (const size of sizeKeys) {
    let qty = 0;
    for (const cwId of colorwayIds) {
      qty += sizeProgress?.getVisitSizeCount?.(cwId, visitId, size) ?? 0;
    }
    if (qty > 0) out[size] = qty;
  }
  return out;
}

/** Scope order-level fabric breakdown to one routing visit (matrix columns are visit-specific). */
export function fabricCutQtyComponentsForVisit(args: {
  components: FabricCutQtyComponentRow[];
  visitId: string;
  colorwayIds: string[];
  sizeKeys: string[];
  visitValue: number;
  size?: string;
  sizeProgress?: {
    getVisitSizeCount?: (colorwayId: string | undefined, visitId: string, size: string) => number;
  };
}): FabricCutQtyComponentRow[] {
  const { components, visitId, colorwayIds, sizeKeys, visitValue, size, sizeProgress } = args;
  if (components.length === 0 || visitValue <= 0) return [];

  const primary = components.find((component) => component.is_primary) ?? components[0];
  const capturedVisitPrimary = visitPrimaryBySize(visitId, colorwayIds, sizeKeys, sizeProgress);
  const capturedVisitPrimaryTotal = sumSizeMap(capturedVisitPrimary);
  const aggregatePrimaryTotal = primary.total || sumSizeMap(primary.by_size ?? {});

  const ratio = (() => {
    if (size) {
      const visitQty = capturedVisitPrimary[size] ?? 0;
      const aggregateQty = Number(primary.by_size?.[size]) || 0;
      if (visitQty > 0 && aggregateQty > 0) return visitQty / aggregateQty;
      if (aggregateQty > 0) return visitValue / aggregateQty;
      return 0;
    }
    if (capturedVisitPrimaryTotal > 0 && aggregatePrimaryTotal > 0) {
      return capturedVisitPrimaryTotal / aggregatePrimaryTotal;
    }
    if (aggregatePrimaryTotal > 0) return visitValue / aggregatePrimaryTotal;
    return 0;
  })();

  if (ratio <= 0) return [];

  return components
    .map((component) => {
      const isPrimary =
        component.is_primary
        || component.component_id === primary.component_id;

      if (isPrimary && capturedVisitPrimaryTotal > 0) {
        if (size) {
          const qty = capturedVisitPrimary[size] ?? 0;
          if (qty <= 0) return null;
          return { ...component, by_size: { [size]: qty }, total: qty };
        }
        return {
          ...component,
          by_size: { ...capturedVisitPrimary },
          total: capturedVisitPrimaryTotal,
        };
      }

      const sourceMap = component.by_size ?? {};
      const by_size = size
        ? (() => {
            const qty = Math.round((Number(sourceMap[size]) || 0) * ratio);
            return qty > 0 ? { [size]: qty } : {};
          })()
        : scaleSizeMap(sourceMap, ratio);
      const total = size
        ? (by_size[size] ?? 0)
        : (sumSizeMap(by_size) || Math.round(component.total * ratio));
      if (total <= 0) return null;
      return { ...component, by_size, total };
    })
    .filter((component): component is NonNullable<typeof component> => component != null);
}

export function formatFabricCutQtyTooltip(components: FabricCutQtyComponentRow[]): string {
  if (components.length === 0) return '';
  return components
    .map((c) => {
      const tag = c.is_primary ? ' (primary)' : '';
      return `${c.fabric_type}${tag}: ${c.total.toLocaleString()}`;
    })
    .join('\n');
}

/** Qty for one component row, optionally narrowed to a size. */
export function fabricComponentQty(
  component: FabricCutQtyComponentRow,
  size?: string,
): number {
  if (size) return Number(component.by_size?.[size]) || 0;
  return Number(component.total) || 0;
}

/** Sum of non-primary fabric cut qty (optionally for one size). */
export function secondaryFabricCutQty(
  components: FabricCutQtyComponentRow[],
  size?: string,
): number {
  return components
    .filter((c) => c.is_primary !== true)
    .reduce((sum, c) => sum + fabricComponentQty(c, size), 0);
}

/**
 * Headline for cutting cells:
 * - primary captured qty when primary is cut (normal)
 * - secondary-only qty when primary is still 0 (shown grayed in UI)
 */
export function resolveCuttingCellDisplay(args: {
  primaryValue: number;
  components: FabricCutQtyComponentRow[];
  size?: string;
}): { displayQty: number; secondaryOnly: boolean } {
  const primary = Math.max(0, Number(args.primaryValue) || 0);
  if (primary > 0) return { displayQty: primary, secondaryOnly: false };
  const secondary = secondaryFabricCutQty(args.components, args.size);
  if (secondary > 0) return { displayQty: secondary, secondaryOnly: true };
  return { displayQty: 0, secondaryOnly: false };
}

export function resolveHeadlineCutQty(args: {
  cut_qty?: number;
  cut_qty_source?: string;
  fallback?: number;
}): number {
  const fromRecon = args.cut_qty ?? 0;
  if (args.cut_qty_source === 'captured' && fromRecon > 0) return fromRecon;
  if (fromRecon > 0) return fromRecon;
  return args.fallback ?? 0;
}
