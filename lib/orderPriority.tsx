import React from 'react';
import type { OrderPriority } from '../types';

export const ORDER_PRIORITY_OPTIONS: { value: OrderPriority; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const CHIP_STYLES: Record<OrderPriority, string> = {
  normal: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  high: 'bg-orange-50 text-orange-800 border-orange-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

const DOT_STYLES: Record<OrderPriority, string> = {
  normal: 'bg-emerald-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
};

export function orderPriorityLabel(priority: OrderPriority | undefined | null): string {
  return ORDER_PRIORITY_OPTIONS.find((o) => o.value === priority)?.label ?? 'Normal';
}

/** Small colored dot — use beside style name in lists and detail headers. */
export const OrderPriorityChip: React.FC<{
  priority?: OrderPriority | null;
  className?: string;
}> = ({ priority = 'normal', className = '' }) => {
  const p = priority ?? 'normal';
  return (
    <span
      role="img"
      aria-label={`Priority: ${orderPriorityLabel(p)}`}
      title={orderPriorityLabel(p)}
      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${DOT_STYLES[p]} ${className}`}
    />
  );
};

interface OrderPriorityChipsProps {
  value: OrderPriority;
  onChange: (value: OrderPriority) => void;
  disabled?: boolean;
}

/** Three side-by-side choice chips for order creation. */
export const OrderPriorityChips: React.FC<OrderPriorityChipsProps> = ({
  value,
  onChange,
  disabled = false,
}) => (
  <div className="flex gap-2">
    {ORDER_PRIORITY_OPTIONS.map((opt) => {
      const active = value === opt.value;
      return (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-2 py-2 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition-colors ${
            active
              ? CHIP_STYLES[opt.value]
              : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

/** Default SAM hint when planning row has no allocation SAM yet. */
export function referenceSewingSam(order: { sewingSam?: number | null; sam?: number | null }): number {
  const v = order.sewingSam ?? order.sam;
  return v != null && v > 0 ? v : 0;
}
