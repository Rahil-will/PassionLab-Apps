import type { MmRackOpsRoll, MmRackOpsTarget } from './mmRpc';
import { declaredQty } from './mmRollDraft';

export function styleKey(roll: MmRackOpsRoll): string {
  return roll.order_id || roll.style_name;
}

export function batchKey(roll: MmRackOpsRoll): string {
  return roll.batch_no || roll.lot_no || '';
}

export function batchLabel(roll: MmRackOpsRoll): string {
  return roll.batch_no || roll.lot_no || '—';
}

export function qtySum(rolls: MmRackOpsRoll[]): number {
  return rolls.reduce((sum, roll) => sum + declaredQty(roll, roll.uom), 0);
}

export function qtyPhrase(rolls: MmRackOpsRoll[]): string {
  const buckets = new Map<string, number>();
  for (const roll of rolls) {
    const unit = (roll.uom ?? '').trim() || 'm';
    const qty = declaredQty(roll, unit);
    if (qty <= 0) continue;
    buckets.set(unit, (buckets.get(unit) ?? 0) + qty);
  }
  if (buckets.size === 0) return '0';
  return [...buckets.entries()].map(([unit, qty]) => qtyText(qty, unit)).join(' · ');
}

export function qtyText(n: number, uom = 'm'): string {
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${uom}`;
}

export function pctText(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export function occupancyPct(t: MmRackOpsTarget): number {
  if (t.capacity_rolls == null || t.capacity_rolls <= 0) return t.roll_count > 0 ? 100 : 0;
  return Math.min(100, Math.round((t.roll_count / t.capacity_rolls) * 100));
}

export function occupancyLabel(t: MmRackOpsTarget): string {
  if (t.capacity_rolls != null) return `${t.roll_count} / ${t.capacity_rolls} rolls`;
  return `${t.roll_count} ${t.roll_count === 1 ? 'roll' : 'rolls'}`;
}

export function matchesQuery(haystack: string, q: string): boolean {
  return haystack.toLowerCase().includes(q);
}

export function challanDocLabel(roll: MmRackOpsRoll): string {
  if (!roll.challan_no) return '—';
  const kind = roll.challan_source === 'vendor' ? 'GRN' : 'Challan';
  return `${kind} ${roll.challan_no}`;
}

export function rollStatusLabel(
  roll: MmRackOpsRoll,
  pools: { unassigned: MmRackOpsRoll[]; redLabel: MmRackOpsRoll[] },
): { label: string; tone: 'blue' | 'green' | 'rose' } {
  if (pools.redLabel.some((r) => r.id === roll.id)) return { label: 'Red label', tone: 'rose' };
  if (pools.unassigned.some((r) => r.id === roll.id)) return { label: 'Unassigned', tone: 'blue' };
  return { label: roll.location_code || 'On rack', tone: 'green' };
}

export type StyleOption = {
  key: string;
  styleName: string;
  styleRef: string;
  fabricType: string;
  colorCount: number;
};

export function stylesFromRolls(rolls: MmRackOpsRoll[]): StyleOption[] {
  const map = new Map<string, { name: string; ref: string; fabrics: Set<string>; colors: Set<string> }>();
  for (const roll of rolls) {
    const key = styleKey(roll);
    let row = map.get(key);
    if (!row) {
      row = { name: roll.style_name, ref: roll.style_ref ?? '', fabrics: new Set(), colors: new Set() };
      map.set(key, row);
    }
    if (roll.fabric_type) row.fabrics.add(roll.fabric_type);
    if (roll.color_name) row.colors.add(roll.color_name);
  }
  return [...map.entries()]
    .map(([key, row]) => ({
      key,
      styleName: row.name,
      styleRef: row.ref,
      fabricType: [...row.fabrics][0] ?? '',
      colorCount: row.colors.size,
    }))
    .sort((a, b) => a.styleName.localeCompare(b.styleName));
}

export type ColorGroup = {
  colorName: string;
  fabricType: string;
  rolls: MmRackOpsRoll[];
  qty: number;
};

export type StyleGroup = {
  key: string;
  styleName: string;
  styleRef: string;
  colors: ColorGroup[];
  rollCount: number;
  qty: number;
};

/** Group rolls style → color for browse / unassigned tables. */
export function groupRollsByStyleColor(rolls: MmRackOpsRoll[]): StyleGroup[] {
  const styleMap = new Map<
    string,
    { styleName: string; styleRef: string; colors: Map<string, MmRackOpsRoll[]> }
  >();

  for (const roll of rolls) {
    const key = styleKey(roll);
    let style = styleMap.get(key);
    if (!style) {
      style = {
        styleName: roll.style_name,
        styleRef: roll.style_ref ?? '',
        colors: new Map(),
      };
      styleMap.set(key, style);
    }
    const colorKey = `${roll.color_name}||${roll.fabric_type}`;
    const list = style.colors.get(colorKey) ?? [];
    list.push(roll);
    style.colors.set(colorKey, list);
  }

  return [...styleMap.entries()]
    .map(([key, style]) => {
      const colors: ColorGroup[] = [...style.colors.entries()]
        .map(([, list]) => ({
          colorName: list[0]?.color_name || '—',
          fabricType: list[0]?.fabric_type || '',
          rolls: [...list].sort((a, b) => a.unit_code.localeCompare(b.unit_code)),
          qty: qtySum(list),
        }))
        .sort((a, b) => a.colorName.localeCompare(b.colorName));
      const flat = colors.flatMap((c) => c.rolls);
      return {
        key,
        styleName: style.styleName,
        styleRef: style.styleRef,
        colors,
        rollCount: flat.length,
        qty: qtySum(flat),
      };
    })
    .sort((a, b) => a.styleName.localeCompare(b.styleName));
}
