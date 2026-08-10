import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '../ui';
import { DesktopWriteGate } from '../DesktopWriteGate';

interface ShipmentDropdownChipsProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  chipClassName?: string;
  placeholder?: string;
}

/** Inline chip list (like workforce categories on departments). */
export function ShipmentDropdownChips({
  label,
  values,
  onChange,
  chipClassName = 'bg-sky-100 text-sky-800 border-sky-200',
  placeholder = 'Add option',
}: ShipmentDropdownChipsProps) {
  const [draft, setDraft] = useState('');

  const addValue = () => {
    const trimmed = draft.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((val, idx) => (
          <div
            key={`${val}-${idx}`}
            className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-xs font-medium ${chipClassName}`}
          >
            <span>{val}</span>
            <DesktopWriteGate>
            <button
              type="button"
              onClick={() => onChange(values.filter((_, i) => i !== idx))}
              className="opacity-60 hover:opacity-100"
              aria-label={`Remove ${val}`}
            >
              <X size={12} />
            </button>
            </DesktopWriteGate>
          </div>
        ))}
        {values.length === 0 && (
          <span className="text-[10px] text-slate-400 italic py-1">No options yet</span>
        )}
      </div>
      <DesktopWriteGate>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
          className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
        />
        <Button size="sm" variant="secondary" icon={Plus} onClick={addValue} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      </DesktopWriteGate>
    </div>
  );
}
