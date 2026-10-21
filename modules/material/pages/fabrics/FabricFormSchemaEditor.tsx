import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Input, SelectDropdown } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { AppliesToChip } from '../../components/AppliesToChip';
import { CommaSeparatedInput, joinCommaList, splitCommaList } from '../../components/OptionValuesEditor';
import { TierLockNote } from '../../components/TierLockNote';
import { EditorSplitLayout } from '../../../../components/settings/EditorSplitLayout';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from '../../../../components/settings/CatalogTablePanel';
import { useNotificationStore } from '../../../../stores';
import { useMmRequirementCatalog } from '../../lib/useMmRequirementCatalog';
import { useFabricFormSchema, rememberFabricFormSchema } from '../../lib/useFabricFormSchema';
import { saveFabricFormSchema, type MmFabricFieldTier, type MmFabricFormField, type MmFabricFormGroup } from '../../lib/mmFabricRpc';
import { buildSchemaPatch, fieldTier, slugFieldKey } from '../../lib/fabricFormSchema';
import { MmTableSaveButton } from '../../components/MmTableSaveButton';

export interface FabricFormSchemaEditorHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type ControlKind = 'dropdown' | 'input' | 'segment';
type InputKind = 'text' | 'number' | 'checkbox';

interface FieldForm {
  id: string | null;
  groupId: string | null;
  label: string;
  help: string;
  kind: ControlKind;
  input: InputKind;
  valuesText: string;
  values: string[];
  optionValues: string[];
  required: boolean;
  visible: boolean;
  appliesTo: string;
  colSpan: 1 | 2;
  seq: number;
  tier: MmFabricFieldTier;
  hasValues: boolean;
  key: string;
}

const EMPTY_FORM: FieldForm = {
  id: null,
  groupId: null,
  label: '',
  help: '',
  kind: 'input',
  input: 'text',
  valuesText: '',
  values: [],
  optionValues: [],
  required: false,
  visible: true,
  appliesTo: '',
  colSpan: 1,
  seq: 1,
  tier: 'custom',
  hasValues: false,
  key: '',
};

function cloneGroups(groups: MmFabricFormGroup[]): MmFabricFormGroup[] {
  return groups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => ({
      ...field,
      options: field.options.map((option) => ({ ...option })),
      applies_to_type_ids: field.applies_to_type_ids ? [...field.applies_to_type_ids] : null,
    })),
  }));
}

function controlOf(field: MmFabricFormField): { kind: ControlKind; input: InputKind } {
  if (field.input_type === 'segment') return { kind: 'segment', input: 'text' };
  if (field.input_type === 'select') return { kind: 'dropdown', input: 'text' };
  if (field.input_type === 'toggle') return { kind: 'input', input: 'checkbox' };
  if (field.input_type === 'number' || field.input_type === 'decimal') return { kind: 'input', input: 'number' };
  return { kind: 'input', input: 'text' };
}

function controlLabel(field: MmFabricFormField): string {
  if (field.input_type === 'segment' || field.input_type === 'select') return 'Dropdown';
  if (field.input_type === 'toggle') return 'Checkbox';
  if (field.input_type === 'number' || field.input_type === 'decimal') return 'Number';
  if (field.input_type === 'text' || field.input_type === 'textarea') return 'Text';
  return field.input_type.replaceAll('_', ' ');
}

function valueSummary(field: MmFabricFormField): string {
  if (field.input_type !== 'select' && field.input_type !== 'segment') return '—';
  return joinCommaList(field.options.map((option) => option.label || option.value)) || '—';
}

function inputKindOf(value: string): InputKind {
  if (value === 'number') return 'number';
  if (value === 'checkbox') return 'checkbox';
  return 'text';
}

function formFromField(field: MmFabricFormField): FieldForm {
  const control = controlOf(field);
  return {
    id: field.id,
    groupId: field.group_id,
    label: field.label,
    help: field.help ?? '',
    kind: control.kind,
    input: control.input,
    valuesText: joinCommaList(field.options.map((option) => option.label || option.value)),
    values: field.options.map((option) => option.label || option.value),
    optionValues: field.options.map((option) => option.value),
    required: field.required,
    visible: field.visible,
    appliesTo: field.applies_to_type_ids?.length === 1 ? field.applies_to_type_ids[0] : '',
    colSpan: field.col_span,
    seq: field.seq,
    tier: fieldTier(field),
    hasValues: Boolean(field.has_values),
    key: field.key,
  };
}

function optionsFromForm(form: FieldForm): MmFabricFormField['options'] {
  if (form.kind === 'input') return [];
  const used = new Set<number>();
  return splitCommaList(form.valuesText).map((label) => {
    const index = form.values.findIndex((prev, i) => (
      !used.has(i) && prev.trim().toLowerCase() === label.toLowerCase()
    ));
    if (index >= 0) used.add(index);
    const stable = index >= 0 ? form.optionValues[index]?.trim() : '';
    return { value: stable || label, label };
  });
}

function inputTypeFromForm(form: FieldForm, current?: MmFabricFormField['input_type']): MmFabricFormField['input_type'] {
  if (form.kind === 'dropdown') return 'select';
  if (form.kind === 'segment') return 'segment';
  if (form.input === 'checkbox') return 'toggle';
  if (form.input === 'number') return current === 'decimal' ? 'decimal' : 'number';
  return 'text';
}

function mergeField(field: MmFabricFormField, form: FieldForm): MmFabricFormField {
  const tier = fieldTier(field);
  const dropdown = form.kind === 'dropdown' || form.kind === 'segment';
  const next: MmFabricFormField = {
    ...field,
    label: form.label.trim(),
    help: form.help.trim() || null,
    seq: form.seq,
    col_span: form.colSpan,
    group_id: form.groupId || field.group_id,
    applies_to_type_ids: form.appliesTo ? [form.appliesTo] : null,
  };
  if (dropdown) next.options = optionsFromForm(form);
  if (tier === 'core') return next;
  next.required = form.required;
  next.visible = form.visible;
  if (tier === 'standard') return next;
  const options = optionsFromForm(form);
  const inputType = inputTypeFromForm(form, field.input_type);
  if (!field.has_values) {
    next.input_type = inputType;
    next.key = form.key.trim() || slugFieldKey(form.label);
    next.spec_key = next.key;
  }
  next.options = field.has_values && field.input_type !== next.input_type ? field.options : options;
  return next;
}

function applyForm(groups: MmFabricFormGroup[], form: FieldForm): MmFabricFormGroup[] {
  const label = form.label.trim();
  if (!label) return groups;
  if (form.id) {
    let moved: MmFabricFormField | null = null;
    const stripped = groups.map((group) => ({
      ...group,
      fields: group.fields.flatMap((field) => {
        if (field.id !== form.id) return [field];
        const next = mergeField(field, form);
        if (form.groupId && form.groupId !== group.id) {
          moved = next;
          return [];
        }
        return [next];
      }),
    }));
    if (!moved || !form.groupId) return stripped;
    return stripped.map((group) => (
      group.id === form.groupId ? { ...group, fields: [...group.fields, moved as MmFabricFormField] } : group
    ));
  }
  const host = groups.find((group) => group.id === form.groupId) ?? groups[0];
  if (!host) return groups;
  const key = slugFieldKey(label);
  const field: MmFabricFormField = {
    id: `new-${crypto.randomUUID()}`,
    key,
    spec_key: key,
    label,
    help: form.help.trim() || null,
    placeholder: null,
    input_type: inputTypeFromForm(form),
    options: optionsFromForm(form),
    required: form.required,
    col_span: form.colSpan,
    seq: form.seq || (host.fields.at(-1)?.seq ?? 0) + 1,
    storage: 'spec_values',
    column_name: null,
    locked_when_used: false,
    is_system: false,
    visible: form.visible,
    fabric_type_id: null,
    applies_to_type_ids: form.appliesTo ? [form.appliesTo] : null,
    tier: 'custom',
    group_id: host.id,
    has_values: false,
  };
  return groups.map((group) => group.id === host.id ? { ...group, fields: [...group.fields, field] } : group);
}

const FabricFormSchemaEditor = forwardRef<
  FabricFormSchemaEditorHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function FabricFormSchemaEditor({ onDirtyChange }, ref) {
  const { showNotification } = useNotificationStore();
  const catalog = useMmRequirementCatalog();
  const [draft, setDraft] = useState<MmFabricFormGroup[]>([]);
  const [baseline, setBaseline] = useState('');
  const [form, setForm] = useState<FieldForm>(EMPTY_FORM);
  const [savedNote, setSavedNote] = useState('');
  const { schema, loading, error, refetch } = useFabricFormSchema(true);
  const fabricTypes = catalog.data?.fabricTypes ?? [];

  useEffect(() => {
    if (!schema) return;
    const next = cloneGroups(schema.groups);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    const spec = next.find((group) => group.key === 'spec') ?? next[0];
    setForm({ ...EMPTY_FORM, groupId: spec?.id ?? null });
    setSavedNote('');
  }, [schema]);

  const formDirty = Boolean(form.label.trim() || form.help.trim());
  const dirty = (JSON.stringify(draft) !== baseline && baseline !== '') || (formDirty && !form.id);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const sections = useMemo(
    () => draft
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((group) => ({
        group,
        fields: group.fields.filter((field) => field.key !== 'image_url').slice().sort((a, b) => a.seq - b.seq),
      }))
      .filter((section) => section.fields.length > 0 || section.group.is_system),
    [draft],
  );

  function commitForm(groups: MmFabricFormGroup[]): MmFabricFormGroup[] {
    if (!form.id && !form.label.trim()) return groups;
    return applyForm(groups, form);
  }

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      if (!schema) return false;
      const nextDraft = commitForm(draft);
      const patch = buildSchemaPatch(schema, nextDraft);
      if (patch.length === 0) {
        setDraft(nextDraft);
        setForm((current) => ({ ...EMPTY_FORM, groupId: current.groupId }));
        return true;
      }
      const res = await saveFabricFormSchema(patch);
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return false;
      }
      rememberFabricFormSchema(res.data);
      const next = cloneGroups(res.data.groups);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      const spec = next.find((group) => group.key === 'spec') ?? next[0];
      setForm({ ...EMPTY_FORM, groupId: spec?.id ?? null });
      setSavedNote(`Saved · version ${res.data.schema_version}`);
      showNotification(`Saved · version ${res.data.schema_version}`, 'success');
      void refetch();
      return true;
    },
  }), [schema, draft, form, dirty, showNotification, refetch]);

  const sectionOptions = useMemo(() => (
    draft.slice().sort((a, b) => a.seq - b.seq).map((group) => ({ value: group.id, label: group.label }))
  ), [draft]);

  function setApplies(fieldId: string, next: string[] | null) {
    setDraft((groups) => groups.map((group) => ({
      ...group,
      fields: group.fields.map((field) => (
        field.id === fieldId ? { ...field, applies_to_type_ids: next } : field
      )),
    })));
  }

  function submitForm() {
    if (!form.label.trim()) return;
    if (!form.groupId) {
      showNotification('Select a section', 'error');
      return;
    }
    if ((form.kind === 'dropdown' || form.kind === 'segment') && splitCommaList(form.valuesText).length === 0) {
      showNotification('Add at least one dropdown value', 'error');
      return;
    }
    setDraft((groups) => applyForm(groups, form));
    setForm((current) => ({ ...EMPTY_FORM, groupId: current.groupId }));
  }

  function removeField(field: MmFabricFormField) {
    if (fieldTier(field) !== 'custom') return;
    if (field.has_values) {
      setDraft((groups) => groups.map((group) => ({
        ...group,
        fields: group.fields.map((row) => row.id === field.id ? { ...row, visible: false } : row),
      })));
      return;
    }
    setDraft((groups) => groups.map((group) => ({
      ...group,
      fields: group.fields.filter((row) => row.id !== field.id),
    })));
    if (form.id === field.id) setForm((current) => ({ ...EMPTY_FORM, groupId: current.groupId }));
  }

  if (loading && draft.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const typeLocked = form.tier !== 'custom' || form.hasValues;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <EditorSplitLayout
        fillHeight
        scrollable={false}
        leftScrollable
        rightScrollable
        left={(
          <DesktopWriteGate>
            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  {form.id ? <Pencil size={14} /> : <Plus size={14} />}
                  {form.id ? 'Edit field' : 'Add field'}
                </h4>
                {savedNote || error ? <p className="text-[10px] text-slate-400 mt-1">{error ?? savedNote}</p> : null}
              </div>
              <SelectDropdown
                label="Section"
                options={sectionOptions}
                value={form.groupId ?? ''}
                onChange={(value) => setForm((current) => ({ ...current, groupId: value }))}
                placeholder="Spec, construction…"
                shape="pill"
                size="compact"
              />
              <Input
                label="Label"
                placeholder="e.g. Finish, Shrinkage"
                value={form.label}
                onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && submitForm()}
              />
              <Input
                label="Help"
                placeholder="Optional hint under the field"
                value={form.help}
                onChange={(e) => setForm((current) => ({ ...current, help: e.target.value }))}
              />
              <SelectDropdown
                label="Applied to"
                options={[{ value: '', label: 'All' }, ...fabricTypes.map((type) => ({ value: type.id, label: type.name }))]}
                value={form.appliesTo}
                onChange={(value) => setForm((current) => ({ ...current, appliesTo: value }))}
                shape="pill"
                size="compact"
              />
              {form.tier === 'custom' && (
                <>
                  <SelectDropdown
                    label="Control"
                    options={[
                      { value: 'input', label: 'Input' },
                      { value: 'dropdown', label: 'Dropdown' },
                    ]}
                    value={form.kind === 'segment' ? 'dropdown' : form.kind}
                    disabled={typeLocked}
                    onChange={(value) => setForm((current) => ({
                      ...current,
                      kind: value === 'dropdown' ? 'dropdown' : 'input',
                    }))}
                    shape="pill"
                    size="compact"
                  />
                  {form.kind === 'input' && (
                    <SelectDropdown
                      label="Input type"
                      options={[
                        { value: 'text', label: 'Text' },
                        { value: 'number', label: 'Number' },
                        { value: 'checkbox', label: 'Checkbox' },
                      ]}
                      value={form.input}
                      disabled={typeLocked}
                      onChange={(value) => setForm((current) => ({ ...current, input: inputKindOf(value) }))}
                      shape="pill"
                      size="compact"
                    />
                  )}
                </>
              )}
              {(form.kind === 'dropdown' || form.kind === 'segment') && (
                <CommaSeparatedInput
                  label="Dropdown values"
                  value={form.valuesText}
                  placeholder="Solid, Yarn dyed, Printed"
                  hint="Separate values with commas."
                  rows={3}
                  maxRows={6}
                  onChange={(value) => setForm((current) => ({ ...current, valuesText: value }))}
                />
              )}
              {form.id && form.tier !== 'custom' && (
                <TierLockNote>
                  {form.tier === 'core'
                    ? 'Core field. Label and help can change. Applied to decides which fabric type shows it.'
                    : 'Built-in field. Input type stays fixed. Applied to decides which fabric type shows it.'}
                </TierLockNote>
              )}
              {form.hasValues && form.tier === 'custom' && (
                <p className="text-[10px] text-slate-400">This field already has values. Key and input type stay fixed.</p>
              )}
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  icon={form.id ? Pencil : Plus}
                  disabled={!form.label.trim()}
                  onClick={submitForm}
                  className="w-full"
                >
                  {form.id ? 'Update in table' : 'Add to table'}
                </Button>
                {form.id ? (
                  <>
                    {form.tier === 'custom' && (
                      <Button
                        variant="danger-light"
                        size="sm"
                        icon={Trash2}
                        onClick={() => {
                          const field = sections.flatMap((section) => section.fields).find((row) => row.id === form.id);
                          if (field) removeField(field);
                        }}
                        className="w-full"
                      >
                        Remove from table
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={X}
                      onClick={() => setForm((current) => ({ ...EMPTY_FORM, groupId: current.groupId }))}
                      className="w-full"
                    >
                      Cancel
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </DesktopWriteGate>
        )}
        right={(
          <div className="h-full flex flex-col min-h-0">
            <CatalogTablePanel
              title="Fabric requirement fields"
              subtitle="One form for every fabric. Click a row to edit."
              isEmpty={sections.every((section) => section.fields.length === 0)}
              emptyMessage="No fields yet."
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={['S.No', 'Label', 'Control', 'Help', 'Value', 'Applies to', '']}>
                {sections.map(({ group, fields }) => (
                  <React.Fragment key={group.id}>
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200"
                      >
                        {group.label}
                      </td>
                    </tr>
                    {fields.map((field, index) => {
                      const tier = fieldTier(field);
                      return (
                        <CatalogTableRow
                          key={field.id}
                          selected={form.id === field.id}
                          onClick={() => setForm(formFromField(field))}
                        >
                          <CatalogTableCell className={catalogSerialCellClass}>{index + 1}</CatalogTableCell>
                          <CatalogTableCell className="font-medium text-slate-800 truncate">
                            <span className="inline-flex items-center gap-1">
                              {tier !== 'custom' && <Lock size={11} className="text-slate-400 shrink-0" />}
                              {field.label}
                            </span>
                            {field.id.startsWith('new-') ? (
                              <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                            ) : null}
                            {!field.visible ? (
                              <span className="ml-2 text-[9px] font-semibold uppercase text-slate-400">Hidden</span>
                            ) : null}
                          </CatalogTableCell>
                          <CatalogTableCell className="text-slate-600">{controlLabel(field)}</CatalogTableCell>
                          <CatalogTableCell className="text-[10px] leading-tight text-slate-500 whitespace-normal max-w-[12rem]">
                            {field.help?.trim() || '—'}
                          </CatalogTableCell>
                          <CatalogTableCell className="text-[10px] leading-tight text-slate-500 whitespace-normal max-w-[14rem]">
                            {valueSummary(field)}
                          </CatalogTableCell>
                          <CatalogTableCell>
                            <AppliesToChip
                              ids={field.applies_to_type_ids}
                              types={fabricTypes.map((type) => ({ id: type.id, name: type.name }))}
                              onChange={(next) => setApplies(field.id, next)}
                            />
                          </CatalogTableCell>
                          <CatalogTableCell>
                            {tier === 'custom' && (
                              <DesktopWriteGate>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeField(field);
                                  }}
                                  className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                                  aria-label={`Remove ${field.label}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </DesktopWriteGate>
                            )}
                          </CatalogTableCell>
                        </CatalogTableRow>
                      );
                    })}
                  </React.Fragment>
                ))}
              </CatalogTable>
            </CatalogTablePanel>
          </div>
        )}
      />
    </div>
  );
});

export default FabricFormSchemaEditor;
