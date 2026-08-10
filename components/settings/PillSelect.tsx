import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface PillSelectOption {
  value: string;
  label: string;
}

interface PillSelectProps {
  value: string;
  options: PillSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/** Compact pill-styled native select used in process flow rows. */
export const PillSelect: React.FC<PillSelectProps> = ({
  value,
  options,
  onChange,
  disabled,
  className = '',
  placeholder,
}) => (
  <div className={`relative inline-flex ${className}`}>
    <select
      value={value}
      disabled={disabled || options.length === 0}
      onChange={(e) => onChange(e.target.value)}
      className="appearance-none pl-3 pr-7 py-1.5 rounded-full border border-slate-200 bg-white text-[10px] font-semibold text-slate-700 hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {placeholder && (
        <option value="">{placeholder}</option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
  </div>
);

interface PillToggleGroupProps {
  value: string;
  options: PillSelectOption[];
  onChange: (value: string) => void;
}

/** Inline pill radio group for capture app (hourly / qc). */
export const PillToggleGroup: React.FC<PillToggleGroupProps> = ({ value, options, onChange }) => (
  <div className="inline-flex flex-wrap gap-1.5">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(value === o.value ? '' : o.value)}
        className={`px-2.5 py-1 rounded-full border text-[10px] font-semibold transition-colors ${
          value === o.value
            ? 'border-blue-400 bg-blue-50 text-blue-800'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);
