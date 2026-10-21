import { Input } from '../../../components/ui';

export function splitCommaList(text: string): string[] {
  return text.split(',').map((part) => part.trim()).filter(Boolean);
}

export function joinCommaList(items: string[]): string {
  return items.map((item) => item.trim()).filter(Boolean).join(', ');
}

function lineBoxHeight(lines: number): string {
  return `${lines * 1.25 + 1}rem`;
}

export function CommaSeparatedInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled = false,
  rows,
  maxRows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  /** When set, the field is a resizable box this many lines tall. */
  rows?: number;
  /** Caps how far the box can be stretched. */
  maxRows?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-600 mb-1">{label}</label>
      {rows ? (
        <textarea
          rows={rows}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{
            minHeight: lineBoxHeight(rows),
            maxHeight: lineBoxHeight(maxRows ?? 10),
          }}
          className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y text-[11px] leading-5 disabled:bg-slate-50 disabled:text-slate-400"
        />
      ) : (
        <Input
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint ? <p className="mt-1 text-[9px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
