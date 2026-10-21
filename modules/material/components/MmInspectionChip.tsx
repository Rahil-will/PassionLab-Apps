import React from 'react';
import { rollInspectionChip } from '../lib/inspAlloc';
import type { MmRollPassportInspection } from '../lib/mmV4Rpc';

const TONE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  default: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function MmInspectionChip({ inspection }: {
  inspection?: MmRollPassportInspection | null;
}) {
  const chip = rollInspectionChip({ inspection });
  if (chip.label === '—') return <span>—</span>;
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${TONE[chip.tone]}`}>
      {chip.label}
    </span>
  );
}
