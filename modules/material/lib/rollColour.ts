import type { MmRollFinished, MmRollSpec } from './mmV4Rpc';
import { toDisplayWidth, widthLabel, type WidthUnit } from './units';

export function rollColour(row: {
  color?: string | null;
  color_ref?: string | null;
  color_name?: string | null;
}): string {
  const value = String(row.color ?? row.color_ref ?? row.color_name ?? '').trim();
  return value || '—';
}

export function rollStageLabel(
  row: { stage_label?: string | null; stage_code?: string | null },
  stages?: Array<{ code: string; label: string }>,
): string {
  const label = String(row.stage_label ?? '').trim();
  if (label) return label;
  const code = String(row.stage_code ?? '').trim();
  if (!code) return '—';
  const match = stages?.find((stage) => stage.code === code);
  return match?.label || code;
}

export function finishedText(finished: MmRollFinished | null | undefined): { text: string; className: string } {
  if (!finished || typeof finished.finished !== 'boolean') {
    return { text: '—', className: 'text-slate-400' };
  }
  if (finished.finished) return { text: 'Yes', className: 'text-green-700' };
  const missing = finished.missing ?? [];
  const parts: string[] = [];
  if (missing.includes('colour')) parts.push('needs colour');
  if (missing.includes('stage')) parts.push('not cuttable');
  return {
    text: parts.length > 0 ? `No · ${parts.join(' · ')}` : 'No',
    className: 'text-amber-700',
  };
}

export function needsColour(finished: MmRollFinished | null | undefined): boolean {
  return (finished?.missing ?? []).includes('colour');
}

export function colourBlocksAllocate(finished: MmRollFinished | null | undefined): boolean {
  return finished?.finished === false && needsColour(finished);
}

export function specChip(spec: MmRollSpec | null | undefined, widthUnit: WidthUnit = 'in'): { text: string; className: string } | null {
  if (!spec?.checked) return null;
  if (spec.ok) return { text: 'In spec', className: 'text-green-700' };
  const bits: string[] = [];
  if (spec.gsm && spec.gsm.ok === false) {
    bits.push(`GSM ${fmt(spec.gsm.actual)} vs ${fmt(spec.gsm.target)} ±${fmt(spec.gsm.tol_pct)}%`);
  }
  if (spec.width && spec.width.ok === false) {
    const actual = toDisplayWidth(spec.width.actual ?? null, widthUnit);
    const target = toDisplayWidth(spec.width.target ?? null, widthUnit);
    bits.push(`Width ${fmt(actual)} vs ${fmt(target)} ${widthLabel(widthUnit)} ±${fmt(spec.width.tol_pct)}%`);
  }
  const basis = spec.basis === 'greige' || spec.basis === 'finished' ? ` (${spec.basis})` : '';
  return {
    text: `${bits.join(' · ') || 'Out of spec'}${basis}`,
    className: 'text-amber-700',
  };
}

function fmt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return String(value);
}
