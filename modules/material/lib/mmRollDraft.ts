import type { MmMillLineRoll, MmRollWrite, MmTestField } from './mmRpc';

export type MmMillRollWorkStatus = 'new' | 'not_sent' | 'sent' | 'received';

export interface MmDraftRoll {
  localId: string;
  id?: string;
  locked?: boolean;
  millWorkStatus?: MmMillRollWorkStatus;
  roll_no: string;
  length_m: string;
  weight_kg: string;
  shade: string;
  lot_no: string;
  attributes: Record<string, string>;
}

export const MAX_MILL_BATCH_ROLLS = 500;

export function nextRollNo(rows: MmDraftRoll[]): string {
  let max = 0;
  for (const row of rows) {
    const n = Number(row.roll_no.trim());
    if (Number.isInteger(n) && n > max) max = n;
  }
  return String(max + 1);
}

export function blankDraftRoll(fields: MmTestField[] = [], rollNo = ''): MmDraftRoll {
  const attributes: Record<string, string> = {};
  for (const field of fields) attributes[field.key] = '';
  return {
    localId: crypto.randomUUID(),
    millWorkStatus: 'new',
    roll_no: rollNo,
    length_m: '',
    weight_kg: '',
    shade: '',
    lot_no: '',
    attributes,
  };
}

export function parseRollCount(raw: string, max = MAX_MILL_BATCH_ROLLS): number | null {
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
    key === 'lengthm' || key === 'length' || key.includes('length')
    || label.includes('length') || label.includes('metre') || label.includes('meter')
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

export function withLengthField(fields: MmTestField[] | null | undefined, uom?: string | null): MmTestField[] {
  const list = (Array.isArray(fields) ? fields : []).filter((field) => fieldRole(field) !== 'shade');
  const withQty = list.some((field) => fieldRole(field) === 'length')
    ? list
    : [fallbackLengthField(uom), ...list];
  const qtyIdx = withQty.findIndex((field) => fieldRole(field) === 'length');
  const next = [...withQty];
  next.splice(Math.max(qtyIdx, 0) + 1, 0, FALLBACK_SHADE_FIELD);
  return next;
}

/** Warehouse re-measure columns: mill type test fields except stock qty and shade. */
export function warehouseTestFields(fields: MmTestField[] | null | undefined): MmTestField[] {
  const list = Array.isArray(fields) ? fields : [];
  return list.filter((field) => fieldRole(field) !== 'length' && fieldRole(field) !== 'shade');
}

export function applyFieldValue(row: MmDraftRoll, field: MmTestField, value: string): MmDraftRoll {
  const next: MmDraftRoll = { ...row, attributes: { ...row.attributes, [field.key]: value } };
  const role = fieldRole(field);
  if (role === 'length') next.length_m = value;
  if (role === 'weight') next.weight_kg = value;
  if (role === 'shade') next.shade = value;
  if (role === 'lot') next.lot_no = value;
  return next;
}

function sampleForField(field: MmTestField, index: number): string {
  const options = parseTestOptions(field.options);
  if (field.data_type === 'select' && options.length > 0) return options[index % options.length];
  const role = fieldRole(field);
  if (role === 'length') return (42 + index * 1.5).toFixed(2);
  if (role === 'weight') return (11 + index * 0.35).toFixed(2);
  if (role === 'shade') return String.fromCharCode(65 + (index % 6));
  if (role === 'lot') return `L${String(index + 1).padStart(2, '0')}`;
  if (field.data_type === 'number') return String(100 + index);
  if (field.data_type === 'decimal') return (10 + index * 0.25).toFixed(2);
  return `${field.label} ${index + 1}`;
}

export function autoFillDraftRolls(rows: MmDraftRoll[], fields: MmTestField[]): MmDraftRoll[] {
  const cols = withLengthField(fields);
  return rows.map((row, i) => {
    let next = row;
    for (const field of cols) {
      const current = (next.attributes[field.key] ?? '').trim();
      if (current !== '') continue;
      next = applyFieldValue(next, field, sampleForField(field, i));
    }
    return next;
  });
}

export function formatQtyM(value: number | null | undefined, uom?: string | null): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const qty = n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const unit = (uom ?? '').trim();
  return unit ? `${qty} ${unit}` : qty;
}

export function millTransferSummary(rollCount: number, qtyM: number, uom?: string | null): string {
  const rolls = `${rollCount} ${rollCount === 1 ? 'roll' : 'rolls'}`;
  return `${rolls} · ${formatQtyM(qtyM, uom)} transferred from mill to warehouse`;
}

export function millChallanStatusLabel(status: string | null | undefined): string {
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

export function millRollWorkStatus(roll: {
  id?: string | null;
  at_mill?: boolean;
  in_challan_id?: string | null;
  challan_status?: string | null;
  status?: string | null;
}): MmMillRollWorkStatus {
  if (!roll.id) return 'new';
  const atMill = roll.at_mill === true
    || (roll.at_mill !== false && roll.status === 'draft' && !roll.in_challan_id);
  if (atMill) return 'not_sent';
  if ((roll.challan_status ?? '') === 'received') return 'received';
  return 'sent';
}

export function millRollWorkStatusLabel(status: MmMillRollWorkStatus): string {
  if (status === 'new') return 'New';
  if (status === 'not_sent') return 'Not sent';
  if (status === 'sent') return 'Sent';
  return 'Received';
}

export function millRollWorkStatusClass(status: MmMillRollWorkStatus): string {
  if (status === 'new') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'not_sent') return 'bg-yellow-50 text-yellow-800 border-yellow-200';
  if (status === 'sent') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

export function millChallanStatusClass(status: string | null | undefined): string {
  const label = millChallanStatusLabel(status);
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

export function millRollFieldText(
  roll: {
    length_m: number | null;
    weight_kg?: number | null;
    shade?: string | null;
    lot_no?: string | null;
    attributes?: Record<string, unknown> | null;
    mill_snapshot?: Record<string, unknown> | null;
  },
  field: MmTestField,
): string {
  const values = lockedRollValues(roll);
  const fromAttr = attrText(values.attributes, field.key);
  const role = fieldRole(field);
  if (role === 'shade') return values.shade || fromAttr || '—';
  if (fromAttr) return fromAttr;
  if (role === 'length') return values.length_m == null ? '—' : String(values.length_m);
  if (role === 'weight') return values.weight_kg == null ? '—' : String(values.weight_kg);
  if (role === 'lot') return values.lot_no || '—';
  return '—';
}

export function millFieldSeedText(
  roll: Parameters<typeof millRollFieldText>[0],
  field: MmTestField,
): string {
  const text = millRollFieldText(roll, field);
  return text === '—' ? '' : text;
}

/** Catalog cells: warehouse JSON if already tested, else mill declared, else blank. */
export function seedWarehouseFieldValues(
  mill: Parameters<typeof millRollFieldText>[0] | null | undefined,
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
    out[field.key] = mill ? millFieldSeedText(mill, field) : '';
  }
  return out;
}

/** Persist warehouse edits only. Mill copies and blanks stay off mm_warehouse_inspections. */
export function warehouseMeasuredFieldValues(
  millSeeds: Record<string, string> | null | undefined,
  current: Record<string, string> | null | undefined,
  fields?: MmTestField[] | null,
): Record<string, string> {
  const mill = millSeeds && typeof millSeeds === 'object' && !Array.isArray(millSeeds) ? millSeeds : {};
  const src = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const keys = fields != null ? warehouseTestFields(fields).map((field) => field.key) : Object.keys(src);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const now = String(src[key] ?? '').trim();
    if (!now) continue;
    if (now === String(mill[key] ?? '').trim()) continue;
    out[key] = now;
  }
  return out;
}

export function millDeclaredQty(roll: {
  length_m: number | null;
  mill_snapshot?: Record<string, unknown> | null;
}): number {
  return Number(lockedRollValues(roll).length_m ?? 0);
}

function snapNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function snapText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function lockedRollValues(roll: {
  length_m: number | null;
  weight_kg?: number | null;
  shade?: string | null;
  lot_no?: string | null;
  attributes?: Record<string, unknown> | null;
  mill_snapshot?: Record<string, unknown> | null;
}): {
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  lot_no: string | null;
  attributes: Record<string, unknown> | null;
} {
  const snap = roll.mill_snapshot;
  const snapAttrs =
    snap && snap.attributes && typeof snap.attributes === 'object' && !Array.isArray(snap.attributes)
      ? (snap.attributes as Record<string, unknown>)
      : null;
  return {
    length_m: snapNum(snap?.length_m) ?? roll.length_m,
    weight_kg: snapNum(snap?.weight_kg) ?? roll.weight_kg ?? null,
    shade: snapText(snap?.shade) ?? roll.shade ?? null,
    lot_no: snapText(snap?.lot_no) ?? roll.lot_no ?? null,
    attributes: snapAttrs ?? roll.attributes ?? null,
  };
}

export function lockedRollFieldText(
  roll: {
    length_m: number | null;
    weight_kg?: number | null;
    shade?: string | null;
    lot_no?: string | null;
    attributes?: Record<string, unknown> | null;
    mill_snapshot?: Record<string, unknown> | null;
  },
  field: MmTestField,
): string {
  return millRollFieldText(roll, field);
}

export function fieldsForType(
  packs: Array<{ type_id: string; fields: MmTestField[] }> | null | undefined,
  typeId: string | null | undefined,
): MmTestField[] {
  if (!typeId) return [];
  const pack = packs?.find((item) => item.type_id === typeId);
  return Array.isArray(pack?.fields) ? pack.fields : [];
}

export function millRollSearchBlob(roll: MmMillLineRoll, fields: MmTestField[]): string {
  const values = lockedRollValues(roll);
  const parts = [roll.unit_code, values.lot_no, values.shade, roll.batch_no, roll.challan_no];
  for (const field of fields) parts.push(millRollFieldText(roll, field));
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
  rolls: MmMillLineRoll[];
}

export function groupMillDispatchedChallans(rolls: MmMillLineRoll[]): MmDispatchedChallanGroup[] {
  const byId = new Map<string, MmDispatchedChallanGroup>();
  for (const roll of rolls) {
    if (roll.at_mill || !roll.in_challan_id) continue;
    const existing = byId.get(roll.in_challan_id);
    if (existing) {
      existing.rolls.push(roll);
      existing.roll_count += 1;
      existing.qty_m += millDeclaredQty(roll);
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
      qty_m: millDeclaredQty(roll),
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
  const n = parseRollCount(String(count), MAX_MILL_BATCH_ROLLS);
  if (n == null) return rows;
  if (n === rows.length) return rows;
  if (n < rows.length) return rows.slice(0, n);
  const cols = withLengthField(fields);
  const next = rows.slice();
  while (next.length < n) next.push(blankDraftRoll(cols, nextRollNo(next)));
  return next;
}

export function growMillBatchRolls(
  rows: MmDraftRoll[],
  count: number,
  fields: MmTestField[] = [],
): MmDraftRoll[] {
  const n = parseRollCount(String(count), MAX_MILL_BATCH_ROLLS);
  if (n == null) return rows;
  const locked = rows.filter((row) => Boolean(row.locked));
  const open = rows.filter((row) => !row.locked);
  if (n < locked.length) return sortMillAssignDrafts(rows);
  if (n === rows.length) return sortMillAssignDrafts(rows);
  const cols = withLengthField(fields);
  if (n < rows.length) {
    return sortMillAssignDrafts([...open.slice(0, n - locked.length), ...locked]);
  }
  const next = open.slice();
  while (next.length + locked.length < n) {
    next.push(blankDraftRoll(cols, nextRollNo([...next, ...locked])));
  }
  return sortMillAssignDrafts([...next, ...locked]);
}

export function sortMillAssignDrafts(rows: MmDraftRoll[]): MmDraftRoll[] {
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
    const lengthRaw = row.length_m.trim() || (lengthField ? (row.attributes[lengthField.key] ?? '').trim() : '');
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
      weight_kg: weight,
      shade: shade || null,
      lot_no: lotNo || null,
      attributes,
    });
  }
  if (rolls.length === 0) return { rolls: [], error: 'Add at least one roll' };
  return { rolls, error: null };
}

export function draftQtySum(rows: MmDraftRoll[]): number {
  return rows.reduce((sum, row) => {
    const n = Number(row.length_m);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

export function millLineRollToDraft(
  roll: {
    id: string;
    unit_code?: string | null;
    length_m: number | null;
    weight_kg: number | null;
    shade: string | null;
    lot_no: string | null;
    attributes: Record<string, unknown> | null;
    mill_snapshot?: Record<string, unknown> | null;
    at_mill: boolean;
    in_challan_id?: string | null;
    challan_status?: string | null;
    status?: string | null;
  },
  fields: MmTestField[] = [],
  uom?: string | null,
): MmDraftRoll {
  const cols = withLengthField(fields, uom);
  const values = roll.mill_snapshot ? lockedRollValues(roll) : {
    length_m: roll.length_m,
    weight_kg: roll.weight_kg,
    shade: roll.shade,
    lot_no: roll.lot_no,
    attributes: roll.attributes,
  };
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
    locked: !roll.at_mill,
    millWorkStatus: millRollWorkStatus(roll),
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

export function millDateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const raw = iso.trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function millDateTimeParts(iso: string | null | undefined): { date: string; time: string | null } {
  if (!iso) return { date: '—', time: null };
  const raw = iso.trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return { date: raw, time: null };
  return {
    date: date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }),
    time: date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  };
}
