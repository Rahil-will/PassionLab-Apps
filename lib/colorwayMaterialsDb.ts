import type { Colorway, Material } from '../types';
import type { MmFabric } from '../modules/material/lib/mmFabricRpc';
import { getFabric, listFabrics } from '../modules/material/lib/mmFabricRpc';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ensureMaterialId(id: string | undefined): string {
  if (id && UUID_RE.test(id)) return id;
  return crypto.randomUUID();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactExtras(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === '') continue;
    if (isPlainObject(value) && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** RPC transport: fixed columns + extras.paramValues for fabric type params. */
export function materialToRpcPayload(m: Material): Record<string, unknown> {
  const kind = m.category === 'Trim' ? 'Trim' : 'Fabric';
  const payload: Record<string, unknown> = {
    id: ensureMaterialId(m.id),
    kind,
    category: kind === 'Trim' ? (m.trimCategory || '') : (m.fabricCategory || ''),
    name: m.name ?? '',
    type: kind === 'Trim' ? (m.trimType || m.type || '') : (m.type || ''),
    placement: kind === 'Trim' ? (m.placement || '') : '',
    consPerPc: kind === 'Trim' ? (m.perPc ?? 0) : (m.avgCons ?? 0),
    processLossPct: m.processLossPct ?? null,
    wastagePct: m.wastagePct ?? null,
    unit: m.unit ?? '',
    extras: compactExtras({
      paramValues: m.paramValues,
    }),
  };

  if (kind === 'Trim') {
    payload.fabricColor = m.fabricColor ?? null;
  }

  // New fabric-line keys only when this UI row is a style fabric line (has lineKey).
  // Untouched legacy rows omit keys so the DB keeps stored values.
  if (kind === 'Fabric' && m.lineKey) {
    payload.fabricId = m.fabricId ?? null;
    payload.fabricColor = m.fabricColor ?? null;
    payload.fabricColorRef = m.fabricColorRef ?? null;
    payload.lineKey = m.lineKey;
    payload.consOverridden = m.consOverridden === true;
  }

  return payload;
}

function num(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Extra % on required qty. Empty / 0 is ignored. */
export function materialMarkupFactor(processLossPct?: number | null, wastagePct?: number | null): number {
  const loss = Number(processLossPct);
  const waste = Number(wastagePct);
  return 1
    + (Number.isFinite(loss) && loss > 0 ? loss / 100 : 0)
    + (Number.isFinite(waste) && waste > 0 ? waste / 100 : 0);
}

export function materialRequiredQty(
  consPerPc: number,
  adjustedQty: number,
  processLossPct?: number | null,
  wastagePct?: number | null,
): number {
  return (Number(consPerPc) || 0) * (Number(adjustedQty) || 0) * materialMarkupFactor(processLossPct, wastagePct);
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v ?? '')]));
}

function kindFromRow(row: Record<string, unknown>, extras: Record<string, unknown>): 'Fabric' | 'Trim' {
  const kind = text(row.kind);
  if (kind === 'Trim' || kind === 'Fabric') return kind;
  const category = text(row.category);
  if (category === 'Trim' || category === 'Fabric') return category;
  if (text(extras.trimCategory) || text(extras.trimType)) return 'Trim';
  return 'Fabric';
}

export function mapMaterialFromDb(row: Record<string, unknown>): Material {
  const extras = isPlainObject(row.extras) ? row.extras : {};
  const kind = kindFromRow(row, extras);
  const kindStored = text(row.kind) === 'Fabric' || text(row.kind) === 'Trim';
  const catalog = kindStored
    ? text(row.category)
    : text(kind === 'Trim' ? extras.trimCategory : extras.fabricCategory);
  const typeCol = text(row.type) || (kind === 'Trim' ? text(extras.trimType) : '');
  const cons = num(row.cons_per_pc) ?? 0;
  const paramValues = stringMap(extras.paramValues ?? extras.param_values);
  const fabricId = row.fabric_id != null && text(row.fabric_id) ? text(row.fabric_id) : null;
  const lineKey = row.line_key != null && text(row.line_key) ? text(row.line_key) : undefined;

  return {
    id: String(row.id),
    category: kind,
    name: text(row.name),
    placement: kind === 'Trim' ? (text(row.placement) || text(extras.placement)) : '',
    type: typeCol,
    trimType: kind === 'Trim' ? typeCol : undefined,
    trimCategory: kind === 'Trim' ? catalog : undefined,
    fabricCategory: kind === 'Fabric' ? catalog : undefined,
    unit: text(row.unit) || text(extras.unit),
    avgCons: kind === 'Fabric' ? cons : 0,
    perPc: kind === 'Trim' ? cons : 0,
    reqQty: num(row.total_cons),
    processLossPct: num(row.process_loss_pct) ?? null,
    wastagePct: num(row.wastage_pct) ?? null,
    paramValues,
    fabricId: kind === 'Fabric' ? fabricId : undefined,
    fabricColor: row.fabric_color == null || text(row.fabric_color) === '' ? null : text(row.fabric_color),
    fabricColorRef: kind === 'Fabric'
      ? (row.fabric_color_ref == null || text(row.fabric_color_ref) === '' ? null : text(row.fabric_color_ref))
      : undefined,
    lineKey: kind === 'Fabric' ? lineKey : undefined,
    consOverridden: kind === 'Fabric' ? row.cons_overridden === true : undefined,
  };
}

export function materialsFromColorwayRow(row: Record<string, unknown>): Material[] {
  const nested = row.colorway_materials;
  if (Array.isArray(nested)) {
    return [...nested]
      .map((item) => item as Record<string, unknown>)
      .sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0))
      .map(mapMaterialFromDb);
  }
  if (Array.isArray(row.materials)) {
    return row.materials as Material[];
  }
  return [];
}

/** Attach display-only `material.fabric` across all colorways of an order. */
export async function attachFabricsToOrderColorways(colorways: Colorway[]): Promise<Colorway[]> {
  const all = colorways.flatMap((c) => c.materials ?? []);
  const hydrated = await attachFabricsToMaterials(all);
  const byId = new Map(hydrated.map((m) => [m.id, m]));
  return colorways.map((c) => ({
    ...c,
    materials: (c.materials ?? []).map((m) => byId.get(m.id) ?? m),
  }));
}

/** Attach display-only `material.fabric` for fabric_id rows after an order load. */
export async function attachFabricsToMaterials(materials: Material[]): Promise<Material[]> {
  const ids = [...new Set(
    materials
      .map((m) => m.fabricId)
      .filter((id): id is string => Boolean(id)),
  )];
  if (ids.length === 0) return materials;

  const byId = new Map<string, MmFabric>();
  if (ids.length <= 3) {
    await Promise.all(ids.map(async (id) => {
      const res = await getFabric(id);
      if (res.ok) byId.set(id, res.data);
    }));
  } else {
    const res = await listFabrics({
      status: ['active', 'inactive'],
      include_inactive: true,
      with_stock: false,
      limit: 2000,
    });
    if (res.ok) {
      for (const f of res.data.rows) {
        if (ids.includes(f.id)) byId.set(f.id, f);
      }
    }
    for (const id of ids) {
      if (!byId.has(id)) {
        const one = await getFabric(id);
        if (one.ok) byId.set(id, one.data);
      }
    }
  }

  return materials.map((m) => (
    m.fabricId && byId.has(m.fabricId)
      ? { ...m, fabric: byId.get(m.fabricId)! }
      : m
  ));
}

export const COLORWAY_WITH_MATERIALS_SELECT = '*, colorway_materials(*)';
