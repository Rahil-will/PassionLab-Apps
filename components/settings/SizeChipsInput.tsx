import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '../ui';

const SIZE_PRESETS: Array<{ label: string; sizes: string[] }> = [
  { label: 'S–XL', sizes: ['S', 'M', 'L', 'XL'] },
  { label: 'XS–XXL', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { label: '1–5', sizes: ['1', '2', '3', '4', '5'] },
];

function parseSizeTokens(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface SizeChipsInputProps {
  sizes: string[];
  onChange: (sizes: string[]) => void;
}

/** One-size-at-a-time chip entry for buyer size groups (no comma typing required). */
export function SizeChipsInput({ sizes, onChange }: SizeChipsInputProps) {
  const [draft, setDraft] = useState('');

  const addTokens = (tokens: string[]) => {
    if (tokens.length === 0) return;
    const seen = new Set(sizes.map((s) => s.toLowerCase()));
    const next = [...sizes];
    for (const token of tokens) {
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(token);
    }
    if (next.length !== sizes.length) onChange(next);
  };

  const addDraft = () => {
    const tokens = parseSizeTokens(draft);
    if (tokens.length === 0) return;
    addTokens(tokens);
    setDraft('');
  };

  const applyPreset = (presetSizes: string[]) => {
    addTokens(presetSizes);
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Sizes</p>

      <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
        {sizes.map((size, idx) => (
          <div
            key={`${size}-${idx}`}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-mono font-semibold text-slate-700"
          >
            <span>{size}</span>
            <button
              type="button"
              onClick={() => onChange(sizes.filter((_, i) => i !== idx))}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={`Remove size ${size}`}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        {sizes.length === 0 && (
          <span className="text-[10px] text-slate-400 italic py-1">
            Add sizes one by one, or use a quick set below
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
          placeholder="Type a size (e.g. M) and press Enter"
          className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
          aria-label="Add size"
        />
        <Button size="sm" variant="secondary" icon={Plus} onClick={addDraft} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
          Quick set
        </span>
        {SIZE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset.sizes)}
            className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            title={`Add ${preset.sizes.join(', ')}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
