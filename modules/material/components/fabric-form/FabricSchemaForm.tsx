import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { compositionFromJson, compositionToInput, isFieldRequired, isFieldVisible, type FabricFormValues } from '../../lib/fabricFormSchema';
import type { MmFabricFormField, MmFabricFormGroup, MmFabricFormSchema } from '../../lib/mmFabricRpc';
import { qtyLabel, widthLabel, type QtyUnit, type WidthUnit } from '../../lib/units';
import { LockedInput, renderFabricFieldInput } from './FabricFields';

function GroupCard({
  group,
  forceOpen,
  footer,
  children,
}: {
  group: MmFabricFormGroup;
  forceOpen: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(group.default_open || !group.collapsible);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  const isOpen = !group.collapsible || open || forceOpen;
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => group.collapsible && setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left bg-slate-50 border-b border-slate-100 ${
          group.collapsible ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'
        }`}
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{group.label}</span>
        {group.collapsible && (isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />)}
      </button>
      {isOpen && (
        <>
          <div className="p-4">{children}</div>
          {footer}
        </>
      )}
    </div>
  );
}

function FieldCell({
  field,
  values,
  error,
  locked,
  lockedMsg,
  readOnly,
  fabricTypes,
  constructions,
  isConfig,
  pairCodeAndName,
  identityLayout = false,
  allowAddConstruction,
  onChange,
  onSuggestName,
  onAddConstruction,
  widthUnitText,
}: {
  field: MmFabricFormField;
  values: FabricFormValues;
  error?: string;
  locked: boolean;
  lockedMsg: string;
  readOnly: boolean;
  fabricTypes: Array<{ id: string; name: string }>;
  constructions: Array<{ id: string; name: string }>;
  isConfig: boolean;
  pairCodeAndName?: boolean;
  identityLayout?: boolean;
  allowAddConstruction?: boolean;
  onChange: (key: string, value: string) => void;
  onSuggestName?: () => void;
  onAddConstruction?: (name: string) => Promise<void>;
  widthUnitText?: string;
}) {
  const required = isFieldRequired(field, values);
  const fieldLocked = locked && field.locked_when_used;
  const disabled = readOnly || fieldLocked || field.input_type === 'auto_code';
  const rawValue = values[field.key] ?? '';
  const display = field.input_type === 'composition'
    ? (rawValue.trim().startsWith('[') ? compositionToInput(compositionFromJson(rawValue)) : rawValue)
    : field.input_type === 'select' || field.input_type === 'segment'
      ? (field.options.find((option) => option.value === rawValue)?.label ?? rawValue)
      : field.input_type === 'fabric_type'
        ? (fabricTypes.find((type) => type.id === rawValue)?.name ?? rawValue)
        : field.input_type === 'construction'
          ? (constructions.find((row) => row.id === rawValue)?.name ?? rawValue)
          : rawValue;
  const input = fieldLocked ? (
    <LockedInput title={lockedMsg}>
      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-700 pr-8">
        {display || '—'}
      </div>
    </LockedInput>
  ) : (
    renderFabricFieldInput(field, values, onChange, {
      disabled,
      fabricTypes,
      constructions,
      canAddConstruction: (allowAddConstruction ?? true) && isConfig && !readOnly,
      onAddConstruction,
      onSuggestName,
    })
  );
  const span = identityLayout && field.key === 'code'
    ? 'col-span-3'
    : identityLayout && field.key === 'name'
      ? 'col-span-7'
      : pairCodeAndName && (field.key === 'code' || field.key === 'name')
        ? 'col-span-1'
        : field.col_span === 2 ? 'col-span-2' : 'col-span-1';
  return (
    <div className={span}>
      <label className="block text-[10px] font-semibold text-slate-600 mb-1">
        {field.key === 'width_in' && widthUnitText ? `${field.label} (${widthUnitText})` : field.label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {fieldLocked && <Lock size={10} className="inline ml-1 text-amber-500" />}
      </label>
      {input}
      {field.help && field.key !== 'color_method' && !(identityLayout && field.input_type === 'auto_code') && (
        <p className="mt-1 text-[10px] text-slate-400">{field.help}</p>
      )}
      {error && <p className="mt-1 text-[10px] text-red-600">{error}</p>}
    </div>
  );
}

export function FabricSchemaForm({
  schema,
  values,
  onChange,
  errors,
  locked,
  lockedMsg,
  readOnly,
  fabricTypes,
  constructions,
  isConfig,
  pairCodeAndName = false,
  allowAddConstruction = true,
  onSuggestName,
  onAddConstruction,
  afterReference,
  widthUnitText,
  unitPick,
}: {
  schema: MmFabricFormSchema;
  values: FabricFormValues;
  onChange: (key: string, value: string) => void;
  errors: Record<string, string>;
  locked: boolean;
  lockedMsg: string;
  readOnly: boolean;
  fabricTypes: Array<{ id: string; name: string }>;
  constructions: Array<{ id: string; name: string }>;
  isConfig: boolean;
  pairCodeAndName?: boolean;
  allowAddConstruction?: boolean;
  onSuggestName?: () => void;
  onAddConstruction?: (name: string) => Promise<void>;
  afterReference?: React.ReactNode;
  widthUnitText?: string;
  unitPick?: {
    qtyOptions: QtyUnit[];
    widthOptions: WidthUnit[];
    qtyUnit: QtyUnit;
    widthUnit: WidthUnit;
    onQty: (unit: QtyUnit) => void;
    onWidth: (unit: WidthUnit) => void;
  } | null;
}) {
  const groups = schema.groups
    .filter((group) => group.visible)
    .slice()
    .sort((a, b) => a.seq - b.seq);
  const hasReference = groups.some((group) => group.key === 'reference');
  const hasIdentity = groups.some((group) => group.key === 'identity');
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const identityLayout = group.key === 'identity';
        const fields = group.fields
          .filter((field) => field.key !== 'image_url' && field.key !== 'uom' && field.column_name !== 'uom' && isFieldVisible(field, values))
          .slice()
          .sort((a, b) => a.seq - b.seq);
        if (fields.length === 0) {
          if (group.key === 'reference' && afterReference) {
            return <React.Fragment key={group.id || group.key}>{afterReference}</React.Fragment>;
          }
          return null;
        }
        const forceOpen = fields.some((field) => Boolean(errors[field.key]));
        const identityHelp = identityLayout
          ? fields.find((field) => field.input_type === 'auto_code')?.help?.trim()
          : '';
        return (
          <React.Fragment key={group.id || group.key}>
            <GroupCard
              group={group}
              forceOpen={forceOpen}
              footer={identityHelp ? (
                <p className="px-4 py-2.5 border-t border-slate-100 text-[10px] text-slate-400">
                  {identityHelp}
                </p>
              ) : null}
            >
              <div className={identityLayout ? 'grid grid-cols-10 gap-3' : 'grid grid-cols-2 gap-3'}>
                {fields.map((field) => (
                  <FieldCell
                    key={field.id || field.key}
                    field={field}
                    values={values}
                    error={errors[field.key]}
                    locked={locked}
                    lockedMsg={lockedMsg}
                    readOnly={readOnly}
                    fabricTypes={fabricTypes}
                    constructions={constructions}
                    isConfig={isConfig}
                    pairCodeAndName={pairCodeAndName}
                    identityLayout={identityLayout}
                    allowAddConstruction={allowAddConstruction}
                    onChange={onChange}
                    onSuggestName={onSuggestName}
                    onAddConstruction={onAddConstruction}
                    widthUnitText={widthUnitText}
                  />
                ))}
              </div>
            </GroupCard>
            {group.key === 'identity' && unitPick ? <FabricUnitPick pick={unitPick} /> : null}
            {group.key === 'reference' ? afterReference : null}
          </React.Fragment>
        );
      })}
      {!hasIdentity && unitPick ? <FabricUnitPick pick={unitPick} /> : null}
      {!hasReference ? afterReference : null}
    </div>
  );
}

function UnitChoice<T extends string>({
  label,
  options,
  value,
  text,
  onChange,
}: {
  label: string;
  options: T[];
  value: T;
  text: (unit: T) => string;
  onChange: (unit: T) => void;
}) {
  if (options.length <= 1) {
    const only = options[0] ?? value;
    return (
      <div>
        <p className="block text-[10px] font-semibold text-slate-600 mb-1">{label}</p>
        <span className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[12px] font-semibold text-slate-700">
          {text(only)}
        </span>
      </div>
    );
  }
  return (
    <div>
      <p className="block text-[10px] font-semibold text-slate-600 mb-1">{label}</p>
      <div className="flex rounded-lg border border-slate-300 overflow-hidden">
        {options.map((option) => {
          const on = option === value;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`flex-1 h-8 text-[11px] font-semibold ${on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {text(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FabricUnitPick({
  pick,
}: {
  pick: {
    qtyOptions: QtyUnit[];
    widthOptions: WidthUnit[];
    qtyUnit: QtyUnit;
    widthUnit: WidthUnit;
    onQty: (unit: QtyUnit) => void;
    onWidth: (unit: WidthUnit) => void;
  };
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <UnitChoice label="Qty unit" options={pick.qtyOptions} value={pick.qtyUnit} text={(unit) => qtyLabel(unit)} onChange={pick.onQty} />
      <UnitChoice label="Width unit" options={pick.widthOptions} value={pick.widthUnit} text={(unit) => widthLabel(unit)} onChange={pick.onWidth} />
    </div>
  );
}
