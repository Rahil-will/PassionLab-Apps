import React from 'react';

/** Colored dot + label for a Status column. Header and cell stay centered by the caller. */
export function statusMark(raw: string | null | undefined): { dot: string; text: string } {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!s || s === '—') return { dot: 'bg-slate-300', text: 'text-slate-400' };
  if (s === 'inactive' || s === 'void' || s === 'consumed' || s === 'short closed' || s === 'sent') {
    return { dot: 'bg-slate-400', text: 'text-slate-500' };
  }
  if (/\b(fail|failed|reject|rejected|red label|missing|written off|closed)\b/.test(s)) {
    return { dot: 'bg-red-500', text: 'text-red-600' };
  }
  if (/\b(new|unassigned|incoming|open|part back)\b/.test(s)) {
    return { dot: 'bg-blue-500', text: 'text-blue-600' };
  }
  if (
    /\b(pending|partial|in transit|mixed|due|hold|on hold|stale|incomplete|receiving|not sent|still out|qc pending|at processing|draft|not started|returned)\b/.test(s)
  ) {
    return { dot: 'bg-amber-500', text: 'text-amber-600' };
  }
  if (
    /\b(pass|passed|received|in stock|done|met|completed|dispatched|active|on rack|issued|came back|on hand|covered|inspection completed|cutting store)\b/.test(s)
  ) {
    return { dot: 'bg-emerald-500', text: 'text-emerald-600' };
  }
  return { dot: 'bg-slate-300', text: 'text-slate-500' };
}

export function MmStatusDot({
  label,
  dot,
  text,
}: {
  label: string;
  dot?: string;
  text?: string;
}) {
  const tone = statusMark(label);
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot ?? tone.dot}`} />
      <span className={`text-[10px] font-bold ${text ?? tone.text}`}>{label || '—'}</span>
    </span>
  );
}
