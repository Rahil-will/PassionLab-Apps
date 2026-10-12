import type { Colorway, Material } from '../types';
import type { MmFabric } from '../modules/material/lib/mmFabricRpc';
import { materialRequiredQty } from './colorwayMaterialsDb';

export type StyleFabricLineRow = {
  colorwayId: string;
  materialId: string;
  fabricColor: string | null;
  fabricColorRef: string | null;
  consPerPc: number;
  consOverridden: boolean;
  reqQty?: number;
};

export type StyleFabricLine = {
  lineKey: string;
  fabricId: string | null;
  fabric: MmFabric | null;
  placement: string;
  unit: string;
  consPerPc: number;
  processLossPct: number | null;
  wastagePct: number | null;
  rows: StyleFabricLineRow[];
};

function fabricRows(cw: Colorway): Material[] {
  return (cw.materials ?? []).filter((m) => m.category === 'Fabric');
}

function collectStyleFabricLines(
  colorways: Colorway[],
  requireFabricId: boolean,
): StyleFabricLine[] {
  const order: string[] = [];
  const map = new Map<string, StyleFabricLine>();

  for (const cw of colorways) {
    for (const m of fabricRows(cw)) {
      if (!m.lineKey) continue;
      if (requireFabricId && !m.fabricId) continue;
      let line = map.get(m.lineKey);
      if (!line) {
        line = {
          lineKey: m.lineKey,
          fabricId: m.fabricId ?? null,
          fabric: m.fabric ?? null,
          placement: m.fabricCategory ?? '',
          unit: m.unit ?? '',
          consPerPc: Number(m.avgCons) || 0,
          processLossPct: m.processLossPct ?? null,
          wastagePct: m.wastagePct ?? null,
          rows: [],
        };
        map.set(m.lineKey, line);
        order.push(m.lineKey);
      }
      if (!m.consOverridden) {
        line.consPerPc = Number(m.avgCons) || 0;
      }
      if (m.fabric) line.fabric = m.fabric;
      if (m.fabricId) line.fabricId = m.fabricId;
      line.placement = m.fabricCategory ?? line.placement;
      line.unit = m.unit || line.unit;
      line.processLossPct = m.processLossPct ?? line.processLossPct;
      line.wastagePct = m.wastagePct ?? line.wastagePct;
      line.rows.push({
        colorwayId: cw.id,
        materialId: m.id,
        fabricColor: m.fabricColor ?? null,
        fabricColorRef: m.fabricColorRef ?? null,
        consPerPc: Number(m.avgCons) || 0,
        consOverridden: m.consOverridden === true,
        reqQty: m.reqQty,
      });
    }
  }

  return order.map((key) => map.get(key)!);
}

/** Linked style fabric lines (have lineKey + fabricId), ordered by first appearance. */
export function groupStyleFabricLines(colorways: Colorway[]): StyleFabricLine[] {
  return collectStyleFabricLines(colorways, true);
}

/** Style fabric lines including unfinished ones (lineKey set, fabricId may be null). */
export function groupDraftStyleFabricLines(colorways: Colorway[]): StyleFabricLine[] {
  return collectStyleFabricLines(colorways, false);
}

/** Fabric rows without fabricId (legacy / unlinked). */
export function legacyFabricRows(colorway: Colorway): Material[] {
  return fabricRows(colorway).filter((m) => !m.fabricId);
}

/** Every colorway has exactly one row per style-fabric lineKey (incl. unfinished). */
export function ensureStyleFabricLines(colorways: Colorway[]): Colorway[] {
  const lines = groupDraftStyleFabricLines(colorways);
  if (lines.length === 0) return colorways;

  return colorways.map((cw) => {
    const materials = [...(cw.materials ?? [])];
    const fabricMats = materials.filter((m) => m.category === 'Fabric');

    for (const line of lines) {
      const existing = fabricMats.find((m) => m.lineKey === line.lineKey);
      if (existing) continue;

      const template = colorways
        .flatMap((c) => c.materials ?? [])
        .find((m) => m.lineKey === line.lineKey);

      materials.push({
        id: crypto.randomUUID(),
        category: 'Fabric',
        name: template?.name ?? line.fabric?.name ?? '',
        type: template?.type ?? line.fabric?.fabric_type?.name ?? '',
        fabricCategory: line.placement || template?.fabricCategory || '',
        unit: line.unit || template?.unit || line.fabric?.uom || '',
        avgCons: line.consPerPc,
        perPc: 0,
        processLossPct: line.processLossPct,
        wastagePct: line.wastagePct,
        fabricId: line.fabricId,
        fabricColor: null,
        fabricColorRef: null,
        lineKey: line.lineKey,
        consOverridden: false,
        fabric: line.fabric ?? template?.fabric ?? null,
        paramValues: template?.paramValues ? { ...template.paramValues } : {},
      });
    }

    return { ...cw, materials };
  });
}

export type StyleFabricLinePatch = {
  fabricId?: string | null;
  fabric?: MmFabric | null;
  placement?: string;
  unit?: string;
  name?: string;
  type?: string;
  consPerPc?: number;
  processLossPct?: number | null;
  wastagePct?: number | null;
};

/** Apply shared line fields to every colour row of the line. */
export function applyLineEdit(
  colorways: Colorway[],
  lineKey: string,
  patch: StyleFabricLinePatch,
): Colorway[] {
  return colorways.map((cw) => ({
    ...cw,
    materials: (cw.materials ?? []).map((m) => {
      if (m.category !== 'Fabric' || m.lineKey !== lineKey) return m;
      const next: Material = { ...m };
      if (patch.fabricId !== undefined) next.fabricId = patch.fabricId;
      if (patch.fabric !== undefined) next.fabric = patch.fabric;
      if (patch.placement !== undefined) next.fabricCategory = patch.placement;
      if (patch.unit !== undefined) next.unit = patch.unit;
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.type !== undefined) next.type = patch.type;
      if (patch.processLossPct !== undefined) next.processLossPct = patch.processLossPct;
      if (patch.wastagePct !== undefined) next.wastagePct = patch.wastagePct;
      if (patch.consPerPc !== undefined && !m.consOverridden) {
        next.avgCons = patch.consPerPc;
      }
      return next;
    }),
  }));
}

export function requiredQty(
  cons: number,
  adjQty: number,
  pl?: number | null,
  w?: number | null,
): number {
  return materialRequiredQty(cons, adjQty, pl, w);
}

/** Legacy groups across colors sharing the same lineKey (or name+placement when no key). */
export function groupLegacyFabricLines(colorways: Colorway[]): Array<{
  lineKey: string;
  name: string;
  placement: string;
  colorwayNames: string[];
  sample: Material;
}> {
  const order: string[] = [];
  const map = new Map<string, {
    lineKey: string;
    name: string;
    placement: string;
    colorwayNames: string[];
    sample: Material;
  }>();

  for (const cw of colorways) {
    for (const m of legacyFabricRows(cw)) {
      const key = m.lineKey || `legacy:${m.name}|${m.fabricCategory ?? ''}|${m.type ?? ''}`;
      let g = map.get(key);
      if (!g) {
        g = {
          lineKey: m.lineKey || key,
          name: m.name,
          placement: m.fabricCategory ?? '',
          colorwayNames: [],
          sample: m,
        };
        map.set(key, g);
        order.push(key);
      }
      if (cw.name && !g.colorwayNames.includes(cw.name)) {
        g.colorwayNames.push(cw.name);
      }
    }
  }

  return order.map((k) => map.get(k)!);
}
