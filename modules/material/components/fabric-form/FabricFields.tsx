import React, { useState } from 'react';
import { Lock, Plus, Sparkles, X } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { SelectDropdown } from '../../../../components/ui';
import type { FabricFormValues } from '../../lib/fabricFormSchema';
import type { MmFabricFieldOption, MmFabricFormField } from '../../lib/mmFabricRpc';

export const fieldInputCls =
  'w-full bg-white border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 rounded-lg px-3 py-2 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400';

const warnedTypes = new Set<string>();

export function warnUnknownInputType(inputType: string) {
  if (warnedTypes.has(inputType)) return;
  warnedTypes.add(inputType);
  console.warn(`Unknown fabric form input_type "${inputType}". Rendering as text.`);
}

export function LockedInput({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="relative group">
      {children}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
        <Lock size={13} className="text-amber-500" aria-label={title} />
      </div>
      <div className="absolute bottom-full right-0 mb-1 px-2 py-1 rounded bg-amber-50 border border-amber-200 text-[9px] text-amber-700 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none shadow-sm">
        {title}
      </div>
    </div>
  );
}

function ReadOnlyValue({ value }: { value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-700 pr-8">
      {value || '—'}
    </div>
  );
}

export function AutoCodeField({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 text-[10px] font-mono font-semibold text-slate-600">
      {value || 'Auto'}
    </span>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  onSuggest,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | null;
  disabled?: boolean;
  onSuggest?: () => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? ''}
        className={fieldInputCls}
      />
      {onSuggest && !disabled && (
        <button
          type="button"
          onClick={onSuggest}
          title="Suggest name from spec"
          className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-blue-600 shrink-0"
        >
          <Sparkles size={14} />
        </button>
      )}
    </div>
  );
}

export function TextareaField({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | null;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder ?? ''}
      rows={3}
      className={`${fieldInputCls} resize-y min-h-[5rem]`}
    />
  );
}

export function ImageUrlField({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? 'https://'}
        className={fieldInputCls}
      />
      {value.trim() && (
        <img src={value} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
      )}
    </div>
  );
}

export function DecimalField({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | null;
  disabled?: boolean;
}) {
  return (
    <input
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder ?? ''}
      className={`${fieldInputCls} text-right`}
    />
  );
}

export function NumberField(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | null;
  disabled?: boolean;
}) {
  return <DecimalField {...props} />;
}

export function SelectField({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: MmFabricFieldOption[];
  disabled?: boolean;
}) {
  return (
    <SelectDropdown
      options={[{ value: '', label: 'Select…' }, ...options.map((option) => ({ value: option.value, label: option.label }))]}
      value={value}
      onChange={onChange}
      disabled={disabled}
      shape="pill"
      size="compact"
      label=""
    />
  );
}

export function ToggleField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const on = value === 'true';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(on ? 'false' : 'true')}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-blue-600' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'left-5' : 'left-0.5'}`} />
    </button>
  );
}

export function FabricTypeField({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  disabled?: boolean;
}) {
  return (
    <SelectDropdown
      options={[{ value: '', label: 'Select type…' }, ...options.map((option) => ({ value: option.id, label: option.name }))]}
      value={value}
      onChange={onChange}
      disabled={disabled}
      shape="pill"
      size="compact"
      label=""
    />
  );
}

export function ConstructionField({
  value,
  onChange,
  options,
  disabled,
  canAdd,
  onAdd,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  disabled?: boolean;
  canAdd?: boolean;
  onAdd?: (name: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-2">
      <SelectDropdown
        options={[{ value: '', label: 'Select construction…' }, ...options.map((option) => ({ value: option.id, label: option.name }))]}
        value={value}
        onChange={onChange}
        disabled={disabled || options.length === 0 && !value}
        shape="pill"
        size="compact"
        label=""
      />
      {canAdd && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-[10px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <Plus size={11} /> Add construction
        </button>
      )}
      {adding && (
        <div className="flex gap-2 items-center">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Construction name"
            className="flex-1 bg-white border border-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 rounded-lg px-3 py-1.5 text-[11px] text-slate-900 placeholder-slate-400 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false);
                setName('');
              }
            }}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim() || saving}
            onClick={() => {
              if (!onAdd) return;
              setSaving(true);
              void onAdd(name.trim()).finally(() => {
                setSaving(false);
                setAdding(false);
                setName('');
              });
            }}
          >
            Add
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setName(''); }}>
            <X size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}

export function renderFabricFieldInput(
  field: MmFabricFormField,
  values: FabricFormValues,
  onChange: (key: string, value: string) => void,
  ctx: {
    disabled: boolean;
    fabricTypes: Array<{ id: string; name: string }>;
    constructions: Array<{ id: string; name: string }>;
    canAddConstruction: boolean;
    onAddConstruction?: (name: string) => Promise<void>;
    onSuggestName?: () => void;
  },
) {
  const value = values[field.key] ?? '';
  const set = (next: string) => onChange(field.key, next);
  switch (field.input_type) {
    case 'auto_code':
      return <AutoCodeField value={value} />;
    case 'text':
      if (field.key === 'name') {
        return (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-700">
            {value || 'Fills from construction, composition, GSM and full width'}
          </div>
        );
      }
      return (
        <TextField
          value={value}
          onChange={set}
          placeholder={field.placeholder}
          disabled={ctx.disabled}
        />
      );
    case 'textarea':
      return <TextareaField value={value} onChange={set} placeholder={field.placeholder} disabled={ctx.disabled} />;
    case 'image_url':
      return <ImageUrlField value={value} onChange={set} placeholder={field.placeholder} disabled={ctx.disabled} />;
    case 'decimal':
      return <DecimalField value={value} onChange={set} placeholder={field.placeholder} disabled={ctx.disabled} />;
    case 'number':
      return <NumberField value={value} onChange={set} placeholder={field.placeholder} disabled={ctx.disabled} />;
    case 'segment':
    case 'select':
      return <SelectField value={value} onChange={set} options={field.options} disabled={ctx.disabled} />;
    case 'toggle':
      return <ToggleField value={value} onChange={set} disabled={ctx.disabled} />;
    case 'fabric_type':
      return <FabricTypeField value={value} onChange={set} options={ctx.fabricTypes} disabled={ctx.disabled} />;
    case 'construction':
      return (
        <ConstructionField
          value={value}
          onChange={set}
          options={ctx.constructions}
          disabled={ctx.disabled || !values.fabric_type}
          canAdd={ctx.canAddConstruction && Boolean(values.fabric_type)}
          onAdd={ctx.onAddConstruction}
        />
      );
    case 'composition':
      return (
        <TextField
          value={value}
          onChange={set}
          placeholder={field.placeholder ?? 'Cotton, elastane'}
          disabled={ctx.disabled}
        />
      );
    default:
      warnUnknownInputType(field.input_type);
      return <TextField value={value} onChange={set} placeholder={field.placeholder} disabled={ctx.disabled} />;
  }
}
