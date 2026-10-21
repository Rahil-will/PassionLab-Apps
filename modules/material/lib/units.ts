import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mmListUnits } from './mmRpc';

export type QtyUnit = string;
export type WidthUnit = string;

export type MmUnitKind = 'qty' | 'width';
export type MmUnitBase = 'kg' | 'm' | 'in';

export type MmUnit = {
  code: string;
  kind: MmUnitKind;
  label: string;
  base: MmUnitBase;
  factor: number;
  aliases: string[];
};

export type MmUnitLists = {
  qty: MmUnit[];
  width: MmUnit[];
  all: MmUnit[];
};

let byCode = new Map<string, MmUnit>();
let byAlias = new Map<string, string>();

function asUnit(value: unknown): MmUnit | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const code = String(row.code ?? '').trim().toLowerCase();
  const kind = row.kind === 'width' ? 'width' : row.kind === 'qty' ? 'qty' : null;
  const base = row.base === 'm' || row.base === 'in' || row.base === 'kg' ? row.base : null;
  const factor = Number(row.factor);
  if (!code || !kind || !base || !Number.isFinite(factor) || factor <= 0) return null;
  const aliases = Array.isArray(row.aliases) ? row.aliases.map((alias) => String(alias)) : [];
  return {
    code,
    kind,
    label: String(row.label ?? code).trim() || code,
    base,
    factor,
    aliases,
  };
}

export function asUnitList(value: unknown): MmUnit[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const unit = asUnit(item);
    return unit ? [unit] : [];
  }) : [];
}

/** Replace the conversion table. Tests pass a mocked list; the app loads mm_list_units().all. */
export function setUnitCatalog(units: MmUnit[]): void {
  const codes = new Map<string, MmUnit>();
  const aliases = new Map<string, string>();
  for (const unit of units) {
    codes.set(unit.code, unit);
    aliases.set(unit.code, unit.code);
    const label = unit.label.trim().toLowerCase();
    if (label) aliases.set(label, unit.code);
    for (const alias of unit.aliases) {
      const key = alias.trim().toLowerCase();
      if (key) aliases.set(key, unit.code);
    }
  }
  byCode = codes;
  byAlias = aliases;
}

export function resolveUnitCode(value: unknown): string | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  return byAlias.get(text) ?? (byCode.has(text) ? text : null);
}

export function unitOf(code: string | null | undefined): MmUnit | null {
  const resolved = resolveUnitCode(code);
  return resolved ? byCode.get(resolved) ?? null : null;
}

export function unitBase(code: string | null | undefined): MmUnitBase {
  const unit = unitOf(code);
  if (unit) return unit.base;
  const text = String(code ?? '').trim().toLowerCase();
  if (text === 'm' || text === 'in') return text;
  return 'kg';
}

function factorOf(code: string | null | undefined): number {
  const factor = unitOf(code)?.factor;
  return factor != null && Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export const qtyFromStored = (v: number | null, code: string | null | undefined) => (
  v == null || !Number.isFinite(v) ? null : v / factorOf(code)
);
export const qtyToStored = (v: number | null, code: string | null | undefined) => (
  v == null || !Number.isFinite(v) ? null : v * factorOf(code)
);
export const widthFromStored = (inch: number | null, code: string | null | undefined) => (
  inch == null || !Number.isFinite(inch) ? null : inch / factorOf(code)
);
export const widthToStored = (v: number | null, code: string | null | undefined) => (
  v == null || !Number.isFinite(v) ? null : v * factorOf(code)
);

export const toDisplayWidth = widthFromStored;
export const toStoredInches = widthToStored;

export const qtyLabel = (code: string | null | undefined) => {
  const unit = unitOf(code);
  if (unit?.kind === 'qty') return unit.label;
  const text = String(code ?? '').trim();
  return text || 'KG';
};

export const widthLabel = (code: string | null | undefined) => {
  const unit = unitOf(code);
  if (unit?.kind === 'width') return unit.label;
  const text = String(code ?? '').trim();
  return text || 'in';
};

/** Columns stored as inches. Custom test KPIs are not in this set. */
export const STORED_WIDTH_KEYS = new Set([
  'width_in',
  'actual_width_in',
  'target_width_in',
  'inspected_width_in',
]);

export function isStoredWidthKey(key: string): boolean {
  return STORED_WIDTH_KEYS.has(key);
}

export function parseWidthUnit(value: unknown): WidthUnit {
  return resolveUnitCode(value) ?? (String(value ?? '').trim().toLowerCase() || 'in');
}

export function parseQtyUnit(value: unknown): QtyUnit {
  return resolveUnitCode(value) ?? (String(value ?? '').trim().toLowerCase() || 'kg');
}

/** jsonb array of codes, or one code in a plain string. */
export function parseUnitCodeList(value: unknown): string[] {
  let source: unknown[] = [];
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) source = [];
    else if (text.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(text);
        source = Array.isArray(parsed) ? parsed : [text];
      } catch {
        source = [text];
      }
    } else source = [text];
  } else if (Array.isArray(value)) source = value;
  const out: string[] = [];
  for (const item of source) {
    const raw = String(item ?? '').trim();
    if (!raw) continue;
    const code = resolveUnitCode(raw) ?? raw.toLowerCase();
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

export const parseQtyUnitList = parseUnitCodeList;
export const parseWidthUnitList = parseUnitCodeList;

export function sameUnitList<T extends string>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** Visible width. Inches round to one decimal so 59.055 reads as 59.1. */
export function formatStoredWidth(inches: number | null | undefined, unit: string | null | undefined): string {
  if (inches == null || !Number.isFinite(Number(inches))) return '—';
  const shown = widthFromStored(Number(inches), unit);
  if (shown == null) return '—';
  const text = shown.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `${text} ${widthLabel(unit)}`;
}

export function formatStoredQty(stored: number | null | undefined, unit: string | null | undefined): string {
  if (stored == null || !Number.isFinite(Number(stored))) return '—';
  const shown = qtyFromStored(Number(stored), unit);
  if (shown == null) return '—';
  const text = shown.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return `${text} ${qtyLabel(unit)}`;
}

export function displayNumberToInches(raw: string | null | undefined, unit: string | null | undefined): number | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return widthToStored(n, unit);
}

export type FabricUnitSource = {
  qty_unit?: string | null;
  width_unit?: string | null;
  uom?: string | null;
} | null | undefined;

export function fabricUnitsOf(fabric: FabricUnitSource): { qtyUnit: QtyUnit; widthUnit: WidthUnit } {
  return {
    qtyUnit: parseQtyUnit(fabric?.qty_unit ?? fabric?.uom),
    widthUnit: fabric?.width_unit != null && String(fabric.width_unit).trim() !== ''
      ? parseWidthUnit(fabric.width_unit)
      : 'in',
  };
}

export function useMmUnits() {
  const query = useQuery({
    queryKey: ['mm-units'],
    queryFn: async (): Promise<MmUnitLists> => {
      const res = await mmListUnits();
      if (res.ok === false) throw new Error(res.message);
      return {
        qty: asUnitList(res.data?.qty),
        width: asUnitList(res.data?.width),
        all: asUnitList(res.data?.all),
      };
    },
    staleTime: 60_000,
  });
  useEffect(() => {
    if (query.data?.all) setUnitCatalog(query.data.all);
  }, [query.data]);
  return query;
}

/** Qty and width units chosen on the fabric. Storage stays kg|m and inches. */
export function useFabricUnits(fabric: FabricUnitSource): { qtyUnit: QtyUnit; widthUnit: WidthUnit } {
  useMmUnits();
  const qty = fabric?.qty_unit;
  const width = fabric?.width_unit;
  const uom = fabric?.uom;
  return useMemo(
    () => fabricUnitsOf({ qty_unit: qty, width_unit: width, uom }),
    [qty, width, uom],
  );
}
