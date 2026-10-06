export type FourPointResult = '' | 'pass' | 'fail';

export interface FourPointDraft {
  id: string;
  unit_code: string;
  length_m: number | null;
  shade: string;
  qc_result: string | null;
  inspected: boolean;
  result: FourPointResult;
  inspectedLength: string;
  actualWidth: string;
  cuttableWidth: string;
  pts1: string;
  pts2: string;
  pts3: string;
  pts4: string;
  widthUom: 'in' | 'cm';
  overrideReason: string;
}

export function fourPointPoints(row: Pick<FourPointDraft, 'pts1' | 'pts2' | 'pts3' | 'pts4'>): number {
  const n = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  return n(row.pts1) + 2 * n(row.pts2) + 3 * n(row.pts3) + 4 * n(row.pts4);
}

function attrText(attrs: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  for (const key of keys) {
    const value = attrs?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

export function fourPointScore(row: FourPointDraft, lengthUom: string | null): number | null {
  const length = Number(row.inspectedLength);
  const width = Number(row.actualWidth);
  if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return null;
  const yards = lengthUom === 'yd' ? length : length / 0.9144;
  const inches = row.widthUom === 'cm' ? width / 2.54 : width;
  if (!(yards > 0) || !(inches > 0)) return null;
  return Math.round(((fourPointPoints(row) * 3600) / (yards * inches)) * 100) / 100;
}

export function fourPointVerdict(score: number): 'pass' | 'fail' {
  return score <= 40 ? 'pass' : 'fail';
}

export function toFourPointDraft(roll: {
  id: string;
  unit_code: string;
  length_m?: number | null;
  qty?: number | null;
  shade?: string | null;
  qc_result?: string | null;
  attributes?: Record<string, unknown> | null;
}): FourPointDraft {
  const result = roll.qc_result === 'pass' || roll.qc_result === 'fail' ? roll.qc_result : '';
  const attrs = roll.attributes;
  const widthUom = attrText(attrs, 'width_uom') === 'cm' ? 'cm' : 'in';
  return {
    id: roll.id,
    unit_code: roll.unit_code,
    length_m: roll.length_m ?? roll.qty ?? null,
    shade: (roll.shade ?? '').trim(),
    qc_result: roll.qc_result ?? null,
    inspected: Boolean(result),
    result,
    inspectedLength: attrText(attrs, 'inspected_length', 'actual_length'),
    actualWidth: attrText(attrs, 'actual_width', 'inspected_width_in'),
    cuttableWidth: attrText(attrs, 'cuttable_width'),
    pts1: attrText(attrs, 'pts_1'),
    pts2: attrText(attrs, 'pts_2'),
    pts3: attrText(attrs, 'pts_3'),
    pts4: attrText(attrs, 'pts_4'),
    widthUom,
    overrideReason: attrText(attrs, 'override_reason'),
  };
}

export function fourPointValues(row: FourPointDraft): Record<string, string> {
  const values: Record<string, string> = {};
  const put = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) values[key] = trimmed;
  };
  put('inspected_length', row.inspectedLength);
  put('actual_width', row.actualWidth);
  put('cuttable_width', row.cuttableWidth);
  if (row.actualWidth.trim() || row.cuttableWidth.trim()) {
    values.width_uom = row.widthUom;
    if (row.widthUom === 'in' && row.actualWidth.trim()) put('inspected_width_in', row.actualWidth);
  }
  put('pts_1', row.pts1);
  put('pts_2', row.pts2);
  put('pts_3', row.pts3);
  put('pts_4', row.pts4);
  put('override_reason', row.overrideReason);
  return values;
}
