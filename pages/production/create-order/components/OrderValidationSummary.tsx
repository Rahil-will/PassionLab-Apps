import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface OrderValidationSummaryProps {
  errors: Record<string, string>;
}

export const OrderValidationSummary: React.FC<OrderValidationSummaryProps> = ({ errors }) => {
  const messages = Object.values(errors).filter(Boolean);
  if (messages.length === 0) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[11px] text-red-800 mb-6 flex items-start gap-2">
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <span className="font-bold">Please fix the following:</span>
        {messages.map((msg, idx) => (
          <span key={idx}>• {msg}</span>
        ))}
      </div>
    </div>
  );
};
