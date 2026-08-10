import React from 'react';
import {
  handoverDbToDisplay,
  handoverDisplayLabel,
  type HandoverDisplayStatus,
} from '../../lib/handoverStatus';

const STATUS_STYLES: Record<HandoverDisplayStatus, string> = {
  received: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_transit: 'bg-amber-50 text-amber-800 border-amber-200',
  disputed: 'bg-red-50 text-red-700 border-red-200',
  received_disputed: 'bg-red-50 text-red-700 border-red-200',
};

export function HandoverStatusBadge({ status }: { status: string | null | undefined }) {
  const display = handoverDbToDisplay(status);
  return (
    <span
      className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-semibold uppercase tracking-wide border ${STATUS_STYLES[display]}`}
    >
      {handoverDisplayLabel(display)}
    </span>
  );
}
