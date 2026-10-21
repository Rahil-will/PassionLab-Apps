import React from 'react';

export function MmSegmentControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex items-stretch rounded-lg border border-slate-200 bg-white p-0.5 shrink-0">
      {options.map((opt) => {
        const on = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`px-3 py-1.5 text-[11px] font-semibold rounded-md whitespace-nowrap ${
              on ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
