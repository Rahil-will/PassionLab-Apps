import type { Colorway, Material } from '../types';
import type { MmFabric } from '../modules/material/lib/mmFabricRpc';
import { materialMarkupFactor, materialRequiredQty } from './colorwayMaterialsDb';

export type MaterialPlanLine = {
  lineKey: string;
  kind: 'Fabric' | 'Trim';
  fabricId?: string | null;
  fabric?: MmFabric | null;
  name: string;
  fabricCategory?: string;
  trimCategory?: string;
  trimType?: string;
  placement?: string;
  unit: string;
  processLossPct: number | null;
  wastagePct: number | null;
  /** 'all' includes colours added later. A list is only those style colours. */
  appliesTo?: 'all' | string[];
};

/** Rebuild style plan from colour materials (unique lineKey / trim identity). */
export function materialPlanKey(m: Material): string {
  if (m.category === 'Fabric') return m.lineKey || `fab:${m.fabricId || m.name}`;
  return m.lineKey || `trim:${m.name}|${m.trimCategory || ''}|${m.trimType || ''}|${m.placement || ''}`;
}

export function lineColourIds(line: MaterialPlanLine, colorways: Colorway[]): string[] {
  if (!line.appliesTo || line.appliesTo === 'all') return colorways.map((c) => c.id);
  const live = new Set(colorways.map((c) => c.id));
  return line.appliesTo.filter((id) => live.has(id));
}

export function lineAppliesToColour(line: MaterialPlanLine, colorId: string, colorways: Colorway[]): boolean {
  return lineColourIds(line, colorways).includes(colorId);
}

export function deriveMaterialPlan(colorways: Colorway[]): MaterialPlanLine[] {
  const order: string[] = [];
  const map = new Map<string, MaterialPlanLine>();

  for (const cw of colorways) {
    for (const m of cw.materials ?? []) {
      if (m.category === 'Fabric') {
        const key = materialPlanKey(m);
        if (!map.has(key)) {
          order.push(key);
          map.set(key, {
            lineKey: m.lineKey || key,
            kind: 'Fabric',
            fabricId: m.fabricId ?? null,
            fabric: m.fabric ?? null,
            name: m.name || m.fabric?.name || '',
            fabricCategory: m.fabricCategory || '',
            unit: m.unit || m.fabric?.uom || '',
            processLossPct: m.processLossPct ?? null,
            wastagePct: m.wastagePct ?? null,
          });
        } else {
          const row = map.get(key)!;
          if (m.fabricId) row.fabricId = m.fabricId;
          if (m.fabric) row.fabric = m.fabric;
          if (m.name) row.name = m.name;
          if (m.fabricCategory) row.fabricCategory = m.fabricCategory;
          if (m.unit) row.unit = m.unit;
          if (m.processLossPct != null) row.processLossPct = m.processLossPct;
          if (m.wastagePct != null) row.wastagePct = m.wastagePct;
        }
      } else {
        const key = materialPlanKey(m);
        if (!map.has(key)) {
          order.push(key);
          map.set(key, {
            lineKey: m.lineKey || key,
            kind: 'Trim',
            name: m.name || '',
            trimCategory: m.trimCategory || '',
            trimType: m.trimType || '',
            placement: m.placement || '',
            unit: m.unit || '',
            processLossPct: m.processLossPct ?? null,
            wastagePct: m.wastagePct ?? null,
          });
        }
      }
    }
  }

  return order.map((k) => {
    const row = map.get(k)!;
    const linked = colorways.filter((cw) =>
      (cw.materials ?? []).some((m) => materialPlanKey(m) === k),
    );
    row.appliesTo = colorways.length > 0 && linked.length === colorways.length
      ? 'all'
      : linked.map((cw) => cw.id);
    return row;
  });
}

export function planLineLinks(colorways: Colorway[], lineKey: string): Array<{
  colorway: Colorway;
  material: Material;
}> {
  const out: Array<{ colorway: Colorway; material: Material }> = [];
  for (const cw of colorways) {
    for (const m of cw.materials ?? []) {
      if (m.lineKey === lineKey) out.push({ colorway: cw, material: m });
    }
  }
  return out;
}

/** Cons only “shows” after at least one colour is linked with cons > 0. */
export function planLineHasConsumption(colorways: Colorway[], lineKey: string): boolean {
  return planLineLinks(colorways, lineKey).some((l) => {
    const cons = l.material.category === 'Fabric' ? l.material.avgCons : l.material.perPc;
    return (Number(cons) || 0) > 0;
  });
}

/** Cons per piece after process loss and wastage. */
export function planLineAdjustedCons(colorways: Colorway[], line: MaterialPlanLine): number | null {
  if (!planLineHasConsumption(colorways, line.lineKey)) return null;
  const cons = planLineSharedCons(colorways, line.lineKey, line.kind);
  return cons * materialMarkupFactor(line.processLossPct, line.wastagePct);
}

export function planLineTotalReq(colorways: Colorway[], line: MaterialPlanLine): number | null {
  if (!planLineHasConsumption(colorways, line.lineKey)) return null;
  let sum = 0;
  for (const { colorway, material } of planLineLinks(colorways, line.lineKey)) {
    const cons = material.category === 'Fabric' ? Number(material.avgCons) || 0 : Number(material.perPc) || 0;
    sum += materialRequiredQty(
      cons,
      colorway.adjQty ?? 0,
      material.processLossPct ?? line.processLossPct,
      material.wastagePct ?? line.wastagePct,
    );
  }
  return sum;
}

export function coloursUnlinkedToPlan(
  colorways: Colorway[],
  lineKey: string,
): Colorway[] {
  const linked = new Set(planLineLinks(colorways, lineKey).map((l) => l.colorway.id));
  return colorways.filter((c) => !linked.has(c.id));
}

/** Shared cons/pc for a plan line. The first colour with a value wins. */
export function planLineSharedCons(
  colorways: Colorway[],
  lineKey: string,
  kind: 'Fabric' | 'Trim',
): number {
  let fallback = 0;
  for (const { material } of planLineLinks(colorways, lineKey)) {
    const cons = kind === 'Fabric' ? Number(material.avgCons) || 0 : Number(material.perPc) || 0;
    if (cons > 0) return cons;
    fallback = cons;
  }
  return fallback;
}

/** Cons/pc for a plan line on one colour; null if not linked. */
export function planLineConsForColour(
  colorways: Colorway[],
  lineKey: string,
  colorId: string,
): number | null {
  const cw = colorways.find((c) => c.id === colorId);
  const m = (cw?.materials ?? []).find((row) => row.lineKey === lineKey);
  if (!m) return null;
  const cons = m.category === 'Fabric' ? Number(m.avgCons) : Number(m.perPc);
  return Number.isFinite(cons) ? cons : 0;
}

export function materialFromPlan(
  plan: MaterialPlanLine,
  cons: number,
): Material {
  if (plan.kind === 'Fabric') {
    return {
      id: crypto.randomUUID(),
      category: 'Fabric',
      name: plan.name || plan.fabric?.name || '',
      type: plan.fabric?.fabric_type?.name || '',
      fabricCategory: plan.fabricCategory || '',
      unit: plan.unit || plan.fabric?.uom || '',
      avgCons: cons,
      perPc: 0,
      processLossPct: plan.processLossPct,
      wastagePct: plan.wastagePct,
      fabricId: plan.fabricId ?? null,
      fabric: plan.fabric ?? null,
      fabricColor: null,
      fabricColorRef: null,
      lineKey: plan.lineKey,
      consOverridden: false,
      paramValues: {},
    };
  }
  return {
    id: crypto.randomUUID(),
    category: 'Trim',
    name: plan.name,
    trimCategory: plan.trimCategory || '',
    trimType: plan.trimType || '',
    placement: plan.placement || '',
    unit: plan.unit,
    avgCons: 0,
    perPc: cons,
    processLossPct: plan.processLossPct,
    wastagePct: plan.wastagePct,
    lineKey: plan.lineKey,
    consOverridden: false,
    paramValues: {},
  };
}
