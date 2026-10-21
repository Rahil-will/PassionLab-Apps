import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, Input, SelectDropdown } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { EditorSplitLayout } from '../../../components/settings/EditorSplitLayout';
import {
  CatalogTable,
  CatalogTableCell,
  CatalogTablePanel,
  CatalogTableRow,
  catalogSerialCellClass,
} from '../../../components/settings/CatalogTablePanel';
import { useNotificationStore } from '../../../stores';
import { EditorToggle } from '../components/EditorToggle';
import { MmTableSaveButton } from '../components/MmTableSaveButton';
import { mmSaveProcess, type MmChallanFieldType, type MmProcessRow } from '../lib/mmV4Rpc';
import { useMmProcesses, useRefreshMmV4Config } from '../lib/useMmV4Config';

export interface MmProcessFormHandle {
  save: () => Promise<boolean>;
  isDirty: () => boolean;
}

type FieldDraft = {
  localId: string;
  key: string;
  label: string;
  type: MmChallanFieldType;
  options: string;
  required: boolean;
};

let localSeq = 1;
const nextKey = () => `field-${localSeq++}`;

function asFieldType(value: string): MmChallanFieldType {
  if (value === 'number' || value === 'select') return value;
  return 'text';
}

function typeLabel(type: MmChallanFieldType): string {
  if (type === 'number') return 'Number';
  if (type === 'select') return 'Dropdown';
  return 'Text';
}

function fieldsFromProcess(row: MmProcessRow | undefined): FieldDraft[] {
  return (row?.challan_fields ?? []).map((field) => ({
    localId: field.key || nextKey(),
    key: field.key ?? '',
    label: field.label,
    type: asFieldType(field.type),
    options: (field.options ?? []).join(', '),
    required: field.required === true,
  }));
}

const MmProcessFormPage = forwardRef<
  MmProcessFormHandle,
  { onDirtyChange: (dirty: boolean) => void }
>(function MmProcessFormPage({ onDirtyChange }, ref) {
  const showNotification = useNotificationStore((s) => s.showNotification);
  const refreshV4 = useRefreshMmV4Config();
  const processesQ = useMmProcesses();

  const processes = useMemo(
    () => (processesQ.data ?? []).filter((row) => row.active !== false),
    [processesQ.data],
  );

  const [processId, setProcessId] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [baseline, setBaseline] = useState('[]');
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState<MmChallanFieldType>('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!processId && processes[0]) setProcessId(processes[0].id);
  }, [processId, processes]);

  useEffect(() => {
    const row = processes.find((item) => item.id === processId);
    const next = fieldsFromProcess(row);
    setFields(next);
    setBaseline(JSON.stringify(next));
    setEditingId(null);
    setLabel('');
    setFieldType('text');
    setOptions('');
    setRequired(false);
  }, [processId, processesQ.data]);

  const formDirty = Boolean(label.trim() || (editingId && (
    fields.find((field) => field.localId === editingId)?.label !== label
  )));
  const dirty = JSON.stringify(fields) !== baseline || formDirty;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const resetForm = () => {
    setEditingId(null);
    setLabel('');
    setFieldType('text');
    setOptions('');
    setRequired(false);
  };

  const applyForm = (rows: FieldDraft[]): FieldDraft[] | null => {
    const trimmed = label.trim();
    if (!trimmed) {
      if (editingId) {
        showNotification('Enter a field label', 'error');
        return null;
      }
      return rows;
    }
    const optionList = options.split(',').map((item) => item.trim()).filter(Boolean);
    if (fieldType === 'select' && optionList.length === 0) {
      showNotification('Dropdown fields need options', 'error');
      return null;
    }
    const next: FieldDraft = {
      localId: editingId ?? nextKey(),
      key: rows.find((field) => field.localId === editingId)?.key ?? '',
      label: trimmed,
      type: fieldType,
      options: fieldType === 'select' ? optionList.join(', ') : '',
      required,
    };
    if (editingId) return rows.map((field) => (field.localId === editingId ? next : field));
    return [...rows, next];
  };

  const loadField = (field: FieldDraft) => {
    setEditingId(field.localId);
    setLabel(field.label);
    setFieldType(field.type);
    setOptions(field.options);
    setRequired(field.required);
  };

  useImperativeHandle(ref, () => ({
    isDirty: () => JSON.stringify(fields) !== baseline || Boolean(label.trim()),
    save: async () => {
      const row = (processesQ.data ?? []).find((item) => item.id === processId);
      if (!row) {
        showNotification('Select a process', 'error');
        return false;
      }
      const pending = applyForm(fields);
      if (!pending) return false;
      setFields(pending);
      resetForm();
      const res = await mmSaveProcess({
        id: row.id,
        name: row.name,
        expected_loss_pct: row.expected_loss_pct ?? null,
        active: row.active !== false,
        sort_order: row.sort_order ?? 0,
        done_inhouse: row.done_inhouse === true,
        done_external: row.done_external === true,
        challan_fields: pending.map((field) => ({
          ...(field.key ? { key: field.key } : {}),
          label: field.label.trim(),
          type: field.type,
          required: field.required,
          ...(field.type === 'select'
            ? { options: field.options.split(',').map((item) => item.trim()).filter(Boolean) }
            : {}),
        })),
      });
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return false;
      }
      showNotification('Process requirement form saved', 'success');
      await Promise.all([processesQ.refetch(), refreshV4()]);
      return true;
    },
  }), [fields, label, processId, processesQ, refreshV4, showNotification]);

  const processName = processes.find((row) => row.id === processId)?.name || '—';

  if (processesQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px]">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">
      <EditorSplitLayout
        fillHeight
        leftScrollable
        rightScrollable
        left={(
          <DesktopWriteGate>
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                {editingId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingId ? 'Edit field' : 'Add field'}
              </h4>
              <SelectDropdown size="compact"
                label="Process"
                value={processId}
                onChange={(value) => {
                  if (dirty) {
                    showNotification('Save the fields before switching process', 'error');
                    return;
                  }
                  setProcessId(value);
                }}
                options={processes.map((row) => ({ value: row.id, label: row.name }))}
              />
              <Input label="Label *" value={label} onChange={(event) => setLabel(event.target.value)} />
              <SelectDropdown size="compact"
                label="Type"
                value={fieldType}
                onChange={(value) => setFieldType(asFieldType(value))}
                options={[
                  { value: 'text', label: 'Text' },
                  { value: 'number', label: 'Number' },
                  { value: 'select', label: 'Dropdown' },
                ]}
              />
              {fieldType === 'select' ? (
                <Input
                  label="Dropdown options"
                  value={options}
                  placeholder="Comma list"
                  onChange={(event) => setOptions(event.target.value)}
                />
              ) : null}
              <EditorToggle label="Required" on={required} onChange={setRequired} />
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={editingId ? Pencil : Plus}
                  disabled={!label.trim()}
                  onClick={() => {
                    const next = applyForm(fields);
                    if (!next) return;
                    setFields(next);
                    resetForm();
                  }}
                  className="w-full"
                >
                  {editingId ? 'Update in table' : 'Add to table'}
                </Button>
                {editingId ? (
                  <>
                    <Button
                      type="button"
                      variant="danger-light"
                      size="sm"
                      icon={Trash2}
                      onClick={() => {
                        setFields(fields.filter((item) => item.localId !== editingId));
                        resetForm();
                      }}
                      className="w-full"
                    >
                      Remove from table
                    </Button>
                    <Button type="button" size="sm" variant="secondary" icon={X} onClick={resetForm} className="w-full">
                      Cancel
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </DesktopWriteGate>
        )}
        right={(
          <CatalogTablePanel
            title="Challan fields"
            subtitle="Click a row to edit."
            isEmpty={fields.length === 0}
            emptyMessage="No fields on this process yet."
            headerAction={<MmTableSaveButton />}
          >
            <CatalogTable headers={['S.No', 'Process', 'Label', 'Type', 'Dropdown options', 'Required']}>
              {fields.map((field, index) => (
                <CatalogTableRow key={field.localId} onClick={() => loadField(field)} selected={editingId === field.localId}>
                  <CatalogTableCell className={catalogSerialCellClass}>{index + 1}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-700 truncate">{processName}</CatalogTableCell>
                  <CatalogTableCell className="font-medium text-slate-800 truncate">{field.label}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">{typeLabel(field.type)}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600 truncate">{field.type === 'select' ? field.options : '—'}</CatalogTableCell>
                  <CatalogTableCell className="text-slate-600">{field.required ? 'Yes' : 'No'}</CatalogTableCell>
                </CatalogTableRow>
              ))}
            </CatalogTable>
          </CatalogTablePanel>
        )}
      />
    </div>
  );
});

export default MmProcessFormPage;
