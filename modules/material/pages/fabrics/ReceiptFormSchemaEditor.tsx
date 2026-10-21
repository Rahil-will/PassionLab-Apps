import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Input, SelectDropdown } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
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
import { MmTableSaveButton } from '../../components/MmTableSaveButton';
import { AppliesToChip } from '../../components/AppliesToChip';
import { EditorToggle } from '../../components/EditorToggle';
import { CommaSeparatedInput, joinCommaList, splitCommaList } from '../../components/OptionValuesEditor';
import { TierLockNote } from '../../components/TierLockNote';
import {
  RECEIPT_INPUT_TYPES,
  RECEIPT_SECTIONS,
  cloneReceiptForm,
  mmGetReceiptForm,
  mmSaveReceiptForm,
  receiptFormSaveList,
  receiptInputLabel,
  type ReceiptDataType,
  type ReceiptFormField,
  type ReceiptFormSection,
  type ReceiptSectionKey,
} from '../../lib/receiptForm';

export interface ReceiptFormSchemaEditorHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

interface FieldForm {
  id: string | null;
  section: ReceiptSectionKey;
  label: string;
  help: string;
  dataType: ReceiptDataType;
  valuesText: string;
  required: boolean;
  visible: boolean;
  fabricTypeIds: string[];
  tier: ReceiptFormField['tier'];
  hasValues: boolean;
  key: string;
}

const EMPTY_FORM: FieldForm = {
  id: null,
  section: 'receipt',
  label: '',
  help: '',
  dataType: 'text',
  valuesText: '',
  required: false,
  visible: true,
  fabricTypeIds: [],
  tier: 'custom',
  hasValues: false,
  key: '',
};

function formFromField(field: ReceiptFormField): FieldForm {
  return {
    id: field.id,
    section: field.section,
    label: field.label,
    help: field.help ?? '',
    dataType: field.data_type,
    valuesText: joinCommaList(field.options),
    required: field.key === 'roll_no' ? true : field.required,
    visible: field.visible,
    fabricTypeIds: [...field.fabric_type_ids],
    tier: field.tier,
    hasValues: field.has_values,
    key: field.key,
  };
}

function optionsFrom(form: FieldForm): string[] {
  if (form.dataType !== 'select') return [];
  return splitCommaList(form.valuesText);
}

function mergeField(field: ReceiptFormField, form: FieldForm): ReceiptFormField {
  if (field.tier === 'core') return field;
  const next: ReceiptFormField = {
    ...field,
    label: form.label.trim(),
    help: form.help.trim() || null,
    required: form.required,
    fabric_type_ids: form.fabricTypeIds,
    section: field.tier === 'system' ? field.section : form.section,
  };
  if (field.tier === 'system') {
    next.visible = form.visible;
    return next;
  }
  next.visible = true;
  if (!field.has_values) {
    next.data_type = form.dataType;
    next.options = optionsFrom(form);
  } else if (field.data_type === 'select') {
    next.options = optionsFrom(form);
  }
  return next;
}

function applyForm(sections: ReceiptFormSection[], form: FieldForm): ReceiptFormSection[] {
  const label = form.label.trim();
  if (!label) return sections;
  if (form.id) {
    let moved: ReceiptFormField | null = null;
    const stripped = sections.map((section) => ({
      ...section,
      fields: section.fields.flatMap((field) => {
        if (field.id !== form.id) return [field];
        const next = mergeField(field, form);
        if (next.section !== section.key) {
          moved = next;
          return [];
        }
        return [next];
      }),
    }));
    if (!moved) return stripped;
    return stripped.map((section) => (
      section.key === form.section ? { ...section, fields: [...section.fields, moved as ReceiptFormField] } : section
    ));
  }
  const field: ReceiptFormField = {
    id: `new-${crypto.randomUUID()}`,
    section: form.section,
    key: '',
    label,
    help: form.help.trim() || null,
    data_type: form.dataType,
    options: optionsFrom(form),
    required: form.required,
    visible: true,
    tier: 'custom',
    seq: 0,
    fabric_type_ids: form.fabricTypeIds,
    fabric_types: [],
    has_values: false,
  };
  return sections.map((section) => (
    section.key === form.section ? { ...section, fields: [...section.fields, field] } : section
  ));
}

const ReceiptFormSchemaEditor = forwardRef<
  ReceiptFormSchemaEditorHandle,
  { onDirtyChange?: (dirty: boolean) => void }
>(function ReceiptFormSchemaEditor({ onDirtyChange }, ref) {
  const { showNotification } = useNotificationStore();
  const catalog = useMmRequirementCatalog();
  const [draft, setDraft] = useState<ReceiptFormSection[]>([]);
  const [baseline, setBaseline] = useState('');
  const [form, setForm] = useState<FieldForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState('');
  const fabricTypes = catalog.data?.fabricTypes ?? [];
  const typeOptions = fabricTypes.map((type) => ({ id: type.id, name: type.name }));

  useEffect(() => {
    let live = true;
    setLoading(true);
    void mmGetReceiptForm(null).then((res) => {
      if (!live) return;
      if (res.ok === false) {
        setError(res.message);
        setDraft([]);
      } else {
        const next = cloneReceiptForm(res.data).sections;
        setDraft(next);
        setBaseline(JSON.stringify(next));
        setError(null);
        setForm(EMPTY_FORM);
        setSavedNote('');
      }
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const formDirty = Boolean(form.label.trim() || form.help.trim());
  const dirty = (JSON.stringify(draft) !== baseline && baseline !== '') || (formDirty && !form.id);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const sections = useMemo(
    () => draft.map((section) => ({
      section,
      fields: section.fields,
    })),
    [draft],
  );

  function commitForm(groups: ReceiptFormSection[]): ReceiptFormSection[] {
    if (!form.id && !form.label.trim()) return groups;
    if (form.tier === 'core') return groups;
    return applyForm(groups, form);
  }

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    save: async () => {
      if (baseline === '') {
        showNotification(error ?? 'The form has not loaded', 'error');
        return false;
      }
      const nextDraft = commitForm(draft);
      const missingChoice = nextDraft.flatMap((section) => section.fields).find((field) => (
        field.tier === 'custom' && field.data_type === 'select' && field.options.length === 0
      ));
      if (missingChoice) {
        showNotification(`${missingChoice.label}: add at least one choice`, 'error');
        return false;
      }
      const res = await mmSaveReceiptForm(receiptFormSaveList(nextDraft));
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return false;
      }
      const next = cloneReceiptForm(res.data).sections;
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setForm(EMPTY_FORM);
      setSavedNote('Saved');
      showNotification('Saved', 'success');
      return true;
    },
  }), [draft, form, dirty, baseline, error, showNotification]);

  function setApplies(fieldId: string, next: string[] | null) {
    const ids = next ?? [];
    setDraft((groups) => groups.map((section) => ({
      ...section,
      fields: section.fields.map((field) => (
        field.id === fieldId && field.tier !== 'core' ? { ...field, fabric_type_ids: ids } : field
      )),
    })));
    if (form.id === fieldId && form.tier !== 'core') {
      setForm((current) => ({ ...current, fabricTypeIds: ids }));
    }
  }

  function submitForm() {
    if (form.tier === 'core') return;
    if (!form.label.trim()) return;
    if (form.dataType === 'select' && form.tier === 'custom' && splitCommaList(form.valuesText).length === 0) {
      showNotification('Add at least one dropdown value', 'error');
      return;
    }
    setDraft((groups) => applyForm(groups, form));
    setForm(EMPTY_FORM);
  }

  function removeField(field: ReceiptFormField) {
    if (field.tier !== 'custom') return;
    setDraft((groups) => groups.map((section) => ({
      ...section,
      fields: section.fields.filter((row) => row.id !== field.id),
    })));
    if (form.id === field.id) setForm(EMPTY_FORM);
  }

  if (loading && draft.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const coreLocked = form.tier === 'core';
  const typeLocked = form.tier !== 'custom' || form.hasValues;
  const sectionLocked = form.tier !== 'custom';

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
              {form.section === 'fabric' ? (
                <Input label="Section" value="Fabric information" disabled />
              ) : (
                <SelectDropdown
                  label="Section"
                  options={RECEIPT_SECTIONS.map((section) => ({ value: section.value, label: section.label }))}
                  value={form.section}
                  disabled={sectionLocked && Boolean(form.id)}
                  onChange={(value) => setForm((current) => ({
                    ...current,
                    section: value === 'roll' ? 'roll' : 'receipt',
                  }))}
                  shape="pill"
                  size="compact"
                />
              )}
              <Input
                label="Label"
                placeholder="e.g. Truck no, Finish"
                value={form.label}
                disabled={coreLocked}
                onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && submitForm()}
              />
              <Input
                label="Help"
                placeholder="Optional hint under the field"
                value={form.help}
                disabled={coreLocked}
                onChange={(e) => setForm((current) => ({ ...current, help: e.target.value }))}
              />
              {form.key === 'roll_no' ? (
                <Input label="Input type" value="Auto" disabled />
              ) : (
                <SelectDropdown
                  label="Input type"
                  options={RECEIPT_INPUT_TYPES.map((row) => ({ value: row.value, label: row.label }))}
                  value={form.dataType}
                  disabled={typeLocked && Boolean(form.id)}
                  onChange={(value) => setForm((current) => ({
                    ...current,
                    dataType: RECEIPT_INPUT_TYPES.some((row) => row.value === value) ? value as ReceiptDataType : 'text',
                  }))}
                  shape="pill"
                  size="compact"
                />
              )}
              {form.dataType === 'select' && form.tier === 'custom' && (
                <CommaSeparatedInput
                  label="Dropdown values"
                  value={form.valuesText}
                  disabled={coreLocked}
                  placeholder="Solid, Yarn dyed, Printed"
                  hint="Separate values with commas."
                  rows={3}
                  maxRows={6}
                  onChange={(value) => setForm((current) => ({ ...current, valuesText: value }))}
                />
              )}
              <SelectDropdown
                label="Applied to"
                options={[
                  { value: '', label: 'All' },
                  ...(form.fabricTypeIds.length > 1
                    ? [{
                      value: '__keep__',
                      label: fabricTypes
                        .filter((type) => form.fabricTypeIds.includes(type.id))
                        .map((type) => type.name)
                        .join(', ') || 'Several types',
                    }]
                    : []),
                  ...fabricTypes.map((type) => ({ value: type.id, label: type.name })),
                ]}
                value={form.fabricTypeIds.length > 1 ? '__keep__' : (form.fabricTypeIds[0] ?? '')}
                disabled={coreLocked}
                onChange={(value) => {
                  if (value === '__keep__') return;
                  setForm((current) => ({ ...current, fabricTypeIds: value ? [value] : [] }));
                }}
                shape="pill"
                size="compact"
              />
              <EditorToggle
                label="Required"
                on={form.key === 'roll_no' || form.required}
                disabled={coreLocked || form.key === 'roll_no'}
                onChange={(required) => setForm((current) => ({ ...current, required }))}
              />
              {form.tier === 'system' && (
                <EditorToggle
                  label="Show"
                  on={form.visible}
                  onChange={(visible) => setForm((current) => ({ ...current, visible }))}
                />
              )}
              {form.id && form.tier === 'core' && (
                <TierLockNote>Locked — always on the receive page</TierLockNote>
              )}
              {form.id && form.tier === 'system' && (
                <TierLockNote>Section and input type stay fixed.</TierLockNote>
              )}
              {form.hasValues && form.tier === 'custom' && (
                <p className="text-[10px] text-slate-400">This field already has values. Input type stays fixed.</p>
              )}
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  icon={form.id ? Pencil : Plus}
                  disabled={coreLocked || !form.label.trim()}
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
                      onClick={() => setForm(EMPTY_FORM)}
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
              title="Fabric receiving fields"
              subtitle="One form for every fabric type. Click a row to edit."
              isEmpty={sections.every((section) => section.fields.length === 0)}
              emptyMessage="No fields yet."
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={['S.No', 'Label', 'Input', 'Value', 'Required', 'Applies to', '']}>
                {sections.map(({ section, fields }) => (
                  <React.Fragment key={section.key}>
                    <tr>
                      <td
                        colSpan={7}
                        className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {section.key === 'fabric' ? <Lock size={11} className="text-slate-400" /> : null}
                          {section.label}
                          {section.key === 'fabric' ? (
                            <span className="font-medium normal-case tracking-normal text-slate-400">Fixed</span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                    {fields.map((field, index) => (
                      <CatalogTableRow
                        key={field.id}
                        selected={form.id === field.id}
                        onClick={() => setForm(formFromField(field))}
                      >
                        <CatalogTableCell className={catalogSerialCellClass}>{index + 1}</CatalogTableCell>
                        <CatalogTableCell className="font-medium text-slate-800 truncate">
                          <span className="inline-flex items-center gap-1">
                            {field.tier !== 'custom' && <Lock size={11} className="text-slate-400 shrink-0" />}
                            {field.label}
                          </span>
                          {field.id.startsWith('new-') ? (
                            <span className="ml-2 text-[9px] font-semibold uppercase text-amber-600">New</span>
                          ) : null}
                          {!field.visible ? (
                            <span className="ml-2 text-[9px] font-semibold uppercase text-slate-400">Hidden</span>
                          ) : null}
                        </CatalogTableCell>
                        <CatalogTableCell className="text-slate-600">{receiptInputLabel(field.data_type, field.key)}</CatalogTableCell>
                        <CatalogTableCell className="text-[10px] leading-tight text-slate-500 whitespace-normal max-w-[14rem]">
                          {field.data_type === 'select' ? (joinCommaList(field.options) || '—') : '—'}
                        </CatalogTableCell>
                        <CatalogTableCell className="text-slate-600">{field.key === 'roll_no' || field.required ? 'Yes' : 'No'}</CatalogTableCell>
                        <CatalogTableCell>
                          <AppliesToChip
                            ids={field.fabric_type_ids.length === 0 ? null : field.fabric_type_ids}
                            types={typeOptions}
                            disabled={field.tier === 'core'}
                            onChange={(next) => setApplies(field.id, next)}
                          />
                        </CatalogTableCell>
                        <CatalogTableCell>
                          {field.tier === 'custom' && (
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
                    ))}
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

export default ReceiptFormSchemaEditor;
