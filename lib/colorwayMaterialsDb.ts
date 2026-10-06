import type { Material } from '../types';

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
  return {
    id: ensureMaterialId(m.id),
    kind,
    category: kind === 'Trim' ? (m.trimCategory || '') : (m.fabricCategory || ''),
    name: m.name ?? '',
    type: kind === 'Trim' ? (m.trimType || m.type || '') : (m.type || ''),
    placement: kind === 'Trim' ? (m.placement || '') : '',
    consPerPc: kind === 'Trim' ? (m.perPc ?? 0) : (m.avgCons ?? 0),
    totalCons: m.reqQty ?? null,
    processLossPct: m.processLossPct ?? null,
    wastagePct: m.wastagePct ?? null,
    unit: m.unit ?? '',
    extras: compactExtras({
      paramValues: m.paramValues,
    }),
  };
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

export const COLORWAY_WITH_MATERIALS_SELECT = '*, colorway_materials(*)';
