/** Roll / lap / pieces — set at create or receive (Fabric v4 unit_form). */

export type MmUnitForm = 'roll' | 'lap' | 'pieces' | string;

export function normalizeUnitForm(value: string | null | undefined): MmUnitForm {
  const raw = String(value ?? 'roll').trim().toLowerCase();
  if (raw === 'lap' || raw === 'laps') return 'lap';
  if (raw === 'piece' || raw === 'pieces') return 'pieces';
  return 'roll';
}

export function unitFormLabel(value: string | null | undefined, count = 1): string {
  const form = normalizeUnitForm(value);
  if (form === 'lap') return count === 1 ? 'lap' : 'laps';
  if (form === 'pieces') return count === 1 ? 'piece' : 'pieces';
  return count === 1 ? 'roll' : 'rolls';
}

export function unitFormOptionLabel(value: string): string {
  const form = normalizeUnitForm(value);
  if (form === 'lap') return 'Lap';
  if (form === 'pieces') return 'Pieces';
  return 'Roll';
}

/** e.g. "12 rolls", "8 laps", or "10 rolls · 2 laps" when mixed. */
export function unitFormCountText(counts: Partial<Record<string, number>>): string {
  const parts: string[] = [];
  for (const key of ['roll', 'lap', 'pieces'] as const) {
    const n = Number(counts[key] ?? 0);
    if (n > 0) parts.push(`${n} ${unitFormLabel(key, n)}`);
  }
  if (parts.length === 0) {
    const other = Object.entries(counts).filter(([, n]) => Number(n) > 0);
    for (const [key, n] of other) {
      parts.push(`${n} ${unitFormLabel(key, Number(n))}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Location display: prefer human name; never show raw CODE_WITH_UNDERSCORES. */
export function humanizeLocationToken(raw: string | null | undefined): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  const known: Record<string, string> = {
    WAREHOUSE_REDLABEL: 'Red label',
    WAREHOUSE_RECV: 'Receiving',
    CUTTING_STORE: 'Cutting store',
    WAREHOUSE: 'Warehouse',
    RED_LABEL: 'Red label',
    RECEIVING: 'Receiving',
  };
  const upper = t.toUpperCase();
  if (known[upper]) return known[upper];
  if (/_/.test(t) || (t === upper && t.length > 2 && !/\s/.test(t))) {
    return t
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return t;
}

export function locationDisplayLine(
  code: string | null | undefined,
  name: string | null | undefined,
): string {
  const n = humanizeLocationToken(name);
  if (n) return n;
  const c = humanizeLocationToken(code);
  return c || '—';
}
