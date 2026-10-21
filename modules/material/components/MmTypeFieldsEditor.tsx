import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { Button, Input, SelectDropdown } from '../../../components/ui';
import { EditorSplitLayout } from '../../../components/settings/EditorSplitLayout';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from '../../../components/settings/CatalogTablePanel';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { EditorToggle } from './EditorToggle';
import { MmTableSaveButton } from './MmTableSaveButton';

export const MM_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
] as const;

export type MmToleranceMode = 'pm' | 'range';
export type MmToleranceUnit = 'abs' | 'pct';

export interface MmFieldRow {
  localId: string;
  id: string | null;
  rowVersion: number;
  label: string;
  dataType: string;
  options: string[];
  remarks: string;
  captureSite: string;
  toleranceOn?: boolean;
  toleranceMode?: MmToleranceMode;
  /** ± value when mode is pm. */
  tolerance?: number | null;
  toleranceUnit?: MmToleranceUnit;
  toleranceTarget?: number | null;
  toleranceMin?: number | null;
  toleranceMax?: number | null;
  /** Server text such as "± 5%". */
  toleranceText?: string;
}

export interface MmTypeOption {
  id: string;
  name: string;
}

export interface MmTypeFieldsHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

interface MmTypeFieldsEditorProps {
  types: MmTypeOption[];
  savedRows: (typeId: string) => MmFieldRow[];
  persist: (typeId: string, rows: MmFieldRow[]) => Promise<void>;
  fieldNoun: string;
  tableSubtitle: string;
  namePlaceholder: string;
  /** Testing keeps Input + dropdown chips. Requirement uses remarks only. */
  variant: 'test' | 'requirement';
  onError?: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void | Promise<void>;
}

const blankForm = {
  label: '',
  dataType: 'text',
  options: [] as string[],
  remarks: '',
  captureSite: 'either',
  toleranceOn: false,
  toleranceMode: 'pm' as MmToleranceMode,
  tolerance: '',
  toleranceUnit: 'abs' as MmToleranceUnit,
  toleranceTarget: '',
  toleranceMin: '',
  toleranceMax: '',
  editingLocalId: null as string | null,
};

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function toleranceFields(form: typeof blankForm): Pick<
  MmFieldRow,
  'toleranceOn' | 'toleranceMode' | 'tolerance' | 'toleranceUnit' | 'toleranceTarget' | 'toleranceMin' | 'toleranceMax'
> {
  const on = numericInput(form.dataType) && form.toleranceOn;
  if (!on) {
    return {
      toleranceOn: false,
      toleranceMode: 'pm',
      tolerance: null,
      toleranceUnit: 'abs',
      toleranceTarget: null,
      toleranceMin: null,
      toleranceMax: null,
    };
  }
  const range = form.toleranceMode === 'range';
  return {
    toleranceOn: true,
    toleranceMode: range ? 'range' : 'pm',
    tolerance: range ? null : optionalNumber(form.tolerance),
    toleranceUnit: form.toleranceUnit === 'pct' ? 'pct' : 'abs',
    toleranceTarget: null,
    toleranceMin: range ? optionalNumber(form.toleranceMin) : null,
    toleranceMax: range ? optionalNumber(form.toleranceMax) : null,
  };
}

function tolerancePreview(row: MmFieldRow): string {
  const server = (row.toleranceText ?? '').trim();
  if (server) return server;
  if (!row.toleranceOn) return '';
  if (row.toleranceMode === 'range') {
    if (row.toleranceMin != null && row.toleranceMax != null) return `${row.toleranceMin}–${row.toleranceMax}`;
    if (row.toleranceMax != null) return `≤ ${row.toleranceMax}`;
    if (row.toleranceMin != null) return `≥ ${row.toleranceMin}`;
    return '';
  }
  if (row.tolerance == null) return '';
  return row.toleranceUnit === 'pct' ? `± ${row.tolerance}%` : `± ${row.tolerance}`;
}

function numericInput(dataType: string): boolean {
  return dataType === 'number' || dataType === 'decimal';
}

function mergeOptionDraft(current: string[], draft: string): string[] {
  const trimmed = draft.trim();
  if (!trimmed) return current;
  if (current.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return current;
  return [...current, trimmed];
}

export const MmTypeFieldsEditor = forwardRef<MmTypeFieldsHandle, MmTypeFieldsEditorProps>(
  function MmTypeFieldsEditor(
    {
      types,
      savedRows,
      persist,
      fieldNoun,
      tableSubtitle,
      namePlaceholder,
      variant,
      onError,
      onDirtyChange,
      onSaved,
    },
    ref,
  ) {
    const [typeId, setTypeId] = useState(types[0]?.id ?? '');
    const [drafts, setDrafts] = useState<Record<string, MmFieldRow[]>>({});
    const [form, setForm] = useState(blankForm);
    const [optionDraft, setOptionDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const optionInputWrapRef = useRef<HTMLDivElement>(null);
    const pendingFocusOptions = useRef(false);

    const activeTypeId = types.some((t) => t.id === typeId) ? typeId : (types[0]?.id ?? '');
    const selectedType = types.find((t) => t.id === activeTypeId) ?? null;
    const rows = drafts[activeTypeId] ?? savedRows(activeTypeId);
    const isTest = variant === 'test';
    const showOptionForm = isTest && form.dataType === 'select';

    const focusOptionInput = () => {
      requestAnimationFrame(() => {
        optionInputWrapRef.current?.querySelector('input')?.focus();
      });
    };

    useEffect(() => {
      if (!showOptionForm || !pendingFocusOptions.current) return;
      pendingFocusOptions.current = false;
      const id = window.setTimeout(() => {
        optionInputWrapRef.current?.querySelector('input')?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }, [showOptionForm]);

    const dirtyTypeIds = useMemo(
      () =>
        Object.keys(drafts).filter(
          (id) => JSON.stringify(drafts[id]) !== JSON.stringify(savedRows(id)),
        ),
      [drafts, savedRows],
    );

    const formDirty = Boolean(
      form.label.trim() || form.remarks.trim() || form.options.length || optionDraft.trim()
      || form.toleranceOn || form.tolerance.trim() || form.toleranceTarget.trim()
      || form.toleranceMin.trim() || form.toleranceMax.trim(),
    );

    useEffect(() => {
      onDirtyChange?.(dirtyTypeIds.length > 0 || formDirty);
    }, [dirtyTypeIds, formDirty, onDirtyChange]);

    const setRows = (next: MmFieldRow[]) => {
      setDrafts({ ...drafts, [activeTypeId]: next });
    };

    const resetForm = () => {
      setForm(blankForm);
      setOptionDraft('');
    };

    const addOption = () => {
      const next = mergeOptionDraft(form.options, optionDraft);
      if (next === form.options && optionDraft.trim()) {
        onError?.('That option is already added');
        focusOptionInput();
        return;
      }
      if (next === form.options) {
        focusOptionInput();
        return;
      }
      setForm({ ...form, options: next });
      setOptionDraft('');
      focusOptionInput();
    };

    const submitForm = () => {
      const label = form.label.trim();
      if (!label) return;
      if (isTest && label.toLowerCase() === 'shade') {
        onError?.('Shade is set on the roll, not a testing parameter.');
        return;
      }
      if (rows.some((r) => r.localId !== form.editingLocalId && r.label.toLowerCase() === label.toLowerCase())) {
        onError?.(`That ${fieldNoun.toLowerCase()} already exists`);
        return;
      }
      const options = isTest && form.dataType === 'select' ? mergeOptionDraft(form.options, optionDraft) : [];
      const dataType = isTest ? form.dataType : 'text';
      const remarks = isTest ? '' : form.remarks.trim();
      const tolerance = toleranceFields(form);

      if (form.editingLocalId) {
        setRows(
          rows.map((r) =>
            r.localId === form.editingLocalId
              ? {
                ...r,
                label,
                dataType,
                options,
                remarks,
                captureSite: 'either',
                toleranceText: '',
                ...tolerance,
              }
              : r,
          ),
        );
      } else {
        setRows([
          ...rows,
          {
            localId: `tmp_${crypto.randomUUID()}`,
            id: null,
            rowVersion: 1,
            label,
            dataType,
            options,
            remarks,
            captureSite: 'either',
            toleranceText: '',
            ...tolerance,
          },
        ]);
      }
      resetForm();
    };

    const editRow = (row: MmFieldRow) => {
      setForm({
        label: row.label,
        dataType: row.dataType,
        options: row.options,
        remarks: row.remarks,
        captureSite: 'either',
        toleranceOn: row.toleranceOn === true,
        toleranceMode: row.toleranceMode === 'range' ? 'range' : 'pm',
        tolerance: row.tolerance != null && Number.isFinite(row.tolerance) ? String(row.tolerance) : '',
        toleranceUnit: row.toleranceUnit === 'pct' ? 'pct' : 'abs',
        toleranceTarget: row.toleranceTarget != null && Number.isFinite(row.toleranceTarget) ? String(row.toleranceTarget) : '',
        toleranceMin: row.toleranceMin != null && Number.isFinite(row.toleranceMin) ? String(row.toleranceMin) : '',
        toleranceMax: row.toleranceMax != null && Number.isFinite(row.toleranceMax) ? String(row.toleranceMax) : '',
        editingLocalId: row.localId,
      });
      setOptionDraft('');
    };

    const removeRow = (row: MmFieldRow) => {
      setRows(rows.filter((r) => r.localId !== row.localId));
      if (form.editingLocalId === row.localId) resetForm();
    };

    useImperativeHandle(ref, () => ({
      isDirty: () => dirtyTypeIds.length > 0 || formDirty,
      save: async () => {
        let nextDrafts = { ...drafts };
        const pendingLabel = form.label.trim();
        if (!pendingLabel && (form.remarks.trim() || form.options.length > 0 || optionDraft.trim())) {
          onError?.(`Enter a ${fieldNoun.toLowerCase()} name before saving`);
          return false;
        }
        if (pendingLabel && activeTypeId) {
          if (isTest && pendingLabel.toLowerCase() === 'shade') {
            onError?.('Shade is set on the roll, not a testing parameter.');
            return false;
          }
          if (rows.some((r) => r.localId !== form.editingLocalId && r.label.toLowerCase() === pendingLabel.toLowerCase())) {
            onError?.(`That ${fieldNoun.toLowerCase()} already exists`);
            return false;
          }
          const options = isTest && form.dataType === 'select' ? mergeOptionDraft(form.options, optionDraft) : [];
          const dataType = isTest ? form.dataType : 'text';
          const remarks = isTest ? '' : form.remarks.trim();
          const tolerance = toleranceFields(form);
          const current = nextDrafts[activeTypeId] ?? savedRows(activeTypeId);
          const nextRows = form.editingLocalId
            ? current.map((r) => (r.localId === form.editingLocalId
              ? {
                ...r,
                label: pendingLabel,
                dataType,
                options,
                remarks,
                captureSite: 'either',
                toleranceText: '',
                ...tolerance,
              }
              : r))
            : [...current, {
              localId: `tmp_${crypto.randomUUID()}`,
              id: null,
              rowVersion: 1,
              label: pendingLabel,
              dataType,
              options,
              remarks,
              captureSite: 'either',
              toleranceText: '',
              ...tolerance,
            }];
          nextDrafts = { ...nextDrafts, [activeTypeId]: nextRows };
          setDrafts(nextDrafts);
        }
        const toPersist = Object.keys(nextDrafts).filter(
          (id) => JSON.stringify(nextDrafts[id]) !== JSON.stringify(savedRows(id)),
        );
        if (toPersist.length === 0) {
          resetForm();
          onDirtyChange?.(false);
          return true;
        }
        setSaving(true);
        try {
          for (const id of toPersist) {
            await persist(id, nextDrafts[id] ?? savedRows(id));
          }
          await onSaved?.();
          setDrafts({});
          resetForm();
          onDirtyChange?.(false);
          return true;
        } catch (e) {
          onError?.(e instanceof Error ? e.message : 'Save failed');
          return false;
        } finally {
          setSaving(false);
        }
      },
    }), [dirtyTypeIds, formDirty, drafts, persist, savedRows, onDirtyChange, onError, onSaved, form, optionDraft, activeTypeId, rows, isTest, fieldNoun]);

    const tableHeaders = isTest
      ? ['S.No', fieldNoun, 'Input', 'Options']
      : ['S.No', fieldNoun, 'Remarks'];

    return (
      <EditorSplitLayout
        scrollable={false}
        leftScrollable
        rightScrollable
        fillHeight
        left={(
          <div className="space-y-4">
            <SelectDropdown size="compact"
              label="Fabric type"
              value={activeTypeId}
              onChange={(v) => {
                setTypeId(v);
                resetForm();
              }}
              options={types.map((t) => ({ value: t.id, label: t.name }))}
              className="w-full"
            />

            <DesktopWriteGate>
              <div className="space-y-3 border-t border-slate-200 pt-4">
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  {form.editingLocalId ? <Pencil size={14} /> : <Plus size={14} />}
                  {form.editingLocalId ? `Edit ${fieldNoun.toLowerCase()}` : `Add ${fieldNoun.toLowerCase()}`}
                </h4>
                <Input
                  label={`${fieldNoun} name`}
                  placeholder={namePlaceholder}
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && submitForm()}
                />
                {isTest ? (
                  <>
                    <SelectDropdown size="compact"
                      label="Input"
                      value={form.dataType}
                      onChange={(v) => {
                        setForm({ ...form, dataType: v });
                        if (v !== 'select') setOptionDraft('');
                        else pendingFocusOptions.current = true;
                      }}
                      options={MM_FIELD_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                      className="w-full"
                    />
                    {numericInput(form.dataType) ? (
                      <div className="space-y-2">
                        <EditorToggle
                          label="Tolerance"
                          on={form.toleranceOn}
                          onChange={(toleranceOn) => setForm({ ...form, toleranceOn })}
                        />
                        {form.toleranceOn ? (
                          <div className="space-y-2">
                            <div className="flex rounded-full border border-slate-200 overflow-hidden w-fit">
                              <button
                                type="button"
                                className={`px-3 py-1 text-[11px] font-semibold ${form.toleranceMode !== 'range' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}
                                onClick={() => setForm({ ...form, toleranceMode: 'pm' })}
                              >
                                ± around fabric spec
                              </button>
                              <button
                                type="button"
                                className={`px-3 py-1 text-[11px] font-semibold ${form.toleranceMode === 'range' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}
                                onClick={() => setForm({ ...form, toleranceMode: 'range' })}
                              >
                                Range
                              </button>
                            </div>
                            {form.toleranceMode === 'range' ? (
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  label="Min"
                                  type="number"
                                  value={form.toleranceMin}
                                  onChange={(e) => setForm({ ...form, toleranceMin: e.target.value })}
                                />
                                <Input
                                  label="Max"
                                  type="number"
                                  value={form.toleranceMax}
                                  onChange={(e) => setForm({ ...form, toleranceMax: e.target.value })}
                                />
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="flex items-end gap-2">
                                  <Input
                                    label="±"
                                    type="number"
                                    value={form.tolerance}
                                    onChange={(e) => setForm({ ...form, tolerance: e.target.value })}
                                    className="flex-1"
                                  />
                                  <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0 mb-0.5">
                                    <button
                                      type="button"
                                      className={`px-2 py-1.5 text-[11px] font-semibold ${form.toleranceUnit !== 'pct' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}
                                      onClick={() => setForm({ ...form, toleranceUnit: 'abs' })}
                                    >
                                      abs
                                    </button>
                                    <button
                                      type="button"
                                      className={`px-2 py-1.5 text-[11px] font-semibold ${form.toleranceUnit === 'pct' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}
                                      onClick={() => setForm({ ...form, toleranceUnit: 'pct' })}
                                    >
                                      %
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {showOptionForm ? (
                      <div className="space-y-2">
                        <div ref={optionInputWrapRef}>
                          <Input
                            label="Dropdown options"
                            placeholder="Type an option and press Enter"
                            value={optionDraft}
                            onChange={(e) => setOptionDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addOption();
                              }
                            }}
                          />
                        </div>
                        {form.options.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {form.options.map((val, idx) => (
                              <div
                                key={`${val}-${idx}`}
                                className="flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-blue-50 text-blue-700 border-blue-200"
                              >
                                <span>{val}</span>
                                <button
                                  type="button"
                                  onClick={() => setForm({ ...form, options: form.options.filter((_, i) => i !== idx) })}
                                  className="opacity-60 hover:opacity-100"
                                  aria-label={`Remove ${val}`}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
                    <textarea
                      rows={3}
                      value={form.remarks}
                      onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                      placeholder="Optional notes"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-500 resize-y min-h-[6.5rem] max-h-40 text-[11px]"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-2 pt-1">
                  {showOptionForm ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={Plus}
                      disabled={!optionDraft.trim() || saving}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={addOption}
                      className="w-full !bg-blue-50 !text-blue-700 !border-blue-200 hover:!bg-blue-100 hover:!text-blue-800"
                    >
                      Add option
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    size="sm"
                    icon={form.editingLocalId ? Pencil : Plus}
                    disabled={!form.label.trim() || !selectedType || saving}
                    onClick={submitForm}
                    className="w-full"
                  >
                    {form.editingLocalId ? 'Update in table' : 'Add to table'}
                  </Button>
                  {form.editingLocalId ? (
                    <>
                      <Button
                        variant="danger-light"
                        size="sm"
                        icon={Trash2}
                        onClick={() => {
                          const row = rows.find((r) => r.localId === form.editingLocalId);
                          if (row) removeRow(row);
                        }}
                        className="w-full"
                      >
                        Remove from table
                      </Button>
                      <Button size="sm" variant="secondary" icon={X} onClick={resetForm} className="w-full">
                        Cancel
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </DesktopWriteGate>
          </div>
        )}
        right={(
          <div className="h-full flex flex-col min-h-0">
            <CatalogTablePanel
              title={selectedType ? `${selectedType.name} — ${fieldNoun.toLowerCase()}s` : `${fieldNoun}s`}
              subtitle={tableSubtitle}
              isEmpty={rows.length === 0}
              emptyMessage={`No ${fieldNoun.toLowerCase()}s yet. Add one from the left.`}
              headerAction={<MmTableSaveButton />}
            >
              <CatalogTable headers={tableHeaders}>
                {rows.map((row, idx) => (
                  <CatalogTableRow
                    key={row.localId}
                    onClick={() => editRow(row)}
                    selected={form.editingLocalId === row.localId}
                  >
                    <CatalogTableCell className={catalogSerialCellClass}>{idx + 1}</CatalogTableCell>
                    <CatalogTableCell className="font-medium text-slate-800 truncate">
                      {row.label}
                    </CatalogTableCell>
                    {isTest ? (
                      <>
                        <CatalogTableCell className="text-slate-600">
                          {MM_FIELD_TYPES.find((t) => t.value === row.dataType)?.label ?? row.dataType}
                          {tolerancePreview(row) ? (
                            <span className="text-slate-400"> · {tolerancePreview(row)}</span>
                          ) : null}
                        </CatalogTableCell>
                        <CatalogTableCell>
                          {row.options.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {row.options.map((opt) => (
                                <span
                                  key={opt}
                                  className="px-1.5 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-800 text-[10px] font-medium"
                                >
                                  {opt}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </CatalogTableCell>
                      </>
                    ) : (
                      <CatalogTableCell className="text-slate-500 truncate max-w-[12rem]">
                        {row.remarks.trim() || '—'}
                      </CatalogTableCell>
                    )}
                  </CatalogTableRow>
                ))}
              </CatalogTable>
            </CatalogTablePanel>
          </div>
        )}
      />
    );
  },
);
