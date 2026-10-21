export type QcToleranceLimit = {
  mode?: string | null;
  target?: number | null;
  min?: number | null;
  max?: number | null;
  text?: string | null;
} | null;

function finite(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

/** 'out' when a number is past a set min or max. 'none' when there is nothing to compare. */
export function toleranceState(
  limit: QcToleranceLimit | null | undefined,
  value: unknown,
): 'ok' | 'out' | 'none' {
  if (!limit) return 'none';
  const min = finite(limit.min);
  const max = finite(limit.max);
  if (min == null && max == null) return 'none';
  if (value == null) return 'none';
  if (typeof value === 'string' && value.trim() === '') return 'none';
  const num = finite(value);
  if (num == null) return 'none';
  if (min != null && num < min) return 'out';
  if (max != null && num > max) return 'out';
  return 'ok';
}

const CHECK_TRUE = new Set(['1', 'yes', 'true', 'y', '✓']);
const CHECK_FALSE = new Set(['0', 'no', 'false', 'n']);

/** vendor_certificate → Vendor, own → Own. Migrated and anything else stay unlabelled. */
export function qcCaptureOriginLabel(origin: unknown): 'Vendor' | 'Own' | null {
  if (origin === 'vendor_certificate') return 'Vendor';
  if (origin === 'own') return 'Own';
  return null;
}

function resultWord(result: unknown): string {
  const text = String(result ?? '').trim();
  if (!text || text.toUpperCase() === 'NONE') return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** Result word from last_test, then the roll status. Tag only for Vendor or Own. */
export function lastTestParts(roll: {
  last_test?: { result?: string | null; origin?: string | null } | null;
  test_status?: string | null;
}): { result: string; tag: 'Vendor' | 'Own' | null } {
  const fromLast = resultWord(roll.last_test?.result);
  if (fromLast) {
    return { result: fromLast, tag: qcCaptureOriginLabel(roll.last_test?.origin) };
  }
  const fromStatus = resultWord(roll.test_status);
  return { result: fromStatus || '—', tag: null };
}

export function lastTestCaption(roll: {
  last_test?: { result?: string | null; origin?: string | null } | null;
  test_status?: string | null;
}): string {
  const { result, tag } = lastTestParts(roll);
  if (result === '—') return '—';
  return tag ? `${result} (${tag})` : result;
}

/** Checkbox paste. Junk returns null so the cell stays as it was. */
export function parseCheckboxPaste(text: string): boolean | null {
  const value = text.trim().toLowerCase();
  if (CHECK_TRUE.has(value)) return true;
  if (CHECK_FALSE.has(value)) return false;
  return null;
}
