import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface OrderValidationSummaryProps {
  errors: Record<string, string>;
  warnings?: string[];
}

export const OrderValidationSummary: React.FC<OrderValidationSummaryProps> = ({ errors, warnings }) => {
  const messages = Object.values(errors).filter(Boolean);
  const hasErrors = messages.length > 0;
  const hasWarnings = Boolean(warnings && warnings.length > 0);
  if (!hasErrors && !hasWarnings) return null;
  return (
    <div className="flex flex-col gap-2">
      {hasErrors && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[11px] text-red-800 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-bold">Please fix the following:</span>
            {messages.map((msg, idx) => (
              <span key={idx}>• {msg}</span>
            ))}
          </div>
        </div>
      )}
      {hasWarnings && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="font-bold">Please note:</span>
            {(warnings ?? []).map((msg, idx) => (
              <span key={idx}>• {msg}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
