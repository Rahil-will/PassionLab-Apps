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
import { MmTableSaveButton } from './MmTableSaveButton';

export const MM_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'select', label: 'Dropdown' },
] as const;

export const MM_CAPTURE_SITES = [
  { value: 'either', label: 'Mill or warehouse' },
  { value: 'mill', label: 'Mill only' },
  { value: 'warehouse', label: 'Warehouse only' },
  { value: 'both', label: 'Mill and warehouse' },
] as const;

export interface MmFieldRow {
  localId: string;
  id: string | null;
  rowVersion: number;
  label: string;
  dataType: string;
  options: string[];
  remarks: string;
  captureSite: string;
  /** Fabric v4: per-roll vs per-lot test field. */
  testLevel?: 'roll' | 'lot';
  /** Fabric v4: stage codes where this field is required. */
  requiredAtStages?: string[];
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
  /** When set (Fabric v4), show Level + Required-at-stages on test fields. */
  stageOptions?: { value: string; label: string }[];
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
  testLevel: 'roll' as 'roll' | 'lot',
  requiredAtStages: [] as string[],
  editingLocalId: null as string | null,
};

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
      stageOptions,
      onError,
      onDirtyChange,
      onSaved,
    },
    ref,
  ) {
    const showV4Rules = variant === 'test' && Array.isArray(stageOptions);
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
      form.label.trim() || form.remarks.trim() || form.options.length || optionDraft.trim(),
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
        onError?.('Shade is mill identity and a warehouse testing outcome, not a testing parameter');
        return;
      }
      if (rows.some((r) => r.localId !== form.editingLocalId && r.label.toLowerCase() === label.toLowerCase())) {
        onError?.(`That ${fieldNoun.toLowerCase()} already exists`);
        return;
      }
      const options = isTest && form.dataType === 'select' ? mergeOptionDraft(form.options, optionDraft) : [];
      const dataType = isTest ? form.dataType : 'text';
      const remarks = isTest ? '' : form.remarks.trim();

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
                captureSite: isTest ? form.captureSite || 'either' : 'either',
                testLevel: showV4Rules ? form.testLevel : r.testLevel,
                requiredAtStages: showV4Rules ? form.requiredAtStages : r.requiredAtStages,
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
            captureSite: form.captureSite || 'either',
            testLevel: showV4Rules ? form.testLevel : 'roll',
            requiredAtStages: showV4Rules ? form.requiredAtStages : [],
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
        captureSite: row.captureSite || 'either',
        testLevel: row.testLevel === 'lot' ? 'lot' : 'roll',
        requiredAtStages: row.requiredAtStages ?? [],
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
            onError?.('Shade is mill identity and a warehouse testing outcome, not a testing parameter');
            return false;
          }
          if (rows.some((r) => r.localId !== form.editingLocalId && r.label.toLowerCase() === pendingLabel.toLowerCase())) {
            onError?.(`That ${fieldNoun.toLowerCase()} already exists`);
            return false;
          }
          const options = isTest && form.dataType === 'select' ? mergeOptionDraft(form.options, optionDraft) : [];
          const dataType = isTest ? form.dataType : 'text';
          const remarks = isTest ? '' : form.remarks.trim();
          const current = nextDrafts[activeTypeId] ?? savedRows(activeTypeId);
          const captureSite = isTest ? (form.captureSite || 'either') : 'either';
          const nextRows = form.editingLocalId
            ? current.map((r) => (r.localId === form.editingLocalId
              ? {
                ...r,
                label: pendingLabel,
                dataType,
                options,
                remarks,
                captureSite,
                testLevel: showV4Rules ? form.testLevel : r.testLevel,
                requiredAtStages: showV4Rules ? form.requiredAtStages : r.requiredAtStages,
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
              captureSite,
              testLevel: showV4Rules ? form.testLevel : 'roll',
              requiredAtStages: showV4Rules ? form.requiredAtStages : [],
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
    }), [dirtyTypeIds, formDirty, drafts, persist, savedRows, onDirtyChange, onError, onSaved, form, optionDraft, activeTypeId, rows, isTest, fieldNoun, showV4Rules]);

    const tableHeaders = isTest
      ? (showV4Rules
        ? ['S.No', fieldNoun, 'Input', 'Where', 'Level', 'Stages', 'Options']
        : ['S.No', fieldNoun, 'Input', 'Where', 'Options'])
      : ['S.No', fieldNoun, 'Remarks'];

    return (
      <EditorSplitLayout
        scrollable={false}
        leftScrollable
        rightScrollable
        fillHeight
        left={(
          <div className="space-y-4">
            <SelectDropdown
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
                    <SelectDropdown
                      label="Where captured"
                      value={form.captureSite}
                      onChange={(v) => setForm({ ...form, captureSite: v })}
                      options={MM_CAPTURE_SITES.map((site) => ({ value: site.value, label: site.label }))}
                      className="w-full"
                    />
                    <SelectDropdown
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
                    {showV4Rules ? (
                      <>
                        <SelectDropdown
                          label="Level"
                          value={form.testLevel}
                          onChange={(v) =>
                            setForm({ ...form, testLevel: v === 'lot' ? 'lot' : 'roll' })
                          }
                          options={[
                            { value: 'roll', label: 'Per roll' },
                            { value: 'lot', label: 'Per lot' },
                          ]}
                          className="w-full"
                        />
                        <div>
                          <p className="text-[10px] font-semibold text-slate-600 mb-1">Required at stages</p>
                          <div className="flex flex-wrap gap-2">
                            {(stageOptions ?? []).map((stage) => (
                              <label key={stage.value} className="text-[11px] text-slate-700 flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={form.requiredAtStages.includes(stage.value)}
                                  onChange={(e) => {
                                    const requiredAtStages = e.target.checked
                                      ? [...form.requiredAtStages, stage.value]
                                      : form.requiredAtStages.filter((code) => code !== stage.value);
                                    setForm({ ...form, requiredAtStages });
                                  }}
                                />
                                {stage.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      </>
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
                        </CatalogTableCell>
                        <CatalogTableCell className="text-slate-600">
                          {MM_CAPTURE_SITES.find((site) => site.value === row.captureSite)?.label ?? 'Mill or warehouse'}
                        </CatalogTableCell>
                        {showV4Rules ? (
                          <>
                            <CatalogTableCell className="text-slate-600">
                              {row.testLevel === 'lot' ? 'Per lot' : 'Per roll'}
                            </CatalogTableCell>
                            <CatalogTableCell className="text-slate-600 truncate">
                              {(row.requiredAtStages ?? []).join(', ') || '—'}
                            </CatalogTableCell>
                          </>
                        ) : null}
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
