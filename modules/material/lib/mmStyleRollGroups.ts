import type { MmStyleWarehouseRoll, MmTestField } from './mmRpc';
import { receiptIdOf } from './mmIds';
import { lockedRollFieldText } from './mmRollDraft';

export type RollGroupKey =
  | 'color'
  | 'fabric'
  | 'challan'
  | 'shade'
  | 'width'
  | 'shrinkW'
  | 'shrinkL'
  | 'gsm'
  | 'lot'
  | 'qc';

export type GroupStep = {
  key: RollGroupKey;
  rangeStep?: number;
};

export type RollTreeNode = {
  key: string;
  kind: RollGroupKey;
  label: string;
  rolls: MmStyleWarehouseRoll[];
  qty: number;
  children?: RollTreeNode[];
};

export const GROUP_KEY_OPTIONS: Array<{ key: RollGroupKey; label: string; numeric: boolean }> = [
  { key: 'color', label: 'Color', numeric: false },
  { key: 'fabric', label: 'Fabric', numeric: false },
  { key: 'challan', label: 'Challan', numeric: false },
  { key: 'shade', label: 'Shade', numeric: false },
  { key: 'width', label: 'Width', numeric: true },
  { key: 'shrinkW', label: 'Shrinkage W%', numeric: true },
  { key: 'shrinkL', label: 'Shrinkage L%', numeric: true },
  { key: 'gsm', label: 'GSM', numeric: true },
  { key: 'lot', label: 'Lot', numeric: false },
  { key: 'qc', label: 'Inspection', numeric: false },
];

export const DEFAULT_GROUP_STEPS: GroupStep[] = [
  { key: 'color' },
  { key: 'fabric' },
  { key: 'shade' },
  { key: 'width', rangeStep: 1 },
];

const NUMERIC_KEYS: RollGroupKey[] = ['width', 'shrinkW', 'shrinkL', 'gsm'];

export function isNumericGroupKey(key: RollGroupKey): boolean {
  return NUMERIC_KEYS.includes(key);
}

export function groupKeyLabel(key: RollGroupKey): string {
  return GROUP_KEY_OPTIONS.find((row) => row.key === key)?.label ?? key;
}

export function groupStepsLabel(steps: GroupStep[]): string {
  return steps.map((step) => {
    const name = groupKeyLabel(step.key);
    if (!isNumericGroupKey(step.key)) return name;
    const range = step.rangeStep && step.rangeStep > 0 ? step.rangeStep : 1;
    return `${name} (${range})`;
  }).join(' / ');
}

export function rollQcLabel(result: string | null | undefined): 'Pass' | 'Fail' | 'Pending' {
  if (result === 'pass') return 'Pass';
  if (result === 'fail') return 'Fail';
  return 'Pending';
}

export function rollQcClass(result: string | null | undefined): string {
  if (result === 'pass') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (result === 'fail') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-500 border-slate-200';
}

export function inboundChallanInspected(
  challanId: string,
  rolls: Array<{ receipt_id?: string | null; in_challan_id?: string | null; bucket: string; qc_result: string | null }>,
): boolean {
  const onChallan = rolls.filter(
    (row) => receiptIdOf(row) === challanId && row.bucket !== 'transit',
  );
  return onChallan.length > 0 && onChallan.every((row) => row.qc_result === 'pass' || row.qc_result === 'fail');
}

function normToken(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function matchAttrField(fields: MmTestField[], kind: 'width' | 'shrinkW' | 'shrinkL' | 'gsm'): MmTestField | null {
  const scored = fields.map((field) => ({ field, token: `${normToken(field.key)}${normToken(field.label)}` }));
  if (kind === 'gsm') return scored.find((row) => row.token.includes('gsm'))?.field ?? null;
  if (kind === 'width') {
    return scored.find((row) => row.token.includes('width') && !row.token.includes('shrink'))?.field ?? null;
  }
  if (kind === 'shrinkW') {
    return (
      scored.find((row) => row.token.includes('shrink') && (row.token.includes('weft') || /shrink(?:age)?w/.test(row.token)))
        ?.field ?? null
    );
  }
  return (
    scored.find((row) => row.token.includes('shrink') && (row.token.includes('warp') || /shrink(?:age)?l/.test(row.token)))
      ?.field ?? null
  );
}

function fmtBound(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const text = n.toFixed(4).replace(/\.?0+$/, '');
  return text.length > 0 ? text : '0';
}

export function numericRangeLabel(raw: string, step: number): string {
  const text = raw.trim();
  if (!text) return '—';
  const n = Number(text);
  if (!Number.isFinite(n) || !(step > 0)) return text;
  const start = Math.floor(n / step) * step;
  return `${fmtBound(start)} to ${fmtBound(start + step)}`;
}

function shadeValue(roll: MmStyleWarehouseRoll, fields: MmTestField[]): string {
  const tested = (roll.tested_shade ?? '').trim();
  if (tested) return tested;
  const fromCol = (roll.shade ?? '').trim();
  if (fromCol) return fromCol;
  const shadeField = fields.find((field) => {
    const token = `${normToken(field.key)}${normToken(field.label)}`;
    return token.includes('shade');
  });
  if (!shadeField) return '';
  const text = lockedRollFieldText(roll, shadeField);
  return text === '—' ? '' : text;
}

function attrValue(
  roll: MmStyleWarehouseRoll,
  fields: MmTestField[],
  kind: 'width' | 'shrinkW' | 'shrinkL' | 'gsm',
): string {
  const field = matchAttrField(fields, kind);
  if (!field) return '';
  const text = lockedRollFieldText(roll, field);
  return text === '—' ? '' : text;
}

type Bucket = { id: string; label: string; sort: number };

function bucketFor(
  roll: MmStyleWarehouseRoll,
  step: GroupStep,
  fields: MmTestField[],
  challanLabel: ((roll: MmStyleWarehouseRoll) => string) | undefined,
): Bucket {
  const key = step.key;
  if (key === 'color') {
    const label = (roll.color_name || '—').trim() || '—';
    return { id: `c:${label}`, label, sort: 0 };
  }
  if (key === 'fabric') {
    const label = (roll.fabric_name || '—').trim() || '—';
    return { id: `f:${label}`, label, sort: 0 };
  }
  if (key === 'challan') {
    const label = (challanLabel?.(roll) || '—').trim() || '—';
    return { id: `h:${label}`, label, sort: label === '—' ? 1 : 0 };
  }
  if (key === 'shade') {
    const label = shadeValue(roll, fields) || '—';
    return { id: `s:${label}`, label, sort: label === '—' ? 1 : 0 };
  }
  if (key === 'lot') {
    const label = (roll.lot_no || '—').trim() || '—';
    return { id: `l:${label}`, label, sort: label === '—' ? 1 : 0 };
  }
  if (key === 'qc') {
    const label = rollQcLabel(roll.qc_result);
    const sort = label === 'Pass' ? 0 : label === 'Fail' ? 1 : 2;
    return { id: `q:${label}`, label, sort };
  }
  const kind = key === 'width' ? 'width' : key === 'shrinkW' ? 'shrinkW' : key === 'shrinkL' ? 'shrinkL' : 'gsm';
  const raw = attrValue(roll, fields, kind);
  const range = step.rangeStep && step.rangeStep > 0 ? step.rangeStep : 1;
  const label = numericRangeLabel(raw, range);
  const start = Number(raw);
  const sort = Number.isFinite(start) ? start : Number.POSITIVE_INFINITY;
  return { id: `${key}:${label}`, label, sort };
}

function qtyOf(rolls: MmStyleWarehouseRoll[]): number {
  return rolls.reduce((sum, row) => sum + Number(row.length_m || 0), 0);
}

function compareLabel(a: string, b: string): number {
  if (a === '—' && b !== '—') return 1;
  if (b === '—' && a !== '—') return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function sortRolls(rolls: MmStyleWarehouseRoll[]): MmStyleWarehouseRoll[] {
  return [...rolls].sort((a, b) => a.unit_code.localeCompare(b.unit_code, undefined, { numeric: true }));
}

function asSteps(steps: Array<GroupStep | RollGroupKey>): GroupStep[] {
  return steps.map((step) => (typeof step === 'string' ? { key: step } : step));
}

export function groupStyleRollsByKeys(
  rolls: MmStyleWarehouseRoll[],
  steps: Array<GroupStep | RollGroupKey>,
  fieldsFor: (roll: MmStyleWarehouseRoll) => MmTestField[],
  challanLabel?: (roll: MmStyleWarehouseRoll) => string,
): RollTreeNode[] {
  const list = asSteps(steps);
  const nest = (rows: MmStyleWarehouseRoll[], remaining: GroupStep[], path: string): RollTreeNode[] => {
    const [head, ...rest] = remaining;
    if (!head) return [];
    const buckets = new Map<string, { label: string; sort: number; rolls: MmStyleWarehouseRoll[] }>();
    for (const roll of rows) {
      const bucket = bucketFor(roll, head, fieldsFor(roll), challanLabel);
      const existing = buckets.get(bucket.id);
      if (existing) existing.rolls.push(roll);
      else buckets.set(bucket.id, { label: bucket.label, sort: bucket.sort, rolls: [roll] });
    }
    return [...buckets.entries()]
      .sort((a, b) => a[1].sort - b[1].sort || compareLabel(a[1].label, b[1].label))
      .map(([id, group]) => {
        const key = path ? `${path}/${id}` : id;
        const sorted = sortRolls(group.rolls);
        return {
          key,
          kind: head.key,
          label: group.label,
          rolls: sorted,
          qty: qtyOf(sorted),
          children: rest.length > 0 ? nest(sorted, rest, key) : undefined,
        };
      });
  };
  return nest(rolls, list, '');
}
