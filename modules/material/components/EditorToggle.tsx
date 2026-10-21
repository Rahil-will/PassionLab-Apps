import { tokens } from '../../../lib/designTokens';

export function EditorToggle({
  label,
  on,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="min-w-0">
        <span className="block font-medium text-slate-700" style={{ fontSize: tokens.fontSize.body }}>{label}</span>
        {hint ? <span className="block font-normal text-slate-500 mt-0.5" style={{ fontSize: tokens.fontSize.bodySmall }}>{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:pointer-events-none ${on ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            on ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
