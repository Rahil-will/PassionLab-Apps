import type { MmLineRoll, MmRollWrite, MmTestField } from './mmRpc';

export type MmRollWorkStatus = 'new' | 'not_sent' | 'sent' | 'received';

export interface MmDraftRoll {
  localId: string;
  id?: string;
  locked?: boolean;
  rollWorkStatus?: MmRollWorkStatus;
  roll_no: string;
  length_m: string;
  weight_kg: string;
  shade: string;
  lot_no: string;
  attributes: Record<string, string>;
}

export const MAX_RECEIPT_ROLLS = 500;

export function formatRollNo(n: number): string {
  return `ROL-${String(n).padStart(3, '0')}`;
}

function rollNoSequence(raw: string): number {
  const prefixed = raw.trim().match(/^rol-(\d+)$/i);
  if (prefixed) {
    const n = Number(prefixed[1]);
    return Number.isInteger(n) ? n : 0;
  }
  const plain = Number(raw.trim());
  return Number.isInteger(plain) && plain > 0 ? plain : 0;
}

export function nextRollNo(rows: MmDraftRoll[]): string {
  let max = 0;
  for (const row of rows) {
    const n = rollNoSequence(row.roll_no);
    if (n > max) max = n;
  }
  return formatRollNo(max + 1);
}

export function blankDraftRoll(fields: MmTestField[] = [], rollNo = ''): MmDraftRoll {
  const attributes: Record<string, string> = {};
  for (const field of fields) attributes[field.key] = '';
  return {
    localId: crypto.randomUUID(),
    rollWorkStatus: 'new',
    roll_no: rollNo,
    length_m: '',
    weight_kg: '',
    shade: '',
    lot_no: '',
    attributes,
  };
}

export function parseRollCount(raw: string, max = MAX_RECEIPT_ROLLS): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

export type MmFieldRole = 'length' | 'weight' | 'shade' | 'lot' | 'attr';

function normKey(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function fieldRole(field: MmTestField): MmFieldRole {
  const key = normKey(field.key);
  const label = normKey(field.label);
  const token = `${key} ${label}`;
  if (token.includes('shrink')) return 'attr';
  if (
    key === 'lengthm'
    || key === 'qty' || key.startsWith('qty') || label === 'qty' || label.startsWith('qty')
  ) {
    return 'length';
  }
  if (key === 'weightkg' || key === 'weight' || key.includes('weight') || label.includes('weight')) return 'weight';
  if (key === 'shade' || label === 'shade') return 'shade';
  if (key === 'lot' || key === 'lotno' || key === 'lotnumber' || label === 'lot') return 'lot';
  return 'attr';
}

export function qtyFieldLabel(_uom?: string | null): string {
  return 'Qty';
}

/** GSM and width columns from a fabric type's own field list. The attribute key is the field's key. */
export function actualMeasureFields(
  bundle: { test_fields?: Record<string, unknown>[]; requirement_fields?: Record<string, unknown>[] } | null | undefined,
  typeId: string,
): MmTestField[] {
  if (!typeId || !bundle) return [];
  const mapRows = (rows: Record<string, unknown>[] | undefined): MmTestField[] =>
    (rows ?? [])
      .filter((row) => String(row.type_id ?? '') === typeId && row.is_active !== false)
      .map((row) => {
        const label = String(row.label ?? '').trim();
        const key = String(row.key ?? '').trim() || label;
        return {
          id: String(row.id ?? key),
          key,
          label: label || key,
          data_type: String(row.data_type ?? 'decimal'),
          options: (row.options as MmTestField['options']) ?? null,
        };
      })
      .filter((field) => field.key);
  const seen = new Set<string>();
  const out: MmTestField[] = [];
  for (const field of [...mapRows(bundle.test_fields), ...mapRows(bundle.requirement_fields)]) {
    const token = `${normKey(field.key)} ${normKey(field.label)}`;
    if (token.includes('shrink') || token.includes('form')) continue;
    if (!token.includes('gsm') && !token.includes('width')) continue;
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
  }
  return out;
}

export const FALLBACK_LENGTH_FIELD: MmTestField = {
  id: '__length_m',
  key: 'length_m',
  label: 'Qty',
  data_type: 'decimal',
  options: null,
};

export function fallbackLengthField(uom?: string | null): MmTestField {
  return { ...FALLBACK_LENGTH_FIELD, label: qtyFieldLabel(uom) };
}

export const FALLBACK_SHADE_FIELD: MmTestField = {
  id: '__shade',
  key: 'shade',
  label: 'Shade',
  data_type: 'text',
  options: null,
};

export function withLengthField(
  fields: MmTestField[] | null | undefined,
  uom?: string | null,
  options?: { injectShade?: boolean },
): MmTestField[] {
  const injectShade = options?.injectShade !== false;
  const list = (Array.isArray(fields) ? fields : []).filter((field) => (injectShade ? fieldRole(field) !== 'shade' : true));
  const withQty = list.some((field) => fieldRole(field) === 'length')
    ? list
    : [fallbackLengthField(uom), ...list];
  if (!injectShade) return withQty;
  const qtyIdx = withQty.findIndex((field) => fieldRole(field) === 'length');
  const next = [...withQty];
  next.splice(Math.max(qtyIdx, 0) + 1, 0, FALLBACK_SHADE_FIELD);
  return next;
}

/** Shade bands A–E, each split 1–4: A1…A4, B1…B4, through E4. */
export const LOT_TYPE_OPTIONS = (['A', 'B', 'C', 'D', 'E'] as const).flatMap((band) =>
  [1, 2, 3, 4].map((step) => `${band}${step}`),
);

export const QC_DISPOSITIONS = [
  { value: 'pass', label: 'Pass' },
  { value: 'hold', label: 'Hold' },
  { value: 'rework', label: 'Rework' },
  { value: 'downgrade', label: 'Downgrade' },
  { value: 'reject', label: 'Reject' },
] as const;

export const DEFAULT_MEASURE_TOLERANCE = '2.5';

export type MmMeasureSpec = {
  id: 'width' | 'gsm';
  label: string;
  targetKey: string;
  tolKey: string;
  actualKey: string;
};

export const ROLL_MEASURES: MmMeasureSpec[] = [
  { id: 'width', label: 'Width', targetKey: 'target_width_in', tolKey: 'width_tol_pct', actualKey: 'actual_width_in' },
  { id: 'gsm', label: 'GSM', targetKey: 'target_gsm', tolKey: 'gsm_tol_pct', actualKey: 'actual_gsm' },
];

export function measureOutOfSpec(target: string, actual: string, tolerance: string): boolean {
  const spec = Number(target);
  const measured = Number(actual);
  if (!target.trim() || !actual.trim() || !Number.isFinite(spec) || !Number.isFinite(measured) || spec === 0) return false;
  const pct = Number(tolerance);
  const band = Number.isFinite(pct) ? Math.abs(pct) : Number(DEFAULT_MEASURE_TOLERANCE);
  return (Math.abs(measured - spec) / Math.abs(spec)) * 100 > band;
}

export function rollOutOfSpec(row: MmDraftRoll, measures: MmMeasureSpec[] = ROLL_MEASURES): boolean {
  return measures.some((measure) => measureOutOfSpec(
    row.attributes[measure.targetKey] ?? '',
    row.attributes[measure.actualKey] ?? '',
    row.attributes[measure.tolKey] || DEFAULT_MEASURE_TOLERANCE,
  ));
}

export function applyMeasureQc(row: MmDraftRoll, measures: MmMeasureSpec[] = ROLL_MEASURES): MmDraftRoll {
  const out = rollOutOfSpec(row, measures);
  const current = row.attributes.qc_status || 'pass';
  const next = out
    ? (current === 'pass' || current === '' ? 'hold' : current)
    : (current === 'hold' ? 'pass' : current);
  if (next === current && row.attributes.qc_status) return row;
  return { ...row, attributes: { ...row.attributes, qc_status: next } };
}

/** Copy fabric targets onto every roll. Tolerance stays at ±2.5% until a roll overrides it. */
export function stampMeasureTargets(
  rows: MmDraftRoll[],
  targets: Partial<Record<MmMeasureSpec['id'], string>>,
): MmDraftRoll[] {
  let changed = false;
  const next = rows.map((row) => {
    const attributes = { ...row.attributes };
    let rowChanged = false;
    for (const measure of ROLL_MEASURES) {
      const target = targets[measure.id] ?? '';
      if ((attributes[measure.targetKey] ?? '') !== target) {
        attributes[measure.targetKey] = target;
        rowChanged = true;
      }
      if (!(attributes[measure.tolKey] ?? '').trim()) {
        attributes[measure.tolKey] = DEFAULT_MEASURE_TOLERANCE;
        rowChanged = true;
      }
    }
    const stamped = rowChanged ? { ...row, attributes } : row;
    const withQc = applyMeasureQc(stamped);
    if (withQc !== stamped || rowChanged) changed = true;
    return withQc === stamped && !rowChanged ? row : withQc;
  });
  return changed ? next : rows;
}

/** Warehouse re-measure columns: type test fields except stock qty and shade. */
export function warehouseTestFields(fields: MmTestField[] | null | undefined): MmTestField[] {
  const list = Array.isArray(fields) ? fields : [];
  return list.filter((field) => fieldRole(field) !== 'length' && fieldRole(field) !== 'shade');
}

export function applyFieldValue(row: MmDraftRoll, field: MmTestField, value: string, uom?: string | null): MmDraftRoll {
  const role = fieldRole(field);
  const attributes = { ...row.attributes };
  if (isKgUom(uom) && field.key === 'length_m') delete attributes.length_m;
  else attributes[field.key] = value;
  const next: MmDraftRoll = { ...row, attributes };
  if (role === 'length') {
    if (isKgUom(uom)) {
      next.weight_kg = value;
      next.length_m = '';
    } else {
      next.length_m = value;
    }
  }
  if (role === 'weight') next.weight_kg = value;
  if (role === 'shade') next.shade = value;
  if (role === 'lot') next.lot_no = value;
  return next;
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function fieldAlreadySet(row: MmDraftRoll, field: MmTestField): boolean {
  if ((row.attributes[field.key] ?? '').trim() !== '') return true;
  const role = fieldRole(field);
  if (role === 'length') return row.length_m.trim() !== '';
  if (role === 'weight') return row.weight_kg.trim() !== '';
  if (role === 'shade') return row.shade.trim() !== '';
  if (role === 'lot') return row.lot_no.trim() !== '';
  return false;
}

function randomForField(field: MmTestField): string {
  const options = parseTestOptions(field.options);
  if (field.data_type === 'select' && options.length > 0) {
    return options[Math.floor(Math.random() * options.length)] ?? '';
  }
  const role = fieldRole(field);
  const token = `${normKey(field.key)} ${normKey(field.label)}`;
  if (role === 'length') return randBetween(25, 120).toFixed(2);
  if (role === 'weight') return randBetween(8, 40).toFixed(2);
  if (role === 'shade') return String.fromCharCode(65 + Math.floor(Math.random() * 6));
  if (role === 'lot') return LOT_TYPE_OPTIONS[Math.floor(Math.random() * LOT_TYPE_OPTIONS.length)] ?? 'A1';
  if (token.includes('shrink')) return randBetween(0.2, 4).toFixed(2);
  if (field.data_type === 'number') return String(Math.floor(randBetween(1, 100)));
  if (field.data_type === 'decimal') return randBetween(0.5, 20).toFixed(2);
  return `${field.label} ${Math.floor(randBetween(1, 99))}`;
}

/** Random actual inside the tolerance band. Rounding never lands outside the band. */
function randomActualInTolerance(targetRaw: string, tolRaw: string): string | null {
  const target = Number(targetRaw);
  if (!targetRaw.trim() || !Number.isFinite(target) || target === 0) return null;
  const pct = Number(tolRaw);
  const band = Number.isFinite(pct) ? Math.abs(pct) : Number(DEFAULT_MEASURE_TOLERANCE);
  const span = Math.abs(target) * (band / 100) * 0.9;
  const rounded = (target + (Math.random() * 2 - 1) * span).toFixed(2);
  if (measureOutOfSpec(targetRaw, rounded, String(band))) return target.toFixed(2);
  return rounded;
}

export function autoFillDraftRolls(
  rows: MmDraftRoll[],
  fields: MmTestField[],
  options?: { measures?: MmMeasureSpec[]; fillLotType?: boolean },
): MmDraftRoll[] {
  const measures = options?.measures ?? [];
  const reserved = new Set(measures.flatMap((measure) => [measure.targetKey, measure.tolKey, measure.actualKey]));
  return rows.map((row) => {
    if (row.locked) return row;
    let next = row;
    for (const field of fields) {
      if (reserved.has(field.key) || fieldAlreadySet(next, field)) continue;
      next = applyFieldValue(next, field, randomForField(field));
    }
    if (options?.fillLotType && !next.lot_no.trim()) {
      next = {
        ...next,
        lot_no: LOT_TYPE_OPTIONS[Math.floor(Math.random() * LOT_TYPE_OPTIONS.length)] ?? 'A1',
      };
    }
    if (measures.length === 0) return next;
    const attributes = { ...next.attributes };
    for (const measure of measures) {
      if ((attributes[measure.actualKey] ?? '').trim() !== '') continue;
      const actual = randomActualInTolerance(
        attributes[measure.targetKey] ?? '',
        attributes[measure.tolKey] || DEFAULT_MEASURE_TOLERANCE,
      );
      if (actual != null) attributes[measure.actualKey] = actual;
    }
    return applyMeasureQc({ ...next, attributes }, measures);
  });
}

export function formatQtyM(value: number | null | undefined, uom?: string | null): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const qty = n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const unit = (uom ?? '').trim();
  return unit ? `${qty} ${unit}` : qty;
}

export function transferSummary(rollCount: number, qtyM: number, uom?: string | null): string {
  const rolls = `${rollCount} ${rollCount === 1 ? 'roll' : 'rolls'}`;
  return `${rolls} · ${formatQtyM(qtyM, uom)} transferred to the warehouse`;
}

export function challanStatusLabel(status: string | null | undefined): string {
  if (status === 'received') return 'Received';
  if (status === 'pending' || status === 'in_transit') return 'In transit';
  if (status === 'partial') return 'Partial';
  if (status === 'short_closed') return 'Short closed';
  if (status === 'pending_qc') return 'Pending test';
  if (status === 'in_stock') return 'In stock';
  if (status === 'rejected') return 'Rejected';
  if (!status) return '—';
  return status.replace(/_/g, ' ');
}

export function rollWorkStatus(roll: {
  id?: string | null;
  in_challan_id?: string | null;
  challan_status?: string | null;
  status?: string | null;
}): MmRollWorkStatus {
  if (!roll.id) return 'new';
  if (roll.status === 'draft' && !roll.in_challan_id) return 'not_sent';
  if ((roll.challan_status ?? '') === 'received') return 'received';
  return 'sent';
}

export function rollWorkStatusLabel(status: MmRollWorkStatus): string {
  if (status === 'new') return 'New';
  if (status === 'not_sent') return 'Not sent';
  if (status === 'sent') return 'Sent';
  return 'Received';
}

export function rollWorkStatusClass(status: MmRollWorkStatus): string {
  if (status === 'new') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'not_sent') return 'bg-yellow-50 text-yellow-800 border-yellow-200';
  if (status === 'sent') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

export function challanStatusClass(status: string | null | undefined): string {
  const label = challanStatusLabel(status);
  if (label === 'Received' || label === 'In stock') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (label === 'In transit' || label === 'Pending test') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (label === 'Rejected') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function attrText(attrs: Record<string, unknown> | null | undefined, key: string): string {
  if (!attrs) return '';
  const value = attrs[key];
  if (value == null) return '';
  return String(value).trim();
}

export function rollFieldText(
  roll: {
    length_m: number | null;
    weight_kg?: number | null;
    shade?: string | null;
    lot_no?: string | null;
    attributes?: Record<string, unknown> | null;
  },
  field: MmTestField,
  uom?: string | null,
): string {
  const values = lockedRollValues(roll);
  const fromAttr = attrText(values.attributes, field.key);
  const role = fieldRole(field);
  if (role === 'shade') return values.shade || fromAttr || '—';
  if (role === 'length') {
    const qty = declaredQty(roll, uom);
    return qty > 0 ? String(qty) : '—';
  }
  if (fromAttr) return fromAttr;
  if (role === 'weight') {
    const qty = isKgUom(uom) ? declaredQty(roll, uom) : positiveQty(values.weight_kg);
    return qty > 0 ? String(qty) : '—';
  }
  if (role === 'lot') return values.lot_no || '—';
  return '—';
}

export function fieldSeedText(
  roll: Parameters<typeof rollFieldText>[0],
  field: MmTestField,
): string {
  const text = rollFieldText(roll, field);
  return text === '—' ? '' : text;
}

/** Catalog cells: warehouse JSON if already tested, else declared values, else blank. */
export function seedWarehouseFieldValues(
  declared: Parameters<typeof rollFieldText>[0] | null | undefined,
  saved: Record<string, string> | null | undefined,
  fields: MmTestField[] | null | undefined,
): Record<string, string> {
  const src = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const out: Record<string, string> = {};
  for (const field of warehouseTestFields(fields)) {
    const recorded = src[field.key];
    if (recorded != null && String(recorded).trim()) {
      out[field.key] = String(recorded).trim();
      continue;
    }
    out[field.key] = declared ? fieldSeedText(declared, field) : '';
  }
  return out;
}

/** Persist warehouse edits only. Unchanged copies and blanks stay off mm_warehouse_inspections. */
export function warehouseMeasuredFieldValues(
  declaredSeeds: Record<string, string> | null | undefined,
  current: Record<string, string> | null | undefined,
  fields?: MmTestField[] | null,
): Record<string, string> {
  const declared = declaredSeeds && typeof declaredSeeds === 'object' && !Array.isArray(declaredSeeds) ? declaredSeeds : {};
  const src = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const keys = fields != null ? warehouseTestFields(fields).map((field) => field.key) : Object.keys(src);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const now = String(src[key] ?? '').trim();
    if (!now) continue;
    if (now === String(declared[key] ?? '').trim()) continue;
    out[key] = now;
  }
  return out;
}

function positiveQty(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isKgUom(uom?: string | null): boolean {
  const unit = (uom ?? '').trim().toLowerCase();
  return unit === 'kg' || unit === 'kgs';
}

export function isMetreUom(uom?: string | null): boolean {
  const unit = (uom ?? '').trim().toLowerCase();
  return unit === 'm' || unit === 'mtr' || unit === 'meter' || unit === 'metre' || unit === 'meters' || unit === 'metres';
}

function attrQty(attrs: Record<string, unknown> | null, role: 'length' | 'weight'): number {
  if (!attrs) return 0;
  for (const [key, value] of Object.entries(attrs)) {
    const field: MmTestField = { id: key, key, label: key, data_type: 'decimal', options: null };
    if (fieldRole(field) !== role) continue;
    const n = positiveQty(value);
    if (n > 0) return n;
  }
  return 0;
}

/** One quantity. Metres read length_m. Kilograms read weight_kg. The two columns are never added. */
export function declaredQty(roll: {
  length_m?: number | null;
  weight_kg?: number | null;
  attributes?: Record<string, unknown> | null;
}, uom?: string | null): number {
  const values = lockedRollValues(roll);
  const metres = positiveQty(values.length_m);
  const kilos = positiveQty(values.weight_kg);
  if (isKgUom(uom)) return kilos || metres || attrQty(values.attributes, 'weight');
  if (isMetreUom(uom)) return metres || kilos || attrQty(values.attributes, 'length');
  if (kilos > 0 && (metres === 0 || metres === kilos)) return kilos;
  if (metres > 0) return metres;
  return attrQty(values.attributes, 'weight') || attrQty(values.attributes, 'length');
}

/** Unit for a roll when the fabric unit was not passed in. A kilogram copied into both columns stays kg. */
export function shownUnit(roll: {
  length_m?: number | null;
  weight_kg?: number | null;
  attributes?: Record<string, unknown> | null;
}, uom?: string | null): string {
  const given = (uom ?? '').trim();
  if (given) return given;
  const values = lockedRollValues(roll);
  const metres = positiveQty(values.length_m);
  const kilos = positiveQty(values.weight_kg);
  if (kilos > 0 && (metres === 0 || metres === kilos)) return 'kg';
  return 'm';
}

export function lockedRollValues(roll: {
  length_m?: number | null;
  weight_kg?: number | null;
  shade?: string | null;
  lot_no?: string | null;
  attributes?: Record<string, unknown> | null;
}): {
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  lot_no: string | null;
  attributes: Record<string, unknown> | null;
} {
  return {
    length_m: roll.length_m ?? null,
    weight_kg: roll.weight_kg ?? null,
    shade: roll.shade ?? null,
    lot_no: roll.lot_no ?? null,
    attributes: roll.attributes ?? null,
  };
}

export function lockedRollFieldText(
  roll: {
    length_m: number | null;
    weight_kg?: number | null;
    shade?: string | null;
    lot_no?: string | null;
    attributes?: Record<string, unknown> | null;
  },
  field: MmTestField,
  uom?: string | null,
): string {
  return rollFieldText(roll, field, uom);
}

export function fieldsForType(
  packs: Array<{ type_id: string; fields: MmTestField[] }> | null | undefined,
  typeId: string | null | undefined,
): MmTestField[] {
  if (!typeId) return [];
  const pack = packs?.find((item) => item.type_id === typeId);
  return Array.isArray(pack?.fields) ? pack.fields : [];
}

export function rollSearchBlob(roll: MmLineRoll, fields: MmTestField[]): string {
  const values = lockedRollValues(roll);
  const parts = [roll.unit_code, values.lot_no, values.shade, roll.batch_no, roll.challan_no];
  for (const field of fields) parts.push(rollFieldText(roll, field));
  return parts.map((part) => (part ?? '').toLowerCase()).join(' ');
}

export interface MmDispatchedChallanGroup {
  id: string;
  challan_no: string;
  status: string;
  reference_no: string;
  sent_at: string | null;
  received_at: string | null;
  to_location: string;
  roll_count: number;
  qty_m: number;
  rolls: MmLineRoll[];
}

export function groupDispatchedChallans(rolls: MmLineRoll[], uom?: string | null): MmDispatchedChallanGroup[] {
  const byId = new Map<string, MmDispatchedChallanGroup>();
  for (const roll of rolls) {
    if (!roll.in_challan_id) continue;
    const existing = byId.get(roll.in_challan_id);
    if (existing) {
      existing.rolls.push(roll);
      existing.roll_count += 1;
      existing.qty_m += declaredQty(roll, uom);
      continue;
    }
    byId.set(roll.in_challan_id, {
      id: roll.in_challan_id,
      challan_no: roll.challan_no ?? '—',
      status: roll.challan_status ?? 'pending',
      reference_no: roll.challan_reference_no ?? '',
      sent_at: roll.challan_sent_at,
      received_at: roll.challan_received_at ?? null,
      to_location: roll.challan_to_location || 'Warehouse',
      roll_count: 1,
      qty_m: declaredQty(roll, uom),
      rolls: [roll],
    });
  }
  return [...byId.values()].sort((a, b) => b.challan_no.localeCompare(a.challan_no));
}

export function resizeDraftRolls(
  rows: MmDraftRoll[],
  count: number,
  fields: MmTestField[] = [],
): MmDraftRoll[] {
  const n = parseRollCount(String(count), MAX_RECEIPT_ROLLS);
  if (n == null) return rows;
  if (n === rows.length) return rows;
  if (n < rows.length) return rows.slice(0, n);
  const cols = withLengthField(fields);
  const next = rows.slice();
  while (next.length < n) next.push(blankDraftRoll(cols, nextRollNo(next)));
  return next;
}

export function growReceiptRolls(
  rows: MmDraftRoll[],
  count: number,
  fields: MmTestField[] = [],
): MmDraftRoll[] {
  const n = parseRollCount(String(count), MAX_RECEIPT_ROLLS);
  if (n == null) return rows;
  const locked = rows.filter((row) => Boolean(row.locked));
  const open = rows.filter((row) => !row.locked);
  if (n < locked.length) return sortAssignDrafts(rows);
  if (n === rows.length) return sortAssignDrafts(rows);
  const cols = withLengthField(fields);
  if (n < rows.length) {
    return sortAssignDrafts([...open.slice(0, n - locked.length), ...locked]);
  }
  const next = open.slice();
  while (next.length + locked.length < n) {
    next.push(blankDraftRoll(cols, nextRollNo([...next, ...locked])));
  }
  return sortAssignDrafts([...next, ...locked]);
}

export function sortAssignDrafts(rows: MmDraftRoll[]): MmDraftRoll[] {
  const open = rows.filter((row) => !row.locked);
  const locked = rows.filter((row) => Boolean(row.locked));
  return [...open, ...locked];
}

export function parseTestOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item)).filter((item) => item.trim() !== '');
}

export function attrRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) continue;
    out[key] = String(value);
  }
  return out;
}

export function draftsToRollWrites(
  rows: MmDraftRoll[],
  fields: MmTestField[] = [],
  uom?: string | null,
): { rolls: MmRollWrite[]; error: string | null } {
  const cols = withLengthField(fields);
  const lengthField = cols.find((field) => fieldRole(field) === 'length');
  const weightField = cols.find((field) => fieldRole(field) === 'weight');
  const shadeField = cols.find((field) => fieldRole(field) === 'shade');
  const lotField = cols.find((field) => fieldRole(field) === 'lot');
  const rolls: MmRollWrite[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const rollNo = row.roll_no.trim();
    if (!rollNo) {
      return { rolls: [], error: 'Each roll needs a roll number' };
    }
    const key = rollNo.toLowerCase();
    if (seen.has(key)) {
      return { rolls: [], error: `Roll ${rollNo} is already used in this batch` };
    }
    seen.add(key);
    const attrQty = lengthField ? (row.attributes[lengthField.key] ?? '').trim() : '';
    const lengthRaw = isKgUom(uom)
      ? (row.weight_kg.trim() || row.length_m.trim() || attrQty)
      : (row.length_m.trim() || attrQty);
    const length = Number(lengthRaw);
    if (!Number.isFinite(length) || length <= 0) {
      return { rolls: [], error: 'Each roll needs quantity greater than 0' };
    }
    const weightRaw = row.weight_kg.trim() || (weightField ? (row.attributes[weightField.key] ?? '').trim() : '');
    const weight = weightRaw === '' ? null : Number(weightRaw);
    if (weightRaw !== '' && !Number.isFinite(weight)) {
      return { rolls: [], error: 'Weight must be a number' };
    }
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.attributes)) {
      if (value.trim() !== '') attributes[key] = value;
    }
    const shade = row.shade.trim() || (shadeField ? (row.attributes[shadeField.key] ?? '').trim() : '');
    const lotNo = row.lot_no.trim() || (lotField ? (row.attributes[lotField.key] ?? '').trim() : '');
    rolls.push({
      id: row.id,
      unit_code: rollNo,
      length_m: length,
      weight_kg: isKgUom(uom) ? length : weight,
      shade: shade || null,
      lot_no: lotNo || null,
      attributes,
    });
  }
  if (rolls.length === 0) return { rolls: [], error: 'Add at least one roll' };
  return { rolls, error: null };
}

export function draftQtySum(rows: MmDraftRoll[], uom?: string | null): number {
  return rows.reduce((sum, row) => {
    const raw = isKgUom(uom) ? (row.weight_kg.trim() || row.length_m) : (row.length_m.trim() || row.weight_kg);
    const n = Number(raw);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

export function lineRollToDraft(
  roll: {
    id: string;
    unit_code?: string | null;
    length_m: number | null;
    weight_kg: number | null;
    shade: string | null;
    lot_no: string | null;
    attributes: Record<string, unknown> | null;
    in_challan_id?: string | null;
    challan_status?: string | null;
    status?: string | null;
  },
  fields: MmTestField[] = [],
  uom?: string | null,
): MmDraftRoll {
  const cols = withLengthField(fields, uom);
  const values = lockedRollValues(roll);
  const workStatus = rollWorkStatus(roll);
  const attributes = attrRecord(values.attributes);
  const length = values.length_m != null ? String(values.length_m) : '';
  const weight = values.weight_kg != null ? String(values.weight_kg) : '';
  const shade = values.shade ?? '';
  const lot = values.lot_no ?? '';
  for (const field of cols) {
    const role = fieldRole(field);
    if (attributes[field.key]) continue;
    if (role === 'length') attributes[field.key] = length;
    else if (role === 'weight') attributes[field.key] = weight;
    else if (role === 'shade') attributes[field.key] = shade;
    else if (role === 'lot') attributes[field.key] = lot;
  }
  return {
    localId: roll.id,
    id: roll.id,
    locked: workStatus === 'sent' || workStatus === 'received',
    rollWorkStatus: workStatus,
    roll_no: roll.unit_code ?? '',
    length_m: length,
    weight_kg: weight,
    shade,
    lot_no: lot,
    attributes,
  };
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const raw = iso.trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function dateTimeParts(iso: string | null | undefined): { date: string; time: string | null } {
  if (!iso) return { date: '—', time: null };
  const raw = iso.trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return { date: raw, time: null };
  return {
    date: date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }),
    time: date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
}
